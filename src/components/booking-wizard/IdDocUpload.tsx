// Part 2 — ID document upload for the New Booking wizard.
// Unlike the legacy deferred-upload field, this uploads to Drive immediately so
// the Drive thumbnail (driveThumbnailUrl) can be shown inline after success.
import { useRef, useState } from "react";
import { Camera, FolderOpen, FileText, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { driveThumbnailUrl } from "@/lib/guestIdLookup";
import {
  uploadFileToDrive, validateDriveImage, driveFileExtension, safeName, logDriveUploadFailure,
} from "@/lib/driveUpload";
import { errorMessage } from "@/lib/errorMessage";

export interface UploadedIdDoc {
  fileId: string | null;
  viewUrl: string | null;
  name: string | null;
}

interface Props {
  value: UploadedIdDoc;
  onChange: (next: UploadedIdDoc) => void;
  guestName?: string;
  disabled?: boolean;
}

export function IdDocUpload({ value, onChange, guestName, disabled }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePicked(f: File | undefined) {
    if (!f) return;
    setError(null);
    try {
      validateDriveImage(f);
    } catch (e: any) {
      setError(e?.message ?? "Unsupported file");
      void logDriveUploadFailure(e, { stage: "validation", folderType: "id_doc", file: f });
      return;
    }
    setBusy(true);
    try {
      const ext = driveFileExtension(f);
      const fileName = `${safeName(guestName || "Guest")}_${Date.now()}.${ext}`;
      const res = await uploadFileToDrive(f, "id_doc", fileName);
      onChange({ fileId: res.fileId, viewUrl: res.viewUrl, name: f.name });
    } catch (e: any) {
      setError(errorMessage(e, "uploading the ID document"));
    } finally {
      setBusy(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const thumb = driveThumbnailUrl(value.fileId);
  const has = Boolean(value.fileId || value.viewUrl);

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">ID Document (optional)</div>
      {has && (
        <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
          {thumb ? (
            <img
              src={thumb}
              alt={value.name ?? "Uploaded ID document"}
              loading="lazy"
              decoding="async"
              className="h-16 w-16 rounded border bg-background object-cover"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded border bg-background">
              <FileText className="h-6 w-6 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{value.name ?? "ID document"}</div>
            <div className="text-[11px] text-emerald-600">Uploaded to Drive</div>
            {value.viewUrl && (
              <a href={value.viewUrl} target="_blank" rel="noreferrer" className="text-[11px] underline text-muted-foreground">
                View document
              </a>
            )}
          </div>
          <Button
            type="button" size="icon" variant="ghost" disabled={disabled || busy}
            onClick={() => onChange({ fileId: null, viewUrl: null, name: null })}
            aria-label="Remove document"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={disabled || busy} onClick={() => cameraRef.current?.click()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
          Camera
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={disabled || busy} onClick={() => fileRef.current?.click()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderOpen className="mr-2 h-4 w-4" />}
          {has ? "Replace file" : "Choose file"}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <input
        ref={cameraRef} type="file" accept="image/*,application/pdf" capture="environment"
        className="hidden" onChange={(e) => void handlePicked(e.target.files?.[0])}
      />
      <input
        ref={fileRef} type="file" accept="image/*,application/pdf"
        className="hidden" onChange={(e) => void handlePicked(e.target.files?.[0])}
      />
    </div>
  );
}