import { useState, useEffect } from "react";
import { curatedTenantDescription, curatedParentDescription, getTenantDescription, getParentDescription } from "../lib/tenantDescriptions";

// A brief 2-3 sentence description of a tenant brand or parent company, shown in
// the header of the Tenant / Parent-Company analytics pages. Curated blurbs render
// instantly; anything else is filled by a cached AI fallback (so it loads once).
export default function EntityDescription({ name, kind }: { name: string; kind: "tenant" | "parent" }) {
  const curated = kind === "tenant" ? curatedTenantDescription(name) : curatedParentDescription(name);
  const [text, setText] = useState<string | null>(curated);
  const [loading, setLoading] = useState(curated == null);

  useEffect(() => {
    let cancelled = false;
    const c = kind === "tenant" ? curatedTenantDescription(name) : curatedParentDescription(name);
    if (c != null) { setText(c); setLoading(false); return; }
    setLoading(true);
    setText(null);
    (kind === "tenant" ? getTenantDescription(name) : getParentDescription(name))
      .then(d => { if (!cancelled) { setText(d); setLoading(false); } })
      .catch(() => { if (!cancelled) { setText(null); setLoading(false); } });
    return () => { cancelled = true; };
  }, [name, kind]);

  if (loading) {
    return <div style={{ fontSize:12.5, color:"#bcae97", fontStyle:"italic", margin:"6px 0 2px", maxWidth:680 }}>Loading description…</div>;
  }
  if (!text) return null;
  return (
    <div style={{ fontSize:12.5, color:"#7d766a", lineHeight:1.55, margin:"6px 0 2px", maxWidth:680 }}>{text}</div>
  );
}
