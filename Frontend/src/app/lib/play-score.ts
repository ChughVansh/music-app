interface PlayNote {
  frequency: number;
  startSec: number;
  durationSec: number;
  isChord: boolean;
  /** Tied continuation of the previous note: occupies a timeline slot (for cursor
   *  alignment) but shouldn't trigger a new attack — the previous note's sound
   *  is extended to cover it instead. */
  silent?: boolean;
}

const CHORD_INTERVALS: Record<string, number[]> = {
  "major": [0, 4, 7],
  "minor": [0, 3, 7],
  "dominant": [0, 4, 7, 10],
  "major-seventh": [0, 4, 7, 11],
  "minor-seventh": [0, 3, 7, 10],
  "diminished": [0, 3, 6],
  "augmented": [0, 4, 8],
  "half-diminished": [0, 3, 6, 10],
  "diminished-seventh": [0, 3, 6, 9],
  "major-sixth": [0, 4, 7, 9],
  "minor-sixth": [0, 3, 7, 9],
  "suspended-fourth": [0, 5, 7],
  "suspended-second": [0, 2, 7],
};

const SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function noteToFrequency(step: string, octave: number, alter: number): number {
  const midi = (octave + 1) * 12 + (SEMITONES[step] ?? 0) + Math.round(alter);
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function parseForPlayback(
  xml: string,
  bpmOverride?: number
): { notes: PlayNote[]; totalDuration: number; melodyCount: number; baseBpm: number } {
  const doc = new DOMParser().parseFromString(xml, "application/xml");

  let baseBpm = 120;
  const firstSound = doc.querySelector("sound[tempo]");
  if (firstSound) baseBpm = parseFloat(firstSound.getAttribute("tempo") ?? "120");

  const melodyNotes: PlayNote[] = [];
  const chordNotes: PlayNote[] = [];

  for (const part of Array.from(doc.getElementsByTagName("part"))) {
    let measureStartSec = 0;
    let divisions = 1;
    let currentBpm = bpmOverride ?? baseBpm;
    // Tracks the note that currently "owns" the sounding oscillator, so a chain
    // of tied notes (a-tied-to-b-tied-to-c) all extend the same original attack.
    let lastSoundingMelodyNote: PlayNote | null = null;

    for (const measure of Array.from(part.getElementsByTagName("measure"))) {
      const divEl = measure.getElementsByTagName("divisions")[0];
      if (divEl) divisions = parseInt(divEl.textContent!, 10);

      if (!bpmOverride) {
        const soundEl = measure.querySelector("sound[tempo]");
        if (soundEl) currentBpm = parseFloat(soundEl.getAttribute("tempo") ?? String(currentBpm));
      }

      const secPerBeat = 60 / currentBpm;
      let cursor = measureStartSec;
      let lastAdvance = 0;
      let measureEnd = measureStartSec;
      const measureHarmonies: Array<{ startSec: number; root: string; alter: number; kind: string }> = [];

      for (const child of Array.from(measure.childNodes) as Element[]) {
        const tag = child.nodeName;
        if (tag === "harmony") {
          const rootStep = child.getElementsByTagName("root-step")[0]?.textContent?.trim() ?? "C";
          const rootAlter = parseFloat(child.getElementsByTagName("root-alter")[0]?.textContent ?? "0");
          const kind = child.getElementsByTagName("kind")[0]?.textContent?.trim() ?? "major";
          measureHarmonies.push({ startSec: cursor, root: rootStep, alter: rootAlter, kind });
        } else if (tag === "note") {
          const isNoteChord = child.getElementsByTagName("chord").length > 0;
          const isRest = child.getElementsByTagName("rest").length > 0;
          const durEl = child.getElementsByTagName("duration")[0];
          const durSec = durEl
            ? (parseInt(durEl.textContent!, 10) / divisions) * secPerBeat
            : secPerBeat;
          const startSec = isNoteChord ? cursor - lastAdvance : cursor;

          if (!isRest) {
            const pitchEl = child.getElementsByTagName("pitch")[0];
            if (pitchEl) {
              const step = pitchEl.getElementsByTagName("step")[0]?.textContent?.trim() ?? "C";
              const octave = parseInt(pitchEl.getElementsByTagName("octave")[0]?.textContent ?? "4", 10);
              const alter = parseFloat(pitchEl.getElementsByTagName("alter")[0]?.textContent ?? "0");
              const tieStop = Array.from(child.getElementsByTagName("tie")).some(
                (t) => t.getAttribute("type") === "stop"
              );
              if (tieStop && lastSoundingMelodyNote) {
                // Extend the original attack's sustain instead of re-triggering.
                lastSoundingMelodyNote.durationSec += durSec * 0.9;
                melodyNotes.push({
                  frequency: noteToFrequency(step, octave, alter),
                  startSec,
                  durationSec: 0,
                  isChord: false,
                  silent: true,
                });
              } else {
                const newNote: PlayNote = {
                  frequency: noteToFrequency(step, octave, alter),
                  startSec,
                  durationSec: durSec * 0.9,
                  isChord: false,
                };
                melodyNotes.push(newNote);
                lastSoundingMelodyNote = newNote;
              }
            }
          }

          if (!isNoteChord) {
            lastAdvance = durSec;
            cursor += durSec;
            measureEnd = Math.max(measureEnd, cursor);
          }
        } else if (tag === "backup") {
          const d = child.getElementsByTagName("duration")[0];
          if (d) cursor -= (parseInt(d.textContent!, 10) / divisions) * secPerBeat;
        } else if (tag === "forward") {
          const d = child.getElementsByTagName("duration")[0];
          if (d) { cursor += (parseInt(d.textContent!, 10) / divisions) * secPerBeat; measureEnd = Math.max(measureEnd, cursor); }
        }
      }

      // Schedule harmony chord tones (soft sine wave, octave 3 voicing)
      for (let hi = 0; hi < measureHarmonies.length; hi++) {
        const h = measureHarmonies[hi];
        const durSec = hi < measureHarmonies.length - 1
          ? measureHarmonies[hi + 1].startSec - h.startSec
          : measureEnd - h.startSec;
        if (durSec < 0.05) continue;
        const intervals = CHORD_INTERVALS[h.kind] ?? [0, 4, 7];
        const rootMidi = 4 * 12 + (SEMITONES[h.root] ?? 0) + Math.round(h.alter);
        for (const interval of intervals) {
          chordNotes.push({
            frequency: 440 * Math.pow(2, (rootMidi + interval - 69) / 12),
            startSec: h.startSec,
            durationSec: durSec * 0.85,
            isChord: true,
          });
        }
      }

      measureStartSec = measureEnd;
    }
  }

  const notes = [...melodyNotes, ...chordNotes];
  const totalDuration = notes.reduce((m, n) => Math.max(m, n.startSec + n.durationSec), 0);
  return { notes, totalDuration, melodyCount: melodyNotes.length, baseBpm };
}

export class ScorePlayer {
  private ctx: AudioContext | null = null;
  private notes: PlayNote[] = [];
  private totalDuration = 0;
  private pauseOffset = 0;
  private startedAt = 0;
  private playing = false;
  private nodes: { osc: OscillatorNode; gain: GainNode }[] = [];
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private melodyCount = 0;
  private _xml = "";
  private _bpmOverride: number | null = null;
  private _baseBpm = 120;
  onEnd: (() => void) | null = null;

  load(xml: string) {
    this.stop();
    this._xml = xml;
    this._reparse();
  }

  /** Override the playback tempo. Pass null to use the score's own tempo. */
  setBpm(bpm: number | null) {
    this._bpmOverride = bpm;
    if (this._xml) this._reparse();
  }

  /** The tempo as written in the score (before any override). */
  getBaseBpm(): number { return this._baseBpm; }

  /** Current effective BPM (override if set, otherwise score tempo). */
  getEffectiveBpm(): number { return this._bpmOverride ?? this._baseBpm; }

  private _reparse() {
    const { notes, totalDuration, melodyCount, baseBpm } = parseForPlayback(
      this._xml,
      this._bpmOverride ?? undefined
    );
    this.notes = notes;
    this.totalDuration = totalDuration;
    this.melodyCount = melodyCount;
    this._baseBpm = baseBpm;
    this.pauseOffset = 0;
  }

  /** Start times (seconds) of melody notes only — index-aligned with non-rest cursorNotes. */
  getNoteTimes(): number[] {
    return this.notes.slice(0, this.melodyCount).map((n) => n.startSec);
  }

  /**
   * Melody note times sorted ascending by time, with each note's original
   * XML-parse-order index. Use this for correct cursor tracking in multi-staff scores
   * where notes from different staves interleave in XML order but play simultaneously.
   */
  getSortedNoteTimeline(): { time: number; index: number }[] {
    return this.notes
      .slice(0, this.melodyCount)
      .map((n, i) => ({ time: n.startSec, index: i }))
      .sort((a, b) => a.time - b.time || a.index - b.index);
  }

  /** Set the playback position (seconds). Safe to call while paused or playing. */
  seek(time: number) {
    const t = Math.max(0, Math.min(time, this.totalDuration));
    if (this.playing) {
      this.pause();
      this.pauseOffset = t;
    } else {
      this.pauseOffset = t;
    }
  }

  /** Current playback position in seconds. */
  getCurrentTime(): number {
    if (!this.ctx) return this.pauseOffset;
    return this.playing ? this.ctx.currentTime - this.startedAt : this.pauseOffset;
  }

  async play() {
    if (this.playing) return;
    if (!this.ctx) this.ctx = new AudioContext();
    await this.ctx.resume();

    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.startedAt = now - this.pauseOffset;
    this.playing = true;
    this.nodes = [];

    for (const note of this.notes) {
      // Tied continuation: the sustain was already folded into the originating
      // note's duration, so schedule no separate attack for this slot.
      if (note.silent) continue;

      const noteEnd = note.startSec + note.durationSec;
      // Skip notes that fully ended before the resume point
      if (noteEnd < this.pauseOffset - 0.01) continue;

      // A note that started before pauseOffset but hasn't ended yet: start it now as a partial
      const effectiveStart = Math.max(note.startSec, this.pauseOffset);
      const effectiveDur = noteEnd - effectiveStart;
      if (effectiveDur < 0.03) continue;

      const start = now + (effectiveStart - this.pauseOffset);
      if (start < now - 0.01) continue;

      const peakGain = note.isChord ? 0.06 : 0.15;

      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(peakGain, start + 0.02);
      gain.gain.setValueAtTime(peakGain, start + effectiveDur - 0.05);
      gain.gain.linearRampToValueAtTime(0, start + effectiveDur);

      const osc = ctx.createOscillator();
      osc.type = note.isChord ? "sine" : "triangle";
      osc.frequency.value = note.frequency;
      osc.connect(gain);
      osc.start(start);
      osc.stop(start + effectiveDur + 0.05);

      this.nodes.push({ osc, gain });
    }

    const remaining = (this.totalDuration - this.pauseOffset) * 1000 + 300;
    this.endTimer = setTimeout(() => {
      if (this.playing) {
        this.playing = false;
        this.pauseOffset = 0;
        this.onEnd?.();
      }
    }, remaining);
  }

  pause() {
    if (!this.playing || !this.ctx) return;
    this.pauseOffset = this.ctx.currentTime - this.startedAt;
    this.playing = false;
    // Fade out over 80ms instead of hard-cutting
    const now = this.ctx.currentTime;
    for (const { gain } of this.nodes) {
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.08);
      } catch {}
    }
    setTimeout(() => this._cancelNodes(), 100);
    if (this.endTimer !== null) { clearTimeout(this.endTimer); this.endTimer = null; }
  }

  stop() {
    this.playing = false;
    this.pauseOffset = 0;
    this._cancelNodes();
  }

  private _cancelNodes() {
    if (this.endTimer !== null) { clearTimeout(this.endTimer); this.endTimer = null; }
    for (const { osc, gain } of this.nodes) {
      try { gain.gain.cancelScheduledValues(0); gain.gain.setValueAtTime(0, 0); osc.stop(); } catch {}
    }
    this.nodes = [];
  }

  dispose() {
    this.stop();
    this.ctx?.close();
    this.ctx = null;
  }
}
