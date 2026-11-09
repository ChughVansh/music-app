import { X, Keyboard } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";

export function KeyboardShortcuts() {
  const [isOpen, setIsOpen] = useState(false);

  const shortcuts = [
    { key: "Space", action: "Play / Pause" },
    { key: "← / →", action: "Previous / next note" },
    { key: "Ctrl + ← / →", action: "Previous / next measure" },
    { key: "Shift + ← / →", action: "Extend / shrink selection" },
    { key: "Home / End", action: "First / last note" },
    { key: "↑ / ↓", action: "Raise / lower by semitone" },
    { key: "Ctrl + ↑ / ↓", action: "Raise / lower by octave" },
    { key: "A – G", action: "Set pitch name" },
    { key: "Shift + A – G", action: "Add note to chord" },
    { key: "3 4 5 6 7", action: "16th / 8th / quarter / half / whole" },
    { key: ".", action: "Toggle dotted duration" },
    { key: "Delete", action: "Delete selected notes" },
    { key: "Ctrl + B", action: "Insert measure" },
    { key: "Ctrl + Delete", action: "Delete measure" },
    { key: "Ctrl + K", action: "Add / edit chord symbol" },
    { key: "Ctrl + Z", action: "Undo" },
    { key: "Ctrl + Shift + Z / Ctrl + Y", action: "Redo" },
    { key: "Ctrl + S", action: "Save to library" },
  ];

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-accent text-accent-foreground rounded-full shadow-xl hover:scale-110 transition-transform flex items-center justify-center z-40"
        title="Keyboard Shortcuts"
      >
        <Keyboard className="w-6 h-6" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            />

            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl z-50 overflow-hidden"
            >
              <div className="flex items-center justify-between p-6 border-b border-border">
                <h2 className="text-xl font-semibold">Keyboard Shortcuts</h2>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 hover:bg-muted rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 max-h-96 overflow-y-auto">
                <div className="space-y-3">
                  {shortcuts.map((shortcut, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between py-2 border-b border-border/50 last:border-0"
                    >
                      <span className="text-sm text-muted-foreground">{shortcut.action}</span>
                      <kbd className="ml-3 shrink-0 px-3 py-1.5 bg-muted text-foreground rounded-md text-xs font-mono border border-border">
                        {shortcut.key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
