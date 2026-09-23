export interface ParsedNote {
  id: number;          // global sequential ID
  xmlIndex: number;    // index within the <note> elements of its measure (for XML mutation)
  measure: number;      // 0-based global measure index (across all parts, used for XML mutation)
  localMeasure: number; // 0-based index within its own <part> (matches OSMD's MeasureList index)
  partIndex: number;    // which <part> this note belongs to
  staffId: number;      // unique 0-based staff index derived from (partIndex, <staff> number)
  beat: number;        // 0-based beat within measure
  step: string;        // C D E F G A B  (or "R" for rest)
  octave: number;
  alter: number;       // -1 flat  0 natural  1 sharp
  type: string;        // whole half quarter eighth sixteenth ...
  isRest: boolean;
}

export interface ScoreInfo {
  title: string;
  composer: string;
  keyFifths: number;
  keyMode: string;
  beats: number;
  beatType: number;
}

export interface ParsedScore {
  info: ScoreInfo;
  notes: ParsedNote[];
}

const DIATONIC = ["C", "D", "E", "F", "G", "A", "B"];

const NOTE_SEMITONES: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

// Chromatic spelling tables indexed by semitone mod 12
const SHARP_SPELLING = [
  { step: "C", alter: 0 }, { step: "C", alter: 1 }, { step: "D", alter: 0 },
  { step: "D", alter: 1 }, { step: "E", alter: 0 }, { step: "F", alter: 0 },
  { step: "F", alter: 1 }, { step: "G", alter: 0 }, { step: "G", alter: 1 },
  { step: "A", alter: 0 }, { step: "A", alter: 1 }, { step: "B", alter: 0 },
];
const FLAT_SPELLING = [
  { step: "C", alter: 0  }, { step: "D", alter: -1 }, { step: "D", alter: 0 },
  { step: "E", alter: -1 }, { step: "E", alter: 0  }, { step: "F", alter: 0 },
  { step: "G", alter: -1 }, { step: "G", alter: 0  }, { step: "A", alter: -1 },
  { step: "A", alter: 0  }, { step: "B", alter: -1 }, { step: "B", alter: 0 },
];

function getText(parent: Element | Document, tag: string): string {
  return parent.getElementsByTagName(tag)[0]?.textContent?.trim() ?? "";
}

function fifthsToKey(fifths: number, mode: string): string {
  const major = ["C","G","D","A","E","B","F#","C#","F","Bb","Eb","Ab","Db","Gb","Cb"];
  const minor = ["A","E","B","F#","C#","G#","D#","A#","D","G","C","F","Bb","Eb","Ab"];
  const name = (mode === "minor" ? minor : major)[fifths + 7];
  return `${name} ${mode === "minor" ? "Minor" : "Major"}`;
}

export function parseMusicXml(xml: string): ParsedScore {
  const doc = new DOMParser().parseFromString(xml, "application/xml");

  const title =
    getText(doc, "work-title") ||
    getText(doc, "movement-title") ||
    "Untitled";
  const composer =
    doc.querySelector("creator[type='composer']")?.textContent?.trim() ??
    getText(doc, "creator") ??
    "";

  const keyEl = doc.getElementsByTagName("key")[0];
  const keyFifths = parseInt(keyEl?.getElementsByTagName("fifths")[0]?.textContent ?? "0", 10);
  const keyMode = keyEl?.getElementsByTagName("mode")[0]?.textContent?.trim() ?? "major";

  const timeEl = doc.getElementsByTagName("time")[0];
  const beats = parseInt(getText(timeEl ?? doc.documentElement, "beats") || "4", 10);
  const beatType = parseInt(getText(timeEl ?? doc.documentElement, "beat-type") || "4", 10);

  const info: ScoreInfo = { title, composer, keyFifths, keyMode, beats, beatType };

  const notes: ParsedNote[] = [];
  let noteId = 0;
  const parts = doc.getElementsByTagName("part");
  // Use parts if present, otherwise fall back to flat measure list
  const partEls = parts.length > 0 ? Array.from(parts) : [doc.documentElement];
  let globalMeasureOffset = 0;

  for (let p = 0; p < partEls.length; p++) {
    const partMeasures = partEls[p].getElementsByTagName("measure");

    for (let m = 0; m < partMeasures.length; m++) {
      const measure = partMeasures[m];
      const noteEls = measure.getElementsByTagName("note");
      let beat = 0;

      for (let n = 0; n < noteEls.length; n++) {
        const noteEl = noteEls[n];
        const isRest = noteEl.getElementsByTagName("rest").length > 0;
        const isChord = noteEl.getElementsByTagName("chord").length > 0;

        const pitchEl = noteEl.getElementsByTagName("pitch")[0];
        const step = pitchEl?.getElementsByTagName("step")[0]?.textContent?.trim() ?? "C";
        const octave = parseInt(pitchEl?.getElementsByTagName("octave")[0]?.textContent ?? "4", 10);
        const alter = parseFloat(pitchEl?.getElementsByTagName("alter")[0]?.textContent ?? "0");
        const baseType = noteEl.getElementsByTagName("type")[0]?.textContent?.trim() ?? "quarter";
        const type = baseType + (noteEl.getElementsByTagName("dot").length > 0 ? "." : "");

        if (!isChord) beat++;
        const staffNum = parseInt(noteEl.getElementsByTagName("staff")[0]?.textContent ?? "1", 10);

        notes.push({
          id: noteId++,
          xmlIndex: n,
          measure: globalMeasureOffset + m,
          localMeasure: m,
          partIndex: p,
          staffId: 0, // filled in below
          beat: beat - 1,
          step: isRest ? "R" : step,
          octave: isRest ? 4 : octave,
          alter: isRest ? 0 : alter,
          type,
          isRest,
          _staffNum: staffNum, // temp field
        } as any);
      }
    }

    globalMeasureOffset += partMeasures.length;
  }

  // Assign staffId: unique sequential index per (partIndex, staffNum) pair,
  // in the order first encountered — which is top-staff-first in standard MusicXML.
  const staffKeys = new Map<string, number>();
  for (const n of notes) {
    const raw = (n as any)._staffNum as number;
    const key = `${n.partIndex}_${raw}`;
    if (!staffKeys.has(key)) staffKeys.set(key, staffKeys.size);
    n.staffId = staffKeys.get(key)!;
    delete (n as any)._staffNum;
  }

  return { info, notes };
}

export function pitchLabel(note: ParsedNote): string {
  if (note.isRest) return "Rest";
  const acc = note.alter === 1 ? "#" : note.alter === -1 ? "b" : "";
  return `${note.step}${acc}${note.octave}`;
}

export function keyLabel(info: ScoreInfo): string {
  return fifthsToKey(info.keyFifths, info.keyMode);
}

// --- XML mutation helpers ---

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, "application/xml");
}

function serializeXml(doc: Document): string {
  return new XMLSerializer().serializeToString(doc);
}

export function updateNotePitch(
  xml: string,
  measureIdx: number,
  xmlNoteIdx: number,
  step: string,
  octave: number,
  alter: number
): string {
  const doc = parseXml(xml);
  const measures = doc.getElementsByTagName("measure");
  const measure = measures[measureIdx];
  if (!measure) return xml;

  const noteEls = measure.getElementsByTagName("note");
  const noteEl = noteEls[xmlNoteIdx];
  if (!noteEl) return xml;

  const pitch = noteEl.getElementsByTagName("pitch")[0];
  if (!pitch) return xml;

  const stepEl = pitch.getElementsByTagName("step")[0];
  if (stepEl) stepEl.textContent = step;

  const octaveEl = pitch.getElementsByTagName("octave")[0];
  if (octaveEl) octaveEl.textContent = String(octave);

  // Update or remove alter
  const existingAlter = pitch.getElementsByTagName("alter")[0];
  if (alter !== 0) {
    if (existingAlter) {
      existingAlter.textContent = String(alter);
    } else {
      const alterEl = doc.createElement("alter");
      alterEl.textContent = String(alter);
      pitch.insertBefore(alterEl, octaveEl ?? null);
    }
  } else if (existingAlter) {
    pitch.removeChild(existingAlter);
  }

  return serializeXml(doc);
}

export function addMeasure(xml: string, afterLocalMeasureIdx: number): string {
  const doc = parseXml(xml);
  const parts = doc.getElementsByTagName("part");
  const partEls = parts.length > 0 ? Array.from(parts) : [doc.documentElement];

  for (const part of partEls) {
    const measures = Array.from(part.getElementsByTagName("measure"));
    const refMeasure = measures[afterLocalMeasureIdx];
    if (!refMeasure) continue;

    // Find nearest divisions value at or before insertion point
    let divisions = 1;
    for (let i = afterLocalMeasureIdx; i >= 0; i--) {
      const d = measures[i]?.getElementsByTagName("divisions")[0];
      if (d) { divisions = parseInt(d.textContent ?? "1", 10); break; }
    }

    // Find nearest time signature at or before insertion point
    let beats = 4, beatType = 4;
    for (let i = afterLocalMeasureIdx; i >= 0; i--) {
      const t = measures[i]?.getElementsByTagName("time")[0];
      if (t) {
        beats    = parseInt(t.getElementsByTagName("beats")[0]?.textContent    ?? "4", 10);
        beatType = parseInt(t.getElementsByTagName("beat-type")[0]?.textContent ?? "4", 10);
        break;
      }
    }

    const totalDuration = Math.round(beats * (4 / beatType) * divisions);

    const newMeasure = doc.createElement("measure");
    newMeasure.setAttribute("number", String(afterLocalMeasureIdx + 2));

    // Single whole-measure rest
    const noteEl = doc.createElement("note");
    const restEl = doc.createElement("rest");
    restEl.setAttribute("measure", "yes");
    noteEl.appendChild(restEl);
    const durEl = doc.createElement("duration");
    durEl.textContent = String(totalDuration);
    noteEl.appendChild(durEl);
    const typeEl = doc.createElement("type");
    typeEl.textContent = "whole";
    noteEl.appendChild(typeEl);
    newMeasure.appendChild(noteEl);

    refMeasure.parentNode?.insertBefore(newMeasure, refMeasure.nextSibling);

    // Renumber all measures sequentially
    Array.from(part.getElementsByTagName("measure"))
      .forEach((m, i) => m.setAttribute("number", String(i + 1)));
  }

  return serializeXml(doc);
}

export function deleteMeasure(xml: string, localMeasureIdx: number): string {
  const doc = parseXml(xml);
  const parts = doc.getElementsByTagName("part");
  const partEls = parts.length > 0 ? Array.from(parts) : [doc.documentElement];
  for (const part of partEls) {
    const measures = Array.from(part.getElementsByTagName("measure"));
    if (measures.length <= 1) continue; // keep at least one measure per part
    measures[localMeasureIdx]?.parentNode?.removeChild(measures[localMeasureIdx]);
  }
  return serializeXml(doc);
}

export function convertRestToNote(
  xml: string,
  measureIdx: number,
  xmlNoteIdx: number,
  step: string,
  octave: number,
  alter: number
): string {
  return insertNoteAtPosition(xml, measureIdx, xmlNoteIdx, step, octave, alter, null);
}

// Note-type → beats (in units of quarter notes). Dotted variants use "." suffix.
const TYPE_BEATS: Record<string, number> = {
  whole: 4, half: 2, "half.": 3, quarter: 1, "quarter.": 1.5,
  eighth: 0.5, "eighth.": 0.75, sixteenth: 0.25,
};

// Decompose a type string into base type and dot flag
function splitDotted(type: string): { base: string; dot: boolean } {
  return type.endsWith(".") ? { base: type.slice(0, -1), dot: true } : { base: type, dot: false };
}

// Apply a note type (possibly dotted) to an existing note element, managing <type> and <dot>
function applyNoteType(doc: Document, noteEl: Element, noteType: string): void {
  const { base, dot } = splitDotted(noteType);
  const typeEl = noteEl.getElementsByTagName("type")[0];
  if (typeEl) typeEl.textContent = base;
  const existingDot = noteEl.getElementsByTagName("dot")[0];
  if (dot && !existingDot) {
    const dotEl = doc.createElement("dot");
    noteEl.insertBefore(dotEl, typeEl ? typeEl.nextSibling : null);
  } else if (!dot && existingDot) {
    noteEl.removeChild(existingDot);
  }
}

function getDivisions(doc: Document, measureIdx: number): number {
  const measures = doc.getElementsByTagName("measure");
  for (let i = measureIdx; i >= 0; i--) {
    const d = measures[i]?.getElementsByTagName("divisions")[0];
    if (d) return parseInt(d.textContent ?? "1", 10) || 1;
  }
  return 1;
}

function buildPitchEl(doc: Document, step: string, octave: number, alter: number): Element {
  const pitch = doc.createElement("pitch");
  const stepEl = doc.createElement("step");
  stepEl.textContent = step;
  pitch.appendChild(stepEl);
  if (alter !== 0) {
    const alterEl = doc.createElement("alter");
    alterEl.textContent = String(alter);
    pitch.appendChild(alterEl);
  }
  const octaveEl = doc.createElement("octave");
  octaveEl.textContent = String(octave);
  pitch.appendChild(octaveEl);
  return pitch;
}

function buildRestEl(doc: Document, durDivisions: number, divPerQ: number, staffEl: Element | null, voiceEl: Element | null): Element {
  const note = doc.createElement("note");
  const rest = doc.createElement("rest");
  note.appendChild(rest);
  const dur = doc.createElement("duration");
  dur.textContent = String(durDivisions);
  note.appendChild(dur);

  const beats = durDivisions / divPerQ;
  for (const [type, factor] of Object.entries(TYPE_BEATS)) {
    if (type.endsWith(".")) continue; // base types handle dotted via the ×1.5 check below
    if (Math.abs(beats - factor * 1.5) < 0.01) {
      const typeEl = doc.createElement("type"); typeEl.textContent = type; note.appendChild(typeEl);
      note.appendChild(doc.createElement("dot"));
      break;
    }
    if (Math.abs(beats - factor) < 0.01) {
      const typeEl = doc.createElement("type"); typeEl.textContent = type; note.appendChild(typeEl);
      break;
    }
  }

  if (voiceEl) note.appendChild(voiceEl.cloneNode(true));
  if (staffEl) note.appendChild(staffEl.cloneNode(true));
  return note;
}

// Insert a pitched note into an existing rest, splitting the rest if the chosen
// noteType is shorter than the rest. Pass noteType=null to use the rest's own duration.
export function insertNoteAtPosition(
  xml: string,
  measureIdx: number,
  xmlNoteIdx: number,
  step: string,
  octave: number,
  alter: number,
  noteType: string | null
): string {
  const doc = parseXml(xml);
  const measures = doc.getElementsByTagName("measure");
  const measure = measures[measureIdx];
  if (!measure) return xml;

  const noteEl = Array.from(measure.getElementsByTagName("note"))[xmlNoteIdx];
  if (!noteEl) return xml;

  const restEl = noteEl.getElementsByTagName("rest")[0];
  if (!restEl) return xml;

  const divPerQ = getDivisions(doc, measureIdx);
  const restDurEl = noteEl.getElementsByTagName("duration")[0];
  const restDuration = parseInt(restDurEl?.textContent ?? "0", 10);

  // Duration of new note in divisions
  const targetBeats = noteType ? (TYPE_BEATS[noteType] ?? null) : null;
  const noteDuration = targetBeats !== null
    ? Math.round(targetBeats * divPerQ)
    : restDuration;

  if (noteDuration >= restDuration) {
    // Fill entire rest — simple conversion
    noteEl.removeChild(restEl);
    noteEl.insertBefore(buildPitchEl(doc, step, octave, alter), noteEl.firstChild);
    if (restDurEl) restDurEl.textContent = String(restDuration);
    if (noteType) applyNoteType(doc, noteEl, noteType);
    return serializeXml(doc);
  }

  // Partial fill — update the note element, then insert a trailing rest
  noteEl.removeChild(restEl);
  noteEl.insertBefore(buildPitchEl(doc, step, octave, alter), noteEl.firstChild);
  if (restDurEl) restDurEl.textContent = String(noteDuration);
  if (noteType) applyNoteType(doc, noteEl, noteType);

  const staffEl = noteEl.getElementsByTagName("staff")[0] ?? null;
  const voiceEl = noteEl.getElementsByTagName("voice")[0] ?? null;
  const remaining = restDuration - noteDuration;
  const trailingRest = buildRestEl(doc, remaining, divPerQ, staffEl, voiceEl);
  noteEl.parentNode?.insertBefore(trailingRest, noteEl.nextSibling);

  return serializeXml(doc);
}


export function deleteNote(xml: string, measureIdx: number, xmlNoteIdx: number): string {
  const doc = parseXml(xml);
  const measures = doc.getElementsByTagName("measure");
  const measure = measures[measureIdx];
  if (!measure) return xml;

  const noteEls = Array.from(measure.getElementsByTagName("note"));
  const noteEl = noteEls[xmlNoteIdx];
  if (!noteEl) return xml;

  // Replace with a rest of the same duration
  const typeEl = noteEl.getElementsByTagName("type")[0];
  const durationEl = noteEl.getElementsByTagName("duration")[0];
  const rest = doc.createElement("note");

  const restEl = doc.createElement("rest");
  rest.appendChild(restEl);

  if (durationEl) {
    const dur = doc.createElement("duration");
    dur.textContent = durationEl.textContent;
    rest.appendChild(dur);
  }
  if (typeEl) {
    const type = doc.createElement("type");
    type.textContent = typeEl.textContent;
    rest.appendChild(type);
  }

  measure.replaceChild(rest, noteEl);
  return serializeXml(doc);
}

/**
 * Insert a new note element immediately after `xmlNoteIdx` in the given measure,
 * tagged with <chord/> so it sounds simultaneously with that note.
 * The new note inherits the duration/type of the parent note.
 */
export function addChordNote(
  xml: string,
  measureIdx: number,
  xmlNoteIdx: number,
  step: string,
  octave: number,
  alter: number
): string {
  const doc = parseXml(xml);
  const measures = doc.getElementsByTagName("measure");
  const measure = measures[measureIdx];
  if (!measure) return xml;

  const noteEls = Array.from(measure.getElementsByTagName("note"));
  const refNote = noteEls[xmlNoteIdx];
  if (!refNote) return xml;

  const durationEl = refNote.getElementsByTagName("duration")[0];
  const typeEl = refNote.getElementsByTagName("type")[0];

  const newNote = doc.createElement("note");

  // <chord/> must be the first child
  newNote.appendChild(doc.createElement("chord"));

  // <pitch>
  const pitch = doc.createElement("pitch");
  const stepEl = doc.createElement("step");
  stepEl.textContent = step;
  pitch.appendChild(stepEl);
  if (alter !== 0) {
    const alterEl = doc.createElement("alter");
    alterEl.textContent = String(alter);
    pitch.appendChild(alterEl);
  }
  const octaveEl = doc.createElement("octave");
  octaveEl.textContent = String(octave);
  pitch.appendChild(octaveEl);
  newNote.appendChild(pitch);

  // Copy duration
  if (durationEl) {
    const dur = doc.createElement("duration");
    dur.textContent = durationEl.textContent;
    newNote.appendChild(dur);
  }

  // Copy type
  if (typeEl) {
    const type = doc.createElement("type");
    type.textContent = typeEl.textContent;
    newNote.appendChild(type);
  }

  // Insert right after the reference note (and any existing chord notes that follow it)
  let insertBefore: ChildNode | null = refNote.nextSibling;
  while (
    insertBefore &&
    (insertBefore as Element).tagName === "note" &&
    (insertBefore as Element).getElementsByTagName("chord").length > 0
  ) {
    insertBefore = insertBefore.nextSibling;
  }
  measure.insertBefore(newNote, insertBefore);

  return serializeXml(doc);
}

// Same map as TYPE_BEATS, aliased for clarity in the duration-change context.
const TYPE_MULTIPLIER: Record<string, number> = {
  ...TYPE_BEATS, "32nd": 0.125,
};

export function updateNoteDuration(
  xml: string,
  measureIdx: number,
  xmlNoteIdx: number,
  newType: string
): string {
  const multiplier = TYPE_MULTIPLIER[newType];
  if (multiplier === undefined) return xml;

  const doc = parseXml(xml);
  const measures = doc.getElementsByTagName("measure");

  let divisions = 1;
  for (let i = measureIdx; i >= 0; i--) {
    const divEl = measures[i]?.getElementsByTagName("divisions")[0];
    if (divEl) { divisions = parseInt(divEl.textContent ?? "1", 10); break; }
  }

  const measure = measures[measureIdx];
  if (!measure) return xml;

  const noteEl = measure.getElementsByTagName("note")[xmlNoteIdx];
  if (!noteEl) return xml;

  applyNoteType(doc, noteEl, newType);

  const durationEl = noteEl.getElementsByTagName("duration")[0];
  if (durationEl) durationEl.textContent = String(Math.round(divisions * multiplier));

  return serializeXml(doc);
}

export function applyDiatonicStep(
  step: string,
  octave: number,
  delta: number
): { step: string; octave: number } {
  const idx = DIATONIC.indexOf(step);
  if (idx === -1) return { step, octave };
  let newIdx = idx + delta;
  let newOctave = octave;
  while (newIdx < 0) { newIdx += 7; newOctave--; }
  while (newIdx >= 7) { newIdx -= 7; newOctave++; }
  return { step: DIATONIC[newIdx], octave: newOctave };
}

// Transpose every pitched note in the score by `semitones` (negative = down).
// Key signature is transposed via circle-of-fifths arithmetic.
// Enharmonic spelling follows the new key: flat keys → flats, sharp keys → sharps.
export function transposeScore(xml: string, semitones: number): string {
  if (semitones === 0) return xml;
  const doc = parseXml(xml);

  // Determine the new key's fifths value so we can choose spelling.
  const firstFifthsEl = doc.getElementsByTagName("key")[0]
    ?.getElementsByTagName("fifths")[0];
  const currentFifths = parseInt(firstFifthsEl?.textContent ?? "0", 10);
  // Circle-of-fifths: pc = (7 * fifths) mod 12; fifths = (7 * pc) mod 12
  const currentPc = ((7 * currentFifths) % 12 + 12) % 12;
  const newPc = ((currentPc + semitones) % 12 + 12) % 12;
  const rawFifths = (7 * newPc) % 12;
  const newKeyFifths = rawFifths > 6 ? rawFifths - 12 : rawFifths;
  const table = newKeyFifths < 0 ? FLAT_SPELLING : SHARP_SPELLING;

  // Transpose all pitched notes
  for (const noteEl of Array.from(doc.getElementsByTagName("note"))) {
    const pitchEl = noteEl.getElementsByTagName("pitch")[0];
    if (!pitchEl) continue; // rest — no pitch element

    const stepEl   = pitchEl.getElementsByTagName("step")[0];
    const octaveEl = pitchEl.getElementsByTagName("octave")[0];
    const alterEl  = pitchEl.getElementsByTagName("alter")[0];
    if (!stepEl || !octaveEl) continue;

    const step   = stepEl.textContent!.trim();
    const octave = parseInt(octaveEl.textContent!, 10);
    const alter  = parseFloat(alterEl?.textContent ?? "0");

    const absSemi = octave * 12 + (NOTE_SEMITONES[step] ?? 0) + alter + semitones;
    const newOctave = Math.floor(absSemi / 12);
    const semMod = ((absSemi % 12) + 12) % 12;
    const { step: ns, alter: na } = table[semMod];

    stepEl.textContent   = ns;
    octaveEl.textContent = String(newOctave);

    if (na !== 0) {
      if (alterEl) {
        alterEl.textContent = String(na);
      } else {
        const el = doc.createElement("alter");
        el.textContent = String(na);
        pitchEl.insertBefore(el, octaveEl);
      }
    } else if (alterEl) {
      pitchEl.removeChild(alterEl);
    }
  }

  // Transpose every key signature element
  for (const keyEl of Array.from(doc.getElementsByTagName("key"))) {
    const fifthsEl = keyEl.getElementsByTagName("fifths")[0];
    if (!fifthsEl) continue;
    const kFifths = parseInt(fifthsEl.textContent ?? "0", 10);
    const kPc = ((7 * kFifths) % 12 + 12) % 12;
    const kNewPc = ((kPc + semitones) % 12 + 12) % 12;
    const kRaw = (7 * kNewPc) % 12;
    fifthsEl.textContent = String(kRaw > 6 ? kRaw - 12 : kRaw);
  }

  // Transpose chord symbols in <harmony> elements (root + optional slash-bass)
  for (const harmonyEl of Array.from(doc.getElementsByTagName("harmony"))) {
    for (const group of [
      { container: "root", stepTag: "root-step", alterTag: "root-alter" },
      { container: "bass", stepTag: "bass-step", alterTag: "bass-alter" },
    ]) {
      const containerEl = harmonyEl.getElementsByTagName(group.container)[0];
      if (!containerEl) continue;
      const stepEl  = containerEl.getElementsByTagName(group.stepTag)[0];
      const alterEl = containerEl.getElementsByTagName(group.alterTag)[0];
      if (!stepEl) continue;

      const step  = stepEl.textContent!.trim();
      const alter = parseFloat(alterEl?.textContent ?? "0");
      const semMod = (((NOTE_SEMITONES[step] ?? 0) + alter + semitones) % 12 + 12) % 12;
      const { step: ns, alter: na } = table[semMod];

      stepEl.textContent = ns;
      if (na !== 0) {
        if (alterEl) {
          alterEl.textContent = String(na);
        } else {
          const el = doc.createElement(group.alterTag);
          el.textContent = String(na);
          containerEl.appendChild(el);
        }
      } else if (alterEl) {
        containerEl.removeChild(alterEl);
      }
    }
  }

  return serializeXml(doc);
}

// ---- Harmony / chord symbol API ----

const KIND_TO_LABEL: Record<string, string> = {
  "major": "", "minor": "m", "dominant": "7",
  "major-seventh": "maj7", "minor-seventh": "m7",
  "diminished": "dim", "augmented": "+", "half-diminished": "m7b5",
  "diminished-seventh": "dim7", "augmented-seventh": "+7",
  "major-sixth": "6", "minor-sixth": "m6",
  "suspended-fourth": "sus4", "suspended-second": "sus2",
  "dominant-ninth": "9", "major-ninth": "maj9", "minor-ninth": "m9",
  "dominant-eleventh": "11", "major-eleventh": "maj11", "minor-eleventh": "m11",
  "dominant-thirteenth": "13", "major-thirteenth": "maj13", "minor-thirteenth": "m13",
  "major-minor": "mMaj7",
};

// Grammar-based chord suffix parser — no exhaustive lookup table needed.
// Handles quality (m/maj/dim/aug/ø/sus), extension (6/7/9/11/13), and
// alterations/additions/omissions (b9, #11, add9, no5…) via MusicXML <degree>.
type DegreeEntry = { value: number; alter: number; type: string };

function parseSuffix(suffix: string): { kind: string; degrees: DegreeEntry[] } | null {
  let s = suffix;
  type Quality = "default" | "minor" | "major" | "dim" | "aug" | "halfDim" | "sus2" | "sus4";
  let quality: Quality = "default";
  let minorMaj = false;

  if (/^m[Mm]aj?/.test(s))       { quality = "minor"; minorMaj = true; s = s.replace(/^m[Mm]aj?/, ""); }
  else if (s.startsWith("min"))   { quality = "minor"; s = s.slice(3); }
  else if (s.startsWith("maj") || s.startsWith("Maj")) { quality = "major"; s = s.slice(3); }
  else if (s.startsWith("Δ"))    { quality = "major"; s = s.slice(1); }
  else if (s.startsWith("M"))    { quality = "major"; s = s.slice(1); }
  else if (s.startsWith("dim") || s.startsWith("°")) { quality = "dim"; s = s.slice(s.startsWith("°") ? 1 : 3); }
  else if (s.startsWith("aug") || s.startsWith("+")) { quality = "aug"; s = s.slice(s.startsWith("+") ? 1 : 3); }
  else if (s.startsWith("ø") || s.startsWith("∅"))  { quality = "halfDim"; s = s.slice(1); }
  else if (s.startsWith("m"))    { quality = "minor"; s = s.slice(1); }

  if (s.startsWith("sus2"))      { quality = "sus2"; s = s.slice(4); }
  else if (s.startsWith("sus4") || s.startsWith("sus")) { quality = "sus4"; s = s.slice(s.startsWith("sus4") ? 4 : 3); }

  let ext = 0;
  const extM = s.match(/^(13|11|9|7|6)/);
  if (extM) { ext = parseInt(extM[1]); s = s.slice(extM[1].length); }

  s = s.replace(/[()]/g, "");
  const degrees: DegreeEntry[] = [];
  const degRe = /([b♭])(1[0-3]|[2-9])|([#♯])(1[0-3]|[2-9])|(add)(1[0-3]|[2-9])|(no)([135])/g;
  const covered: boolean[] = new Array(s.length).fill(false);
  let dm: RegExpExecArray | null;
  while ((dm = degRe.exec(s)) !== null) {
    for (let i = dm.index; i < dm.index + dm[0].length; i++) covered[i] = true;
    if (dm[1])      degrees.push({ value: parseInt(dm[2]),  alter: -1, type: "add" });
    else if (dm[3]) degrees.push({ value: parseInt(dm[4]),  alter:  1, type: "add" });
    else if (dm[5]) degrees.push({ value: parseInt(dm[6]),  alter:  0, type: "add" });
    else            degrees.push({ value: parseInt(dm[8]),  alter:  0, type: "subtract" });
  }
  const remaining = s.split("").filter((_, i) => !covered[i]).join("").trim();
  if (remaining.length > 0) return null;

  let kind: string;
  if (quality === "sus2")    kind = "suspended-second";
  else if (quality === "sus4")    kind = "suspended-fourth";
  else if (quality === "halfDim") kind = "half-diminished";
  else if (quality === "dim")     kind = ext === 7 ? "diminished-seventh" : "diminished";
  else if (quality === "aug")     kind = ext === 7 ? "augmented-seventh"  : "augmented";
  else if (quality === "minor") {
    if (minorMaj) kind = "major-minor";
    else {
      const m: Record<number, string> = { 13: "minor-thirteenth", 11: "minor-eleventh", 9: "minor-ninth", 7: "minor-seventh", 6: "minor-sixth" };
      kind = m[ext] ?? "minor";
    }
  } else if (quality === "major") {
    const m: Record<number, string> = { 13: "major-thirteenth", 11: "major-eleventh", 9: "major-ninth", 7: "major-seventh" };
    kind = m[ext] ?? "major";
  } else {
    const m: Record<number, string> = { 13: "dominant-thirteenth", 11: "dominant-eleventh", 9: "dominant-ninth", 7: "dominant", 6: "major-sixth" };
    kind = m[ext] ?? "major";
  }
  return { kind, degrees };
}

export interface ParsedHarmony {
  index: number;    // 0-based document order among all <harmony> elements
  measure: number;  // 0-based global measure index
  label: string;    // display string e.g. "Cmaj7", "Dm7/F"
  root: string;
  alter: number;
  kind: string;
  bass: string | null;
  bassAlter: number;
}

export function parseHarmonies(xml: string): ParsedHarmony[] {
  const doc = parseXml(xml);
  const result: ParsedHarmony[] = [];
  let idx = 0;
  let globalMeasure = 0;
  for (const part of Array.from(doc.getElementsByTagName("part"))) {
    for (const measure of Array.from(part.getElementsByTagName("measure"))) {
      for (const child of Array.from(measure.childNodes) as Element[]) {
        if (child.nodeName !== "harmony") continue;
        const rootEl = child.getElementsByTagName("root")[0];
        const root = rootEl?.getElementsByTagName("root-step")[0]?.textContent?.trim() ?? "C";
        const alter = parseFloat(rootEl?.getElementsByTagName("root-alter")[0]?.textContent ?? "0");
        const kind = child.getElementsByTagName("kind")[0]?.textContent?.trim() ?? "major";
        const bassEl = child.getElementsByTagName("bass")[0];
        const bass = bassEl?.getElementsByTagName("bass-step")[0]?.textContent?.trim() ?? null;
        const bassAlter = parseFloat(bassEl?.getElementsByTagName("bass-alter")[0]?.textContent ?? "0");
        const alterSym = alter === 1 ? "#" : alter === -1 ? "b" : "";
        const bassStr = bass ? `/${bass}${bassAlter === 1 ? "#" : bassAlter === -1 ? "b" : ""}` : "";
        let degreeStr = "";
        for (const degEl of Array.from(child.getElementsByTagName("degree"))) {
          const val  = degEl.getElementsByTagName("degree-value")[0]?.textContent?.trim() ?? "";
          const alt  = parseFloat(degEl.getElementsByTagName("degree-alter")[0]?.textContent ?? "0");
          const type = degEl.getElementsByTagName("degree-type")[0]?.textContent?.trim() ?? "add";
          if (type === "subtract")  degreeStr += `no${val}`;
          else if (alt < 0)         degreeStr += `b${val}`;
          else if (alt > 0)         degreeStr += `#${val}`;
          else                      degreeStr += `add${val}`;
        }
        const label = `${root}${alterSym}${KIND_TO_LABEL[kind] ?? kind}${degreeStr}${bassStr}`;
        result.push({ index: idx++, measure: globalMeasure, label, root, alter, kind, bass, bassAlter });
      }
      globalMeasure++;
    }
    globalMeasure = 0;
  }
  return result;
}

function parseChordLabel(label: string): { root: string; alter: number; kind: string; degrees: DegreeEntry[]; bass: string | null; bassAlter: number } | null {
  const trimmed = label.trim();
  const slashIdx = trimmed.lastIndexOf("/");
  let main = trimmed;
  let bassStr = "";
  if (slashIdx > 0) {
    const after = trimmed.slice(slashIdx + 1).trim();
    if (/^[A-G][#♯b♭]?$/.test(after)) { bassStr = after; main = trimmed.slice(0, slashIdx).trim(); }
  }
  const m = main.match(/^([A-G])([#♯b♭]?)(.*)/);
  if (!m) return null;
  const ac = m[2] ?? "";
  const alter = ac === "#" || ac === "♯" ? 1 : ac === "b" || ac === "♭" ? -1 : 0;
  let bass: string | null = null;
  let bassAlter = 0;
  if (bassStr) {
    const bm = bassStr.match(/^([A-G])([#♯b♭]?)$/);
    if (!bm) return null;
    bass = bm[1];
    const bac = bm[2] ?? "";
    bassAlter = bac === "#" || bac === "♯" ? 1 : bac === "b" || bac === "♭" ? -1 : 0;
  }
  const parsed = parseSuffix(m[3] ?? "");
  if (!parsed) return null;
  return { root: m[1], alter, kind: parsed.kind, degrees: parsed.degrees, bass, bassAlter };
}

export function validateChordLabel(label: string): boolean {
  return parseChordLabel(label) !== null;
}

export function updateHarmony(xml: string, index: number, chordLabel: string): string {
  const parsed = parseChordLabel(chordLabel);
  if (!parsed) return xml;
  const doc = parseXml(xml);
  const harmonyEl = Array.from(doc.getElementsByTagName("harmony"))[index];
  if (!harmonyEl) return xml;

  const rootEl = harmonyEl.getElementsByTagName("root")[0];
  if (rootEl) {
    const stepEl = rootEl.getElementsByTagName("root-step")[0];
    const alterEl = rootEl.getElementsByTagName("root-alter")[0];
    if (stepEl) stepEl.textContent = parsed.root;
    if (parsed.alter !== 0) {
      if (alterEl) alterEl.textContent = String(parsed.alter);
      else { const el = doc.createElement("root-alter"); el.textContent = String(parsed.alter); rootEl.appendChild(el); }
    } else if (alterEl) rootEl.removeChild(alterEl);
  }

  const kindEl = harmonyEl.getElementsByTagName("kind")[0];
  if (kindEl) {
    kindEl.textContent = parsed.kind;
    const degSuffix = parsed.degrees.map(d =>
      d.type === "subtract" ? `no${d.value}` :
      d.alter < 0 ? `b${d.value}` :
      d.alter > 0 ? `#${d.value}` :
      `add${d.value}`
    ).join("");
    kindEl.setAttribute("text", (KIND_TO_LABEL[parsed.kind] ?? parsed.kind) + degSuffix);
  }

  for (const deg of Array.from(harmonyEl.getElementsByTagName("degree"))) harmonyEl.removeChild(deg);
  for (const d of parsed.degrees) {
    const degEl = doc.createElement("degree");
    const vEl = doc.createElement("degree-value"); vEl.textContent = String(d.value);
    const aEl = doc.createElement("degree-alter"); aEl.textContent = String(d.alter);
    const tEl = doc.createElement("degree-type");  tEl.textContent = d.type;
    degEl.appendChild(vEl); degEl.appendChild(aEl); degEl.appendChild(tEl);
    harmonyEl.appendChild(degEl);
  }

  const existingBass = harmonyEl.getElementsByTagName("bass")[0];
  if (parsed.bass) {
    const bassEl = existingBass ?? (() => { const el = doc.createElement("bass"); harmonyEl.appendChild(el); return el; })();
    const bsEl = bassEl.getElementsByTagName("bass-step")[0] ?? (() => { const el = doc.createElement("bass-step"); bassEl.appendChild(el); return el; })();
    const baEl = bassEl.getElementsByTagName("bass-alter")[0];
    bsEl.textContent = parsed.bass;
    if (parsed.bassAlter !== 0) {
      if (baEl) baEl.textContent = String(parsed.bassAlter);
      else { const el = doc.createElement("bass-alter"); el.textContent = String(parsed.bassAlter); bassEl.appendChild(el); }
    } else if (baEl) bassEl.removeChild(baEl);
  } else if (existingBass) {
    harmonyEl.removeChild(existingBass);
  }

  return serializeXml(doc);
}

export function updateComposerInXml(xml: string, composer: string): string {
  const doc = parseXml(xml);
  const el = doc.querySelector("creator[type='composer']") ?? doc.querySelector("creator");
  if (el) {
    el.textContent = composer;
    el.setAttribute("type", "composer");
    return serializeXml(doc);
  }
  let identification = doc.getElementsByTagName("identification")[0];
  if (!identification) {
    identification = doc.createElement("identification");
    const ref = doc.querySelector("movement-title") ?? doc.querySelector("work");
    ref ? ref.parentNode?.insertBefore(identification, ref.nextSibling)
        : doc.documentElement.insertBefore(identification, doc.documentElement.firstChild);
  }
  const creatorEl = doc.createElement("creator");
  creatorEl.setAttribute("type", "composer");
  creatorEl.textContent = composer;
  identification.appendChild(creatorEl);
  return serializeXml(doc);
}
