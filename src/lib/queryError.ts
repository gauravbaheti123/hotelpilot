import { toast } from "sonner";

/**
 * Phase 90 — centralised reporting for Supabase read failures.
 *
 * A PostgREST/RPC error that is destructured away (`const { data } = await …`)
 * renders as a silently empty list, which is how two schema-change regressions
 * (ambiguous FK embeds, PGRST201) stayed invisible until a user noticed missing
 * data. Every list/table/summary read must funnel its `error` through here so
 * the failure is loud: full detail in the console, a human message on screen.
 */
export interface QueryErrorLike {
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
}

// Avoid toast storms when a broken query is issued by several widgets at once.
const recent = new Map<string, number>();
const DEDUPE_MS = 4000;

export function reportQueryError(label: string, error: unknown): void {
  if (!error) return;

  const err = (error ?? {}) as QueryErrorLike;
  const message =
    (typeof err.message === "string" && err.message) ||
    (error instanceof Error ? error.message : "") ||
    "Unknown error";
  const code = typeof err.code === "string" && err.code ? ` [${err.code}]` : "";

  // eslint-disable-next-line no-console
  console.error(`[query] ${label} failed${code}`, {
    label,
    message,
    code: err.code ?? null,
    details: err.details ?? null,
    hint: err.hint ?? null,
    error,
  });

  if (typeof window === "undefined") return;

  const key = `${label}|${message}`;
  const now = Date.now();
  const last = recent.get(key);
  if (last && now - last < DEDUPE_MS) return;
  recent.set(key, now);

  toast.error(`Failed to load ${label}: ${message}`);
}
