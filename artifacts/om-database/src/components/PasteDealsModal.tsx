import { useRef, useState } from "react";
import type { Deal } from "../lib/idb";
import { apiSaveDeal } from "../lib/api";

interface Props {
  onClose: () => void;
  onDone: () => void;
}

type ValidationState =
  | { kind: "idle" }
  | { kind: "errors"; errors: string[] }
  | { kind: "valid"; deals: Deal[]; warnings: string[] };

type SaveState =
  | { kind: "idle" }
  | { kind: "saving"; current: number; total: number }
  | { kind: "done"; created: number; failed: { index: number; name: string; error: string }[] };

function parseDealJson(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (Array.isArray(r.deals)) return r.deals;
    return [raw];
  }
  return [];
}

function normalizeDeal(obj: Record<string, unknown>, index: number): { deal: Deal; warnings: string[] } {
  const d = { ...obj };

  if (typeof d.name === "string" && !d.propertyName) {
    d.propertyName = d.name;
  }
  delete d.name;

  if (!d.id || typeof d.id !== "string") {
    d.id = `${Date.now().toString(36)}_${index}`;
  }
  if (!d.status) d.status = "Prospect";
  if (!Array.isArray(d.tenants)) d.tenants = [];
  if (!d.uploadedAt) d.uploadedAt = new Date().toISOString();

  const warnings: string[] = [];
  const tenants = d.tenants as unknown[];
  if (tenants.length > 0 && !d.rentRollDate) {
    warnings.push(`Deal "${d.propertyName || d.id}" has tenants but no rentRollDate`);
  }

  return { deal: d as unknown as Deal, warnings };
}

function formatSF(v: unknown): string {
  const n = Number(v);
  if (!v || isNaN(n) || n === 0) return "";
  return ` · ${n.toLocaleString()} SF`;
}

export default function PasteDealsModal({ onClose, onDone }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [validation, setValidation] = useState<ValidationState>({ kind: "idle" });
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".json")) {
      setValidation({ kind: "errors", errors: ["Please select a .json file."] });
      return;
    }
    setText(await file.text());
    setValidation({ kind: "idle" });
  };

  const handleValidate = () => {
    if (!text.trim()) {
      setValidation({ kind: "errors", errors: ["No JSON to validate."] });
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setValidation({ kind: "errors", errors: [`Could not parse JSON: ${msg}`] });
      return;
    }

    const items = parseDealJson(raw);
    if (items.length === 0) {
      setValidation({ kind: "errors", errors: ["No deals found in JSON."] });
      return;
    }

    const errors: string[] = [];
    const deals: Deal[] = [];
    const allWarnings: string[] = [];

    for (let i = 0; i < items.length; i++) {
      const obj = items[i];
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
        errors.push(`Item at index ${i} is not an object.`);
        continue;
      }
      const r = obj as Record<string, unknown>;
      const hasName = (typeof r.name === "string" && r.name.trim()) ||
                      (typeof r.propertyName === "string" && r.propertyName.trim());
      if (!hasName) {
        errors.push(`Deal at index ${i}: missing required field "name" or "propertyName".`);
        continue;
      }
      const { deal, warnings } = normalizeDeal(r, i);
      deals.push(deal);
      allWarnings.push(...warnings);
    }

    if (errors.length > 0) {
      setValidation({ kind: "errors", errors });
      return;
    }

    setValidation({ kind: "valid", deals, warnings: allWarnings });
  };

  const handleCreate = async () => {
    if (validation.kind !== "valid") return;
    const { deals } = validation;
    const failed: { index: number; name: string; error: string }[] = [];

    setSave({ kind: "saving", current: 1, total: deals.length });

    for (let i = 0; i < deals.length; i++) {
      setSave({ kind: "saving", current: i + 1, total: deals.length });
      try {
        await apiSaveDeal(deals[i]);
      } catch (err) {
        failed.push({
          index: i,
          name: deals[i].propertyName || deals[i].fileName || `Deal ${i + 1}`,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    setSave({ kind: "done", created: deals.length - failed.length, failed });
  };

  const isBusy = save.kind === "saving";

  return (
    <div
      onClick={isBusy ? undefined : onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(38,40,31,0.55)", zIndex: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 16, maxWidth: 640, width: "100%", maxHeight: "92vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(38,40,31,0.32)", border: "1px solid #ece5d7", fontFamily: "'Inter', sans-serif" }}>

        {/* Header */}
        <div style={{ padding: "22px 24px 0" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 600, color: "#26281f", marginBottom: 4 }}>
                Paste deals from Claude
              </div>
              <div style={{ fontSize: 12, color: "#a89f8f", lineHeight: 1.5 }}>
                Skip the AI extraction step — paste JSON Claude already produced for one or more deals. No API tokens used.
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={isBusy}
              style={{ background: "transparent", border: "none", color: "#a89f8f", fontSize: 20, cursor: isBusy ? "default" : "pointer", lineHeight: 1, flexShrink: 0, padding: "2px 4px" }}>
              ×
            </button>
          </div>
        </div>

        <div style={{ padding: "16px 24px 24px" }}>

          {/* Done state */}
          {save.kind === "done" ? (
            <div>
              <div style={{ background: save.failed.length === 0 ? "#f0fdf4" : "#fffbf0", border: `1px solid ${save.failed.length === 0 ? "#bbf7d0" : "#fde68a"}`, borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: save.failed.length === 0 ? "#166534" : "#92400e" }}>
                  {save.failed.length === 0
                    ? `✓ Created ${save.created} deal${save.created !== 1 ? "s" : ""} successfully`
                    : `Created ${save.created} deal${save.created !== 1 ? "s" : ""}; ${save.failed.length} failed`}
                </div>
                {save.failed.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    {save.failed.map((f, i) => (
                      <div key={i} style={{ fontSize: 12, color: "#b45309", marginTop: 4 }}>
                        · {f.name}: {f.error}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={onDone}
                style={{ background: "#6dba43", border: "none", color: "#1f2b16", padding: "10px 22px", borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                Done
              </button>
            </div>
          ) : save.kind === "saving" ? (
            /* Saving progress */
            <div style={{ padding: "32px 0", textAlign: "center" }}>
              <div style={{ fontSize: 13, color: "#6f6a5f", marginBottom: 8 }}>
                Saving deal {save.current} of {save.total}…
              </div>
              <div style={{ background: "#f0f0ec", borderRadius: 6, height: 6, overflow: "hidden", maxWidth: 260, margin: "0 auto" }}>
                <div style={{ background: "#6dba43", height: "100%", width: `${(save.current / save.total) * 100}%`, transition: "width 0.2s" }} />
              </div>
            </div>
          ) : (
            /* Input + validation */
            <>
              {/* Textarea */}
              <div style={{ marginBottom: 10 }}>
                <textarea
                  value={text}
                  onChange={e => { setText(e.target.value); setValidation({ kind: "idle" }); }}
                  placeholder={'[\n  {\n    "propertyName": "Sunset Plaza",\n    "city": "Columbus",\n    "state": "OH",\n    "totalSF": 95000,\n    "capRate": 6.5,\n    "tenants": []\n  }\n]'}
                  style={{ width: "100%", minHeight: 300, fontFamily: "monospace", fontSize: 12, padding: "12px", border: "1px solid #ddd4c2", borderRadius: 9, resize: "vertical", color: "#26281f", background: "#fafaf8", boxSizing: "border-box", outline: "none" }}
                />
              </div>

              {/* File input row */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <span style={{ fontSize: 11, color: "#a89f8f" }}>or</span>
                <button
                  onClick={() => fileRef.current?.click()}
                  style={{ background: "transparent", border: "1px solid #ddd4c2", color: "#52554e", padding: "6px 12px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif" }}>
                  Load from .json file
                </button>
                <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleFile} />
              </div>

              {/* Validation result */}
              {validation.kind === "errors" && (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 9, padding: "12px 14px", marginBottom: 14 }}>
                  {validation.errors.map((e, i) => (
                    <div key={i} style={{ fontSize: 12, color: "#b91c1c", marginTop: i > 0 ? 4 : 0 }}>· {e}</div>
                  ))}
                </div>
              )}

              {validation.kind === "valid" && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 9, padding: "10px 14px", marginBottom: validation.warnings.length > 0 ? 8 : 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#166534", marginBottom: 8 }}>
                      ✓ Parsed {validation.deals.length} deal{validation.deals.length !== 1 ? "s" : ""} successfully
                    </div>
                    {validation.deals.map((d, i) => {
                      const tenantCount = Array.isArray(d.tenants) ? d.tenants.length : 0;
                      const loc = [d.city, d.state].filter(Boolean).join(", ");
                      return (
                        <div key={i} style={{ fontSize: 11.5, color: "#2d6a4f", fontFamily: "monospace", marginTop: 3 }}>
                          ✓ {d.propertyName || d.fileName || `Deal ${i + 1}`}
                          {loc ? ` — ${loc}` : ""}
                          {tenantCount > 0 ? ` · ${tenantCount} tenant${tenantCount !== 1 ? "s" : ""}` : ""}
                          {formatSF(d.totalSF)}
                        </div>
                      );
                    })}
                  </div>
                  {validation.warnings.length > 0 && (
                    <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 9, padding: "10px 14px", marginBottom: 12 }}>
                      {validation.warnings.map((w, i) => (
                        <div key={i} style={{ fontSize: 11.5, color: "#92400e", marginTop: i > 0 ? 3 : 0 }}>⚠ {w}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Action row */}
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button
                  onClick={handleValidate}
                  style={{ background: "#383a37", border: "none", color: "#f6f2ea", padding: "10px 20px", borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                  Validate
                </button>
                {validation.kind === "valid" && (
                  <button
                    onClick={handleCreate}
                    style={{ background: "#6dba43", border: "none", color: "#1f2b16", padding: "10px 22px", borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                    Create {validation.deals.length} deal{validation.deals.length !== 1 ? "s" : ""}
                  </button>
                )}
                <button
                  onClick={onClose}
                  style={{ background: "transparent", border: "1px solid #e7e0d2", color: "#a89f8f", padding: "9px 16px", borderRadius: 9, cursor: "pointer", fontSize: 13, marginLeft: "auto" }}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
