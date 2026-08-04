// Client-safe mapping of the GSTIN lookup payload into wizard fields.
export interface GstinProfile {
  name: string;
  address: string;
  state: string;
  gstStatus: string; // "active" | "cancelled" | ""
}

function pick(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function joinAddress(a: Record<string, unknown>): string {
  const parts = [
    pick(a, ["bno", "building_number", "door"]),
    pick(a, ["bnm", "building_name"]),
    pick(a, ["st", "street"]),
    pick(a, ["loc", "locality", "location"]),
    pick(a, ["dst", "district", "city"]),
    pick(a, ["stcd", "state"]),
    pick(a, ["pncd", "pincode", "pin"]),
  ].filter(Boolean);
  return parts.join(", ");
}

/** Tolerant extractor — the upstream shape varies, so try the common keys. */
export function parseGstinProfile(payload: unknown): GstinProfile {
  const root = (payload ?? {}) as Record<string, unknown>;
  const data = ((root["data"] as Record<string, unknown>) ?? root) as Record<string, unknown>;

  const addrRaw =
    (data["pradr"] as Record<string, unknown> | undefined)?.["addr"] ??
    (data["pradr"] as Record<string, unknown> | undefined) ??
    data["address"];

  const address =
    typeof addrRaw === "string"
      ? addrRaw.trim()
      : addrRaw && typeof addrRaw === "object"
        ? joinAddress(addrRaw as Record<string, unknown>)
        : pick(data, ["adr", "principal_address"]);

  const statusRaw = pick(data, ["sts", "status", "gst_status"]).toLowerCase();
  const gstStatus = statusRaw.includes("cancel")
    ? "cancelled"
    : statusRaw.includes("active")
      ? "active"
      : "";

  const stateFromAddr =
    addrRaw && typeof addrRaw === "object"
      ? pick(addrRaw as Record<string, unknown>, ["stcd", "state"])
      : "";

  return {
    name: pick(data, ["tradeNam", "trade_name", "lgnm", "legal_name", "name"]),
    address,
    state: pick(data, ["stcd", "state"]) || stateFromAddr,
    gstStatus,
  };
}
