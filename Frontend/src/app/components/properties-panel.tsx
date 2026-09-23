import { ChevronUp, ChevronDown, Plus } from "lucide-react";
import { useState, useEffect } from "react";
import type { ParsedNote } from "../lib/parse-musicxml";
import { pitchLabel, applyDiatonicStep } from "../lib/parse-musicxml";

const DURATIONS = [
  { label: "Whole",  value: "whole"     },
  { label: "Half •", value: "half."     },
  { label: "Half",   value: "half"      },
  { label: "Qtr •",  value: "quarter."  },
  { label: "Qtr",    value: "quarter"   },
  { label: "8th •",  value: "eighth."   },
  { label: "8th",    value: "eighth"    },
  { label: "16th",   value: "sixteenth" },
];

const ACCIDENTALS = [
  { label: "♭", value: -1 },
  { label: "♮", value: 0 },
  { label: "♯", value: 1 },
];

const PASTEL = ["#F2C4C4", "#B8D8E8", "#B8D4B0", "#F5E6A0", "#F9C8D8"];

const NOTE_STEPS = ["C", "D", "E", "F", "G", "A", "B"];

interface PropertiesPanelProps {
  note: ParsedNote | null;
  onPitchStep: (note: ParsedNote, newStep: string, newOctave: number) => void;
  onAlterChange: (note: ParsedNote, alter: number) => void;
  onDurationChange: (note: ParsedNote, type: string) => void;
  onDelete: (note: ParsedNote) => void;
  onAddChordNote: (note: ParsedNote, step: string, octave: number, alter: number) => void;
  onConvertToNote?: (note: ParsedNote, step: string, octave: number, alter: number, noteType: string) => void;
}

export function PropertiesPanel({
  note,
  onPitchStep,
  onAlterChange,
  onDurationChange,
  onDelete,
  onAddChordNote,
  onConvertToNote,
}: PropertiesPanelProps) {
  const [addingChord, setAddingChord] = useState(false);
  const [chordAlter, setChordAlter] = useState(0);
  const [noteAlter, setNoteAlter] = useState(0);
  const [noteOctave, setNoteOctave] = useState(4);
  const [noteType, setNoteType] = useState<string | null>(null);
  const [addNoteOpen, setAddNoteOpen] = useState(false);

  // Reset per-note state when the selected note changes
  useEffect(() => {
    setNoteAlter(0);
    setNoteOctave(4);
    setNoteType(null);
    setAddingChord(false);
    setChordAlter(0);
    setAddNoteOpen(false);
  }, [note?.id]);
  const handleUp = () => {
    if (!note || note.isRest) return;
    const { step, octave } = applyDiatonicStep(note.step, note.octave, 1);
    onPitchStep(note, step, octave);
  };

  const handleDown = () => {
    if (!note || note.isRest) return;
    const { step, octave } = applyDiatonicStep(note.step, note.octave, -1);
    onPitchStep(note, step, octave);
  };

  return (
    <div className="w-52 bg-white border-l border-[#1C1917]/10 overflow-y-auto flex flex-col shrink-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#1C1917]/10 bg-[#F5F0E8]">
        <h3
          className="font-bold text-sm text-[#1C1917]"
          style={{ fontFamily: "DM Serif Display, Georgia, serif" }}
        >
          Properties
        </h3>
      </div>

      <div className="p-4 flex-1">
        {!note ? (
          <div className="text-center pt-8">
            <div className="text-4xl mb-3 opacity-20">♩</div>
            <p className="text-xs text-[#1C1917]/40 leading-relaxed">
              Click a note to edit it
            </p>
          </div>
        ) : (
          <div className="space-y-4">

            {/* Pitch display */}
            <div
              className="rounded-xl border-2 border-[#1C1917] p-3 text-center shadow-[3px_3px_0_#1C1917]"
              style={{ backgroundColor: PASTEL[(note.measure) % PASTEL.length] }}
            >
              <div
                className="text-2xl font-bold text-[#1C1917] mb-0.5"
                style={{ fontFamily: "DM Serif Display, Georgia, serif" }}
              >
                {pitchLabel(note)}
              </div>
              <div className="text-xs text-[#1C1917]/60">
                M{note.measure + 1} · {note.type}{note.isRest ? " rest" : ""}
              </div>
            </div>

            {/* Note picker — collapsible, shown when cursor is on a rest */}
            {note.isRest && onConvertToNote && (
              <div>
                <button
                  onClick={() => setAddNoteOpen((v) => !v)}
                  className="w-full flex items-center justify-between py-2 px-3 rounded-lg border-2 border-dashed border-[#1C1917]/30 text-xs font-semibold text-[#1C1917]/60 hover:border-[#1C1917]/60 hover:text-[#1C1917] hover:bg-[#F5F0E8]/60 transition-all"
                >
                  <span>Add Note</span>
                  <Plus className={`w-3.5 h-3.5 transition-transform ${addNoteOpen ? "rotate-45" : ""}`} />
                </button>

                {addNoteOpen && (
                  <div className="mt-2 space-y-1.5">
                    {/* Duration */}
                    <div className="grid grid-cols-3 gap-1">
                      {DURATIONS.map((d) => {
                        const active = (noteType ?? note.type) === d.value;
                        return (
                          <button
                            key={d.value}
                            onClick={() => setNoteType(d.value)}
                            className="py-1.5 rounded-lg text-xs font-medium transition-all border-2"
                            style={{
                              backgroundColor: active ? "#1C1917" : "#F5F0E8",
                              color: active ? "white" : "#1C1917",
                              borderColor: active ? "#1C1917" : "rgba(28,25,23,0.15)",
                              boxShadow: active ? "2px 2px 0 #1C1917" : "none",
                            }}
                          >
                            {d.label}
                          </button>
                        );
                      })}
                    </div>
                    {/* Accidental */}
                    <div className="flex gap-1">
                      {ACCIDENTALS.map((a) => (
                        <button
                          key={a.value}
                          onClick={() => setNoteAlter(a.value)}
                          className="flex-1 py-1.5 rounded-lg text-sm font-bold border-2 transition-all"
                          style={{
                            backgroundColor: noteAlter === a.value ? "#1C1917" : "#F5F0E8",
                            color: noteAlter === a.value ? "white" : "#1C1917",
                            borderColor: noteAlter === a.value ? "#1C1917" : "rgba(28,25,23,0.15)",
                          }}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                    {/* Note letter grid */}
                    <div className="grid grid-cols-4 gap-1">
                      {NOTE_STEPS.map((s) => (
                        <button
                          key={s}
                          onClick={() => {
                            onConvertToNote(note, s, noteOctave, noteAlter, noteType ?? note.type);
                            setAddNoteOpen(false);
                            setNoteAlter(0);
                            setNoteType(null);
                          }}
                          className="py-2 rounded-lg text-sm font-bold border-2 border-[#1C1917]/20 bg-[#F5F0E8] hover:bg-[#7FFFD4] hover:border-[#1C1917] transition-all text-[#1C1917]"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                    {/* Octave */}
                    <div className="flex gap-1">
                      {[3, 4, 5].map((o) => (
                        <button
                          key={o}
                          onClick={() => setNoteOctave(o)}
                          className="flex-1 py-1 rounded text-xs font-semibold border-2 transition-all"
                          style={{
                            backgroundColor: noteOctave === o ? "#1C1917" : "#F5F0E8",
                            color: noteOctave === o ? "white" : "#1C1917",
                            borderColor: noteOctave === o ? "#1C1917" : "rgba(28,25,23,0.15)",
                          }}
                        >
                          oct {o}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {!note.isRest && (
              <>
                {/* Pitch up/down */}
                <div>
                  <label className="block text-xs font-semibold text-[#1C1917]/50 mb-1.5 uppercase tracking-wide">
                    Pitch
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={handleUp}
                      className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg border-2 border-[#1C1917] bg-[#B8D4B0] hover:shadow-[2px_2px_0_#1C1917] transition-all text-sm font-medium text-[#1C1917]"
                    >
                      <ChevronUp className="w-3.5 h-3.5" /> Up
                    </button>
                    <button
                      onClick={handleDown}
                      className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg border-2 border-[#1C1917] bg-[#F9C8D8] hover:shadow-[2px_2px_0_#1C1917] transition-all text-sm font-medium text-[#1C1917]"
                    >
                      <ChevronDown className="w-3.5 h-3.5" /> Down
                    </button>
                  </div>
                </div>

                {/* Accidental */}
                <div>
                  <label className="block text-xs font-semibold text-[#1C1917]/50 mb-1.5 uppercase tracking-wide">
                    Accidental
                  </label>
                  <div className="flex gap-1">
                    {ACCIDENTALS.map((a) => (
                      <button
                        key={a.value}
                        onClick={() => onAlterChange(note, a.value)}
                        className="flex-1 py-2 rounded-lg text-sm font-bold transition-all border-2"
                        style={{
                          backgroundColor: note.alter === a.value ? "#1C1917" : "#F5F0E8",
                          color: note.alter === a.value ? "white" : "#1C1917",
                          borderColor: note.alter === a.value ? "#1C1917" : "rgba(28,25,23,0.15)",
                          boxShadow: note.alter === a.value ? "2px 2px 0 #1C1917" : "none",
                        }}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Add chord note */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-[#1C1917]/50 uppercase tracking-wide">
                      Add to Chord
                    </label>
                    <button
                      onClick={() => { setAddingChord((v) => !v); setChordAlter(0); }}
                      className="w-5 h-5 rounded border-2 border-[#1C1917]/30 flex items-center justify-center hover:border-[#1C1917] transition-colors"
                    >
                      <Plus className="w-3 h-3 text-[#1C1917]/60" />
                    </button>
                  </div>
                  {addingChord && (
                    <div className="space-y-1.5">
                      {/* Accidental for the new chord note */}
                      <div className="flex gap-1">
                        {ACCIDENTALS.map((a) => (
                          <button
                            key={a.value}
                            onClick={() => setChordAlter(a.value)}
                            className="flex-1 py-1 rounded text-xs font-bold border-2 transition-all"
                            style={{
                              backgroundColor: chordAlter === a.value ? "#1C1917" : "#F5F0E8",
                              color: chordAlter === a.value ? "white" : "#1C1917",
                              borderColor: chordAlter === a.value ? "#1C1917" : "rgba(28,25,23,0.15)",
                            }}
                          >
                            {a.label}
                          </button>
                        ))}
                      </div>
                      {/* Note letter grid */}
                      <div className="grid grid-cols-4 gap-1">
                        {NOTE_STEPS.map((s) => (
                          <button
                            key={s}
                            onClick={() => {
                              onAddChordNote(note, s, note.octave, chordAlter);
                              setAddingChord(false);
                              setChordAlter(0);
                            }}
                            className="py-1.5 rounded-lg text-xs font-bold border-2 border-[#1C1917]/20 bg-[#F5F0E8] hover:bg-[#7FFFD4] hover:border-[#1C1917] transition-all text-[#1C1917]"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-[#1C1917]/40 text-center">same octave as selected note</p>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Duration */}
            <div>
              <label className="block text-xs font-semibold text-[#1C1917]/50 mb-1.5 uppercase tracking-wide">
                Duration
              </label>
              <div className="grid grid-cols-2 gap-1">
                {DURATIONS.map((d) => (
                  <button
                    key={d.value}
                    onClick={() => onDurationChange(note, d.value)}
                    className="py-1.5 rounded-lg text-xs font-medium transition-all border-2"
                    style={{
                      backgroundColor: note.type === d.value ? "#1C1917" : "#F5F0E8",
                      color: note.type === d.value ? "white" : "#1C1917",
                      borderColor: note.type === d.value ? "#1C1917" : "rgba(28,25,23,0.15)",
                      boxShadow: note.type === d.value ? "2px 2px 0 #1C1917" : "none",
                    }}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Delete note */}
            <button
              onClick={() => onDelete(note)}
              className="w-full py-2 rounded-lg border-2 border-[#1C1917] bg-white text-[#1C1917] text-sm font-medium hover:bg-[#F2C4C4] hover:shadow-[2px_2px_0_#1C1917] transition-all"
            >
              Delete Note
            </button>

          </div>
        )}
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&display=swap');
      `}</style>
    </div>
  );
}
