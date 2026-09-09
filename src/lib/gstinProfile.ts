// Client-safe mapping of the GSTIN lookup payload into wizard fields.
import { stateNameFromCode } from "@/lib/indiaGeo";

export interface GstinProfile {
  name: string;
  address: string;
  state: string;
  city: string;
  pincode: string;
  gstStatus: string; // "active" | "cancelled" | ""
}

/** First non-empty value among the given keys. Numbers (e.g. pincode) count. */
function pick(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

/** Case/punctuation-insensitive key used to avoid repeating a part. */
function normPart(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Builds the fullest possible address line.
 *
 * The upstream `address` string is often short — it drops the city, state and
 * pincode even though the API sends them in separate fields. So we start from
 * whatever pieces we have, in reading order, and append anything the short
 * line does not already contain.
 */
function buildAddress(base: string, parts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const v = (raw ?? "").trim().replace(/[,\s]+$/, "");
    if (!v) return;
    const key = normPart(v);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(v);
  };

  const baseLine = (base ?? "").trim().replace(/[,\s]+$/, "");
  if (baseLine) {
    push(baseLine);
    // Register the individual chunks of the short line so they aren't repeated.
    baseLine.split(",").forEach((c) => {
      const key = normPart(c);
      if (key) seen.add(key);
    });
  }
  parts.forEach(push);
  return out.join(", ");
}

/** Tolerant extractor — the upstream shape varies, so try the common keys. */
export function parseGstinProfile(payload: unknown): GstinProfile {
  const root = (payload ?? {}) as Record<string, unknown>;
  const data = ((root["data"] as Record<string, unknown>) ?? root) as Record<string, unknown>;

  const pradr = (data["pradr"] as Record<string, unknown> | undefined) ?? undefined;
  const addrObj =
    ((pradr?.["addr"] as Record<string, unknown> | undefined) ??
      (data["address_details"] as Record<string, unknown> | undefined) ??
      (typeof data["address"] === "object" ? (data["address"] as Record<string, unknown>) : undefined) ??
      pradr ??
      {}) as Record<string, unknown>;

  const baseLine =
    typeof data["address"] === "string"
      ? (data["address"] as string)
      : pick(data, ["adr", "principal_address"]) ||
        (typeof pradr?.["adr"] === "string" ? (pradr["adr"] as string) : "");

  const stateCode = pick(data, ["state_code", "stcd"]) || pick(addrObj, ["state_code", "stcd"]);
  const state =
    pick(data, ["state"]) ||
    pick(addrObj, ["state", "stcd"]) ||
    stateNameFromCode(stateCode) ||
    "";

  const city = pick(addrObj, ["city", "dst", "district"]) || pick(data, ["city", "district"]);
  const pincode = pick(addrObj, ["pincode", "pncd", "pin"]) || pick(data, ["pincode", "pncd", "pin"]);

  const address = buildAddress(baseLine, [
    pick(addrObj, ["bno", "building_number", "door"]),
    pick(addrObj, ["flno", "floor", "floor_number"]),
    pick(addrObj, ["bnm", "building_name"]),
    pick(addrObj, ["st", "street"]),
    pick(addrObj, ["landmark", "landMark"]),
    pick(addrObj, ["loc", "locality", "location"]),
    city,
    state,
    pincode,
  ]);

  const statusRaw = pick(data, ["sts", "status", "gst_status"]).toLowerCase();
  const gstStatus = statusRaw.includes("cancel")
    ? "cancelled"
    : statusRaw.includes("active")
      ? "active"
      : "";

  return {
    name: pick(data, ["tradeNam", "trade_name", "lgnm", "legal_name", "name"]),
    address,
    state,
    city,
    pincode,
    gstStatus,
  };
}

