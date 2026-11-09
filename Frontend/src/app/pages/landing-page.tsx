import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Camera, Upload, FileEdit } from "lucide-react";
import { CameraCapture } from "../components/camera-capture";
import { setCapturedFile } from "../lib/camera-store";
import { Navbar } from "../components/navbar";

const NOTES = ["♩", "♪", "♫", "♬"];

function FloatingNotes() {
  const items = [
    { note: "♩", top: "8%",  duration: "20s", delay: "0s"   },
    { note: "♪", top: "18%", duration: "25s", delay: "0.5s" },
    { note: "♫", top: "28%", duration: "22s", delay: "0s"   },
    { note: "♬", top: "38%", duration: "28s", delay: "0.5s" },
    { note: "♩", top: "48%", duration: "24s", delay: "1s"   },
    { note: "♪", top: "58%", duration: "20s", delay: "0.5s"   },
    { note: "♫", top: "68%", duration: "26s", delay: "0s"   },
    { note: "♬", top: "78%", duration: "22s", delay: "0.5s" },
    { note: "♩", top: "88%", duration: "28s", delay: "0.5s" },
    { note: "♪", top: "13%", duration: "24s", delay: "1s"   },
    { note: "♫", top: "33%", duration: "20s", delay: "0s"   },
    { note: "♬", top: "53%", duration: "26s", delay: "4.5s" },
    { note: "♩", top: "73%", duration: "22s", delay: "7s"   },
    { note: "♪", top: "23%", duration: "28s", delay: "0.8s" },
    { note: "♫", top: "43%", duration: "24s", delay: "5.5s" },
    { note: "♬", top: "63%", duration: "20s", delay: "0.2s" },
    { note: "♩", top: "83%", duration: "26s", delay: "0.5s" },
    { note: "♪", top: "5%",  duration: "22s", delay: "0.8s" },
    { note: "♫", top: "95%", duration: "28s", delay: "1.0s" },
    { note: "♬", top: "50%", duration: "24s", delay: "0.5s" },
  ];

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {items.map((item, i) => (
        <div
          key={i}
          className="absolute select-none text-[#1C1917]"
          style={{
            top: item.top,
            fontSize: "32px",
            opacity: 0.25,
            animation: `slideLeft ${item.duration} ${item.delay} infinite linear`,
            animationFillMode: "backwards",
          }}
        >
          {item.note}
        </div>
      ))}
      <style>{`
        @keyframes slideLeft {
          from { transform: translateX(100vw); }
          to   { transform: translateX(-100vw); }
        }
      `}</style>
    </div>
  );
}

export function LandingPage() {
  const [showCamera, setShowCamera] = useState(false);
  const navigate = useNavigate();

  const handleCapture = (file: File) => {
    setCapturedFile(file);
    setShowCamera(false);
    navigate("/upload");
  };

  return (
    <>
      <div className="relative bg-white overflow-x-hidden">
        <Navbar />
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

        {/* Hero Section */}
        <section className="relative py-16 px-6 pt-32 sm:pt-40 overflow-hidden">
          <FloatingNotes />
          <div className="max-w-7xl mx-auto">
            <div className="grid lg:grid-cols-2 gap-10 lg:gap-12 items-center">
              {/* Left side - Text */}
              <div className="relative z-10">
                <div className="inline-block px-4 py-2 bg-[#F0FAF4] border border-[#1C1917]/10 rounded-full text-sm font-medium mb-5">
                  PHOTO → SCORE, INSTANTLY
                </div>

                <h1
                  className="text-5xl sm:text-7xl lg:text-8xl font-serif font-bold mb-5 tracking-tight leading-[0.95]"
                  style={{
                    fontFamily: "OhSheetMark, DM Serif Display, Georgia, serif",
                    letterSpacing: "-0.03em",
                  }}
                >
                  Oh <span className="italic">Sheet<span style={{ fontSize: "0.8em", marginLeft: "0.2em" }}>!</span></span>
                </h1>

                <p className="text-base sm:text-xl text-[#1C1917]/80 mb-3 leading-relaxed">
                  Turn any sheet music into an editable digital score
                  instantly. Photograph, upload, and export to MuseScore, PDF,
                  and more.
                </p>

                <div className="flex flex-wrap gap-3 mt-6">
                  <Link
                    to="/upload"
                    className="inline-block px-6 sm:px-8 py-3 sm:py-4 bg-[#1C1917] text-white border-2 border-[#1C1917] rounded-full text-base sm:text-lg font-medium hover:translate-y-[-2px] transition-all shadow-[4px_4px_0_#1C1917] hover:shadow-[6px_6px_0_#1C1917]"
                  >
                    Scan Your First Score →
                  </Link>
                  <button
                    onClick={() => setShowCamera(true)}
                    className="inline-flex items-center gap-2 px-6 sm:px-8 py-3 sm:py-4 bg-white border-2 border-[#1C1917] rounded-full text-base sm:text-lg font-medium hover:translate-y-[-2px] transition-all shadow-[4px_4px_0_#1C1917] hover:shadow-[6px_6px_0_#1C1917]"
                  >
                    <Camera className="w-5 h-5" />
                    Take a Photo
                  </button>
                </div>
              </div>

              {/* Right side - Before/After (hidden on small mobile to avoid clutter) */}
              <div className="relative z-10 hidden sm:grid grid-cols-2 gap-4 sm:gap-6">
                {/* Before */}
                <div className="bg-[#F5F0E8] p-6 sm:p-8 rounded-2xl border-2 border-[#1C1917] shadow-[6px_6px_0_#1C1917]">
                  <div className="text-xs font-medium text-[#1C1917]/60 mb-4">photo</div>
                  <div className="space-y-2 mb-6">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} className="h-0.5 bg-[#1C1917]/40" />
                    ))}
                  </div>
                  <div className="text-4xl sm:text-5xl">♪ ♫ ♬</div>
                </div>

                {/* After */}
                <div className="bg-white p-6 sm:p-8 rounded-2xl border-2 border-[#1C1917] shadow-[6px_6px_0_#1C1917] translate-y-6 sm:translate-y-8">
                  <div className="text-xs font-medium text-[#1C1917]/60 mb-4">digital score</div>
                  <div className="space-y-2 mb-6">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} className="h-0.5 bg-[#1C1917]" />
                    ))}
                  </div>
                  <div className="text-4xl sm:text-5xl">♪ ♫ ♬</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Marquee strip */}
        <div className="relative z-10 bg-[#1C1917] text-white py-3 overflow-hidden border-y-2 border-[#1C1917]">
          <div className="animate-marquee whitespace-nowrap text-xs font-bold tracking-wide">
            <span className="mx-6">PHOTOGRAPH IT ♪</span>
            <span className="mx-6">UPLOAD IT ♪</span>
            <span className="mx-6">EDIT IT ♪</span>
            <span className="mx-6">EXPORT IT ♪</span>
            <span className="mx-6">NO MORE HAND COPYING ♪</span>
            <span className="mx-6">WORKS WITH MUSESCORE ♪</span>
            <span className="mx-6">CLASSICAL + JAZZ ♪</span>
            <span className="mx-6">PDF SUPPORT ♪</span>
            <span className="mx-6">SAVE YOUR SCORES ♪</span>
            <span className="mx-6">FREE TO TRY ♪</span>
            <span className="mx-6">PHOTOGRAPH IT ♪</span>
            <span className="mx-6">UPLOAD IT ♪</span>
            <span className="mx-6">EDIT IT ♪</span>
            <span className="mx-6">EXPORT IT ♪</span>
            <span className="mx-6">NO MORE HAND COPYING ♪</span>
            <span className="mx-6">WORKS WITH MUSESCORE ♪</span>
            <span className="mx-6">CLASSICAL + JAZZ ♪</span>
            <span className="mx-6">PDF SUPPORT ♪</span>
            <span className="mx-6">SAVE YOUR SCORES ♪</span>
            <span className="mx-6">FREE TO TRY ♪</span>
          </div>
        </div>

        {/* How It Works Section */}
        <section className="relative py-24 px-6 bg-[#F0FAF4]">
          <div
            className="absolute inset-0 pointer-events-none opacity-40"
            style={{
              backgroundImage: `
                linear-gradient(rgba(28, 25, 23, 0.05) 1px, transparent 1px),
                linear-gradient(90deg, rgba(28, 25, 23, 0.05) 1px, transparent 1px)
              `,
              backgroundSize: "20px 20px",
            }}
          />

          <div className="max-w-7xl mx-auto relative z-10">
            <div className="text-center mb-6">
              <div className="text-sm font-medium text-[#1C1917]/60 mb-2">
                SIMPLE AS A CHORD
              </div>
              <h2
                className="text-4xl sm:text-5xl lg:text-7xl font-serif font-bold tracking-tight leading-tight"
                style={{
                  fontFamily: "DM Serif Display, Georgia, serif",
                  letterSpacing: "-0.03em",
                }}
              >
                Three steps to your
                <br />
                <span className="italic">perfect</span> digital score
              </h2>
            </div>

            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6 sm:gap-8 mt-10 sm:mt-16">
              {[
                {
                  num: "01",
                  title: "Photograph your score",
                  desc: "Snap a photo with your phone camera or upload a scan",
                  color: "#B8D4B0",
                  icon: Camera,
                },
                {
                  num: "02",
                  title: "Upload to Oh Sheet!",
                  desc: "We scan every note on the page instantly — PNG, JPG, or PDF",
                  color: "#F2C4C4",
                  icon: Upload,
                },
                {
                  num: "03",
                  title: "Edit & Export",
                  desc: "Export to MuseScore, PDF, and more in one click",
                  color: "#B8D8E8",
                  icon: FileEdit,
                },
              ].map((step) => (
                <div
                  key={step.num}
                  className="relative p-8 rounded-2xl border-2 border-[#1C1917] shadow-[6px_6px_0_#1C1917] overflow-hidden"
                  style={{ backgroundColor: step.color }}
                >
                  <div
                    className="absolute top-0 right-4 text-[12rem] font-bold opacity-10 leading-none"
                    style={{
                      fontFamily: "DM Serif Display, Georgia, serif",
                    }}
                  >
                    {step.num}
                  </div>
                  <step.icon
                    className="w-12 h-12 mb-6 relative z-10"
                    strokeWidth={1.5}
                  />
                  <h3 className="text-2xl font-semibold mb-2 relative z-10">
                    {step.title}
                  </h3>
                  <p className="text-sm text-[#1C1917]/70 relative z-10">
                    {step.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Testimonials Section */}
        <section className="relative py-24 px-6 bg-[#F9C8D8]">
          <div
            className="absolute inset-0 pointer-events-none opacity-40"
            style={{
              backgroundImage: `
                linear-gradient(rgba(28, 25, 23, 0.1) 1px, transparent 1px),
                linear-gradient(90deg, rgba(28, 25, 23, 0.1) 1px, transparent 1px)
              `,
              backgroundSize: "20px 20px",
            }}
          />

          <div className="max-w-7xl mx-auto relative z-10">
            <div className="mb-6">
              <div className="inline-block px-4 py-2 bg-[#1C1917] text-white border-2 border-[#1C1917] rounded-full text-xs font-bold tracking-widest shadow-[4px_4px_0_#1C1917]">
                REAL MUSICIANS. REAL RESULTS.
              </div>
            </div>

            <h2
              className="text-4xl sm:text-5xl lg:text-7xl font-serif font-bold mb-10 sm:mb-16 tracking-tight"
              style={{
                fontFamily: "DM Serif Display, Georgia, serif",
                letterSpacing: "-0.03em",
              }}
            >
              From the music stand
            </h2>

            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6 sm:gap-8">
              {[
                {
                  quote:
                    "I'd rather spend 5 minutes reviewing flagged errors than 30 minutes fixing silent mistakes.",
                  author: "Student | Knox College Jazz Band",
                  accent: "#F5E6A0",
                },
                {
                  quote:
                    "My handwritten arrangements used to live in a drawer. Now I can keep them with me everywhere.",
                  author: "Student | Cherry Street Combo",
                  accent: "#B8D4B0",
                },
                {
                  quote:
                    "It would take me hours to add the notes one by one and then edit them but Oh Sheet has reduced that time to minutes.",
                  author: "Music Director | Knox College",
                  accent: "#B8D8E8",
                },
              ].map((testimonial, i) => (
                <div
                  key={i}
                  className="bg-white p-8 rounded-2xl border-2 border-[#1C1917] shadow-[6px_6px_0_#1C1917] transform hover:-translate-y-1 transition-transform"
                  style={{ rotate: `${(i - 1) * 0.5}deg` }}
                >
                  <div
                    className="h-3 -mx-8 -mt-8 mb-6 rounded-t-xl"
                    style={{ backgroundColor: testimonial.accent }}
                  />
                  <div className="text-7xl mb-4 leading-none text-[#1C1917]/20 font-serif">
                    "
                  </div>
                  <p className="text-base mb-6 leading-relaxed">
                    {testimonial.quote}
                  </p>
                  <p className="text-xs text-[#1C1917]/60 font-medium">
                    — {testimonial.author}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="relative py-24 px-6 bg-[#F5E6A0] text-[#1C1917]">
          <div
            className="absolute inset-0 pointer-events-none opacity-40"
            style={{
              backgroundImage: `
                linear-gradient(rgba(28, 25, 23, 0.1) 1px, transparent 1px),
                linear-gradient(90deg, rgba(28, 25, 23, 0.1) 1px, transparent 1px)
              `,
              backgroundSize: "20px 20px",
            }}
          />
          <div className="max-w-4xl mx-auto text-center relative z-10">
            <h2
              className="text-4xl sm:text-5xl lg:text-7xl font-serif font-bold mb-6 tracking-tight leading-tight"
              style={{
                fontFamily: "DM Serif Display, Georgia, serif",
                letterSpacing: "-0.03em",
              }}
            >
              Your scores deserve
              <br />
              to be heard.
            </h2>
            <p className="text-xl mb-8 text-[#1C1917]/70">
              Sign in to get started — free to try.
            </p>
            <Link
              to="/upload"
              className="inline-block px-8 py-4 bg-[#1C1917] text-white border-2 border-[#1C1917] rounded-full text-lg font-medium hover:translate-y-[-2px] transition-all shadow-[4px_4px_0_#1C1917] hover:shadow-[6px_6px_0_#1C1917]"
            >
              Scan Your First Score →
            </Link>
          </div>
        </section>

        {/* Footer */}
        <footer className="bg-white border-t border-[#1C1917]/10 py-8 px-6 relative z-10">
          <div className="max-w-7xl mx-auto text-center text-sm text-[#1C1917]/60">
            <p style={{ fontFamily: "OhSheetMark, DM Serif Display, Georgia, serif" }}>© 2026 Oh Sheet<span style={{ fontSize: "0.8em", marginLeft: "0.2em" }}>!</span> — Stop copying notes. Start making music.</p>
          </div>
        </footer>

        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&display=swap');

          @keyframes marquee {
            0% { transform: translateX(-50%); }
            100% { transform: translateX(0); }
          }

          .animate-marquee {
            display: inline-block;
            animation: marquee 20s linear infinite;
          }
        `}</style>
      </div>

      {showCamera && (
        <CameraCapture
          onCapture={handleCapture}
          onClose={() => setShowCamera(false)}
        />
      )}
    </>
  );
}
