import { describe, it, expect, afterEach } from "vitest";
import { scrubForViewer, restoreHidden, keepHiddenOnSave, isDocOwner, docPrivacyMiddleware, scrubText, HIDDEN } from "../docPrivacy";

const DRIVE_ID = "1AbCdEfGh2IjKlMnOp3QrStUvWx4YzAbCd";   // 34 chars, Drive-shaped
const loan = {
  id: "loan:abc123", kind: "loan", dealId: "d1",
  sourceNote: `Loan summary — https://drive.google.com/file/d/${DRIVE_ID}/view`,
  data: {
    lender: "BankUnited", currentBalance: 26_000_000, loanLabel: "Senior",
    notes: `Rate per term sheet (docs.google.com/document/d/${DRIVE_ID}/edit). Extension needs 60 days notice.`,
    openQuestions: `Confirm swap confirm in folder ${DRIVE_ID}`,
    missingDocs: ["Executed swap confirmation", "https://kprcenters.sharepoint.com/sites/Debt/Shared%20Documents/Pointe.pdf"],
    sources: [
      { title: "Loan Agreement", docType: "Loan agreement", date: "2021-03-01", status: "Executed", url: `https://drive.google.com/file/d/${DRIVE_ID}/view`, usedFor: ["balance", "spread"] },
      { title: "Lender statement", docType: "Statement", status: "Statement", url: "https://lenderportal.example.com/stmt/9", usedFor: ["balance"] },
    ],
    sourceDocs: [{ id: DRIVE_ID, name: "Loan Agreement.pdf" }],
  },
};
const owner = { userId: "usr_owner", userEmail: "efink@kprcenters.com" };
const andy = { userId: "usr_andy", userEmail: "afrank@kprcenters.com" };

describe("who counts as Eric", () => {
  afterEach(() => { delete process.env.OWNER_EMAIL; delete process.env.DOC_LINK_OWNER_EMAILS; });
  it("the seeded owner account and the owner email only", () => {
    expect(isDocOwner({ userId: "usr_owner" })).toBe(true);
    expect(isDocOwner({ email: "EFink@KPRcenters.com " })).toBe(true);
    expect(isDocOwner({ userId: "usr_andy", email: "afrank@kprcenters.com" })).toBe(false);
    expect(isDocOwner({ email: "deisenberg@kprcenters.com" })).toBe(false);
    expect(isDocOwner(null)).toBe(false);
    expect(isDocOwner({})).toBe(false);
  });
  it("OWNER_EMAIL / DOC_LINK_OWNER_EMAILS name additional addresses", () => {
    process.env.DOC_LINK_OWNER_EMAILS = "eric@example.com, other@example.com";
    expect(isDocOwner({ email: "eric@example.com" })).toBe(true);
    process.env.OWNER_EMAIL = "boss@kprcenters.com";
    expect(isDocOwner({ email: "boss@kprcenters.com" })).toBe(true);
    expect(isDocOwner({ email: "efink@kprcenters.com" })).toBe(false); // default replaced
  });
});

describe("non-owner responses are scrubbed", () => {
  const out = scrubForViewer(loan);
  const text = JSON.stringify(out);
  it("no Drive / SharePoint link or Drive id survives anywhere", () => {
    expect(text).not.toMatch(/drive\.google|docs\.google|sharepoint/i);
    expect(text).not.toContain(DRIVE_ID);
  });
  it("sources keep title, type, date, status, used-for — never the url (any host)", () => {
    expect(out.data.sources).toEqual([
      { title: "Loan Agreement", docType: "Loan agreement", date: "2021-03-01", status: "Executed", usedFor: ["balance", "spread"] },
      { title: "Lender statement", docType: "Statement", status: "Statement", usedFor: ["balance"] },
    ]);
    expect("sourceDocs" in out.data).toBe(false);
  });
  it("free text keeps its words, links replaced", () => {
    expect(out.sourceNote).toBe(`Loan summary — ${HIDDEN}`);
    expect(out.data.notes).toBe(`Rate per term sheet (${HIDDEN}). Extension needs 60 days notice.`);
    expect(out.data.openQuestions).toBe(`Confirm swap confirm in folder ${HIDDEN}`);
    expect(out.data.missingDocs).toEqual(["Executed swap confirmation", HIDDEN]);
  });
  it("ids, numbers, public links, images and file names are left alone", () => {
    expect(out.id).toBe("loan:abc123");
    expect(out.data.currentBalance).toBe(26_000_000);
    const deal = scrubForViewer({
      id: "kpr-sold-bolton-plaza", fileName: "Powell-Center-Lewis-Center-OH-OM_v2", dealIds: ["AbCdEfGhIjKlMnOpQrStUvWx12345"],
      marketSale: { sources: [{ url: "https://www.costar.com/article/123", title: "CoStar" }] },
      cover: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk",
      leaseAbstract: { documents: [{ name: "Lease", fileId: DRIVE_ID }] },
      siteAgreement: { sourceDocs: [{ name: "REA", fileId: DRIVE_ID }] },
    });
    expect(deal.fileName).toBe("Powell-Center-Lewis-Center-OH-OM_v2");
    expect(deal.dealIds).toEqual(["AbCdEfGhIjKlMnOpQrStUvWx12345"]);
    expect(deal.marketSale.sources[0].url).toBe("https://www.costar.com/article/123");
    expect(deal.cover).toMatch(/^data:image\/png;base64,iVBOR/);
    expect(deal.leaseAbstract.documents).toEqual([{ name: "Lease" }]);
    expect("sourceDocs" in deal.siteAgreement).toBe(false);
  });
  it("any key naming a drive / file / doc id is dropped, even list-shaped (driveFileIds leaked live)", () => {
    const o = scrubForViewer({ driveFileIds: [DRIVE_ID], loanDocIds: ["x"], docId: "abc", sharepointUrl: "x", folder_id: "y", dealIds: ["d1"], bldgIds: ["brunswic"], fileName: "OM.pdf", sourceNote: `n ${DRIVE_ID}` });
    expect(Object.keys(o).sort()).toEqual(["bldgIds", "dealIds", "fileName", "sourceNote"]);
    expect(o.sourceNote).toBe(`n ${HIDDEN}`);
    const back = restoreHidden(o, { driveFileIds: [DRIVE_ID], loanDocIds: ["x"], docId: "abc", sharepointUrl: "x", folder_id: "y", dealIds: ["d1"], bldgIds: ["brunswic"], fileName: "OM.pdf", sourceNote: `n ${DRIVE_ID}` });
    expect(back.driveFileIds).toEqual([DRIVE_ID]); expect(back.sourceNote).toBe(`n ${DRIVE_ID}`);
  });
  it("never mutates the stored copy", () => {
    expect(loan.data.sources[0].url).toContain(DRIVE_ID);
    expect(loan.data.sourceDocs).toHaveLength(1);
  });
  it("text detector: Drive ids yes; words, hashes, UUIDs no", () => {
    expect(scrubText(`see ${DRIVE_ID} please`)).toBe(`see ${HIDDEN} please`);
    expect(scrubText("0B7x2Kq9ZpLmNoPqRsTuVwXyZ12")).toBe(HIDDEN);
    expect(scrubText("sha 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08")).toContain("9f86d0");
    expect(scrubText("id 123e4567-e89b-12d3-a456-426614174000")).toContain("123e4567");
    expect(scrubText("Amortization schedule: IO to 1/15/2030, then 30-yr")).toBe("Amortization schedule: IO to 1/15/2030, then 30-yr");
    expect(scrubText("https://1drv.ms/b/s!AbC123")).toBe(HIDDEN);
  });
});

describe("the owner sees everything; the middleware decides per account", () => {
  const run = (session: { userId: string; userEmail: string }, path = "/am/records") => {
    let sent: unknown;
    const res = { json: (b: unknown) => { sent = b; return b; } };
    docPrivacyMiddleware({ path, session }, res, () => {});
    res.json({ records: [loan] });
    return sent as { records: typeof loan[] };
  };
  it("owner: urls, sourceDocs and links all present", () => {
    const r = run(owner).records[0];
    expect(r.data.sources[0].url).toContain(DRIVE_ID);
    expect(r.data.sourceDocs).toHaveLength(1);
    expect(r.sourceNote).toContain("drive.google.com");
  });
  it("non-owner: none of them", () => {
    const r = run(andy).records[0];
    expect(r.data.sources.every(x => !("url" in x))).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/drive\.google|sharepoint|1AbCdEfGh/i);
  });
  it("credential endpoints are never rewritten (a token shown once must stay intact)", () => {
    let sent: unknown;
    const res = { json: (b: unknown) => { sent = b; return b; } };
    docPrivacyMiddleware({ path: "/mcp-keys", session: andy }, res, () => {});
    res.json({ note: `x ${DRIVE_ID}` });
    expect(JSON.stringify(sent)).toContain(DRIVE_ID);
  });
});

describe("a non-owner's save keeps Eric's hidden values", () => {
  const seen = scrubForViewer(loan);
  it("unchanged copy saved back → stored links all restored", () => {
    const back = restoreHidden(seen, loan);
    expect(back).toEqual(loan);
  });
  it("edited text keeps the hidden link in place; new edits stick", () => {
    const edited = { ...seen, data: { ...seen.data, notes: seen.data.notes + " Andy: confirmed with lender.", lender: "BankUnited N.A." } };
    const back = restoreHidden(edited, loan);
    expect(back.data.notes).toBe(`${loan.data.notes} Andy: confirmed with lender.`);
    expect(back.data.lender).toBe("BankUnited N.A.");
    expect(back.data.sources[0].url).toBe(loan.data.sources[0].url);
    expect(back.data.sourceDocs).toEqual(loan.data.sourceDocs);
  });
  it("a source Andy removed stays removed; reordering matches by title", () => {
    const edited = { ...seen, data: { ...seen.data, sources: [seen.data.sources[1]] } };
    const back = restoreHidden(edited, loan);
    expect(back.data.sources).toEqual([loan.data.sources[1]]);
  });
  it("the owner's save is taken as-is (so Eric can remove a link)", () => {
    const noLink = { ...loan, data: { ...loan.data, sources: [{ ...loan.data.sources[0], url: undefined }] } };
    expect(keepHiddenOnSave(owner, noLink, loan)).toBe(noLink);
    expect(keepHiddenOnSave(andy, seen, loan)).toEqual(loan);
  });
});
