// Server-only GSTIN lookup against gstinapi.in, with retry/backoff.
import { GSTIN_REGEX } from "@/lib/gstin";

const NO_RETRY = new Set([400, 401, 402, 403, 404]);
const RETRY = new Set([429, 502]);

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type JsonBody = { [key: string]: Json } | null;

export interface GstinLookupResult {
  status: number;
  body: JsonBody;
}

export function normalizeGstin(raw: string): string {
  return (raw ?? "").trim().toUpperCase();
}

export function isWellFormedGstin(value: string): boolean {
  return GSTIN_REGEX.test(value);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Calls the upstream API, retrying up to 2 extra times on 429/502. */
export async function lookupGstin(gstin: string, apiKey: string): Promise<GstinLookupResult> {
  const url = `https://www.gstinapi.in/v1/gstin/${encodeURIComponent(gstin)}`;
  let last: GstinLookupResult = { status: 502, body: { error: "Upstream unavailable" } };

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(400 * 2 ** (attempt - 1));

    let res: Response;
    try {
      res = await fetch(url, { method: "GET", headers: { "x-api-key": apiKey, accept: "application/json" } });
    } catch {
      last = { status: 502, body: { error: "Could not reach the GST lookup service." } };
      continue;
    }

    const text = await res.text();
    let body: JsonBody;
    try {
      body = text ? (JSON.parse(text) as JsonBody) : null;
    } catch {
      body = { error: text || "Unexpected response from GST lookup service." };
    }

    last = { status: res.status, body };
    if (NO_RETRY.has(res.status) || !RETRY.has(res.status)) return last;
  }
  return last;
}
