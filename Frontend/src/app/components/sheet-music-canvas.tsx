import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { parseMusicXml, applyDiatonicStep } from "../lib/parse-musicxml";
import type { ParsedNote, ParsedHarmony } from "../lib/parse-musicxml";

const ACCENT = "#E8622A";

// Regex to identify chord symbol text elements in OSMD's SVG output
const CHORD_TEXT_RE = /^[A-G][#b]?(?:mMaj|m(?:aj)?|maj|dim|aug|sus[24]?|[+ø°])?(?:\d+)?(?:[#b]\d+|add\d+|no[135])*(?:\/[A-G][#b]?)?$/;

interface ChordHit {
  harmony: ParsedHarmony;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface NoteHit {
  note: ParsedNote;
  x: number;
  y: number;
  lineSpacingPx: number;
  el: Element;
}

interface DragState {
  note: ParsedNote;
  startY: number;
  currentY: number;
  lineSpacingPx: number;
}

export interface SheetMusicCanvasHandle {
  getOsmdDiv: () => HTMLDivElement | null;
}

interface Props {
  musicXml: string;
  selectedNotes: ParsedNote[];
  onNoteClick: (note: ParsedNote, shiftHeld: boolean) => void;
  onPitchCommit: (note: ParsedNote, step: string, octave: number) => void;
  scoreTitle?: string;
  scoreComposer?: string;
  onTitleCommit?: (title: string) => void;
  onComposerCommit?: (composer: string) => void;
  harmonies?: ParsedHarmony[];
  onChordClick?: (harmony: ParsedHarmony, clientX: number, clientY: number) => void;
}

function ScoreTextField({ value, placeholder, fontFamily, className, onCommit }: {
  value: string;
  placeholder: string;
  fontFamily?: string;
  className?: string;
  onCommit?: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (!onCommit) {
    return <p className={className} style={{ fontFamily }}>{value || placeholder}</p>;
  }
  return editing ? (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setEditing(false);
        e.stopPropagation();
      }}
      className={`${className ?? ""} bg-[#F5F0E8]/80 border-b-2 border-[#1C1917] outline-none text-center px-2`}
      style={{ fontFamily, minWidth: 200 }}
    />
  ) : (
    <p
      className={`${className ?? ""} cursor-text hover:bg-[#F5F0E8]/60 rounded px-2 inline-block transition-colors`}
      style={{ fontFamily }}
      onClick={() => { setDraft(value); setEditing(true); }}
      title="Click to edit"
    >
      {value || <span className="opacity-30 italic">{placeholder}</span>}
    </p>
  );
}

function buildChordHits(container: HTMLElement, harmonies: ParsedHarmony[]): ChordHit[] {
  if (!harmonies.length) return [];
  const containerRect = container.getBoundingClientRect();
  const CHORD_ROOT_START = /^[A-G][#b♯♭]?/;

  // Strategy 1: VexFlow chord symbol groups (try several class-name variants)
  let candidates: Element[] = [];
  for (const sel of [".vf-ChordSymbol", ".vf-chordSymbol", ".vf-chord-symbol", "[class*='ChordSymbol']"]) {
    try {
      const found = Array.from(container.querySelectorAll(sel));
      if (found.length > candidates.length) candidates = found;
    } catch {}
  }

  // Strategy 2: text elements starting with a chord root letter → use immediate parent <g>
  // This handles VexFlow rendering each component (root / quality / extension) as separate <text> nodes.
  if (candidates.length < harmonies.length) {
    const seen = new Set<Element>();
    const groups: Element[] = [];
    for (const text of container.querySelectorAll<SVGTextElement>("text")) {
      const t = (text.textContent ?? "").trim();
      if (!CHORD_ROOT_START.test(t) || t.length > 15) continue;
      const p = text.parentElement;
      const target: Element = (p && p.tagName.toLowerCase() === "g") ? p : text;
      if (!seen.has(target)) { seen.add(target); groups.push(target); }
    }
    if (groups.length > candidates.length) candidates = groups;
  }

  // Strategy 3: text elements whose full content matches the chord pattern (single-node rendering)
  if (candidates.length < harmonies.length) {
    const textMatches = Array.from(container.querySelectorAll("text")).filter((el) => {
      return CHORD_TEXT_RE.test((el.textContent ?? "").trim());
    });
    if (textMatches.length > candidates.length) candidates = textMatches;
  }

  const sorted = candidates
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && r.height > 0)
    .sort((a, b) =>
      Math.abs(a.r.top - b.r.top) > 15 ? a.r.top - b.r.top : a.r.left - b.r.left
    );

  const count = Math.min(sorted.length, harmonies.length);
  return sorted.slice(0, count).map(({ r }, i) => ({
    harmony: harmonies[i],
    x: r.left + r.width / 2 - containerRect.left,
    y: r.top + r.height / 2 - containerRect.top,
    w: Math.max(r.width + 20, 40),
    h: Math.max(r.height + 12, 24),
  }));
}

function measureLineSpacing(container: HTMLElement): number {
  const ys: number[] = [];
  const containerTop = container.getBoundingClientRect().top;
  for (const line of container.querySelectorAll<SVGLineElement>("line")) {
    const y1 = parseFloat(line.getAttribute("y1") ?? "0");
    const y2 = parseFloat(line.getAttribute("y2") ?? "0");
    if (Math.abs(y1 - y2) < 1) {
      const r = line.getBoundingClientRect();
      if (r.width < 30) continue; // skip ledger lines (short horizontal lines)
      ys.push(r.top - containerTop);
    }
  }
  ys.sort((a, b) => a - b);
  const diffs: number[] = [];
  for (let i = 1; i < ys.length; i++) {
    const d = ys[i] - ys[i - 1];
    if (d > 2 && d < 40) diffs.push(d);
  }
  if (diffs.length === 0) return 12;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

// Returns Y midpoints between every pair of adjacent staves (within + across systems).
// A gap larger than 1.5× lineSpacing means a new staff started.
function staffBoundaryYs(container: HTMLElement, lineSpacingPx: number): number[] {
  const top = container.getBoundingClientRect().top;
  const ys: number[] = [];
  for (const line of container.querySelectorAll<SVGLineElement>("line")) {
    if (Math.abs(parseFloat(line.getAttribute("y1") ?? "0") -
                 parseFloat(line.getAttribute("y2") ?? "0")) < 1) {
      const r = line.getBoundingClientRect();
      if (r.width < 30) continue; // skip ledger lines
      ys.push(r.top - top);
    }
  }
  ys.sort((a, b) => a - b);
  const deduped: number[] = [];
  for (const y of ys) {
    if (!deduped.length || y - deduped[deduped.length - 1] > 2) deduped.push(y);
  }
  const boundaries: number[] = [];
  for (let i = 1; i < deduped.length; i++) {
    if (deduped[i] - deduped[i - 1] > lineSpacingPx * 1.5)
      boundaries.push((deduped[i] + deduped[i - 1]) / 2);
  }
  return boundaries;
}

// Compute absolute halftone from a ParsedNote using OSMD's convention:
// halfTone = step + 12 * (octave + Pitch.octXmlDiff) where octXmlDiff=3 in OSMD 1.9.7.
// So C4 → 0 + 12*(4+3) = 84. This must match Pitch.halfTone for pitch-based matching to work.
function parsedHalfTone(n: ParsedNote): number {
  const s: Record<string, number> = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };
  return (n.octave + 3) * 12 + (s[n.step] ?? 0) + Math.round(n.alter);
}

function buildHitsFromOsmd(
  osmd: any,
  container: HTMLElement,
  parsedNotes: ParsedNote[],
  lineSpacingPx: number
): NoteHit[] | null {
  try {
    const measureList = osmd?.GraphicSheet?.MeasureList;
    if (!measureList?.length) return null;

    const containerRect = container.getBoundingClientRect();

    // Group parsed notes by (localMeasure, staffId)
    const byKey = new Map<string, ParsedNote[]>();
    for (const n of parsedNotes) {
      const k = `${n.localMeasure}_${n.staffId}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(n);
    }

    const hits: NoteHit[] = [];

    for (let m = 0; m < measureList.length; m++) {
      const staffLines: any[] = measureList[m] ?? [];
      for (let s = 0; s < staffLines.length; s++) {
        const gMeasure = staffLines[s];
        if (!gMeasure?.staffEntries) continue;
        const candidates = byKey.get(`${m}_${s}`) ?? [];
        // Track which candidates have been claimed this measure+staff
        const used = new Set<number>();

        for (const se of gMeasure.staffEntries) {
          for (const ve of se.graphicalVoiceEntries ?? []) {
            for (const gn of ve.notes ?? []) {
              // OSMD 1.8+ exposes getSVGGElement() directly on VexFlowGraphicalNote.
              // Fall back to the old VexFlow attrs.el path for older builds.
              const groupEl: Element | null =
                (gn.getSVGGElement?.() as Element | null) ??
                (() => {
                  const vfn = gn.vfnote?.[0] ?? gn.vfNote?.[0];
                  return (vfn?.attrs?.el ?? vfn?.getSVGElement?.() ?? vfn?.elem ?? vfn?.note_heads?.[0]?.attrs?.el ?? null) as Element | null;
                })();
              if (!groupEl) continue;

              // Use per-note notehead SVGs when available (more accurate for chords).
              const noteheadEls = gn.getNoteheadSVGs?.() as HTMLElement[] | null | undefined;
              const nhEl: Element =
                (noteheadEls?.[0] as Element | undefined) ??
                groupEl.querySelector(".vf-notehead, .vf-note-head, [class*='notehead']") ??
                groupEl;
              const r = nhEl.getBoundingClientRect();
              // Note: don't skip zero-bounds notes here — they still need to consume
              // a candidate slot (tie-end notes are invisible but occupy a ParsedNote slot).

              // --- Pitch-based matching ---
              // OSMD iterates beat-by-beat (all voices per beat), but parseMusicXml
              // emits notes in XML document order (voice 1 all beats, then voice 2
              // all beats). Sequential idx++ drifts on any multi-voice score.
              // Matching by halfTone pitch is order-independent and handles chords.
              const src = gn.sourceNote;
              const pitch = src?.Pitch ?? src?.pitch;
              const ht: number | null =
                typeof pitch?.halfTone === "number" ? pitch.halfTone : null;
              const isOsmdRest = !!(src?.isRest?.() ?? src?.IsRest ?? false);

              let matchIdx = -1;

              // 1) Prefer exact pitch match for non-rest notes
              if (!isOsmdRest && ht !== null) {
                for (let ci = 0; ci < candidates.length; ci++) {
                  if (!used.has(ci) && !candidates[ci].isRest
                      && parsedHalfTone(candidates[ci]) === ht) {
                    matchIdx = ci; break;
                  }
                }
              }

              // 2) Fallback: first unused with matching rest-ness
              if (matchIdx === -1) {
                for (let ci = 0; ci < candidates.length; ci++) {
                  if (!used.has(ci) && candidates[ci].isRest === isOsmdRest) {
                    matchIdx = ci; break;
                  }
                }
              }

              // 3) Last resort: any unused candidate
              if (matchIdx === -1) {
                for (let ci = 0; ci < candidates.length; ci++) {
                  if (!used.has(ci)) { matchIdx = ci; break; }
                }
              }

              if (matchIdx === -1) continue;
              used.add(matchIdx);

              // Invisible note (e.g. second half of a tie) — slot consumed but no hit.
              if (r.width === 0 && r.height === 0) continue;

              hits.push({
                note: candidates[matchIdx],
                x: r.left + r.width / 2 - containerRect.left,
                y: r.top + r.height / 2 - containerRect.top,
                lineSpacingPx,
                el: nhEl,
              });
            }
          }
        }
      }
    }

    return hits.length > 0 ? hits : null;
  } catch (e) {
    console.warn("[SMC] buildHitsFromOsmd threw:", e);
    return null;
  }
}

function buildHits(container: HTMLElement, parsedNotes: ParsedNote[]): NoteHit[] {
  const selectors = [".vf-notehead", ".vf-note-head", "[class*='notehead']"];
  let els: Element[] = [];
  for (const sel of selectors) {
    els = Array.from(container.querySelectorAll(sel));
    if (els.length > 0) break;
  }
  if (els.length === 0) return [];

  const lineSpacingPx = measureLineSpacing(container);
  const containerRect = container.getBoundingClientRect();

  const positioned = els.map((el) => {
    const r = el.getBoundingClientRect();
    return { el, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });

  const numStaves = parsedNotes.length
    ? Math.max(...parsedNotes.map((n) => n.staffId)) + 1
    : 1;

  const sortByReadingOrder = (arr: typeof positioned, rowHeight: number) =>
    arr.slice().sort((a, b) => {
      const ra = Math.floor((a.cy - containerRect.top) / rowHeight);
      const rb = Math.floor((b.cy - containerRect.top) / rowHeight);
      if (ra !== rb) return ra - rb;
      if (Math.abs(a.cx - b.cx) > 2) return a.cx - b.cx;
      return b.cy - a.cy; // same column (chord): low pitch first = ascending XML order
    });

  if (numStaves === 1) {
    const sorted = sortByReadingOrder(positioned, lineSpacingPx * 10);
    const count = Math.min(sorted.length, parsedNotes.length);
    return sorted.slice(0, count).map((p, i) => ({
      note: parsedNotes[i],
      x: p.cx - containerRect.left,
      y: p.cy - containerRect.top,
      lineSpacingPx,
      el: p.el,
    }));
  }

  // Multi-staff: split noteheads by Y band, one band per staff per system.
  // boundaries.filter(b => y > b).length counts staves above; mod numStaves
  // cycles 0..numStaves-1 within each system (top staff = 0).
  const boundaries = staffBoundaryYs(container, lineSpacingPx);
  const rowHeight = lineSpacingPx * 8;

  const staffNotes: ParsedNote[][] = Array.from({ length: numStaves }, () => []);
  for (const n of parsedNotes) staffNotes[n.staffId].push(n);

  const hits: NoteHit[] = [];
  for (let s = 0; s < numStaves; s++) {
    const staffEls = positioned.filter((pos) => {
      const slot = boundaries.filter((b) => pos.cy - containerRect.top > b).length % numStaves;
      return slot === s;
    });
    const sorted = sortByReadingOrder(staffEls, rowHeight);
    const notes = staffNotes[s];
    const count = Math.min(sorted.length, notes.length);
    for (let i = 0; i < count; i++) {
      hits.push({
        note: notes[i],
        x: sorted[i].cx - containerRect.left,
        y: sorted[i].cy - containerRect.top,
        lineSpacingPx,
        el: sorted[i].el,
      });
    }
  }
  return hits;
}

function findNoteContainer(noteheadEl: Element): Element | null {
  let el: Element | null = noteheadEl.parentElement;
  while (el && el.tagName.toLowerCase() !== "svg") {
    if (el.querySelector(".vf-stem")) return el;
    el = el.parentElement;
  }
  return null;
}

// Set both fill and stroke so we cover filled paths (noteheads, stems) and stroked lines alike.
function applyColor(el: Element, color: string | null) {
  const targets = el.querySelectorAll("path, rect, ellipse, circle, use, line, polyline, polygon");
  (targets.length > 0 ? Array.from(targets) : [el]).forEach((c) => {
    (c as SVGElement).style.fill = color ?? "";
    (c as SVGElement).style.stroke = color ?? "";
  });
}

function colorNote(noteheadEl: Element, color: string | null) {
  applyColor(noteheadEl, color);

  const container = findNoteContainer(noteheadEl);
  if (!container) return;

  const stemEl = container.querySelector(".vf-stem");
  if (stemEl) applyColor(stemEl, color);

  const flagEl = container.querySelector(".vf-flag");
  if (flagEl) applyColor(flagEl, color);

  // Accidentals (sharp/flat/natural signs on the note)
  container.querySelectorAll(".vf-accidental").forEach((acc) => applyColor(acc, color));
}

export const SheetMusicCanvas = forwardRef<SheetMusicCanvasHandle, Props>(function SheetMusicCanvas(
  { musicXml, selectedNotes, onNoteClick, onPitchCommit,
    scoreTitle, scoreComposer, onTitleCommit, onComposerCommit,
    harmonies, onChordClick }: Props,
  ref
) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const osmdDivRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const renderedXmlRef = useRef("");

  useImperativeHandle(ref, () => ({
    getOsmdDiv: () => osmdDivRef.current,
  }));
  const [noteHits, setNoteHits] = useState<NoteHit[]>([]);
  const [chordHits, setChordHits] = useState<ChordHit[]>([]);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [containerH, setContainerH] = useState(0);

  const rebuild = useCallback(() => {
    if (!osmdDivRef.current || !musicXml) return;
    try {
      const { notes } = parseMusicXml(musicXml);
      const lineSpacingPx = measureLineSpacing(osmdDivRef.current);
      const osmdHits = buildHitsFromOsmd(osmdRef.current, osmdDivRef.current, notes, lineSpacingPx);
      const rawHits = osmdHits ?? buildHits(osmdDivRef.current, notes);

      // Hit positions are computed relative to osmdDivRef, but the SVG overlay is
      // absolutely positioned relative to wrapperRef (which includes the title section
      // above the score). Apply the offset so coordinates are in SVG / wrapper space.
      const wrapperRect = wrapperRef.current?.getBoundingClientRect();
      const osmdRect = osmdDivRef.current.getBoundingClientRect();
      const dy = wrapperRect ? osmdRect.top - wrapperRect.top : 0;
      const dx = wrapperRect ? osmdRect.left - wrapperRect.left : 0;
      const shift = <T extends { x: number; y: number }>(h: T): T =>
        (dx || dy) ? { ...h, x: h.x + dx, y: h.y + dy } : h;

      setNoteHits(rawHits.map(shift));
      setContainerH(wrapperRef.current?.scrollHeight ?? osmdDivRef.current.scrollHeight);
      if (harmonies?.length) {
        setChordHits(buildChordHits(osmdDivRef.current, harmonies).map(shift));
      } else {
        setChordHits([]);
      }
    } catch (e) {
      console.warn("Note hit build failed:", e);
    }
  }, [musicXml, harmonies]);

  useEffect(() => {
    if (!osmdDivRef.current || !musicXml) return;
    if (renderedXmlRef.current === musicXml) return;
    renderedXmlRef.current = musicXml;

    const init = async () => {
      if (osmdRef.current) {
        try { (osmdRef.current as any).clear?.(); } catch {}
        osmdDivRef.current!.innerHTML = "";
      }
      const osmd = new OpenSheetMusicDisplay(osmdDivRef.current!, {
        autoResize: true,
        backend: "svg",
        drawTitle: false,
        drawComposer: false,
        drawCredits: false,
        drawPartNames: false,
        pageBackgroundColor: "#ffffff",
      } as any);
      osmdRef.current = osmd;
      await osmd.load(musicXml);
      osmd.render();
      requestAnimationFrame(() => requestAnimationFrame(rebuild));
    };

    init().catch(console.error);
  }, [musicXml, rebuild]);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver(() => {
      if (renderedXmlRef.current) setTimeout(rebuild, 100);
    });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, [rebuild]);

  // Color selected noteheads directly in the OSMD SVG.
  // Match by note.id: both noteHits and selectedNotes come from parseMusicXml(same xml),
  // so the n-th note in document order gets id=n in both calls — IDs are stable identifiers.
  useEffect(() => {
    const selectedIds = new Set(selectedNotes.map((n) => n.id));
    for (const hit of noteHits) {
      colorNote(hit.el, !hit.note.isRest && selectedIds.has(hit.note.id) ? ACCENT : null);
    }
  }, [noteHits, selectedNotes]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragState) return;
    setDragState((d) => d ? { ...d, currentY: e.clientY } : null);
  }, [dragState]);

  const commitDrag = useCallback(() => {
    if (!dragState || dragState.note.isRest) { setDragState(null); return; }
    const dy = dragState.startY - dragState.currentY;
    const steps = Math.round(dy / (dragState.lineSpacingPx / 2));
    if (steps !== 0) {
      const { step, octave } = applyDiatonicStep(dragState.note.step, dragState.note.octave, steps);
      onPitchCommit(dragState.note, step, octave);
    }
    setDragState(null);
  }, [dragState, onPitchCommit]);

  // Only allow drag on the single selected note
  const singleSelected =
    selectedNotes.length === 1
      ? noteHits.find(
          (h) =>
            h.note.measure === selectedNotes[0].measure &&
            h.note.xmlIndex === selectedNotes[0].xmlIndex
        ) ?? null
      : null;

  const dragSteps = dragState
    ? Math.round((dragState.startY - dragState.currentY) / (dragState.lineSpacingPx / 2))
    : 0;

  const dragLabel = (() => {
    if (!dragState || dragState.note.isRest || dragSteps === 0) return null;
    const { step, octave } = applyDiatonicStep(dragState.note.step, dragState.note.octave, dragSteps);
    return `${step}${octave}`;
  })();

  return (
    <div
      className="flex-1 bg-background overflow-auto"
      onMouseMove={handleMouseMove}
      onMouseUp={commitDrag}
      onMouseLeave={commitDrag}
    >
      <div ref={wrapperRef} style={{ position: "relative" }}>
        {/* Editable title / composer rendered above the score */}
        {(scoreTitle !== undefined || scoreComposer !== undefined) && (
          <div className="text-center pt-8 pb-3 px-8 bg-white">
            <ScoreTextField
              value={scoreTitle ?? ""}
              placeholder="Untitled"
              fontFamily="DM Serif Display, Georgia, serif"
              className="text-2xl font-bold text-[#1C1917] block w-full"
              onCommit={onTitleCommit}
            />
            {scoreComposer !== undefined && (
              <ScoreTextField
                value={scoreComposer}
                placeholder="Composer"
                className="text-sm text-[#1C1917]/60 mt-1 block w-full"
                onCommit={onComposerCommit}
              />
            )}
          </div>
        )}
        <div ref={osmdDivRef} style={{ width: "100%", backgroundColor: "#fff" }} />

        {(noteHits.length > 0 || chordHits.length > 0) && (
          <svg
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: containerH || "100%",
              overflow: "visible",
              pointerEvents: "none",
            }}
          >
            {/* Blinking insert cursor for selected rests — separate from edit selection */}
            {noteHits
              .filter((hit) =>
                hit.note.isRest &&
                selectedNotes.some(
                  (n) => n.measure === hit.note.measure && n.xmlIndex === hit.note.xmlIndex
                )
              )
              .map((hit, i) => {
                const top = hit.y - 2.5 * hit.lineSpacingPx;
                const bot = hit.y + 2.5 * hit.lineSpacingPx;
                return (
                  <g key={`cursor-${i}`} style={{ pointerEvents: "none" }}>
                    <line
                      x1={hit.x} y1={top} x2={hit.x} y2={bot}
                      stroke="#1C1917" strokeWidth="2" strokeLinecap="round"
                    >
                      <animate attributeName="opacity" values="1;1;0;0;1" keyTimes="0;0.4;0.5;0.9;1" dur="1.2s" repeatCount="indefinite" />
                    </line>
                  </g>
                );
              })}

            {/* Note hit ellipses rendered first so chord rects sit on top */}
            {noteHits.map((hit, i) => {
              const isSelected = selectedNotes.some(
                (n) => n.measure === hit.note.measure && n.xmlIndex === hit.note.xmlIndex
              );
              const isDragging =
                dragState?.note.measure === hit.note.measure &&
                dragState?.note.xmlIndex === hit.note.xmlIndex;
              const r = hit.lineSpacingPx * 0.7;
              const displayY = isDragging
                ? hit.y - dragSteps * (hit.lineSpacingPx / 2)
                : hit.y;
              return (
                <g key={i} style={{ pointerEvents: "all" }}>
                  <ellipse
                    cx={hit.x}
                    cy={hit.y}
                    rx={r + 8}
                    ry={r + 6}
                    fill="rgba(0,0,0,0)"
                    style={{
                      pointerEvents: "all",
                      cursor:
                        isSelected && singleSelected && !hit.note.isRest
                          ? "ns-resize"
                          : "pointer",
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (isSelected && singleSelected && !hit.note.isRest) {
                        setDragState({
                          note: hit.note,
                          startY: e.clientY,
                          currentY: e.clientY,
                          lineSpacingPx: hit.lineSpacingPx,
                        });
                      } else {
                        onNoteClick(hit.note, e.shiftKey);
                      }
                    }}
                  />
                  {isDragging && dragLabel && (
                    <text
                      x={hit.x + r + 8}
                      y={displayY + 4}
                      fontSize={12}
                      fontWeight="bold"
                      fill={ACCENT}
                      style={{ pointerEvents: "none" }}
                    >
                      {dragLabel}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Chord symbol hit areas rendered on top of notes */}
            {chordHits.map((hit, i) => (
              <rect
                key={`chord-${i}`}
                x={hit.x - hit.w / 2}
                y={hit.y - hit.h / 2}
                width={hit.w}
                height={hit.h}
                fill="rgba(0,0,0,0)"
                rx={3}
                style={{ pointerEvents: "all", cursor: "text" }}
                onClick={(e) => onChordClick?.(hit.harmony, e.clientX, e.clientY)}
              />
            ))}

          </svg>
        )}
      </div>
    </div>
  );
});
