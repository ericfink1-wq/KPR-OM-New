import React from "react";

interface State {
  hasError: boolean;
  message: string;
}

export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  State
> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(err: unknown): State {
    const e = err instanceof Error ? err : new Error(String(err));
    return { hasError: true, message: e.message };
  }

  componentDidCatch(err: unknown, info: React.ErrorInfo) {
    try {
      const e = err instanceof Error ? err : new Error(String(err));
      fetch("/api/client-errors", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: e.message.slice(0, 2000),
          stack: (e.stack ?? info.componentStack ?? "").slice(0, 8000),
          route: window.location.pathname + window.location.search,
          userAgent: navigator.userAgent.slice(0, 500),
        }),
      }).catch(() => undefined);
    } catch {
      // never throw from the error reporter
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    // When a `fallback` is provided, this boundary is wrapping a NON-critical
    // subtree (e.g. one panel) — render the quiet fallback instead of the
    // full-page error screen, so one widget's failure can't take down the page.
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", minHeight: "100vh", background: "#f6f2ea",
        fontFamily: "'Inter', sans-serif", padding: 32, boxSizing: "border-box",
      }}>
        <div style={{ maxWidth: 480, textAlign: "center" }}>
          <div style={{ fontSize: 42, marginBottom: 14 }}>⚠️</div>
          <h2 style={{
            fontFamily: "'Fraunces', serif", fontSize: 26, color: "#383a37",
            margin: "0 0 10px", fontWeight: 600,
          }}>
            Something went wrong
          </h2>
          <p style={{ fontSize: 14, color: "#7d766a", lineHeight: 1.65, margin: "0 0 28px" }}>
            An unexpected error occurred. It has been logged automatically — the team will look into it.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: "#6dba43", border: "none", color: "#fff",
              padding: "10px 28px", borderRadius: 8, cursor: "pointer",
              fontSize: 14, fontWeight: 600, fontFamily: "'Inter', sans-serif",
            }}
          >
            Reload the app
          </button>
        </div>
      </div>
    );
  }
}
