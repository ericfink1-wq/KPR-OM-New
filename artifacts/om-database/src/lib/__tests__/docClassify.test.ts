import { describe, it, expect } from "vitest";
import { detectFlyer, applyDeterministicOverrides, hasOmSaleSignals, detectUnsupportedDoc } from "../docClassify";

// Real excerpt from the JLL "Trussville Promenade - Offering Memorandum.pdf" that
// was wrongly routed to the flyer path: it markets vacancy LEASE-UP as upside
// ("Currently Available for Lease Up") while carrying full sale financials.
const TRUSSVILLE_OM = `TRUSSVILLE PROMENADE  Birmingham, Alabama  Offering Memorandum
Investment Sales Advisors  JIM HAMILTON Senior Managing Director
Executive Summary  Property GLA 463,681 SF  Occupancy Incl. Regal: 96%
Financials As-Is-NOI: $4.3M  5-Yr CAGR: 3.95%
Multi-Pronged Upside Potential via Mark-to-Market, Lease Up, and Disposition Optionality
Eight suites available for immediate lease-up 15,787 SF  Currently Available for Lease Up
Vacancy Lease-Up  Disposition Optionality  OFFERING SUMMARY`;

const TRUSSVILLE_FILE = "JLL - Trussville Promenade - Offering Memorandum.pdf";

// A genuine leasing flyer: available space, a leasing contact, and NO sale financials.
const REAL_FLYER = `MAPLE PLAZA — NOW LEASING
Space Available: 1,200 - 5,000 SF available for lease
Join our co-tenants: Kroger, Starbucks, Chase.
Demographics: 45,000 population 3-mile.
For leasing information contact leasing@example.com`;
const FLYER_FILE = "Maple Plaza - Leasing Flyer.pdf";

describe("detectFlyer", () => {
  it("does NOT flag a full OM that markets lease-up upside (the Trussville regression)", () => {
    expect(detectFlyer(TRUSSVILLE_OM, TRUSSVILLE_FILE)).toBe(false);
  });

  it("does NOT flag a file titled Offering Memorandum even with a flyer-ish body", () => {
    expect(detectFlyer("space available for lease, contact leasing@x.com", "Foo - Offering Memorandum.pdf")).toBe(false);
    expect(detectFlyer("space available for lease", "Foo OM.pdf")).toBe(false);
  });

  it("does NOT flag when unambiguous sale signals are present, regardless of 'for lease' text", () => {
    expect(detectFlyer("Asking Price $50,000,000. Cap Rate 6.5%. Space available for lease.", "teaser.pdf")).toBe(false);
    expect(detectFlyer("Net Operating Income $4,300,000. For lease: suite 12.", "package.pdf")).toBe(false);
  });

  it("still flags a genuine leasing flyer (no sale financials)", () => {
    expect(detectFlyer(REAL_FLYER, FLYER_FILE)).toBe(true);
    // Body-only cue (filename neutral) on a doc with no sale signals.
    expect(detectFlyer("Space available for lease at the center.", "handout.pdf")).toBe(true);
  });
});

describe("applyDeterministicOverrides", () => {
  it("keeps an OM as 'om' even though its body says 'for lease' (regression)", () => {
    expect(applyDeterministicOverrides("om", TRUSSVILLE_OM, TRUSSVILLE_FILE, 42)).toBe("om");
  });

  it("flips an LLM 'flyer' misfire to 'om' when the document is long", () => {
    // Even if the model guessed flyer and the body had a flyer cue, a 40-page doc
    // is a full package, not a one-pager.
    expect(applyDeterministicOverrides("flyer", REAL_FLYER, FLYER_FILE, 40)).toBe("om");
  });

  it("flips an LLM 'flyer' misfire to 'om' when sale signals are present, even if short/unknown length", () => {
    // The LLM directly said 'flyer' — detectFlyer never runs — but sale signals win.
    expect(applyDeterministicOverrides("flyer", TRUSSVILLE_OM, TRUSSVILLE_FILE, 3)).toBe("om");
    expect(applyDeterministicOverrides("flyer", TRUSSVILLE_OM, TRUSSVILLE_FILE, null)).toBe("om");
    expect(applyDeterministicOverrides("flyer", TRUSSVILLE_OM, TRUSSVILLE_FILE, undefined)).toBe("om");
  });

  it("leaves a genuinely short flyer as 'flyer'", () => {
    expect(applyDeterministicOverrides("flyer", REAL_FLYER, FLYER_FILE, 2)).toBe("flyer");
    // And promotes an 'om' guess on a short marketing one-pager with flyer cues.
    expect(applyDeterministicOverrides("om", REAL_FLYER, FLYER_FILE, 1)).toBe("flyer");
  });

  it("does not disturb non-flyer types", () => {
    expect(applyDeterministicOverrides("rent-roll", "tenant sf rent", "rentroll.xlsx", 3)).toBe("rent-roll");
    expect(applyDeterministicOverrides("sales", "tenant sales psf", "sales.pdf", 4)).toBe("sales");
  });
});

describe("hasOmSaleSignals (shared source of truth for the router gate)", () => {
  it("detects the sale signals in the Trussville OM", () => {
    expect(hasOmSaleSignals(TRUSSVILLE_OM)).toBe(true);
  });
  it("is false for a pure leasing flyer", () => {
    expect(hasOmSaleSignals(REAL_FLYER)).toBe(false);
  });
  it("handles empty/nullish input", () => {
    expect(hasOmSaleSignals("")).toBe(false);
    expect(hasOmSaleSignals(undefined as unknown as string)).toBe(false);
  });
});

// Advisory detection for documents the site can't build from — must catch a raw
// lease and an REA, but NEVER a real OM, rent roll, or leasing flyer (which the
// site handles), so it can only ever HELP, never block a supported upload.
const RAW_LEASE = `RETAIL LEASE AGREEMENT
THIS LEASE AGREEMENT is made and entered into by and between Maple Plaza Owner LLC ("Landlord")
and Sunrise Nails LLC ("Tenant"). WITNESSETH, in consideration of the mutual covenants herein,
Landlord leases to Tenant the Demised Premises (Suite 120). Commencement Date: the Base Rent
shall be $28.00 per square foot. Term of this Lease: ten (10) years.`;
const LEASE_FILE = "Sunrise Nails - Fully Executed Lease.pdf";

const THIRD_AMENDMENT = `THIRD AMENDMENT TO LEASE
This Third Amendment to Lease is entered into between Landlord and Tenant, amending the base
rent and extending the term. The Tenant shall pay minimum rent as set forth herein.`;
const AMENDMENT_FILE = "620-00072 - Third Amendment.pdf";

const REA_DOC = `DECLARATION OF COVENANTS, CONDITIONS AND RESTRICTIONS AND RECIPROCAL EASEMENT AGREEMENT
This Reciprocal Easement Agreement is made among the parties owning parcels within the shopping
center, granting cross easements for ingress, egress, parking and common area maintenance.`;
const REA_FILE = "Rockaway - REA.pdf";

describe("detectUnsupportedDoc (advisory only — never blocks a supported upload)", () => {
  it("flags a raw executed lease", () => {
    const r = detectUnsupportedDoc(RAW_LEASE, LEASE_FILE);
    expect(r?.kind).toBe("lease");
  });
  it("flags a lease amendment (named by store number, no tenant in the title)", () => {
    expect(detectUnsupportedDoc(THIRD_AMENDMENT, AMENDMENT_FILE)?.kind).toBe("lease");
  });
  it("flags an REA / easement / CC&R document", () => {
    expect(detectUnsupportedDoc(REA_DOC, REA_FILE)?.kind).toBe("rea");
  });
  it("does NOT flag a real sale OM (the guard that protects every real upload)", () => {
    expect(detectUnsupportedDoc(TRUSSVILLE_OM, TRUSSVILLE_FILE)).toBeNull();
  });
  it("does NOT flag a leasing flyer or a rent roll", () => {
    expect(detectUnsupportedDoc(REAL_FLYER, FLYER_FILE)).toBeNull();
    expect(detectUnsupportedDoc("Tenant SF Rent LeaseStart LeaseEnd  Kroger 45000 12.00", "Rent Roll.xlsx")).toBeNull();
  });
});
