import { useState, useEffect } from "react";
import { useAiProgress, dismissAiTask, type AiTask } from "../lib/aiProgress";

// Single pinned progress indicator, mounted once at the app root. Shows every
// in-flight (and just-finished) AI action — running spinner + live elapsed time,
// a green check on success, a red warning on failure — on any page.

function elapsedSec(t: AiTask, now: number): number {
  return Math.max(0, Math.round(((t.endedAt ?? now) - t.startedAt) / 1000));
}

function Row({ task, now }: { task: AiTask; now: number }) {
  const { phase } = task;
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${phase === "error" ? "#f0c5c0" : phase === "done" ? "#b8d49a" : "#e3dccd"}`,
        borderRadius: 12,
        boxShadow: "0 10px 30px -8px rgba(56,58,55,0.28)",
        padding: "12px 16px",
        fontFamily: "'Inter',sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        {phase === "running" && (
          <span style={{ width: 14, height: 14, flexShrink: 0, border: "2px solid #d8cfbd", borderTopColor: "#3f7a1f", borderRadius: "50%", display: "inline-block", animation: "kprspin 0.7s linear infinite" }} />
        )}
        {phase === "done" && <span style={{ color: "#3f7a1f", fontSize: 15, lineHeight: 1 }}>✓</span>}
        {phase === "error" && <span style={{ color: "#dc2626", fontSize: 15, lineHeight: 1 }}>⚠</span>}
        <span style={{ fontSize: 12.5, color: phase === "error" ? "#b3261e" : "#383a37", fontWeight: 500, flex: 1, lineHeight: 1.35 }}>
          {task.label}
          {task.detail && <span style={{ color: "#a69e91", fontWeight: 400 }}> · {task.detail}</span>}
        </span>
        {phase === "running" && (
          <span style={{ fontSize: 11, color: "#a69e91", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{elapsedSec(task, now)}s</span>
        )}
        {phase !== "running" && (
          <button onClick={() => dismissAiTask(task.id)} style={{ background: "transparent", border: "none", color: "#a69e91", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
        )}
      </div>
      {phase === "running" && (
        <div style={{ marginTop: 9, height: 3, background: "#f1eadc", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: "40%", background: "#6dba43", borderRadius: 3, animation: "kprbar 1.2s ease-in-out infinite" }} />
        </div>
      )}
    </div>
  );
}

export default function AiProgressBar() {
  const tasks = useAiProgress();
  const [now, setNow] = useState(Date.now());

  // Tick once a second only while something is running, to drive the elapsed timer.
  const anyRunning = tasks.some((t) => t.phase === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [anyRunning]);

  if (tasks.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 84,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 600,
        width: "min(420px, calc(100vw - 32px))",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "auto",
      }}
    >
      {tasks.map((t) => <Row key={t.id} task={t} now={now} />)}
      <style>{`@keyframes kprspin{to{transform:rotate(360deg)}}@keyframes kprbar{0%{margin-left:-40%}100%{margin-left:100%}}`}</style>
    </div>
  );
}
