import { useState, useEffect, useCallback, useRef } from "react";
import { ArrowLeft, Download, FileDown, RotateCcw, RotateCw, ChevronLeft, ChevronRight, BookmarkPlus, Loader2, Play, Pause, Square, RefreshCw, Trash2, Plus } from "lucide-react";
import { ScorePlayer } from "../lib/play-score";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { SheetMusicCanvas } from "../components/sheet-music-canvas";
import type { SheetMusicCanvasHandle } from "../components/sheet-music-canvas";
import { EditorSidebar } from "../components/editor-sidebar";
import { PropertiesPanel } from "../components/properties-panel";
import {
  parseMusicXml,
  updateNotePitch,
  updateNoteDuration,
  deleteNote,
  insertNoteAtPosition,
  deleteMeasure,
  addMeasure,
  applyDiatonicStep,
  transposeScore,
  addChordNote,
  parseHarmonies,
  updateHarmony,
  validateChordLabel,
  updateComposerInXml,
} from "../lib/parse-musicxml";
import type { ParsedNote, ScoreInfo, ParsedHarmony } from "../lib/parse-musicxml";
import { useAuth } from "../lib/auth-context";
import { generateThumbnail } from "../lib/generate-thumbnail";
import { saveScore } from "../lib/save-score";
import { getPendingUpload, setPendingUpload } from "../lib/pending-upload-store";
import { saveAbFeedback } from "../lib/save-ab-feedback";

function updateTitleInXml(xml: string, title: string): string {
  const escaped = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (/<movement-title>/.test(xml))
    return xml.replace(/<movement-title>[^<]*<\/movement-title>/, `<movement-title>${escaped}</movement-title>`);
  if (/<work-title>/.test(xml))
    return xml.replace(/<work-title>[^<]*<\/work-title>/, `<work-title>${escaped}</work-title>`);
  return xml.replace(/(<score-partwise[^>]*>)/, `$1\n  <movement-title>${escaped}</movement-title>`);
}

function parseScore(xml: string): { notes: ParsedNote[]; info: ScoreInfo | null } {
  try {
    const { notes, info } = parseMusicXml(xml);
    return { notes, info };
  } catch {
    return { notes: [], info: null };
  }
}

export function EditorPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { musicXml: initialXml, fileName, scoreType, sessionId } =
    (location.state as { musicXml: string; fileName: string; scoreType?: string; sessionId?: string }) ?? {};
  const isClassical = scoreType === "classical";
  const { currentUser } = useAuth();
  const canvasRef = useRef<SheetMusicCanvasHandle>(null);
  const playerRef = useRef<ScorePlayer | null>(null);
  const rafRef = useRef<number | null>(null);
  const sortedTimelineRef = useRef<{ time: number; cursorIndices: number[] }[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [bpmDraft, setBpmDraft] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [chordPopup, setChordPopup] = useState<{ harmony: ParsedHarmony; clientX: number; clientY: number; value: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const [homrXml, setHomrXml] = useState<string | null>(null);
  const [homrHistory, setHomrHistory] = useState<string[]>([]);
  const [homrHistIdx, setHomrHistIdx] = useState(-1);
  const [currentModel, setCurrentModel] = useState<"legato" | "homr">("legato");
  const [isLoadingAlt, setIsLoadingAlt] = useState(false);
  const [showAbModal, setShowAbModal] = useState(false);
  const [abFeedbackDone, setAbFeedbackDone] = useState(false);

  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const currentXml = currentModel === "legato"
    ? (history[histIdx] ?? "")
    : (homrHistory[homrHistIdx] ?? "");

  const [cursorStep, setCursorStep] = useState(0);
  const [extraSelected, setExtraSelected] = useState<number[]>([]);

  const { notes: cursorNotes, info: scoreInfo } = currentXml ? parseScore(currentXml) : { notes: [], info: null };
  const harmonies = currentXml ? parseHarmonies(currentXml) : [];
  const cursorNote: ParsedNote | null = cursorNotes[cursorStep] ?? null;

  const selectedNotes: ParsedNote[] = (() => {
    const indices = new Set([cursorStep, ...extraSelected]);
    return Array.from(indices)
      .filter((i) => i >= 0 && i < cursorNotes.length)
      .map((i) => cursorNotes[i])
      .filter((n) => !n.isRest);
  })();

  useEffect(() => {
    if (!initialXml) {
      toast.error("No file loaded — please upload a sheet music image first.");
      navigate("/upload");
      return;
    }
    setHistory([initialXml]);
    setHistIdx(0);
  }, []);

  useEffect(() => {
    if (!currentXml) return;
    if (!playerRef.current) playerRef.current = new ScorePlayer();
    const player = playerRef.current;
    player.load(currentXml);
    player.onEnd = () => {
      setIsPlaying(false);
      setExtraSelected([]);
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
    // Sync displayed BPM to what's in the score (preserve any user override)
    setBpm(player.getEffectiveBpm());
    setIsPlaying(false);
  }, [currentXml]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      playerRef.current?.dispose();
    };
  }, []);

  const moveNext = useCallback(() => {
    setCursorStep((s) => Math.min(s + 1, cursorNotes.length - 1));
    setExtraSelected([]);
  }, [cursorNotes.length]);

  const movePrev = useCallback(() => {
    setCursorStep((s) => Math.max(s - 1, 0));
    setExtraSelected([]);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "BUTTON") return;
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "ArrowRight") { e.preventDefault(); moveNext(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); movePrev(); }
      else if (e.key === "ArrowUp") {
        const targets = [cursorStep, ...extraSelected].map((i) => cursorNotes[i]).filter((n): n is ParsedNote => !!n && !n.isRest);
        if (targets.length > 0) { e.preventDefault(); changePitchMulti(targets, 1); }
      } else if (e.key === "ArrowDown") {
        const targets = [cursorStep, ...extraSelected].map((i) => cursorNotes[i]).filter((n): n is ParsedNote => !!n && !n.isRest);
        if (targets.length > 0) { e.preventDefault(); changePitchMulti(targets, -1); }
      } else if (e.key === "Delete" && cursorNote) { e.preventDefault(); handleDelete(cursorNote); }
      else if (e.key === "z" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleUndo(); }
      else if (e.key === "y" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleRedo(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [cursorNote, cursorStep, extraSelected, cursorNotes, histIdx, history, moveNext, movePrev]);

  const pushXml = (newXml: string) => {
    if (currentModel === "legato") {
      setHistory((prev) => [...prev.slice(0, histIdx + 1), newXml]);
      setHistIdx((i) => i + 1);
    } else {
      setHomrHistory((prev) => [...prev.slice(0, homrHistIdx + 1), newXml]);
      setHomrHistIdx((i) => i + 1);
    }
  };

  const changePitchMulti = (notes: ParsedNote[], delta: number) => {
    let xml = currentXml;
    for (const note of notes) {
      const { step, octave } = applyDiatonicStep(note.step, note.octave, delta);
      xml = updateNotePitch(xml, note.measure, note.xmlIndex, step, octave, note.alter);
    }
    pushXml(xml);
  };

  const handleDelete = (note: ParsedNote) => {
    pushXml(deleteNote(currentXml, note.measure, note.xmlIndex));
  };

  const handleConvertToNote = useCallback((note: ParsedNote, step: string, octave: number, alter: number, noteType: string) => {
    pushXml(insertNoteAtPosition(currentXml, note.measure, note.xmlIndex, step, octave, alter, noteType));
  }, [currentXml, histIdx]);


  const totalMeasures = cursorNotes.reduce((max, n) => Math.max(max, n.localMeasure + 1), 0);

  const handleDeleteMeasure = () => {
    if (!cursorNote || totalMeasures <= 1) return;
    const newXml = deleteMeasure(currentXml, cursorNote.localMeasure);
    pushXml(newXml);
    setCursorStep(0);
    setExtraSelected([]);
  };

  const handleAddMeasure = () => {
    if (!cursorNote) return;
    const newXml = addMeasure(currentXml, cursorNote.localMeasure);
    pushXml(newXml);
    // Move cursor to the first note of the newly inserted measure
    const { notes: newNotes } = parseScore(newXml);
    const newMeasureIdx = cursorNote.localMeasure + 1;
    const firstInNew = newNotes.findIndex((n) => n.localMeasure === newMeasureIdx && n.partIndex === cursorNote.partIndex);
    if (firstInNew !== -1) setCursorStep(firstInNew);
    setExtraSelected([]);
  };

  const handleUndo = () => {
    if (currentModel === "legato") {
      if (histIdx <= 0) return;
      setHistIdx((i) => i - 1);
    } else {
      if (homrHistIdx <= 0) return;
      setHomrHistIdx((i) => i - 1);
    }
  };

  const handleRedo = () => {
    if (currentModel === "legato") {
      if (histIdx >= history.length - 1) return;
      setHistIdx((i) => i + 1);
    } else {
      if (homrHistIdx >= homrHistory.length - 1) return;
      setHomrHistIdx((i) => i + 1);
    }
  };

  const handleNoteClick = useCallback((note: ParsedNote, shiftHeld: boolean) => {
    const { notes } = parseScore(currentXml);
    let idx = notes.findIndex((n) => n.measure === note.measure && n.xmlIndex === note.xmlIndex);
    if (idx === -1) {
      idx = notes.findIndex((n) => n.measure === note.measure && n.beat === note.beat && n.staffId === note.staffId);
    }
    if (idx === -1) return;
    if (shiftHeld) {
      if (idx === cursorStep) return;
      setExtraSelected((prev) => prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]);
    } else {
      setCursorStep(idx);
      setExtraSelected([]);
    }
  }, [currentXml, cursorStep]);

  const handlePitchCommit = useCallback((note: ParsedNote, step: string, octave: number) => {
    pushXml(updateNotePitch(currentXml, note.measure, note.xmlIndex, step, octave, note.alter));
  }, [currentXml, histIdx]);

  const handlePlayPause = async () => {
    const player = playerRef.current;
    if (!player) return;
    if (isPlaying) {
      player.pause();
      setIsPlaying(false);
      setExtraSelected([]);
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    } else {
      // Build a time-sorted mapping: player melody note index → cursorNotes index.
      // Sorting by time (not XML order) ensures multi-staff scores with interleaved
      // treble/bass notes get the right cursor position during playback.
      const nonRests = cursorNotes
        .map((n, i) => ({ n, i }))
        .filter(({ n }) => !n.isRest);

      // Seek to the currently selected note so playback starts from the cursor position.
      const melodyIdx = nonRests.findIndex(({ i }) => i === cursorStep);
      player.seek(melodyIdx >= 0 ? (player.getNoteTimes()[melodyIdx] ?? 0) : 0);

      // Build a time-grouped timeline: notes at the same beat are in one group
      // so that chords and simultaneous treble/bass notes all highlight together.
      const flat = player
        .getSortedNoteTimeline()
        .map(({ time, index }) => ({ time, cursorIdx: nonRests[index]?.i ?? -1 }))
        .filter(({ cursorIdx }) => cursorIdx >= 0);
      const groups: { time: number; cursorIndices: number[] }[] = [];
      for (const { time, cursorIdx } of flat) {
        const last = groups[groups.length - 1];
        if (last && Math.abs(last.time - time) < 0.02) {
          last.cursorIndices.push(cursorIdx);
        } else {
          groups.push({ time, cursorIndices: [cursorIdx] });
        }
      }
      sortedTimelineRef.current = groups;

      await player.play();
      setIsPlaying(true);
      let lastGroupIdx = -1;
      const tick = () => {
        const t = player.getCurrentTime();
        const tl = sortedTimelineRef.current;
        let j = -1;
        for (let k = tl.length - 1; k >= 0; k--) {
          if (tl[k].time <= t + 0.05) { j = k; break; }
        }
        if (j >= 0 && j !== lastGroupIdx) {
          lastGroupIdx = j;
          setCursorStep(tl[j].cursorIndices[0]);
          setExtraSelected(tl[j].cursorIndices.slice(1));
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }
  };

  const commitBpm = (raw: string) => {
    const parsed = parseInt(raw, 10);
    const clamped = isNaN(parsed) ? bpm : Math.max(20, Math.min(300, parsed));
    setBpm(clamped);
    playerRef.current?.setBpm(clamped);
    setBpmDraft(null);
  };

  const handleChordClick = (harmony: ParsedHarmony, clientX: number, clientY: number) => {
    setChordPopup({ harmony, clientX, clientY, value: harmony.label });
  };

  const handleComposerCommit = (composer: string) => {
    pushXml(updateComposerInXml(currentXml, composer));
  };

  const handleAddChordNote = useCallback((note: ParsedNote, step: string, octave: number, alter: number) => {
    pushXml(addChordNote(currentXml, note.measure, note.xmlIndex, step, octave, alter));
  }, [currentXml, histIdx]);

  const handleTranspose = (semitones: number) => {
    pushXml(transposeScore(currentXml, semitones));
  };

  const performSave = async () => {
    if (!currentUser) return;
    setSaving(true);
    try {
      const thumbnailDataUrl = await generateThumbnail(canvasRef.current?.getOsmdDiv() ?? null);
      const id = await saveScore(currentUser.uid, currentXml, fileName ?? "score.musicxml", thumbnailDataUrl);
      setSavedId(id);
      toast.success("Saved to library!");
    } catch {
      toast.error("Failed to save to library");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveToLibrary = async () => {
    if (!currentUser) {
      toast.error("Sign in to save to your library");
      return;
    }
    if (isClassical && homrXml !== null && !abFeedbackDone) {
      setShowAbModal(true);
      return;
    }
    await performSave();
  };

  const handleLoadAlternative = async () => {
    const pending = getPendingUpload();
    if (!pending || !currentUser) {
      toast.error("Source files no longer available — please re-upload to try the alternative.");
      return;
    }
    setIsLoadingAlt(true);
    try {
      const formData = new FormData();
      pending.files.forEach((f) => formData.append("files", f));
      formData.append("score_type", "classical");
      formData.append("model", "homr");
      const idToken = await currentUser.getIdToken();
      const apiUrl = import.meta.env.VITE_API_URL;
      if (!apiUrl) throw new Error("API URL not configured");
      const response = await fetch(`${apiUrl}/transcribe-multi`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
        body: formData,
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Server error: ${response.status}`);
      }
      const xml = await response.text();
      setHomrXml(xml);
      setHomrHistory([xml]);
      setHomrHistIdx(0);
      setCurrentModel("homr");
      setPendingUpload(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load alternative model");
    } finally {
      setIsLoadingAlt(false);
    }
  };

  const handleDownload = () => {
    if (!currentXml) return;
    const blob = new Blob([currentXml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (fileName ?? "score").replace(/\.[^.]+$/, "") + ".musicxml";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPDF = () => {
    const osmdDiv = canvasRef.current?.getOsmdDiv();
    if (!osmdDiv) return;
    const svgContent = osmdDiv.innerHTML;
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const titleEsc = esc(displayTitle);
    const composerEsc = scoreInfo?.composer ? esc(scoreInfo.composer) : "";
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>${titleEsc}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: white; font-family: 'Times New Roman', Georgia, serif; }
    .score-wrap { width: 100%; padding: 20px 32px 32px; }
    .score-header { text-align: center; padding: 20px 0 14px; }
    .score-title { font-size: 26px; font-weight: bold; letter-spacing: -0.02em; }
    .score-composer { font-size: 13px; color: #555; margin-top: 5px; }
    svg { width: 100% !important; height: auto !important; display: block; }
    @page { size: A4; margin: 12mm; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="score-wrap">
    <div class="score-header">
      <div class="score-title">${titleEsc}</div>
      ${composerEsc ? `<div class="score-composer">${composerEsc}</div>` : ""}
    </div>
    ${svgContent}
  </div>
  <script>window.onload = () => { window.print(); };<\/script>
</body>
</html>`);
    win.document.close();
  };

  const displayTitle = scoreInfo?.title || (fileName ? fileName.replace(/\.[^.]+$/, "") : "Sheet Music");

  if (!currentXml) return null;

  const multiSelected = extraSelected.length > 0;

  return (
    <div className="h-screen flex flex-col bg-white" tabIndex={-1}>

      {/* Graph paper background */}
      <div
        className="fixed inset-0 pointer-events-none opacity-60 z-0"
        style={{
          backgroundImage: `
            linear-gradient(rgba(28, 25, 23, 0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(28, 25, 23, 0.05) 1px, transparent 1px)
          `,
          backgroundSize: "20px 20px",
        }}
      />

      {/* Top nav */}
      <div className="relative z-10 bg-white border-b-2 border-[#1C1917] px-3 sm:px-6 py-3 flex items-center justify-between shrink-0 shadow-[0_2px_0_#1C1917]">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <Link
            to="/"
            className="flex items-center gap-2 text-[#1C1917]/60 hover:text-[#1C1917] transition-colors font-medium shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="hidden sm:inline">Back</span>
          </Link>
          <div className="w-px h-6 bg-[#1C1917]/20 shrink-0" />
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                setEditingTitle(false);
                if (titleDraft.trim() && titleDraft.trim() !== displayTitle)
                  pushXml(updateTitleInXml(currentXml, titleDraft.trim()));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setEditingTitle(false);
                e.stopPropagation();
              }}
              className="text-base sm:text-lg font-bold text-[#1C1917] bg-[#F5F0E8] border-b-2 border-[#1C1917] outline-none px-1 rounded min-w-0 w-28 sm:w-auto"
              style={{ fontFamily: "DM Serif Display, Georgia, serif" }}
            />
          ) : (
            <button
              onClick={() => { setTitleDraft(displayTitle); setEditingTitle(true); }}
              title="Click to edit title"
              className="text-base sm:text-lg font-bold text-[#1C1917] hover:bg-[#F5F0E8] px-1 rounded transition-colors truncate max-w-[120px] sm:max-w-xs"
              style={{ fontFamily: "DM Serif Display, Georgia, serif" }}
            >
              {displayTitle}
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Undo / Redo — hidden on mobile */}
          <button
            onClick={handleUndo}
            disabled={currentModel === "legato" ? histIdx <= 0 : homrHistIdx <= 0}
            className="hidden sm:flex p-2 rounded-lg border-2 border-[#1C1917] bg-white hover:bg-[#F5F0E8] disabled:opacity-30 transition-all shadow-[2px_2px_0_#1C1917] hover:shadow-[3px_3px_0_#1C1917] disabled:shadow-none"
            title="Undo (Ctrl+Z)"
          >
            <RotateCcw className="w-4 h-4 text-[#1C1917]" />
          </button>
          <button
            onClick={handleRedo}
            disabled={currentModel === "legato" ? histIdx >= history.length - 1 : homrHistIdx >= homrHistory.length - 1}
            className="hidden sm:flex p-2 rounded-lg border-2 border-[#1C1917] bg-white hover:bg-[#F5F0E8] disabled:opacity-30 transition-all shadow-[2px_2px_0_#1C1917] hover:shadow-[3px_3px_0_#1C1917] disabled:shadow-none"
            title="Redo (Ctrl+Y)"
          >
            <RotateCw className="w-4 h-4 text-[#1C1917]" />
          </button>

          <div className="hidden sm:block w-px h-6 bg-border mx-1" />

          {/* Play / Pause */}
          <button
            onClick={handlePlayPause}
            className="p-2 rounded-lg border-2 border-[#1C1917] bg-white hover:bg-[#F5F0E8] transition-colors shadow-[2px_2px_0_#1C1917]"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause className="w-4 h-4 text-[#1C1917]" /> : <Play className="w-4 h-4 text-[#1C1917]" />}
          </button>

          {/* BPM input — hidden on mobile */}
          <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg border-2 border-[#1C1917]/20 bg-[#F5F0E8] text-xs">
            <input
              type="text"
              inputMode="numeric"
              maxLength={3}
              value={bpmDraft ?? bpm}
              onFocus={() => setBpmDraft(String(bpm))}
              onChange={(e) => setBpmDraft(e.target.value.replace(/\D/g, "").slice(0, 3))}
              onBlur={(e) => commitBpm(e.target.value)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); }}
              className="bpm-field w-10 bg-transparent outline-none text-center text-[#1C1917] font-medium"
              title="Tempo (BPM)"
            />
            <span className="text-[#1C1917]/50 select-none">bpm</span>
          </div>

          {/* Save — hidden on mobile */}
          {currentUser && (
            <button
              onClick={handleSaveToLibrary}
              disabled={saving || !!savedId}
              className="hidden sm:flex px-4 py-2 border-2 border-[#1C1917] bg-[#B8D4B0] hover:bg-[#a8c4a0] disabled:opacity-50 rounded-lg transition-all shadow-[2px_2px_0_#1C1917] hover:shadow-[3px_3px_0_#1C1917] items-center gap-2 font-medium text-[#1C1917] text-sm"
              title={savedId ? "Already saved" : "Save to Library"}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookmarkPlus className="w-4 h-4" />}
              <span>{savedId ? "Saved ✓" : "Save"}</span>
            </button>
          )}

          {/* Export — icon-only on mobile, with PDF option on desktop */}
          <div className="flex rounded-lg overflow-hidden border-2 border-[#1C1917] shadow-[2px_2px_0_#1C1917] hover:shadow-[3px_3px_0_#1C1917] hover:translate-y-[-1px] transition-all">
            <button
              onClick={handleDownload}
              className="px-3 sm:px-4 py-2 bg-[#1C1917] text-white flex items-center gap-2 font-medium text-sm hover:opacity-90 transition-opacity"
              title="Export as MusicXML"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export</span>
            </button>
            <div className="w-px bg-white/20" />
            <button
              onClick={handleExportPDF}
              className="px-2 sm:px-3 py-2 bg-[#1C1917] text-white/70 flex items-center gap-1 font-medium text-sm hover:opacity-90 hover:text-white transition-all"
              title="Export as PDF"
            >
              <FileDown className="w-4 h-4" />
              <span className="hidden sm:inline text-xs">PDF</span>
            </button>
          </div>
        </div>
      </div>

      {/* Navigation / toolbar bar */}
      <div className="relative z-10 bg-[#F5F0E8] border-b-2 border-[#1C1917] px-3 sm:px-4 py-2 flex items-center gap-2 sm:gap-3 shrink-0">

        {/* Prev / Next */}
        <button
          onClick={movePrev}
          className="flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-lg border-2 border-[#1C1917] bg-white hover:bg-[#F5F0E8] text-sm font-medium transition-all shadow-[2px_2px_0_#1C1917]"
          title="Previous note (← arrow key)"
        >
          <ChevronLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Prev</span>
        </button>
        <button
          onClick={moveNext}
          className="flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-lg border-2 border-[#1C1917] bg-white hover:bg-[#F5F0E8] text-sm font-medium transition-all shadow-[2px_2px_0_#1C1917]"
          title="Next note (→ arrow key)"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="w-4 h-4" />
        </button>

        {/* Current note display */}
        {cursorNote && (
          <div className="px-2 sm:px-3 py-1 rounded-lg border-2 border-[#1C1917] bg-[#F2C4C4] text-sm font-medium text-[#1C1917] shadow-[2px_2px_0_#1C1917] truncate max-w-[140px] sm:max-w-none">
            {cursorNote.isRest
              ? "𝄽 Rest"
              : `♩ ${cursorNote.step}${cursorNote.alter === 1 ? "♯" : cursorNote.alter === -1 ? "♭" : ""}${cursorNote.octave}`}
            {" · "}M{cursorNote.measure + 1}
            {multiSelected && (
              <span className="ml-2 text-[#1C1917]/60">+{extraSelected.length}</span>
            )}
          </div>
        )}

        {/* Add / Delete Bar buttons — shown when a note is selected */}
        {cursorNote && (
          <div className="flex items-center gap-1">
            <button
              onClick={handleAddMeasure}
              className="flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-lg border-2 border-[#1C1917]/40 bg-white hover:bg-[#B8D4B0] hover:border-[#1C1917] text-xs font-medium text-[#1C1917]/60 hover:text-[#1C1917] transition-all shadow-[2px_2px_0_#1C1917]/30 hover:shadow-[2px_2px_0_#1C1917]"
              title={`Insert bar after M${cursorNote.measure + 1}`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Add Bar</span>
            </button>
            <button
              onClick={handleDeleteMeasure}
              disabled={totalMeasures <= 1}
              className="flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-lg border-2 border-[#1C1917]/40 bg-white hover:bg-[#F2C4C4] hover:border-[#1C1917] text-xs font-medium text-[#1C1917]/60 hover:text-[#1C1917] transition-all shadow-[2px_2px_0_#1C1917]/30 hover:shadow-[2px_2px_0_#1C1917] disabled:opacity-30 disabled:cursor-not-allowed"
              title={`Delete bar ${cursorNote.measure + 1}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Del Bar</span>
            </button>
          </div>
        )}

        {/* Right side — transpose (hidden on mobile) + model picker */}
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden md:flex items-center gap-1" title="Transpose whole piece">
            <span className="text-xs text-[#1C1917]/60 mr-1 font-medium">Transpose:</span>
            {[
              { label: "↓8va", val: -12, color: "#F9C8D8" },
              { label: "−½",   val: -1,  color: "#F9C8D8" },
              { label: "+½",   val: 1,   color: "#B8D4B0" },
              { label: "↑8va", val: 12,  color: "#B8D4B0" },
            ].map((btn) => (
              <button
                key={btn.label}
                onClick={() => handleTranspose(btn.val)}
                className="px-2 py-1 rounded border-2 border-[#1C1917] text-xs font-medium transition-all shadow-[2px_2px_0_#1C1917] hover:shadow-[3px_3px_0_#1C1917] hover:translate-y-[-1px]"
                style={{ backgroundColor: btn.color }}
              >
                {btn.label}
              </button>
            ))}
          </div>

          {isClassical && (
            <div className="hidden md:flex items-center gap-3">
              <div className="w-px h-4 bg-[#1C1917]/20" />
              {homrXml === null ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#1C1917]/40 hidden sm:inline">Unhappy?</span>
                  <button
                    onClick={handleLoadAlternative}
                    disabled={isLoadingAlt}
                    className="flex items-center gap-1 text-xs font-medium text-[#1C1917]/70 hover:text-[#1C1917] disabled:opacity-50 transition-colors underline underline-offset-2"
                  >
                    {isLoadingAlt
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <RefreshCw className="w-3 h-3" />}
                    {isLoadingAlt ? "Loading..." : "Try alternative model"}
                  </button>
                </div>
              ) : (
                <div className="flex rounded-lg overflow-hidden border-2 border-[#1C1917] shadow-[2px_2px_0_#1C1917]">
                  <button
                    onClick={() => setCurrentModel("legato")}
                    className={`px-3 py-1 text-xs font-medium transition-colors ${
                      currentModel === "legato"
                        ? "bg-[#F2C4C4] text-[#1C1917]"
                        : "bg-white text-[#1C1917]/50 hover:text-[#1C1917]"
                    }`}
                  >
                    A — Legato
                  </button>
                  <div className="w-px bg-[#1C1917]" />
                  <button
                    onClick={() => setCurrentModel("homr")}
                    className={`px-3 py-1 text-xs font-medium transition-colors ${
                      currentModel === "homr"
                        ? "bg-[#B8D8E8] text-[#1C1917]"
                        : "bg-white text-[#1C1917]/50 hover:text-[#1C1917]"
                    }`}
                  >
                    B — HOMR
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mobile quick-edit bar — pitch up/down + BPM, visible only on small screens */}
      <div className="md:hidden relative z-10 bg-white border-b border-[#1C1917]/15 px-3 py-2 shrink-0 flex items-center gap-2 overflow-x-auto">
        {cursorNote && !cursorNote.isRest ? (
          <>
            <button
              onClick={() => changePitchMulti([cursorNote], 1)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border-2 border-[#1C1917] bg-[#B8D4B0] text-xs font-medium shadow-[2px_2px_0_#1C1917] shrink-0"
            >
              ↑ Up
            </button>
            <button
              onClick={() => changePitchMulti([cursorNote], -1)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border-2 border-[#1C1917] bg-[#F9C8D8] text-xs font-medium shadow-[2px_2px_0_#1C1917] shrink-0"
            >
              ↓ Down
            </button>
            <div className="w-px h-4 bg-[#1C1917]/20 shrink-0" />
            {[{ label: "𝅝", value: "whole" }, { label: "𝅗𝅥", value: "half" }, { label: "♩", value: "quarter" }, { label: "♪", value: "eighth" }].map((d) => (
              <button
                key={d.value}
                onClick={() => pushXml(updateNoteDuration(currentXml, cursorNote.measure, cursorNote.xmlIndex, d.value))}
                className="px-2 py-1.5 rounded-lg border-2 text-sm shrink-0 transition-all"
                style={{
                  backgroundColor: cursorNote.type === d.value ? "#1C1917" : "#F5F0E8",
                  color: cursorNote.type === d.value ? "white" : "#1C1917",
                  borderColor: cursorNote.type === d.value ? "#1C1917" : "rgba(28,25,23,0.2)",
                }}
              >
                {d.label}
              </button>
            ))}
            <div className="w-px h-4 bg-[#1C1917]/20 shrink-0" />
            <button
              onClick={() => pushXml(deleteNote(currentXml, cursorNote.measure, cursorNote.xmlIndex))}
              className="px-3 py-1.5 rounded-lg border-2 border-[#1C1917] bg-white text-xs font-medium shrink-0 hover:bg-[#F2C4C4]"
            >
              Delete Note
            </button>
            <button
              onClick={handleAddMeasure}
              className="px-3 py-1.5 rounded-lg border-2 border-[#1C1917]/40 bg-white text-xs font-medium shrink-0 hover:bg-[#B8D4B0] hover:border-[#1C1917]"
            >
              + Bar
            </button>
            <button
              onClick={handleDeleteMeasure}
              disabled={totalMeasures <= 1}
              className="px-3 py-1.5 rounded-lg border-2 border-[#1C1917]/40 bg-white text-xs font-medium shrink-0 hover:bg-[#F2C4C4] hover:border-[#1C1917] disabled:opacity-30"
            >
              − Bar
            </button>
          </>
        ) : cursorNote?.isRest ? (
          <>
            {/* Note picker for rests on mobile */}
            {["C","D","E","F","G","A","B"].map((s) => (
              <button
                key={s}
                onClick={() => pushXml(insertNoteAtPosition(currentXml, cursorNote.measure, cursorNote.xmlIndex, s, 4, 0, cursorNote.type))}
                className="px-2.5 py-1.5 rounded-lg border-2 border-[#1C1917]/20 bg-[#F5F0E8] text-xs font-bold shrink-0 hover:bg-[#7FFFD4] hover:border-[#1C1917] transition-all text-[#1C1917]"
              >
                {s}
              </button>
            ))}
            <div className="w-px h-4 bg-[#1C1917]/20 shrink-0" />
            {[{ label: "𝅝", value: "whole" }, { label: "𝅗𝅥", value: "half" }, { label: "♩", value: "quarter" }, { label: "♪", value: "eighth" }].map((d) => (
              <button
                key={d.value}
                onClick={() => pushXml(updateNoteDuration(currentXml, cursorNote.measure, cursorNote.xmlIndex, d.value))}
                className="px-2 py-1.5 rounded-lg border-2 text-sm shrink-0 transition-all"
                style={{
                  backgroundColor: cursorNote.type === d.value ? "#1C1917" : "#F5F0E8",
                  color: cursorNote.type === d.value ? "white" : "#1C1917",
                  borderColor: cursorNote.type === d.value ? "#1C1917" : "rgba(28,25,23,0.2)",
                }}
              >
                {d.label}
              </button>
            ))}
          </>
        ) : (
          <span className="text-xs text-[#1C1917]/40">Tap a note to edit</span>
        )}
        <div className="ml-auto shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg border border-[#1C1917]/20 bg-[#F5F0E8] text-xs">
          <input
            type="text"
            inputMode="numeric"
            maxLength={3}
            value={bpmDraft ?? bpm}
            onFocus={() => setBpmDraft(String(bpm))}
            onChange={(e) => setBpmDraft(e.target.value.replace(/\D/g, "").slice(0, 3))}
            onBlur={(e) => commitBpm(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); }}
            className="bpm-field w-10 bg-transparent outline-none text-center text-[#1C1917] font-medium"
            title="Tempo (BPM)"
          />
          <span className="text-[#1C1917]/50 select-none">bpm</span>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden relative z-10">
        <div className="hidden md:flex">
          <EditorSidebar activeTool="select" onToolChange={() => {}} />
        </div>

        <SheetMusicCanvas
          ref={canvasRef}
          musicXml={currentXml}
          selectedNotes={selectedNotes}
          onNoteClick={handleNoteClick}
          onPitchCommit={handlePitchCommit}
          scoreTitle={scoreInfo?.title ?? displayTitle}
          scoreComposer={scoreInfo?.composer}
          onTitleCommit={(t) => pushXml(updateTitleInXml(currentXml, t))}
          onComposerCommit={handleComposerCommit}
          harmonies={harmonies}
          onChordClick={handleChordClick}
        />

        <div className="hidden md:flex">
          <PropertiesPanel
            note={cursorNote}
            onPitchStep={(note, newStep, newOctave) =>
              pushXml(updateNotePitch(currentXml, note.measure, note.xmlIndex, newStep, newOctave, 0))
            }
            onAlterChange={(note, alter) =>
              pushXml(updateNotePitch(currentXml, note.measure, note.xmlIndex, note.step, note.octave, alter))
            }
            onDurationChange={(note, type) =>
              pushXml(updateNoteDuration(currentXml, note.measure, note.xmlIndex, type))
            }
            onDelete={handleDelete}
            onAddChordNote={handleAddChordNote}
            onConvertToNote={handleConvertToNote}
          />
        </div>
      </div>

      {/* Chord symbol edit popup */}
      {chordPopup && (
        <div
          className="fixed z-50 bg-white border-2 border-[#1C1917] rounded-lg shadow-[4px_4px_0_#1C1917] px-3 py-1.5 flex items-center gap-2"
          style={{ left: chordPopup.clientX - 48, top: chordPopup.clientY - 48 }}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-xs text-[#1C1917]/40 font-mono">♩</span>
          <input
            autoFocus
            value={chordPopup.value}
            onChange={(e) => setChordPopup((p) => p ? { ...p, value: e.target.value } : null)}
            onBlur={() => {
              const v = chordPopup.value.trim();
              if (v) {
                if (!validateChordLabel(v)) {
                  toast.error(`Unrecognized chord "${v}" — try e.g. Cmaj7, Dm7, Gsus4`);
                } else {
                  pushXml(updateHarmony(currentXml, chordPopup.harmony.index, v));
                }
              }
              setChordPopup(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setChordPopup(null);
              e.stopPropagation();
            }}
            className="text-sm font-mono font-medium text-[#1C1917] border-none outline-none bg-transparent w-20"
            placeholder={chordPopup.harmony.label}
          />
        </div>
      )}

      {showAbModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1C1917]/50">
          <div className="bg-white border-2 border-[#1C1917] rounded-2xl shadow-[8px_8px_0_#1C1917] p-8 max-w-md w-full mx-4">
            <h2
              className="text-2xl font-serif font-bold text-[#1C1917] mb-2"
              style={{ fontFamily: "DM Serif Display, Georgia, serif" }}
            >
              Wanna help us better serve you?
            </h2>
            <p className="text-[#1C1917]/60 text-sm mb-6">
              Which transcription did you prefer?
            </p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <button
                onClick={async () => {
                  try {
                    const idToken = await currentUser!.getIdToken();
                    await saveAbFeedback("legato", sessionId ?? "", fileName ?? "", idToken);
                  } catch {}
                  setAbFeedbackDone(true);
                  setShowAbModal(false);
                  await performSave();
                }}
                className="py-3 px-4 rounded-xl border-2 border-[#1C1917] bg-[#F2C4C4] hover:bg-[#e8b0b0] font-medium text-[#1C1917] transition-all shadow-[3px_3px_0_#1C1917] hover:shadow-[4px_4px_0_#1C1917] text-sm"
              >
                Model A — Legato
              </button>
              <button
                onClick={async () => {
                  try {
                    const idToken = await currentUser!.getIdToken();
                    await saveAbFeedback("homr", sessionId ?? "", fileName ?? "", idToken);
                  } catch {}
                  setAbFeedbackDone(true);
                  setShowAbModal(false);
                  await performSave();
                }}
                className="py-3 px-4 rounded-xl border-2 border-[#1C1917] bg-[#B8D8E8] hover:bg-[#a4c8d8] font-medium text-[#1C1917] transition-all shadow-[3px_3px_0_#1C1917] hover:shadow-[4px_4px_0_#1C1917] text-sm"
              >
                Model B — HOMR
              </button>
            </div>
            <button
              onClick={async () => {
                setAbFeedbackDone(true);
                setShowAbModal(false);
                await performSave();
              }}
              className="w-full text-sm text-[#1C1917]/50 hover:text-[#1C1917] transition-colors py-2"
            >
              Skip →
            </button>
          </div>
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&display=swap');
        input[type=number].bpm-field::-webkit-outer-spin-button,
        input[type=number].bpm-field::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number].bpm-field { -moz-appearance: textfield; }
      `}</style>
    </div>
  );
}
