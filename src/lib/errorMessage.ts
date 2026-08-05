/**
 * Phase 91 — one place that turns raw Supabase / PostgREST / edge-function /
 * network errors into language a hotel receptionist can act on.
 *
 * Primary message = plain English. Raw text (codes, constraint names, hints)
 * is kept as a small "details" line for support, never as the headline.
 */
import { toast } from "sonner";

export interface RawErrorLike {
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
  status?: number | null;
  name?: string | null;
  error?: unknown;
  context?: unknown;
}

export interface HumanError {
  /** Human-readable headline shown to the user. */
  message: string;
  /** Raw technical text, for the small print / console only. */
  details?: string;
}

const GENERIC = (action?: string) =>
  action
    ? `Something went wrong while ${action}. Please try again, and contact support if this keeps happening.`
    : "Something went wrong. Please try again, and contact support if this keeps happening.";

/** Lowercase the leading verb-phrase used inside the generic sentence. */
function normalizeAction(action?: string): string | undefined {
  if (!action) return undefined;
  const a = action.trim().replace(/[.!]+$/, "");
  if (!a) return undefined;
  // "Failed to load invoices" / "Could not assign room" → "loading invoices"
  const m = a.match(/^(?:failed to|could not|couldn'?t|unable to|cannot|can't)\s+(.*)$/i);
  const phrase = m ? m[1] : a;
  return phrase.charAt(0).toLowerCase() + phrase.slice(1);
}

function raw(error: unknown): RawErrorLike {
  if (!error) return {};
  if (typeof error === "string") return { message: error };
  return error as RawErrorLike;
}

function textOf(e: RawErrorLike): string {
  return [e.message, e.details, e.hint].filter(Boolean).join(" | ").toLowerCase();
}

function detailsOf(e: RawErrorLike): string | undefined {
  const parts = [
    e.code ? `code ${e.code}` : "",
    typeof e.message === "string" ? e.message : "",
    typeof e.details === "string" ? e.details : "",
    typeof e.hint === "string" ? e.hint : "",
  ].filter(Boolean);
  const s = parts.join(" — ").trim();
  return s || undefined;
}

/** Known constraint / trigger names → plain language. */
const CONSTRAINT_MESSAGES: Array<[RegExp, string]> = [
  [/guests?_mobile|mobile.*unique|unique.*mobile/, "A guest with this mobile number already exists."],
  [/booking.*overlap|overlap.*booking|room.*overlap|no_overlapping|daterange|tstzrange|exclusion/, "This room is already booked for these dates. Pick a different room or change the dates."],
  [/bill_number|invoice_number|_bill_no/, "A bill with this number already exists. Refresh and try again."],
  [/room_number|rooms_.*_key.*number/, "A room with this number already exists for this property."],
  [/email/, "This email address is already in use."],
  [/gstin/, "This GSTIN is already registered."],
];

function constraintMessage(text: string): string | undefined {
  for (const [re, msg] of CONSTRAINT_MESSAGES) if (re.test(text)) return msg;
  return undefined;
}

/**
 * Translate any thrown/returned error into a human message (+ raw details).
 * `action` describes what the user was doing, e.g. "loading invoices",
 * "saving the booking" — an existing fallback string like
 * "Failed to load invoices" is also accepted and normalized.
 */
export function humanizeError(error: unknown, action?: string): HumanError {
  const e = raw(error);
  const text = textOf(e);
  const code = (typeof e.code === "string" ? e.code : "") || "";
  const act = normalizeAction(action);
  const details = detailsOf(e);

  // Network / connectivity
  if (
    /failed to fetch|networkerror|network request failed|load failed|err_internet|err_network|fetch failed|timeout|timed out|aborted/.test(text) ||
    e.name === "AbortError" ||
    e.name === "TypeError" && /fetch/.test(text)
  ) {
    return { message: "Couldn't connect. Check your internet connection and try again.", details };
  }

  // Auth / session
  if (code === "PGRST301" || e.status === 401 || /jwt expired|invalid jwt|not authenticated|no api key|invalid refresh token/.test(text)) {
    return { message: "Your session has expired. Please sign in again.", details };
  }

  // Permission / RLS
  if (
    code === "42501" ||
    e.status === 403 ||
    /row-level security|violates row level|permission denied|not authorized|unauthorized|insufficient privilege|access denied/.test(text)
  ) {
    // Server-side RAISE with a written-for-humans sentence: show it verbatim.
    const own = typeof e.message === "string" ? e.message.trim() : "";
    if (
      own &&
      /^[A-Z]/.test(own) &&
      /\s/.test(own) &&
      !/row-level security|violates|permission denied for|prest|pgrst/i.test(own)
    ) {
      return { message: own, details };
    }
    return {
      message: "You don't have permission to do this. Contact your Owner/Admin if you think this is a mistake.",
      details,
    };
  }

  // Constraint violations
  if (code === "23505" || /duplicate key|already exists/.test(text)) {
    return { message: constraintMessage(text) ?? "This record already exists. Check for a duplicate entry.", details };
  }
  if (code === "23P01" || /conflicting key value violates exclusion/.test(text)) {
    return { message: constraintMessage(text) ?? "This conflicts with an existing booking for the same dates.", details };
  }
  if (code === "23503" || /foreign key constraint/.test(text)) {
    return {
      message: "This item is linked to other records, so it can't be changed or removed right now.",
      details,
    };
  }
  if (code === "23502" || /null value in column/.test(text)) {
    return { message: "A required field is missing. Please fill in all mandatory fields and try again.", details };
  }
  if (code === "23514" || /check constraint/.test(text)) {
    return { message: "Some of the values entered aren't allowed. Please review the form and try again.", details };
  }
  if (code === "22P02" || code === "42804" || /invalid input syntax|invalid input value/.test(text)) {
    return { message: "One of the values entered isn't in the expected format. Please review and try again.", details };
  }
  if (constraintMessage(text) && /violates|constraint|conflict/.test(text)) {
    return { message: constraintMessage(text)!, details };
  }

  // Schema / query configuration problems (PGRST2xx, missing column/table)
  if (/^PGRST/.test(code) || code === "42703" || code === "42P01" || /could not embed|more than one relationship|schema cache/.test(text)) {
    return {
      message: `We couldn't load this data because of a system configuration issue${act ? ` while ${act}` : ""}. Please refresh, and contact support if it persists.`,
      details,
    };
  }

  // Empty / unknown
  if (!text) return { message: GENERIC(act), details };

  // Raised by our own DB functions with a readable message — surface as-is when
  // it looks like prose rather than a Postgres/HTTP diagnostic.
  const msg = typeof e.message === "string" ? e.message.trim() : "";
  const looksTechnical =
    /non-2xx|edge function|pgrst|violates|relation ".*" does not exist|syntax error|unexpected token|\[object|stack|at .*\(.*:\d+:\d+\)/i.test(msg) ||
    !/[a-z]/.test(msg) ||
    msg.length > 180;
  if (msg && !looksTechnical) return { message: msg, details: details === msg ? undefined : details };

  return { message: GENERIC(act), details };
}

/** Convenience: just the human sentence. */
export function errorMessage(error: unknown, action?: string): string {
  return humanizeError(error, action).message;
}

/**
 * Supabase `functions.invoke` surfaces only "Edge Function returned a non-2xx
 * status code". The real reason lives in the response body — pull it out.
 */
export async function resolveEdgeError(error: unknown, action?: string): Promise<HumanError> {
  const e = raw(error);
  const ctx = e.context as { json?: () => Promise<unknown>; text?: () => Promise<string>; status?: number } | undefined;
  if (ctx && (typeof ctx.json === "function" || typeof ctx.text === "function")) {
    try {
      let body: unknown = null;
      if (typeof ctx.json === "function") body = await ctx.json();
      else if (typeof ctx.text === "function") body = await ctx.text();
      const b = (typeof body === "string" ? { error: body } : (body ?? {})) as { error?: string; message?: string; details?: string };
      const reason = b.error || b.message;
      if (reason) return humanizeError({ message: reason, details: b.details, status: ctx.status }, action);
    } catch {
      /* body already consumed or not JSON — fall through */
    }
  }
  if (/non-2xx/i.test(String(e.message ?? ""))) {
    return {
      message: GENERIC(normalizeAction(action)),
      details: detailsOf(e),
    };
  }
  return humanizeError(error, action);
}

/** Standard error toast: human headline + small raw-detail line. */
export function toastError(error: unknown, action?: string): void {
  const { message, details } = humanizeError(error, action);
  // eslint-disable-next-line no-console
  console.error(`[error] ${action ?? "operation"} failed`, error);
  toast.error(message, details ? { description: details } : undefined);
}

/** Async variant that unwraps edge-function response bodies first. */
export async function toastEdgeError(error: unknown, action?: string): Promise<void> {
  const { message, details } = await resolveEdgeError(error, action);
  // eslint-disable-next-line no-console
  console.error(`[error] ${action ?? "edge function"} failed`, error);
  toast.error(message, details ? { description: details } : undefined);
}
