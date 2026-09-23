import modal
import subprocess
import tempfile
import os
import json
import re
import copy
from pathlib import Path
from typing import Literal
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

# ---------------------------------------------------------------------------
# Legato constants
# ---------------------------------------------------------------------------
# Full model: 107M params, ~429 MB — fits on T4
# Small model: 11M params, ~44 MB — less accurate, for baseline comparisons only
LEGATO_MODEL_PATH = "guangyangmusic/legato"

app = modal.App("ohsheet-omr")

_legato_models: dict = {}

# ---------------------------------------------------------------------------
# Jazzmus constants
# ---------------------------------------------------------------------------
JAZZMUS_HF_REPO = "JuanCarlosMartinezSevilla/jazzmus-model"
JAZZMUS_IMG_HEIGHT = 128   # pixels — fixed height used during SMT training
JAZZMUS_MAX_WIDTH = 1000   # pixels — cap to avoid OOM on very wide staves

# Module-level caches so models are loaded only once per warm container.
_jazzmus_models: dict = {}

try:
    from pdf2image import convert_from_bytes
except ImportError:
    pass

try:
    import firebase_admin
    from firebase_admin import credentials as fb_credentials, auth as fb_auth
except ImportError:
    pass

try:
    from firebase_admin import firestore as fb_firestore
except ImportError:
    pass

image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04",
        add_python="3.12",
    )
    .apt_install(
        "git",
        "libgl1-mesa-glx",
        "libglib2.0-0",
        "libsm6",
        "libxrender1",
        "libxext6",
        "poppler-utils",
    )
    .pip_install("fastapi", "python-multipart", "poetry", "pdf2image", "firebase-admin")
    .run_commands(
        # HOMR (classical fallback)
        "git clone https://github.com/liebharc/homr /homr",
        "cd /homr && poetry config virtualenvs.create false"
        " && poetry install --only main,gpu",
        "python -c 'from homr.main import download_weights; download_weights(True)'",
        # Jazzmus (jazz)
        "git clone https://github.com/JuanCarlosMartinezSevilla/ISMIR-Jazzmus.git /jazzmus",
        "pip install -e '/jazzmus[predict]'",
        "pip install music21 safetensors",
        # Pre-download jazzmus weights into the HuggingFace cache
        "python -c \"from huggingface_hub import snapshot_download; snapshot_download('JuanCarlosMartinezSevilla/jazzmus-model')\"",
        # Legato (classical primary) — clone repo, install inference-only deps
        "git clone https://github.com/guang-yng/legato.git /legato",
        # Filter out SSH-gated deps (musicdiff) and training-only deps (deepspeed, wandb, zss, fire)
        # Also exclude torch/numpy/pillow — reuse versions already installed by jazzmus/HOMR
        "grep -v -E 'musicdiff|deepspeed|wandb|zss|^fire|^torch|^numpy|^pillow' "
        "/legato/requirements.txt > /tmp/legato_req.txt "
        "&& pip install -r /tmp/legato_req.txt",
        # Pre-download Legato weights into the HuggingFace cache
        # Requires HUGGING_FACE_HUB_TOKEN env var from the huggingface-token secret
        "PYTHONPATH=/legato python -c \""
        "import sys; sys.path.insert(0, '/legato'); "
        "from legato.models import LegatoModel; "
        "from transformers import AutoProcessor; "
        f"LegatoModel.from_pretrained('{LEGATO_MODEL_PATH}'); "
        f"AutoProcessor.from_pretrained('{LEGATO_MODEL_PATH}')\"",
        secrets=[modal.Secret.from_name("hf-ohsheet")],
    )
)

web_app = FastAPI()
web_app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://music-app-924.pages.dev", 
                   "http://localhost:5173"],
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

_bearer_scheme = HTTPBearer()
_firebase_app = None


def _get_firebase_app():
    global _firebase_app
    if _firebase_app is not None:
        return _firebase_app
    sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "")
    if not sa_json:
        raise RuntimeError("FIREBASE_SERVICE_ACCOUNT_JSON secret not set")
    cred = fb_credentials.Certificate(json.loads(sa_json))
    _firebase_app = firebase_admin.initialize_app(cred)
    return _firebase_app


async def verify_token(
    creds: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
) -> str:
    try:
        fa = _get_firebase_app()
        decoded = fb_auth.verify_id_token(creds.credentials, app=fa)
        return decoded["uid"]
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Unauthorized: {exc}")


def _load_jazzmus_models() -> dict:
    """Load YOLO staff detector and SMT transcription model into the module cache.

    Models are loaded once on the first jazz transcription request and reused
    for the lifetime of the warm container, avoiding repeated GPU setup costs.
    """
    if _jazzmus_models:
        return _jazzmus_models

    import torch
    from ultralytics import YOLO
    from huggingface_hub import hf_hub_download
    from safetensors.torch import load_file
    from torch.nn import Conv1d
    from jazzmus.model.smt.configuration_smt import SMTConfig
    from jazzmus.model.smt.modeling_smt import SMTModelForCausalLM

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    yolo_path = hf_hub_download(repo_id=JAZZMUS_HF_REPO, filename="yolo_staff_detector.pt")
    yolo = YOLO(yolo_path)

    config = SMTConfig.from_pretrained(JAZZMUS_HF_REPO)
    weights_file = hf_hub_download(repo_id=JAZZMUS_HF_REPO, filename="model.safetensors")
    sd = load_file(weights_file)
    embed_size = sd["decoder.embedding.weight"].shape[0]
    out_size = sd["decoder.out_layer.weight"].shape[0]
    config.out_categories = embed_size
    model = SMTModelForCausalLM(config)
    # embed_size != out_size in released weights; replace output projection accordingly
    model.decoder.out_layer = Conv1d(config.d_model, out_size, kernel_size=1)
    model.load_state_dict(sd, strict=True)
    model.to(device)
    model.positional_2D.pe = model.positional_2D.pe.to(device)
    model.decoder.positional_1D.pe = model.decoder.positional_1D.pe.to(device)
    model.eval()

    _jazzmus_models.update({"yolo": yolo, "model": model, "device": device})
    return _jazzmus_models


def _load_legato_models() -> dict:
    """Load Legato model + processor into the module cache."""
    if _legato_models:
        return _legato_models

    import sys
    if "/legato" not in sys.path:
        sys.path.insert(0, "/legato")

    import torch
    from legato.models import LegatoModel
    from transformers import AutoProcessor, GenerationConfig

    import os
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    if device == "cuda":
        free, total = torch.cuda.mem_get_info()
        print(f"[Legato] GPU before load: {free/1e9:.2f}/{total/1e9:.2f} GB free")
    print(f"[Legato] Loading model dtype={dtype} device={device}")
    model = LegatoModel.from_pretrained(LEGATO_MODEL_PATH, torch_dtype=dtype)
    model = model.to(device)
    model.eval()
    if device == "cuda":
        free, total = torch.cuda.mem_get_info()
        print(f"[Legato] GPU after load: {free/1e9:.2f}/{total/1e9:.2f} GB free")

    processor = AutoProcessor.from_pretrained(LEGATO_MODEL_PATH)
    generation_config = GenerationConfig(max_length=2048, num_beams=10, repetition_penalty=1.1)

    _legato_models.update({
        "model": model,
        "processor": processor,
        "generation_config": generation_config,
        "device": device,
    })
    return _legato_models


def _run_legato(image_path: Path) -> str:
    """Transcribe a single full-page image with Legato, return MusicXML string."""
    import sys
    if "/legato" not in sys.path:
        sys.path.insert(0, "/legato")

    import importlib.util
    import torch
    from PIL import Image as PILImage

    models = _load_legato_models()
    model = models["model"]
    processor = models["processor"]
    generation_config = models["generation_config"]
    device = models["device"]

    img = PILImage.open(image_path).convert("RGB")
    print(f"[Legato] Input image size: {img.size}")
    inputs = processor(images=[img], truncation=True, return_tensors="pt")
    inputs = {k: v.to(device) for k, v in inputs.items()}
    if device == "cuda":
        free, total = torch.cuda.mem_get_info()
        print(f"[Legato] GPU before generate: {free/1e9:.2f}/{total/1e9:.2f} GB free")

    with torch.no_grad():
        outputs = model.generate(**inputs, generation_config=generation_config, use_model_defaults=False)

    if device == "cuda":
        free, total = torch.cuda.mem_get_info()
        print(f"[Legato] GPU after generate: {free/1e9:.2f}/{total/1e9:.2f} GB free")
    abc_outputs = processor.batch_decode(outputs.tolist(), skip_special_tokens=True)
    abc_str = abc_outputs[0] if abc_outputs else ""
    print(f"[Legato] ABC output length: {len(abc_str)} chars")
    print(f"[Legato] ABC (first 300 chars): {abc_str[:300]}")

    if not abc_str.strip():
        raise HTTPException(status_code=500, detail="Legato produced empty output")

    return abc_str


def _abc_to_musicxml(abc_pages: list[str]) -> str:
    """Convert one or more ABC pages to a single MusicXML string.

    Each page is cleaned up and converted independently (cleanup_abc assumes a
    single-tune ABC header), then multiple pages are merged via music21.
    """
    import importlib.util

    spec = importlib.util.spec_from_file_location("legato_convert", "/legato/utils/convert.py")
    convert_mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    spec.loader.exec_module(convert_mod)  # type: ignore[union-attr]

    xml_pages: list[str] = []
    for abc_str in abc_pages:
        clean_abc = convert_mod.cleanup_abc(abc_str)
        if not clean_abc:
            raise HTTPException(status_code=500, detail="Legato ABC cleanup produced empty output")
        result = subprocess.run(
            ["python", "/legato/utils/abc2xml.py", "-"],
            input=clean_abc.encode("utf-8"),
            capture_output=True,
        )
        if result.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=f"abc2xml conversion failed: {result.stderr.decode('utf-8', errors='replace')[:500]}",
            )
        xml_str = result.stdout.decode("utf-8")
        if not xml_str.strip():
            raise HTTPException(status_code=500, detail="abc2xml produced empty MusicXML")
        xml_pages.append(xml_str)

    return _merge_musicxml(xml_pages)


def _run_homr(image_path: Path, tmpdir: str) -> str:
    """Transcribe a single image with HOMR, return MusicXML string."""
    result = subprocess.run(
        ["homr", str(image_path)],
        cwd=tmpdir,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"homr failed: {result.stderr}",
        )
    xml_files = list(Path(tmpdir).glob(f"{image_path.stem}*.musicxml"))
    if not xml_files:
        raise HTTPException(status_code=500, detail="homr produced no output")
    return xml_files[0].read_text(encoding="utf-8")


def _run_jazzmus(image_path: Path) -> str:
    """Transcribe a single full-page image to a **kern string.

    Uses YOLO to detect staff regions, then runs the SMT model on each crop.
    Sections are joined with the Humdrum line-break directive so the caller
    can split them when building the combined score.
    """
    import cv2
    import numpy as np
    from PIL import Image as PILImage
    from jazzmus.dataset.data_preprocessing import convert_img_to_tensor
    from jazzmus.dataset.tokenizer import untokenize
    import torch

    models = _load_jazzmus_models()
    yolo, model, device = models["yolo"], models["model"], models["device"]

    results = yolo(str(image_path))
    image = PILImage.open(image_path)
    staff_boxes = []
    for result in results:
        for box, cls in zip(result.boxes.xyxy, result.boxes.cls):
            if result.names[int(cls)].lower() == "staff":
                x1, y1, x2, y2 = map(int, box.tolist())
                staff_boxes.append((y1, x1, y2, x2))
    staff_boxes.sort(key=lambda b: b[0])

    if not staff_boxes:
        raise HTTPException(status_code=500, detail="No staff regions detected in image")

    transcriptions = []
    for y1, x1, y2, x2 in staff_boxes:
        crop = image.crop((x1, y1, x2, y2))
        img = np.array(crop.convert("L"))
        width = int(np.ceil(img.shape[1] * JAZZMUS_IMG_HEIGHT / img.shape[0]))
        width = min(width, JAZZMUS_MAX_WIDTH)
        img = cv2.resize(img, (width, JAZZMUS_IMG_HEIGHT))
        tensor = convert_img_to_tensor(img).to(device)
        with torch.no_grad():
            predicted_sequence, _ = model.predict(input=tensor, convert_to_str=True)
        transcriptions.append(untokenize(predicted_sequence))

    return "!!linebreak\n".join(transcriptions)


def _kern_to_musicxml(full_kern: str) -> str:
    """Convert jazzmus **kern + **mxhm output to MusicXML string."""
    from music21 import stream, harmony as m21harmony, converter, clef, meter, key

    def parse_mxhm_chord(token: str):
        if not token or token in ('.', '*') or token.startswith('*') or token.startswith('='):
            return None
        token = token.strip()
        if ':' not in token:
            return None
        root, kind = token.split(':', 1)
        if len(root) == 2 and root[1] == 'b':
            root = root[0] + '-'
        kind_map = {
            'maj': 'maj', 'min': 'm', '7': '7', 'maj7': 'maj7', 'min7': 'm7',
            'hdim7': 'm7b5', 'dim7': 'dim7', 'dim': 'dim', 'aug': 'aug',
            'aug7': 'aug7', 'sus4': 'sus4', 'sus2': 'sus2',
            '9': '9', 'maj9': 'maj9', 'min9': 'm9',
            '11': '11', 'maj11': 'maj11', 'min11': 'm11',
            '13': '13', 'maj13': 'maj13', 'min13': 'm13',
            'maj6': 'maj6', 'min6': 'm6', 'minmaj7': 'mM7',
        }
        base_kind = re.split(r'[(\[]', kind)[0]
        label = root + kind_map.get(base_kind, base_kind)
        try:
            return m21harmony.ChordSymbol(label)
        except Exception:
            return None

    def parse_section(section_text: str):
        lines = section_text.strip().split('\n')
        kern_lines, harm_tokens = [], []
        for line in lines:
            parts = line.split('\t')
            kern_lines.append(parts[0])
            harm_tokens.append(parts[1] if len(parts) > 1 else '.')

        kern_only = '\n'.join(kern_lines)
        kern_file = tempfile.mktemp(suffix='.krn')
        try:
            with open(kern_file, 'w') as f:
                f.write(kern_only)
            score = converter.parse(kern_file)
        finally:
            if os.path.exists(kern_file):
                os.unlink(kern_file)

        note_line_indices = []
        for i, line in enumerate(lines):
            col = line.split('\t')[0].strip()
            if col and not col.startswith('*') and not col.startswith('=') \
               and not col.startswith('!') and col != '**kern':
                note_line_indices.append(i)

        chords_by_line = {}
        for i, token in enumerate(harm_tokens):
            cs = parse_mxhm_chord(token)
            if cs is not None:
                chords_by_line[i] = cs

        return score, chords_by_line, note_line_indices

    sections = full_kern.split('!!linebreak\n')
    combined_score = stream.Score()
    combined_part = stream.Part()
    combined_score.insert(0, combined_part)
    current_offset = 0.0

    first_section = True
    for section_text in sections:
        score, chords_by_line, note_line_indices = parse_section(section_text)
        if not score.parts:
            continue
        part = score.parts[0]
        flat_notes = list(score.flatten().notesAndRests)

        # Only keep clef/time/key signature from the first section; later ones
        # redeclare per kern syntax but would show up as spurious mid-piece symbols.
        for m in part.getElementsByClass('Measure'):
            m_copy = copy.deepcopy(m)
            if not first_section:
                for el in list(m_copy.getElementsByClass((clef.Clef, meter.TimeSignature, key.KeySignature))):
                    m_copy.remove(el)
            combined_part.insert(current_offset + m.offset, m_copy)
        first_section = False

        for line_idx, cs in chords_by_line.items():
            try:
                note_idx = note_line_indices.index(line_idx)
                if note_idx >= len(flat_notes):
                    continue
                abs_offset = current_offset + flat_notes[note_idx].offset
                for m in combined_part.getElementsByClass('Measure'):
                    if m.offset <= abs_offset < m.offset + m.barDuration.quarterLength:
                        m.insert(abs_offset - m.offset, copy.deepcopy(cs))
                        break
            except ValueError:
                pass

        current_offset += part.duration.quarterLength

    xml_path = tempfile.mktemp(suffix='.musicxml')
    try:
        combined_score.write('musicxml', fp=xml_path)
        return open(xml_path, encoding='utf-8').read()
    finally:
        if os.path.exists(xml_path):
            os.unlink(xml_path)


def _merge_musicxml(xml_list: list[str]) -> str:
    """Merge multiple single-page MusicXML scores (one per HOMR page) into one."""
    if len(xml_list) == 1:
        return xml_list[0]

    from music21 import converter, stream
    import copy

    def _parse_xml(xml_str: str):
        with tempfile.NamedTemporaryFile(suffix=".musicxml", mode="w", delete=False, encoding="utf-8") as f:
            f.write(xml_str)
            path = f.name
        try:
            return converter.parse(path)
        finally:
            if os.path.exists(path):
                os.unlink(path)

    combined = _parse_xml(xml_list[0])
    combined_parts = list(combined.parts)
    page_offset = combined.duration.quarterLength

    for xml_str in xml_list[1:]:
        page_score = _parse_xml(xml_str)
        for part_idx, part in enumerate(page_score.parts):
            if part_idx < len(combined_parts):
                for m in part.getElementsByClass("Measure"):
                    combined_parts[part_idx].insert(page_offset + m.offset, copy.deepcopy(m))
        page_offset += page_score.duration.quarterLength

    xml_out = tempfile.mktemp(suffix=".musicxml")
    try:
        combined.write("musicxml", fp=xml_out)
        return open(xml_out, encoding="utf-8").read()
    finally:
        if os.path.exists(xml_out):
            os.unlink(xml_out)


@web_app.post("/transcribe-multi")
async def transcribe_multi(
    files: list[UploadFile] = File(...),
    score_type: Literal["classical", "jazz"] = Form(...),
    model: str = Form("legato"),
    uid: str = Depends(verify_token),
):
    import io
    all_images: list[bytes] = []

    for file in files:
        contents = await file.read()

        if file.content_type == "application/pdf":
            pages = convert_from_bytes(contents, dpi=300)
            for page in pages:
                buf = io.BytesIO()
                page.save(buf, format="PNG")
                all_images.append(buf.getvalue())
        else:
            all_images.append(contents)

    with tempfile.TemporaryDirectory() as tmpdir:
        if model == "homr":
            all_xml: list[str] = []
            for i, image_bytes in enumerate(all_images):
                image_path = Path(tmpdir) / f"input_{i}.png"
                image_path.write_bytes(image_bytes)
                all_xml.append(_run_homr(image_path, tmpdir))
            xml_content = _merge_musicxml(all_xml)
        elif score_type == "jazz":
            kern_sections: list[str] = []
            for i, image_bytes in enumerate(all_images):
                image_path = Path(tmpdir) / f"input_{i}.png"
                image_path.write_bytes(image_bytes)
                kern_sections.append(_run_jazzmus(image_path))
            full_kern = "!!linebreak\n".join(kern_sections)
            xml_content = _kern_to_musicxml(full_kern)
        else:
            abc_pages: list[str] = []
            for i, image_bytes in enumerate(all_images):
                image_path = Path(tmpdir) / f"input_{i}.png"
                image_path.write_bytes(image_bytes)
                abc_pages.append(_run_legato(image_path))
            xml_content = _abc_to_musicxml(abc_pages)

    return Response(
        content=xml_content,
        media_type="text/xml",
        headers={"Content-Disposition": "attachment; filename=score.musicxml"},
    )


@web_app.post("/ab-feedback")
async def ab_feedback_endpoint(
    preferred_model: str = Form(...),
    session_id: str = Form(...),
    file_name: str = Form(...),
    uid: str = Depends(verify_token),
):
    try:
        fa = _get_firebase_app()
        db = fb_firestore.client(app=fa)

        db.collection("ab_feedback").add({
            "uid": uid,
            "preferred_model": preferred_model,
            "session_id": session_id,
            "file_name": file_name,
            "created_at": fb_firestore.SERVER_TIMESTAMP,
        })

        stats_ref = db.collection("stats").document("ab_votes")
        stats_ref.set(
            {preferred_model: fb_firestore.Increment(1)},
            merge=True,
        )

        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save feedback: {exc}")


@app.function(
    gpu="A10G",
    image=image,
    timeout=600,
    secrets=[
        modal.Secret.from_name("firebase-service-account"),
        modal.Secret.from_name("hf-ohsheet"),
    ],
)
@modal.asgi_app()
def fastapi_app():
    return web_app
