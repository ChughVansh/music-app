import { useState, useEffect, useRef } from "react";
import { Upload, FileMusic, AlertCircle, LogIn, Camera, GripVertical, ZoomIn, X, Crop, RotateCcw, RotateCw, Plus } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router";
import { Navbar } from "../components/navbar";
import { motion } from "motion/react";
import { useAuth } from "../lib/auth-context";
import { CameraCapture } from "../components/camera-capture";
import { getCapturedFile, setCapturedFile } from "../lib/camera-store";
import { setPendingUpload } from "../lib/pending-upload-store";

const AD_DURATION = 30;

export function UploadPage() {
  const [isDragging, setIsDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<"uploading" | "analyzing" | "converting">("uploading");
  const [showAd, setShowAd] = useState(false);
  const [adCountdown, setAdCountdown] = useState(AD_DURATION);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [selectedType, setSelectedType] = useState<"classical" | "jazz" | null>(null);
  const [showOrderReview, setShowOrderReview] = useState(false);
  const [orderedFiles, setOrderedFiles] = useState<File[]>([]);
  const [orderPreviewUrls, setOrderPreviewUrls] = useState<string[]>([]);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [cropMode, setCropMode] = useState(false);
  const [cropStart, setCropStart] = useState<{ x: number; y: number } | null>(null);
  const [cropEnd, setCropEnd] = useState<{ x: number; y: number } | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<{
    musicXml: string; fileName: string; scoreType: string; sessionId: string;
  } | null>(null);
  const pendingFile = useRef<File[]>([]);
  const pendingScoreType = useRef<"classical" | "jazz">("classical");
  const fileDragIndex = useRef<number | null>(null);
  const dragCounterRef = useRef(0);
  const cropImgRef = useRef<HTMLImageElement>(null);
  const addMoreInputRef = useRef<HTMLInputElement>(null);
  const cropDragging = useRef(false);
  const navigate = useNavigate();
  const [showCamera, setShowCamera] = useState(false);
  const { currentUser, signInWithGoogle } = useAuth();

  useEffect(() => {
    const preloaded = getCapturedFile();
    if (preloaded) {
      setCapturedFile(null);
      handleFilesUpload([preloaded]);
    }
  }, []);

  useEffect(() => {
    if (lightboxIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setLightboxIndex(null); setCropMode(false); setCropStart(null); setCropEnd(null); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxIndex]);

  // Window-level drag detection so dropping anywhere on the page works.
  useEffect(() => {
    const onEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        dragCounterRef.current++;
        setIsDraggingFile(true);
      }
    };
    const onLeave = () => {
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) setIsDraggingFile(false);
    };
    const onOver = (e: DragEvent) => e.preventDefault();
    const onDrop = () => { dragCounterRef.current = 0; setIsDraggingFile(false); };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  useEffect(() => {
    if (!showAd) return;
    setAdCountdown(AD_DURATION);
    const interval = setInterval(() => {
      if (!document.hasFocus() || document.hidden) return;
      setAdCountdown((n) => {
        if (n <= 1) { clearInterval(interval); setShowAd(false); return 0; }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [showAd]);

  // Navigate once upload is done AND the 30s ad has finished.
  // If upload finishes first, pendingNavigation is set and we wait here.
  // If the ad finishes first, this effect fires immediately when upload sets pendingNavigation.
  useEffect(() => {
    if (!pendingNavigation || showAd) return;
    navigate("/editor", { state: pendingNavigation });
  }, [pendingNavigation, showAd]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      if (showOrderReview) handleAppendFiles(Array.from(files));
      else handleFilesUpload(Array.from(files));
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) handleFilesUpload(Array.from(files));
  };

  const ACCEPTED_TYPES = ["image/png", "image/jpeg", "application/pdf"];
  const MAX_SIZE_MB = 10;

  const handleFilesUpload = (files: File[]) => {
    setError(null);
    setShowTypePicker(false);
    setSelectedType(null);
    const invalid = files.find((f) => !ACCEPTED_TYPES.includes(f.type));
    if (invalid) {
      setError(`"${invalid.name}" is not a supported format. Use PNG, JPG, or PDF.`);
      return;
    }
    const tooBig = files.find((f) => f.size > MAX_SIZE_MB * 1024 * 1024);
    if (tooBig) {
      setError(`"${tooBig.name}" exceeds the 10MB limit.`);
      return;
    }
    const previews = files.map((f) =>
      f.type !== "application/pdf" ? URL.createObjectURL(f) : ""
    );
    setOrderedFiles([...files]);
    setOrderPreviewUrls(previews);
    pendingFile.current = [...files];
    setShowOrderReview(true);
  };

  const handleAppendFiles = (files: File[]) => {
    const invalid = files.find((f) => !ACCEPTED_TYPES.includes(f.type));
    if (invalid) { toast.error(`"${invalid.name}" is not a supported format. Use PNG, JPG, or PDF.`); return; }
    const tooBig = files.find((f) => f.size > MAX_SIZE_MB * 1024 * 1024);
    if (tooBig) { toast.error(`"${tooBig.name}" is too large — max 10 MB per file.`); return; }
    const newPreviews = files.map((f) => f.type !== "application/pdf" ? URL.createObjectURL(f) : "");
    setOrderedFiles((prev) => [...prev, ...files]);
    setOrderPreviewUrls((prev) => [...prev, ...newPreviews]);
    pendingFile.current = [...pendingFile.current, ...files];
  };

  const handleRemoveFile = (index: number) => {
    const newFiles = orderedFiles.filter((_, i) => i !== index);
    const newPreviews = orderPreviewUrls.filter((_, i) => i !== index);
    if (newFiles.length === 0) {
      setShowOrderReview(false);
      setOrderedFiles([]);
      setOrderPreviewUrls([]);
      pendingFile.current = [];
      return;
    }
    setOrderedFiles(newFiles);
    setOrderPreviewUrls(newPreviews);
    pendingFile.current = newFiles;
  };

  const confirmOrder = () => {
    setFileName(orderedFiles.map((f) => f.name).join(", "));
    pendingFile.current = orderedFiles;
    const firstImgIdx = orderedFiles.findIndex((f) => f.type !== "application/pdf");
    setPreviewUrl(firstImgIdx !== -1 ? orderPreviewUrls[firstImgIdx] : null);
    // Keep orderedFiles/orderPreviewUrls intact so crop stays available in type picker
    setShowOrderReview(false);
    setShowTypePicker(true);
  };

  const handleFileDragStart = (index: number) => {
    fileDragIndex.current = index;
    setDraggingIndex(index);
  };

  const getInsertPosition = (e: React.DragEvent, index: number) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientY > rect.top + rect.height / 2 ? index + 1 : index;
  };

  const handleFileDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIndex(getInsertPosition(e, index));
  };

  const handleFileDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (fileDragIndex.current === null) {
      // External files dropped on a list item — append to existing set
      const files = e.dataTransfer.files;
      if (files.length > 0) handleAppendFiles(Array.from(files));
      setDragOverIndex(null);
      setDraggingIndex(null);
      return;
    }
    let insertAt = getInsertPosition(e, index);
    const from = fileDragIndex.current;
    if (from < insertAt) insertAt--;
    if (from !== insertAt) {
      const newFiles = [...orderedFiles];
      const newPreviews = [...orderPreviewUrls];
      const [movedFile] = newFiles.splice(from, 1);
      const [movedPreview] = newPreviews.splice(from, 1);
      newFiles.splice(insertAt, 0, movedFile);
      newPreviews.splice(insertAt, 0, movedPreview);
      setOrderedFiles(newFiles);
      setOrderPreviewUrls(newPreviews);
    }
    fileDragIndex.current = null;
    setDragOverIndex(null);
    setDraggingIndex(null);
  };

  const handleFileDragEnd = () => {
    fileDragIndex.current = null;
    setDragOverIndex(null);
    setDraggingIndex(null);
  };

  const handleCropMouseDown = (e: React.MouseEvent<HTMLImageElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setCropStart({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setCropEnd(null);
    cropDragging.current = true;
  };

  const handleCropMouseMove = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!cropDragging.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setCropEnd({
      x: Math.max(0, Math.min(e.clientX - rect.left, rect.width)),
      y: Math.max(0, Math.min(e.clientY - rect.top, rect.height)),
    });
  };

  const handleCropMouseUp = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!cropDragging.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setCropEnd({
      x: Math.max(0, Math.min(e.clientX - rect.left, rect.width)),
      y: Math.max(0, Math.min(e.clientY - rect.top, rect.height)),
    });
    cropDragging.current = false;
  };

  const applyCrop = () => {
    if (!cropStart || !cropEnd || !cropImgRef.current || lightboxIndex === null) return;
    const img = cropImgRef.current;
    const rect = img.getBoundingClientRect();
    const scaleX = img.naturalWidth / rect.width;
    const scaleY = img.naturalHeight / rect.height;
    const x = Math.round(Math.min(cropStart.x, cropEnd.x) * scaleX);
    const y = Math.round(Math.min(cropStart.y, cropEnd.y) * scaleY);
    const w = Math.round(Math.abs(cropEnd.x - cropStart.x) * scaleX);
    const h = Math.round(Math.abs(cropEnd.y - cropStart.y) * scaleY);
    if (w < 10 || h < 10) return;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
    const idx = lightboxIndex;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const newFile = new File([blob], orderedFiles[idx].name, { type: "image/png" });
      const newUrl = URL.createObjectURL(newFile);
      const newFiles = [...orderedFiles];
      const newUrls = [...orderPreviewUrls];
      if (newUrls[idx]) URL.revokeObjectURL(newUrls[idx]);
      newFiles[idx] = newFile;
      newUrls[idx] = newUrl;
      setOrderedFiles(newFiles);
      setOrderPreviewUrls(newUrls);
      pendingFile.current = newFiles;
      if (!showOrderReview) setPreviewUrl(newUrls[idx] || null);
      setLightboxIndex(idx);
      setCropMode(false);
      setCropStart(null);
      setCropEnd(null);
    }, "image/png");
  };

  const applyRotate = (degrees: 90 | -90) => {
    if (lightboxIndex === null) return;
    const src = orderPreviewUrls[lightboxIndex];
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      const swap = Math.abs(degrees) === 90;
      const canvas = document.createElement("canvas");
      canvas.width = swap ? img.naturalHeight : img.naturalWidth;
      canvas.height = swap ? img.naturalWidth : img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((degrees * Math.PI) / 180);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      const idx = lightboxIndex;
      canvas.toBlob((blob) => {
        if (!blob) return;
        const newFile = new File([blob], orderedFiles[idx].name, { type: "image/png" });
        const newUrl = URL.createObjectURL(newFile);
        const newFiles = [...orderedFiles];
        const newUrls = [...orderPreviewUrls];
        if (newUrls[idx]) URL.revokeObjectURL(newUrls[idx]);
        newFiles[idx] = newFile;
        newUrls[idx] = newUrl;
        setOrderedFiles(newFiles);
        setOrderPreviewUrls(newUrls);
        pendingFile.current = newFiles;
        if (!showOrderReview) setPreviewUrl(newUrls[idx] || null);
      }, "image/png");
    };
    img.src = src;
  };

  const runUpload = async (files: File[], scoreType: "classical" | "jazz", model: string = "legato") => {
    if (!currentUser) {
      setError("Please sign in to transcribe sheet music.");
      return;
    }

    const sessionId = scoreType === "classical" ? crypto.randomUUID() : "";

    if (scoreType === "classical") {
      setPendingUpload({ files, scoreType, sessionId });
    }

    setProcessing(true);
    const formData = new FormData();
    files.forEach((f) => formData.append("files", f));
    formData.append("score_type", scoreType);
    if (scoreType === "classical") {
      formData.append("model", model);
    }

    try {
      const apiUrl = import.meta.env.VITE_API_URL;
      if (!apiUrl) throw new Error("API URL not configured");
      const idToken = currentUser ? await currentUser.getIdToken() : "";
      setStage("uploading");
      const response = await fetch(`${apiUrl}/transcribe-multi`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
        body: formData,
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Server error: ${response.status}`);
      }
      setStage("analyzing");
      const musicXml = await response.text();
      setStage("converting");
      await new Promise((r) => setTimeout(r, 800));
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      // Don't navigate yet — wait for the ad countdown to finish first (if still running).
      setPendingNavigation({ musicXml, fileName: files[0].name, scoreType, sessionId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setProcessing(false);
    }
  };

  const handleReset = () => {
    setError(null);
    setProcessing(false);
    setShowAd(false);
    setPendingNavigation(null);
    setShowTypePicker(false);
    setShowOrderReview(false);
    setSelectedType(null);
    setFileName("");
    setOrderedFiles([]);
    setOrderPreviewUrls((urls) => {
      urls.forEach((url) => url && URL.revokeObjectURL(url));
      return [];
    });
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    pendingFile.current = [];
  };

  return (
    <>
      <div className="relative min-h-screen bg-white">
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

        <div className="relative pt-32 pb-20 px-6 max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-12"
          >
            <h1
              className="text-7xl font-serif font-bold mb-4 tracking-tight"
              style={{
                fontFamily: "DM Serif Display, Georgia, serif",
                letterSpacing: "-0.03em",
              }}
            >
              Upload Your Score
            </h1>
            <p className="text-xl text-[#1C1917]/70">
              Snap a photo of your sheet music and we'll convert it to editable
              notation.
            </p>
          </motion.div>

          {/* Upload Zone */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="mb-12"
          >
            <div
              onDragOver={!processing ? handleDragOver : undefined}
              onDragLeave={!processing ? handleDragLeave : undefined}
              onDrop={!processing ? handleDrop : undefined}
              className={`
                relative p-12 rounded-2xl border-4 border-dashed transition-all duration-300
                ${isDragging
                  ? "border-[#7FFFD4] bg-[#7FFFD4]/5 scale-[1.02]"
                  : "border-[#1C1917]/30 bg-white"
                }
              `}
            >
              {/* Staff lines inside upload zone — always visible in idle state */}
              {!showOrderReview && !showTypePicker && !processing && !error && !showAd && (
                <div className="absolute left-16 right-16 top-1/2 -translate-y-1/2 h-32 opacity-40 pointer-events-none">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="absolute left-0 right-0 border-t-2 border-[#1C1917]"
                      style={{ top: `${i * 24}px` }}
                    />
                  ))}
                  <div className="absolute -left-8 top-1/2 -translate-y-1/2 text-6xl opacity-60">
                    𝄞
                  </div>
                  <div className="absolute -left-4 top-0 bottom-0 w-1 bg-[#1C1917] opacity-60" />
                  <div className="absolute -right-4 top-0 bottom-0 w-1 bg-[#1C1917] opacity-60" />
                </div>
              )}

              {/* Preview / order review */}
              {showOrderReview ? (
                <div className="relative z-10">
                  {orderedFiles.length === 1 ? (
                    /* Single file — big centered preview */
                    <>
                      <h2
                        className="text-3xl font-serif font-bold mb-1 text-center"
                        style={{ fontFamily: "DM Serif Display, Georgia, serif" }}
                      >
                        Preview
                      </h2>
                      <div className="flex items-center justify-center gap-2 mb-5">
                        <p className="text-[#1C1917]/60 text-sm truncate max-w-[220px]">{orderedFiles[0].name}</p>
                        <button
                          onClick={() => handleRemoveFile(0)}
                          className="w-5 h-5 rounded-full bg-[#F2C4C4] border border-[#1C1917]/20 flex items-center justify-center hover:bg-red-200 transition-colors flex-shrink-0"
                          title="Remove file"
                        >
                          <X className="w-3 h-3 text-[#1C1917]" />
                        </button>
                      </div>
                      <div className="flex justify-center mb-4">
                        {orderPreviewUrls[0] ? (
                          <button
                            onClick={() => { setLightboxIndex(0); setCropMode(false); setCropStart(null); setCropEnd(null); }}
                            className="relative group cursor-zoom-in"
                            title="Click to preview or crop"
                          >
                            <img
                              src={orderPreviewUrls[0]}
                              alt="Preview"
                              className="max-h-64 w-auto rounded-xl border-2 border-[#1C1917] shadow-[4px_4px_0_#1C1917] object-contain"
                            />
                            <div className="absolute inset-0 rounded-xl bg-black/0 group-hover:bg-black/40 flex items-center justify-center gap-2 transition-all">
                              <Crop className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                              <span className="text-white text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity">Crop</span>
                            </div>
                          </button>
                        ) : (
                          <div className="w-28 h-36 bg-[#F5F0E8] rounded-xl border-2 border-[#1C1917] shadow-[4px_4px_0_#1C1917] flex flex-col items-center justify-center gap-2">
                            <FileMusic className="w-8 h-8 text-[#1C1917]/30" />
                            <span className="text-xs text-[#1C1917]/40">PDF</span>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    /* Multiple files — drag-to-reorder list */
                    <>
                      <h2
                        className="text-3xl font-serif font-bold mb-2 text-center"
                        style={{ fontFamily: "DM Serif Display, Georgia, serif" }}
                      >
                        Confirm page order
                      </h2>
                      <p className="text-center text-[#1C1917]/60 text-sm mb-6">
                        Drag to reorder · {orderedFiles.length} pages
                      </p>
                      <div className="mb-3 max-h-72 overflow-y-auto pr-1">
                        <div className={`h-[3px] rounded-full mx-1 mb-1 bg-[#7FFFD4] transition-opacity duration-100 ${dragOverIndex === 0 ? "opacity-100" : "opacity-0"}`} />
                        {orderedFiles.map((file, i) => (
                          <div key={`${file.name}-${file.size}-${i}`}>
                            <div
                              draggable
                              onDragStart={() => handleFileDragStart(i)}
                              onDragOver={(e) => handleFileDragOver(e, i)}
                              onDrop={(e) => handleFileDrop(e, i)}
                              onDragEnd={handleFileDragEnd}
                              className={`flex items-center gap-3 p-3 rounded-xl border-2 border-[#1C1917]/20 hover:border-[#1C1917]/40 transition-all cursor-grab active:cursor-grabbing bg-white select-none mb-1 ${draggingIndex === i ? "opacity-40" : ""}`}
                            >
                              <GripVertical className="w-5 h-5 text-[#1C1917]/30 flex-shrink-0" />
                              <span className="w-6 h-6 rounded-full bg-[#F5F0E8] border border-[#1C1917]/20 flex items-center justify-center text-xs font-bold text-[#1C1917]/60 flex-shrink-0">
                                {i + 1}
                              </span>
                              {orderPreviewUrls[i] ? (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setLightboxIndex(i); setCropMode(false); setCropStart(null); setCropEnd(null); }}
                                  className="relative group flex-shrink-0 cursor-zoom-in"
                                  draggable={false}
                                >
                                  <img
                                    src={orderPreviewUrls[i]}
                                    alt={`Page ${i + 1}`}
                                    className="w-10 h-14 object-cover rounded border border-[#1C1917]/10"
                                  />
                                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 rounded transition-all flex items-center justify-center">
                                    <ZoomIn className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                  </div>
                                </button>
                              ) : (
                                <div className="w-10 h-14 bg-[#F5F0E8] rounded border border-[#1C1917]/10 flex items-center justify-center flex-shrink-0">
                                  <FileMusic className="w-4 h-4 text-[#1C1917]/30" />
                                </div>
                              )}
                              <span className="text-sm text-[#1C1917] truncate flex-1">{file.name}</span>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleRemoveFile(i); }}
                                draggable={false}
                                className="w-6 h-6 rounded-full bg-[#F5F0E8] border border-[#1C1917]/20 flex items-center justify-center hover:bg-[#F2C4C4] transition-colors flex-shrink-0 cursor-pointer"
                                title="Remove"
                              >
                                <X className="w-3 h-3 text-[#1C1917]/60" />
                              </button>
                            </div>
                            <div className={`h-[3px] rounded-full mx-1 mb-1 bg-[#7FFFD4] transition-opacity duration-100 ${dragOverIndex === i + 1 ? "opacity-100" : "opacity-0"}`} />
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {/* Always-visible input + add more button */}
                  <input
                    ref={addMoreInputRef}
                    type="file"
                    multiple
                    accept=".png,.jpg,.jpeg,.pdf"
                    className="hidden"
                    onChange={(e) => {
                      const files = e.target.files;
                      if (files && files.length > 0) handleAppendFiles(Array.from(files));
                      e.target.value = "";
                    }}
                  />
                  <button
                    onClick={() => addMoreInputRef.current?.click()}
                    className="w-full mt-3 mb-3 py-2 rounded-xl border-2 border-dashed border-[#1C1917]/30 text-sm text-[#1C1917]/50 hover:border-[#1C1917]/60 hover:text-[#1C1917]/70 hover:bg-[#F5F0E8]/60 transition-all flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" /> Add more files
                  </button>
                  <button
                    onClick={confirmOrder}
                    className="w-full py-3 bg-[#7FFFD4] border-2 border-[#1C1917] rounded-full font-medium hover:translate-y-[-2px] transition-all shadow-[4px_4px_0_#1C1917] hover:shadow-[6px_6px_0_#1C1917]"
                  >
                    Continue →
                  </button>
                  <button
                    onClick={handleReset}
                    className="mt-4 block mx-auto text-sm text-[#1C1917]/50 hover:text-[#1C1917] transition-colors"
                  >
                    ← Choose different {orderedFiles.length === 1 ? "file" : "files"}
                  </button>
                </div>

              ) : /* Type picker */
              showTypePicker ? (
                <div className="relative z-10">
                  <h2
                    className="text-3xl font-serif font-bold mb-2 text-center"
                    style={{ fontFamily: "DM Serif Display, Georgia, serif" }}
                  >
                    What type of score is this?
                  </h2>
                  <p className="text-center text-[#1C1917]/60 text-sm mb-5">
                    {fileName}
                  </p>

                  <div className="grid md:grid-cols-2 gap-6">
                    <button
                      onClick={() => {
                        setSelectedType("classical");
                        pendingScoreType.current = "classical";
                        setShowTypePicker(false);
                        setShowAd(true);
                        runUpload(pendingFile.current, "classical", "legato");
                      }}
                      className={`relative p-8 rounded-2xl border-2 transition-all text-left overflow-hidden
                        ${selectedType === "classical"
                          ? "border-[#1C1917] shadow-[6px_6px_0_#1C1917] bg-[#F2C4C4]"
                          : "border-[#1C1917]/20 hover:border-[#1C1917]/60 bg-white hover:shadow-[4px_4px_0_#1C1917]/20"
                        }`}
                    >
                      <div className="absolute top-0 left-0 right-0 h-3 bg-gradient-to-b from-[#1C1917]/5 to-transparent" />
                      <h3
                        className="text-3xl font-serif font-bold mb-3"
                        style={{ fontFamily: "DM Serif Display, Georgia, serif" }}
                      >
                        Classical
                      </h3>
                      <p className="text-sm text-[#1C1917]/60 mb-4">
                        Dense notation, complex arrangements
                      </p>
                      <div className="bg-[#F5F0E8] p-4 rounded-lg border border-[#1C1917]/10">
                        <div className="space-y-1">
                          {[0, 1, 2, 3, 4].map((i) => (
                            <div key={i} className="h-0.5 bg-[#1C1917]/40" />
                          ))}
                          <div className="text-2xl pt-2">♪ ♫ ♬ ♩ 𝄞</div>
                        </div>
                      </div>
                    </button>

                    <button
                      onClick={() => {
                        setSelectedType("jazz");
                        pendingScoreType.current = "jazz";
                        setShowTypePicker(false);
                        setShowAd(true);
                        runUpload(pendingFile.current, "jazz");
                      }}
                      className={`relative p-8 rounded-2xl border-2 transition-all text-left overflow-hidden
                        ${selectedType === "jazz"
                          ? "border-[#1C1917] shadow-[6px_6px_0_#1C1917] bg-[#B8D8E8]"
                          : "border-[#1C1917]/20 hover:border-[#1C1917]/60 bg-white hover:shadow-[4px_4px_0_#1C1917]/20"
                        }`}
                    >
                      <div className="absolute top-0 left-0 right-0 h-3 bg-gradient-to-b from-[#1C1917]/5 to-transparent" />
                      <h3
                        className="text-3xl font-serif font-bold mb-3"
                        style={{ fontFamily: "DM Serif Display, Georgia, serif" }}
                      >
                        Jazz
                      </h3>
                      <p className="text-sm text-[#1C1917]/60 mb-4">
                        Lead sheets, chord symbols
                      </p>
                      <div className="bg-[#F5F0E8] p-4 rounded-lg border border-[#1C1917]/10">
                        <div className="space-y-1">
                          {[0, 1, 2, 3, 4].map((i) => (
                            <div key={i} className="h-0.5 bg-[#1C1917]/40" />
                          ))}
                          <div className="text-sm pt-2 font-mono">
                            Cmaj7 | Dm7 G7
                          </div>
                        </div>
                      </div>
                    </button>
                  </div>
                  <button
                    onClick={handleReset}
                    className="mt-6 block mx-auto text-sm text-[#1C1917]/50 hover:text-[#1C1917] transition-colors"
                  >
                    ← Choose a different file
                  </button>
                </div>

              ) : error ? (
                <div className="text-center relative z-10">
                  <div className="w-24 h-24 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
                    <AlertCircle className="w-12 h-12 text-red-500" />
                  </div>
                  <h2 className="text-2xl font-semibold text-[#1C1917] mb-3">
                    {error.includes("sign in")
                      ? "Sign In Required"
                      : error.includes("not a supported") || error.includes("exceeds") || error.includes("too large")
                      ? "Unsupported File"
                      : "Processing Failed"}
                  </h2>
                  <p className="text-[#1C1917]/60 mb-6 max-w-md mx-auto text-sm">
                    {error}
                  </p>
                  {error.includes("sign in") ? (
                    <button
                      onClick={async () => {
                        const filesToProcess = pendingFile.current;
                        const scoreType = pendingScoreType.current;
                        const selectedFiles = orderedFiles.length > 0 ? orderedFiles : filesToProcess;
                        setError(null);
                        await signInWithGoogle();
                        if (selectedFiles.length > 0) {
                          setShowTypePicker(false);
                          setShowOrderReview(false);
                          runUpload(selectedFiles, scoreType, scoreType === "classical" ? "legato" : undefined);
                        }
                      }}
                      className="px-8 py-4 bg-[#1C1917] text-white border-2 border-[#1C1917] rounded-full hover:translate-y-[-2px] transition-all shadow-[4px_4px_0_#1C1917] inline-flex items-center gap-2"
                    >
                      <LogIn className="w-5 h-5" />
                      Sign In with Google
                    </button>
                  ) : (
                    <button
                      onClick={handleReset}
                      className="px-8 py-4 bg-[#1C1917] text-white border-2 border-[#1C1917] rounded-full hover:translate-y-[-2px] transition-all shadow-[4px_4px_0_#1C1917]"
                    >
                      Try Again
                    </button>
                  )}
                </div>

              ) : processing ? (
                <div className="flex flex-col gap-6 relative z-10">
                  <div className="flex flex-col md:flex-row gap-8 items-center justify-center">
                  {previewUrl && (
                    <div className="flex-shrink-0">
                      <img
                        src={previewUrl}
                        alt="Uploaded sheet music"
                        className="w-40 h-52 object-cover rounded-xl border-2 border-[#1C1917] shadow-[4px_4px_0_#1C1917]"
                      />
                    </div>
                  )}
                  <div className="flex flex-col gap-5 min-w-[220px]">
                    <p className="text-sm text-[#1C1917]/60 mb-1">{fileName}</p>
                    {(["uploading", "analyzing", "converting"] as const).map(
                      (s, i) => {
                        const labels = {
                          uploading: "Uploading file",
                          analyzing: "Analyzing sheet music",
                          converting: "Converting to MusicXML",
                        };
                        const stageIndex = [
                          "uploading",
                          "analyzing",
                          "converting",
                        ].indexOf(stage);
                        const isDone = i < stageIndex;
                        const isCurrent = s === stage;

                        return (
                          <div key={s} className="flex items-center gap-3">
                            <div
                              className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center border-2 transition-all
                              ${isDone
                                ? "bg-[#7FFFD4] border-[#1C1917]"
                                : isCurrent
                                ? "border-[#1C1917] animate-pulse"
                                : "border-[#1C1917]/30"
                              }`}
                            >
                              {isDone && (
                                <svg
                                  className="w-3 h-3 text-[#1C1917]"
                                  fill="none"
                                  viewBox="0 0 12 12"
                                >
                                  <path
                                    d="M2 6l3 3 5-5"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              )}
                            </div>
                            <div className="flex-1">
                              <p
                                className={`text-sm font-medium transition-colors
                                ${isCurrent
                                  ? "text-[#1C1917]"
                                  : isDone
                                  ? "text-[#1C1917]/60"
                                  : "text-[#1C1917]/30"
                                }`}
                              >
                                {labels[s]}
                              </p>
                              {isCurrent && (
                                <div className="mt-1.5 w-full bg-[#F5F0E8] rounded-full h-1.5 overflow-hidden border border-[#1C1917]/20">
                                  <motion.div
                                    className="h-full bg-[#7FFFD4] rounded-full"
                                    animate={{ x: ["-100%", "100%"] }}
                                    transition={{
                                      repeat: Infinity,
                                      duration: 1.5,
                                      ease: "easeInOut",
                                    }}
                                    style={{ width: "40%" }}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      }
                    )}
                    <p className="text-xs text-[#1C1917]/40 mt-2">
                      This usually takes 3–5 minutes. Please keep this tab open.
                    </p>
                  </div>
                  </div>
                  {/* Ad placeholder */}
                  <div className="w-full rounded-xl border-2 border-dashed border-[#1C1917]/20 bg-[#F5F0E8]/50 py-8 flex items-center justify-center">
                    <span className="text-sm text-[#1C1917]/30 font-medium tracking-widest uppercase select-none">
                      Ad Placeholder
                    </span>
                  </div>
                </div>

              ) : (
                <div className="text-center relative z-10">
                  <Upload
                    className="w-16 h-16 mx-auto mb-6 text-[#1C1917]/40"
                    strokeWidth={1.5}
                  />
                  <p
                    className="text-3xl mb-6 font-serif italic"
                    style={{ fontFamily: "DM Serif Display, Georgia, serif" }}
                  >
                    {isDragging ? "Drop it here ♩" : "Drop your score here ♩"}
                  </p>
                  <div className="flex flex-wrap gap-3 justify-center">
                    <label className="inline-block">
                      <input
                        type="file"
                        accept=".png,.jpg,.jpeg,.pdf"
                        onChange={handleFileSelect}
                        className="hidden"
                        multiple
                      />
                      <span className="px-8 py-3 bg-[#7FFFD4] border-2 border-[#1C1917] rounded-full font-medium hover:translate-y-[-2px] transition-all shadow-[4px_4px_0_#1C1917] hover:shadow-[6px_6px_0_#1C1917] cursor-pointer inline-flex items-center gap-2">
                        <FileMusic className="w-5 h-5" />
                        Browse Files
                      </span>
                    </label>
                    <button
                      onClick={() => setShowCamera(true)}
                      className="px-8 py-3 bg-white border-2 border-[#1C1917] rounded-full font-medium hover:translate-y-[-2px] transition-all shadow-[4px_4px_0_#1C1917] hover:shadow-[6px_6px_0_#1C1906] inline-flex items-center gap-2"
                    >
                      <Camera className="w-5 h-5" />
                      Use Camera
                    </button>
                  </div>
                  <p className="text-sm text-[#1C1917]/40 mt-8">
                    Supported formats: PNG, JPG, PDF · Multiple files supported
                    · Max 10MB each
                  </p>
                </div>
              )}
            </div>
          </motion.div>


          {/* Load MusicXML shortcut */}
          {!processing && !error && !showOrderReview && !showTypePicker && (
            <div className="text-center -mt-6 mb-6">
              <label className="inline-flex items-center gap-1.5 text-sm text-[#1C1917]/40 hover:text-[#1C1917]/70 transition-colors cursor-pointer">
                <FileMusic className="w-3.5 h-3.5" />
                or open a .musicxml file directly
                <input
                  type="file"
                  accept=".musicxml,.xml"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      const xml = ev.target?.result as string;
                      if (xml) navigate("/editor", { state: { musicXml: xml, fileName: file.name } });
                    };
                    reader.readAsText(file);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          )}

          {/* Tips Panel */}
          {!processing && !error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="relative bg-[#F5E6A0] p-8 rounded-2xl border-2 border-[#1C1917] shadow-[6px_6px_0_#1C1917]"
              style={{ transform: "rotate(-0.5deg)" }}
            >
              <div
                className="absolute top-4 right-4 w-8 h-8 rounded-full bg-[#E74C3C] border-2 border-[#1C1917] shadow-md"
                style={{ transform: "rotate(0.5deg)" }}
              />
              <h3
                className="text-2xl font-serif font-bold mb-4"
                style={{ fontFamily: "DM Serif Display, Georgia, serif" }}
              >
                📝 Tips for Best Results
              </h3>
              <ul className="space-y-2 text-[#1C1917]/80">
                <li className="flex items-start gap-2">
                  <span>♪</span>
                  <span>Use good lighting and avoid shadows across the staff lines</span>
                </li>
                <li className="flex items-start gap-2">
                  <span>♪</span>
                  <span>Keep your camera parallel to the page — no angled shots</span>
                </li>
                <li className="flex items-start gap-2">
                  <span>♪</span>
                  <span>Include the full staff and any clefs or key signatures</span>
                </li>
                <li className="flex items-start gap-2">
                  <span>♪</span>
                  <span>Supported formats: JPG, PNG, PDF (max 10MB)</span>
                </li>
              </ul>
            </motion.div>
          )}
        </div>

        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&display=swap');
        `}</style>
      </div>

      {showCamera && (
        <CameraCapture
          onCapture={(file) => {
            setShowCamera(false);
            handleFilesUpload([file]);
          }}
          onClose={() => setShowCamera(false)}
        />
      )}

      {/* Full-page drop overlay — fires when user drags a file anywhere over the browser window */}
      {isDraggingFile && !processing && !showOrderReview && !showTypePicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(127,255,212,0.18)", backdropFilter: "blur(2px)" }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            dragCounterRef.current = 0;
            setIsDraggingFile(false);
            const files = e.dataTransfer.files;
            if (files.length > 0) handleFilesUpload(Array.from(files));
          }}
        >
          <div className="text-center pointer-events-none">
            <div
              className="mx-auto mb-6 w-32 h-32 rounded-2xl border-4 border-dashed border-[#1C1917] bg-[#7FFFD4]/60 flex items-center justify-center shadow-[8px_8px_0_#1C1917]"
            >
              <Upload className="w-12 h-12 text-[#1C1917]" strokeWidth={1.5} />
            </div>
            <p className="text-3xl font-bold text-[#1C1917]" style={{ fontFamily: "DM Serif Display, Georgia, serif" }}>
              Drop your score here ♩
            </p>
          </div>
        </div>
      )}

      {lightboxIndex !== null && orderPreviewUrls[lightboxIndex] && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6"
          onClick={() => { if (!cropMode) { setLightboxIndex(null); } }}
        >
          <button
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
            onClick={(e) => { e.stopPropagation(); setLightboxIndex(null); setCropMode(false); setCropStart(null); setCropEnd(null); }}
          >
            <X className="w-5 h-5 text-white" />
          </button>

          {cropMode ? (
            <div className="flex flex-col items-center gap-4" onClick={(e) => e.stopPropagation()}>
              <p className="text-white/70 text-sm">Drag to select crop area</p>
              <div className="relative inline-block select-none">
                <img
                  ref={cropImgRef}
                  src={orderPreviewUrls[lightboxIndex]}
                  alt="Crop preview"
                  style={{ display: "block", maxWidth: "80vw", maxHeight: "65vh" }}
                  draggable={false}
                  onMouseDown={handleCropMouseDown}
                  onMouseMove={handleCropMouseMove}
                  onMouseUp={handleCropMouseUp}
                  className="rounded-xl cursor-crosshair"
                />
                {cropStart && cropEnd && (
                  <div
                    className="absolute border-2 border-[#7FFFD4] pointer-events-none"
                    style={{
                      left: Math.min(cropStart.x, cropEnd.x),
                      top: Math.min(cropStart.y, cropEnd.y),
                      width: Math.abs(cropEnd.x - cropStart.x),
                      height: Math.abs(cropEnd.y - cropStart.y),
                      boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
                    }}
                  />
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => { setCropMode(false); setCropStart(null); setCropEnd(null); }}
                  className="px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={applyCrop}
                  disabled={!cropStart || !cropEnd}
                  className="px-4 py-2 bg-[#7FFFD4] text-[#1C1917] font-medium rounded-lg disabled:opacity-40 hover:bg-[#6FEFC4] transition-colors"
                >
                  Apply Crop
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4" onClick={(e) => e.stopPropagation()}>
              <img
                src={orderPreviewUrls[lightboxIndex]}
                alt="Page preview"
                className="max-w-full max-h-[75vh] object-contain rounded-xl shadow-2xl"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => applyRotate(-90)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-full transition-colors"
                  title="Rotate left 90°"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button
                  onClick={() => applyRotate(90)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-full transition-colors"
                  title="Rotate right 90°"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
                <button
                  onClick={() => { setCropMode(true); setCropStart(null); setCropEnd(null); }}
                  className="flex items-center gap-2 px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-full transition-colors"
                >
                  <Crop className="w-4 h-4" />
                  Crop
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
