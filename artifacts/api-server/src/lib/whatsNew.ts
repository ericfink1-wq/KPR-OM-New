// "What's new" — deciding how far back to summarise for one reader.
//
// The rule the client applies is "show me everything shipped after CUTOFF". This
// picks that cutoff. It is a pure function so the decision can be tested without a
// database, which matters because every branch here is a way to get it wrong in a
// direction the user notices: too early and they are handed months of notes they
// have already read, too late and a change is silently never announced.

export interface CutoffInput {
  /** When this account was last SHOWN the list. Null if never. */
  seenAt?: Date | string | null;
  /**
   * The previous successful sign-in — i.e. the last time they were here BEFORE the
   * session asking the question. Used only when seenAt is null, which is the case
   * for everyone the first time this feature exists.
   */
  previousLoginAt?: Date | string | null;
  /** Now. Injected so tests don't race the clock. */
  now?: Date;
}

export interface CutoffResult {
  /** ISO instant, or null when we genuinely cannot say (a brand-new account). */
  cutoff: string | null;
  /** Which input produced it — surfaced to the client so the modal can word its subtitle honestly. */
  basis: "seen" | "previous-login" | "none";
}

export function whatsNewCutoff(input: CutoffInput): CutoffResult {
  const now = input.now ?? new Date();
  const seen = toDate(input.seenAt);
  const prev = toDate(input.previousLoginAt);

  // A stored "seen" timestamp is the truth: this person has been shown the list and
  // told us where they got to. It wins even when it is OLDER than their last login —
  // being here is not the same as having read the notes.
  if (seen) return { cutoff: clamp(seen, now).toISOString(), basis: "seen" };

  // Nobody has a seen-timestamp the first time this ships, so fall back to the
  // question actually asked: what changed since I was last logged in.
  if (prev) return { cutoff: clamp(prev, now).toISOString(), basis: "previous-login" };

  // A brand-new account with no prior session. Showing them the entire history as
  // "new since you were away" would be a lie, so show nothing and let the first
  // dismissal set their baseline.
  return { cutoff: null, basis: "none" };
}

/** A clock-skewed or corrupt future timestamp would hide every entry forever. */
function clamp(d: Date, now: Date): Date {
  return d.getTime() > now.getTime() ? now : d;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
