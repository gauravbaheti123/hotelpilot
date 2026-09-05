import { supabase } from "@/integrations/supabase/client";
import { reportQueryError } from "@/lib/queryError";

export interface ExistingIdDoc {
  documentName: string | null;
  driveFileId: string | null;
  driveViewUrl: string | null;
  driveFolderPath: string | null;
  uploadedAt: string | null;
}

export interface GuestIdLookupResult {
  guest: {
    id: string;
    name: string | null;
    mobile: string | null;
    idProofNumber: string | null;
    /** Phase 29.6 — last saved guest type, for auto-fill on returning guests. */
    guestType: "regular" | "corporate" | null;
  };
  matchedOn: "mobile" | "id";
  /** Front side (legacy single-document uploads land here). */
  doc: ExistingIdDoc | null;
  /** Back side, when one was uploaded. */
  docBack: ExistingIdDoc | null;
}

/** Google Drive thumbnail URL for a file stored on Drive. */
export function driveThumbnailUrl(fileId: string | null | undefined) {
  return fileId ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w200` : null;
}

export interface GuestSearchHit {
  id: string;
  name: string;
  mobile: string | null;
  email: string | null;
  company: string | null;
}

/**
 * Full guest profile + stay stats, as needed by the New Booking guest picker.
 * Superset of {@link GuestSearchHit}.
 */
export interface GuestSearchDetail extends GuestSearchHit {
  dob: string | null;
  id_proof_type: string | null;
  id_proof_number: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  gst_number: string | null;
  tags: string[] | null;
  notes: string | null;
  visit_count: number;
  last_stay: string | null;
}

/**
 * Debounce-friendly guest search returning the full profile plus visit stats.
 * Single shared implementation for the "find existing guest" search boxes —
 * replaces the inline ilike query that used to live in front-desk.new.tsx.
 */
export async function searchGuestsDetailed(
  propertyId: string,
  query: string,
  limit = 8,
): Promise<GuestSearchDetail[]> {
  const q = (query ?? "").trim();
  if (q.length < 2) return [];
  const safe = q.replace(/[%,()]/g, " ");
  const like = `%${safe}%`;
  const { data, error } = await supabase
    .from("guests")
    .select(
      "id,name,mobile,email,dob,id_proof_type,id_proof_number,address,city,state,country,gst_number,company,tags,notes",
    )
    .eq("property_id", propertyId)
    .or(`name.ilike.${like},mobile.ilike.${like},email.ilike.${like}`)
    .limit(limit);
  if (error) return [];
  const guests = (data ?? []) as any[];
  if (!guests.length) return [];
  // One batched query for every hit instead of a fetch per guest.
  const { data: bks, error: __qe1 } = await supabase
    .from("bookings")
    .select("guest_id,check_in")
    .in("guest_id", guests.map((g) => g.id))
    .order("check_in", { ascending: false });
  if (__qe1) reportQueryError("bookings", __qe1);
  const byGuest = new Map<string, string[]>();
  for (const b of (bks ?? []) as any[]) {
    const list = byGuest.get(b.guest_id) ?? [];
    list.push(b.check_in);
    byGuest.set(b.guest_id, list);
  }
  return guests.map((g) => {
    const rows = byGuest.get(g.id) ?? [];
    return { ...g, visit_count: rows.length, last_stay: rows[0] ?? null } as GuestSearchDetail;
  });
}

/**
 * Debounce-friendly guest search by name or mobile (Phase 21 lookup pattern,
 * widened to partial matches). Returns [] for queries under 2 characters.
 */
export async function searchGuests(
  propertyId: string,
  query: string,
  limit = 8,
): Promise<GuestSearchHit[]> {
  const q = (query ?? "").trim();
  if (q.length < 2) return [];
  const safe = q.replace(/[%,()]/g, " ");
  const { data, error } = await supabase
    .from("guests")
    .select("id,name,mobile,email,company")
    .eq("property_id", propertyId)
    .or(`name.ilike.%${safe}%,mobile.ilike.%${safe}%`)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as GuestSearchHit[];
}

/**
 * Convenience defaults from a repeat guest's most recent booking, used to
 * prefill Bill-To / tariff / meal plan in the New Booking wizard. Returns
 * null when the guest has no past bookings.
 */
export interface LastBookingDefaults {
  billingCompanyId: string | null;
  /** Tariff plan id from the last booking room, plus its display name. */
  tariffId: string | null;
  planName: string | null;
  rate: number | null;
  mealPlan: string | null;
}

export async function fetchLastBookingDefaults(
  propertyId: string,
  guestId: string,
): Promise<LastBookingDefaults | null> {
  const { data: bk, error } = await supabase
    .from("bookings")
    .select("id,billing_company_id")
    .eq("property_id", propertyId)
    .eq("guest_id", guestId)
    .order("check_in", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !bk) return null;
  const booking = bk as any;

  const { data: room } = await supabase
    .from("booking_rooms")
    .select("tariff_id,rate,meal_plan")
    .eq("booking_id", booking.id)
    .order("check_in", { ascending: false })
    .limit(1)
    .maybeSingle();
  const br = room as any;

  let planName: string | null = null;
  if (br?.tariff_id) {
    const { data: plan } = await supabase
      .from("tariff_plans")
      .select("name")
      .eq("id", br.tariff_id)
      .maybeSingle();
    planName = (plan as any)?.name ?? null;
  }

  return {
    billingCompanyId: booking.billing_company_id ?? null,
    tariffId: br?.tariff_id ?? null,
    planName,
    rate: br?.rate != null ? Number(br.rate) : null,
    mealPlan: br?.meal_plan ?? null,
  };
}

/** Create a guest inline from a name + mobile pair. */
export async function createGuestQuick(
  propertyId: string,
  name: string,
  mobile: string,
): Promise<GuestSearchHit> {
  const { data, error } = await supabase
    .from("guests")
    .insert({ property_id: propertyId, name: name.trim(), mobile: mobile.trim() || null } as never)
    .select("id,name,mobile,email,company")
    .single();
  if (error) throw error;
  return data as GuestSearchHit;
}

/**
 * Find an existing guest by mobile (checked first) or ID/Aadhaar number, and
 * return their most recent previously uploaded ID document, if any.
 */
export async function lookupExistingGuestId(
  propertyId: string,
  mobile: string,
  idNumber: string,
): Promise<GuestIdLookupResult | null> {
  const m = (mobile ?? "").trim();
  const n = (idNumber ?? "").trim();

  const attempts: Array<{ col: "mobile" | "id_proof_number"; val: string; matchedOn: "mobile" | "id" }> = [];
  if (m.length === 10) attempts.push({ col: "mobile", val: m, matchedOn: "mobile" });
  if (n.length >= 6) attempts.push({ col: "id_proof_number", val: n, matchedOn: "id" });
  if (!attempts.length) return null;

  for (const a of attempts) {
    const { data, error: __qe2 } = await supabase
      .from("guests")
      .select("id,name,mobile,id_proof_number,tags,guest_type,id_document_url,id_document_name,id_document_uploaded_at,id_document_back_url,id_document_back_name,id_document_back_uploaded_at")
      .eq("property_id", propertyId)
      .eq(a.col, a.val)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (__qe2) reportQueryError("guests", __qe2);
    const g = (data ?? [])[0] as any;
    if (!g) continue;

    const { data: docs, error: __qe3 } = await supabase
      .from("guest_documents")
      .select("document_name,drive_file_id,drive_view_url,drive_folder_path,uploaded_at,side")
      .eq("guest_id", g.id)
      .order("uploaded_at", { ascending: false })
      .limit(10);
    if (__qe3) reportQueryError("guest documents", __qe3);
    const rows = (docs ?? []) as any[];
    const toDoc = (d: any): ExistingIdDoc | null =>
      d && (d.drive_view_url || d.drive_file_id)
        ? {
            documentName: d.document_name ?? null,
            driveFileId: d.drive_file_id ?? null,
            driveViewUrl: d.drive_view_url ?? null,
            driveFolderPath: d.drive_folder_path ?? null,
            uploadedAt: d.uploaded_at ?? null,
          }
        : null;

    let doc = toDoc(rows.find((r) => (r.side ?? "front") === "front"));
    let docBack = toDoc(rows.find((r) => r.side === "back"));
    if (!doc && g.id_document_url) {
      doc = {
        documentName: g.id_document_name ?? null,
        driveFileId: null,
        driveViewUrl: g.id_document_url,
        driveFolderPath: null,
        uploadedAt: g.id_document_uploaded_at ?? null,
      };
    }
    if (!docBack && g.id_document_back_url) {
      docBack = {
        documentName: g.id_document_back_name ?? null,
        driveFileId: null,
        driveViewUrl: g.id_document_back_url,
        driveFolderPath: null,
        uploadedAt: g.id_document_back_uploaded_at ?? null,
      };
    }

    return {
      guest: {
        id: g.id,
        name: g.name ?? null,
        mobile: g.mobile ?? null,
        idProofNumber: g.id_proof_number ?? null,
        guestType: (g as { guest_type?: string | null }).guest_type === "corporate"
          ? "corporate"
          : "regular",
      },
      matchedOn: a.matchedOn,
      doc,
      docBack,
    };
  }
  return null;
}
