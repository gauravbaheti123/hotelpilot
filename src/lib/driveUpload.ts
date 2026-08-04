import { supabase } from "@/integrations/supabase/client";
import { logClientError } from "@/lib/client-error-log";
import { resolveEdgeError } from "@/lib/errorMessage";

const ALLOWED_MIME = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
];
const MAX_BYTES = 10 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

export type DriveFolderType = "id_doc" | "kot_proof";

export interface DriveUploadResult {
  fileId: string;
  viewUrl: string;
}

/**
 * Validate a document/image before upload. Throws on failure.
 * Accepts everything the pickers allow: JPEG/PNG/WEBP/HEIC images and PDFs.
 * HEIC may not preview in-browser but uploads fine — Drive stores it correctly.
 */
export function validateDriveImage(file: File) {
  const type = (file.type || "").toLowerCase();
  const okType =
    ALLOWED_MIME.includes(type) ||
    // Some browsers report an empty type for camera/HEIC captures.
    type === "" ||
    /\.(jpe?g|png|webp|heic|heif|pdf)$/i.test(file.name);
  if (!okType) throw new Error("Only JPG, PNG, WEBP, HEIC images or PDF files are allowed");
  if (file.size > MAX_BYTES) throw new Error("File exceeds 10MB");
}

/** Derive the real file extension from MIME type, falling back to the filename. */
export function driveFileExtension(file: File): string {
  const type = (file.type || "").toLowerCase();
  if (EXT_BY_MIME[type]) return EXT_BY_MIME[type];
  const m = /\.([A-Za-z0-9]{2,5})$/.exec(file.name || "");
  if (m) return m[1].toLowerCase();
  return "bin";
}

/** Sanitize a component used in a filename. */
export function safeName(s: string) {
  return (s || "file").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60);
}

/** Persist a Drive upload failure with full detail so it is diagnosable later. */
export async function logDriveUploadFailure(
  error: unknown,
  ctx: { stage: "validation" | "upload" | "persist"; folderType?: string; file?: File | null; extra?: Record<string, unknown> },
) {
  await logClientError(error, {
    boundary: "drive-upload",
    extra: {
      stage: ctx.stage,
      folderType: ctx.folderType ?? null,
      fileName: ctx.file?.name ?? null,
      fileType: ctx.file?.type ?? null,
      fileSize: ctx.file?.size ?? null,
      ...(ctx.extra ?? {}),
    },
  });
}

/** Upload a file to Google Drive via the upload-to-drive edge function. */
export async function uploadFileToDrive(
  file: File,
  folderType: DriveFolderType,
  fileName: string,
): Promise<DriveUploadResult> {
  try {
    validateDriveImage(file);
  } catch (e) {
    await logDriveUploadFailure(e, { stage: "validation", folderType, file });
    throw e;
  }
  const form = new FormData();
  form.append("file", file, fileName);
  form.append("folderType", folderType);
  form.append("fileName", fileName);

  const { data, error } = await supabase.functions.invoke("upload-to-drive", {
    body: form,
  });
  if (error) {
    const err = new Error((await resolveEdgeError(error, "uploading the file")).message);
    await logDriveUploadFailure(err, { stage: "upload", folderType, file, extra: { invokeError: error.message } });
    throw err;
  }
  const payload = data as { success?: boolean; fileId?: string; viewUrl?: string; error?: string } | null;
  if (!payload?.success || !payload.fileId || !payload.viewUrl) {
    const err = new Error(payload?.error || "Upload failed (no fileId returned)");
    await logDriveUploadFailure(err, {
      stage: "upload",
      folderType,
      file,
      extra: { response: payload ?? null },
    });
    throw err;
  }
  return { fileId: payload.fileId, viewUrl: payload.viewUrl };
}