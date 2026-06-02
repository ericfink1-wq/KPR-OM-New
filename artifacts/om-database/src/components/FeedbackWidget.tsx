import { useState, useRef } from "react";
import { apiSubmitFeedback } from "../lib/api";

interface Props {
  currentPage: string;
  liftAboveBar?: boolean;
  /** Height (px) of the open import panel — lifts the flag just above it so it doesn't overlap. */
  liftAbove?: number;
}

type FeedbackType = "Bug" | "Idea" | "Other";
type Phase = "idle" | "open" | "submitting" | "done" | "error";

const TYPES: FeedbackType[] = ["Bug", "Idea", "Other"];
const MAX_IMAGES = 5;

// Downscale/re-encode an image file to a data URL so phone screenshots don't
// balloon the request or the email. Caps the longest edge and re-encodes to JPEG;
// falls back to the original bytes if anything goes wrong.
function fileToDownscaledDataUrl(file: File, maxDim = 1400, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onerror = () => resolve(src); // can't process — send original
      img.onload = () => {
        const longest = Math.max(img.width, img.height);
        if (longest <= maxDim) { resolve(src); return; }
        const scale = maxDim / longest;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(src); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        try { resolve(canvas.toDataURL("image/jpeg", quality)); }
        catch { resolve(src); }
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

export default function FeedbackWidget({ currentPage, liftAboveBar, liftAbove }: Props) {
  // When the import panel is open, sit just above it; otherwise normal position.
  const bottomOffset = liftAbove && liftAbove > 0 ? liftAbove + 16 : (liftAboveBar ? 110 : 24);
  const [phase, setPhase] = useState<Phase>("idle");
  const [type, setType] = useState<FeedbackType>("Idea");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const open = () => {
    setPhase("open");
    setType("Idea");
    setMessage("");
    setName("");
    setImages([]);
  };

  const close = () => setPhase("idle");

  const addFiles = async (files: FileList | File[] | null | undefined) => {
    if (!files) return;
    const imgs = Array.from(files).filter(f => f.type.startsWith("image/"));
    for (const f of imgs) {
      if (images.length >= MAX_IMAGES) break;
      try {
        const url = await fileToDownscaledDataUrl(f);
        setImages(prev => prev.length >= MAX_IMAGES ? prev : [...prev, url]);
      } catch { /* skip unreadable image */ }
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items || []);
    const files = items.filter(it => it.kind === "file" && it.type.startsWith("image/")).map(it => it.getAsFile()).filter((f): f is File => !!f);
    if (files.length) { e.preventDefault(); addFiles(files); }
  };

  const removeImage = (i: number) => setImages(prev => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!message.trim()) return;
    setPhase("submitting");
    try {
      await apiSubmitFeedback({
        type: type.toLowerCase(),
        message: message.trim(),
        name: name.trim() || undefined,
        page: currentPage,
        userAgent: navigator.userAgent,
        images: images.length ? images : undefined,
      });
      setPhase("done");
      setTimeout(() => setPhase("idle"), 2600);
    } catch {
      setPhase("error");
    }
  };

  return (
    <div style={{ position: "fixed", bottom: bottomOffset, left: 24, zIndex: 9500, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10, transition: "bottom 0.2s ease" }}>
      {(phase === "open" || phase === "submitting" || phase === "error") && (
        <div style={{
          background: "#fff",
          border: "1px solid #e6dfd0",
          borderRadius: 14,
          boxShadow: "0 8px 32px rgba(56,58,55,0.18)",
          width: 300,
          overflow: "hidden",
          fontFamily: "'Inter',sans-serif",
        }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 16px 10px", borderBottom: "1px solid #f1eadc" }}>
            <span style={{ fontFamily: "'Fraunces',serif", fontSize: 15, fontWeight: 500, color: "#26281f" }}>Send feedback</span>
            <button onClick={close} aria-label="Close" style={{ background: "none", border: "none", color: "#b0a898", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
          </div>

          <div style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            {/* Type buttons */}
            <div style={{ display: "flex", gap: 6 }}>
              {TYPES.map(t => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  style={{
                    flex: 1,
                    padding: "5px 0",
                    borderRadius: 6,
                    border: type === t ? "1.5px solid #6dba43" : "1.5px solid #e6dfd0",
                    background: type === t ? "#f0f9ea" : "transparent",
                    color: type === t ? "#3f7a1f" : "#7d766a",
                    fontFamily: "'Inter',sans-serif",
                    fontSize: 12,
                    fontWeight: type === t ? 600 : 400,
                    cursor: "pointer",
                  }}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Message */}
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              onPaste={onPaste}
              placeholder="Describe the issue or idea… (you can paste a screenshot here)"
              rows={4}
              style={{
                resize: "vertical",
                border: "1.5px solid #e6dfd0",
                borderRadius: 8,
                padding: "8px 10px",
                fontFamily: "'Inter',sans-serif",
                fontSize: 13,
                color: "#383a37",
                background: "#fdfaf5",
                outline: "none",
                width: "100%",
                boxSizing: "border-box",
              }}
            />

            {/* Name */}
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name (optional)"
              style={{
                border: "1.5px solid #e6dfd0",
                borderRadius: 8,
                padding: "7px 10px",
                fontFamily: "'Inter',sans-serif",
                fontSize: 13,
                color: "#383a37",
                background: "#fdfaf5",
                outline: "none",
                width: "100%",
                boxSizing: "border-box",
              }}
            />

            {/* Screenshots: paste into the box above, or attach here */}
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: "none" }}
                onChange={e => { addFiles(e.target.files); e.target.value = ""; }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={images.length >= MAX_IMAGES}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  background: "transparent", border: "1.5px dashed #d8cfbd", borderRadius: 8,
                  padding: "6px 10px", fontSize: 12, fontFamily: "'Inter',sans-serif",
                  color: images.length >= MAX_IMAGES ? "#b0a898" : "#7d766a",
                  cursor: images.length >= MAX_IMAGES ? "default" : "pointer", width: "100%", justifyContent: "center",
                }}
              >
                📎 {images.length ? `Add another screenshot (${images.length}/${MAX_IMAGES})` : "Attach a screenshot"}
              </button>
              {images.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                  {images.map((src, i) => (
                    <div key={i} style={{ position: "relative", width: 56, height: 56, borderRadius: 8, overflow: "hidden", border: "1px solid #e6dfd0" }}>
                      <img src={src} alt={`screenshot ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      <button
                        type="button"
                        onClick={() => removeImage(i)}
                        aria-label="Remove screenshot"
                        style={{
                          position: "absolute", top: 2, right: 2, width: 16, height: 16, borderRadius: "50%",
                          background: "rgba(38,40,31,0.78)", color: "#fff", border: "none", cursor: "pointer",
                          fontSize: 11, lineHeight: "16px", padding: 0, textAlign: "center",
                        }}
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {phase === "error" && (
              <div style={{ fontSize: 12, color: "#c0392b", background: "#fdf0ee", borderRadius: 6, padding: "6px 10px" }}>
                Something went wrong — please try again.
              </div>
            )}

            <button
              onClick={submit}
              disabled={!message.trim() || phase === "submitting"}
              style={{
                background: !message.trim() || phase === "submitting" ? "#c8e4b4" : "#6dba43",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "8px 0",
                fontSize: 13,
                fontFamily: "'Inter',sans-serif",
                fontWeight: 600,
                cursor: !message.trim() || phase === "submitting" ? "default" : "pointer",
                width: "100%",
              }}
            >
              {phase === "submitting" ? "Sending…" : "Submit"}
            </button>
          </div>
        </div>
      )}

      {phase === "done" && (
        <div style={{
          background: "#fff",
          border: "1px solid #c8e4b4",
          borderRadius: 14,
          boxShadow: "0 8px 32px rgba(56,58,55,0.14)",
          padding: "14px 20px",
          fontFamily: "'Inter',sans-serif",
          fontSize: 13,
          color: "#3f7a1f",
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          <span style={{ fontSize: 18 }}>✓</span> Thanks — got it!
        </div>
      )}

      {/* Trigger button */}
      <button
        onClick={phase === "idle" || phase === "done" ? open : close}
        title="Send feedback"
        aria-label="Send feedback"
        style={{
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: "#383a37",
          border: "none",
          boxShadow: "0 4px 16px rgba(56,58,55,0.28)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          transition: "background 0.15s",
        }}
        onMouseEnter={e => (e.currentTarget.style.background = "#52554e")}
        onMouseLeave={e => (e.currentTarget.style.background = "#383a37")}
      >
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#f6f2ea" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
          <path d="M4 22v-7"/>
        </svg>
      </button>
    </div>
  );
}
