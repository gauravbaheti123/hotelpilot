import { supabase } from "@/integrations/supabase/client";

const ALLOWED_MIME = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

export type DriveFolderType = "id_doc" | "kot_proof";

export interface DriveUploadResult {
  fileId: string;
  viewUrl: string;
}

/** Validate an image before upload. Throws on failure. */
export function validateDriveImage(file: File) {
  const type = (file.type || "").toLowerCase();
  const okType =
    ALLOWED_MIME.includes(type) ||
    /\.(jpe?g|png|webp)$/i.test(file.name);
  if (!okType) throw new Error("Only JPG, PNG, or WEBP images are allowed");
  if (file.size > MAX_BYTES) throw new Error("File exceeds 10MB");
}

/** Sanitize a component used in a filename. */
export function safeName(s: string) {
  return (s || "file").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60);
}

/** Upload a file to Google Drive via the upload-to-drive edge function. */
export async function uploadFileToDrive(
  file: File,
  folderType: DriveFolderType,
  fileName: string,
): Promise<DriveUploadResult> {
  validateDriveImage(file);
  const form = new FormData();
  form.append("file", file, fileName);
  form.append("folderType", folderType);
  form.append("fileName", fileName);

  const { data, error } = await supabase.functions.invoke("upload-to-drive", {
    body: form,
  });
  if (error) throw new Error(error.message || "Upload failed");
  const payload = data as { success?: boolean; fileId?: string; viewUrl?: string; error?: string } | null;
  if (!payload?.success || !payload.fileId || !payload.viewUrl) {
    throw new Error(payload?.error || "Upload failed");
  }
  return { fileId: payload.fileId, viewUrl: payload.viewUrl };
}