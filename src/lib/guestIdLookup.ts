import { supabase } from "@/integrations/supabase/client";

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
  doc: ExistingIdDoc | null;
}

/** Google Drive thumbnail URL for a file stored on Drive. */
export function driveThumbnailUrl(fileId: string | null | undefined) {
  return fileId ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w200` : null;
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
    const { data } = await supabase
      .from("guests")
      .select("id,name,mobile,id_proof_number,tags,id_document_url,id_document_name,id_document_uploaded_at")
      .eq("property_id", propertyId)
      .eq(a.col, a.val)
      .order("updated_at", { ascending: false })
      .limit(1);
    const g = (data ?? [])[0] as any;
    if (!g) continue;

    const { data: docs } = await supabase
      .from("guest_documents")
      .select("document_name,drive_file_id,drive_view_url,drive_folder_path,uploaded_at")
      .eq("guest_id", g.id)
      .order("uploaded_at", { ascending: false })
      .limit(1);
    const d = (docs ?? [])[0] as any;

    let doc: ExistingIdDoc | null = null;
    if (d?.drive_view_url || d?.drive_file_id) {
      doc = {
        documentName: d.document_name ?? null,
        driveFileId: d.drive_file_id ?? null,
        driveViewUrl: d.drive_view_url ?? null,
        driveFolderPath: d.drive_folder_path ?? null,
        uploadedAt: d.uploaded_at ?? null,
      };
    } else if (g.id_document_url) {
      doc = {
        documentName: g.id_document_name ?? null,
        driveFileId: null,
        driveViewUrl: g.id_document_url,
        driveFolderPath: null,
        uploadedAt: g.id_document_uploaded_at ?? null,
      };
    }

    return {
      guest: {
        id: g.id,
        name: g.name ?? null,
        mobile: g.mobile ?? null,
        idProofNumber: g.id_proof_number ?? null,
        guestType: ((g.tags ?? []) as string[]).includes("corporate")
          ? "corporate"
          : "regular",
      },
      matchedOn: a.matchedOn,
      doc,
    };
  }
  return null;
}
