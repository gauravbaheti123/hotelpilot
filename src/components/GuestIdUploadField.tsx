import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, FolderOpen, FileText, X } from "lucide-react";
import { driveThumbnailUrl, type ExistingIdDoc } from "@/lib/guestIdLookup";

export interface SelectedIdFile {
  file: File;
  previewUrl: string | null;
}

interface Props {
  value: SelectedIdFile | null;
  onChange: (next: SelectedIdFile | null) => void;
  disabled?: boolean;
  /** Previously uploaded ID for a matched returning guest (Phase 21). */
  existingDoc?: ExistingIdDoc | null;
  existingGuestName?: string | null;
  /** True when staff chose to reuse the existing document. */
  reuseExisting?: boolean;
  onReuseChange?: (next: boolean) => void;
}

/**
 * Two-button ID document selector (camera + file picker). Holds the chosen
 * File in parent state — actual upload is deferred until booking save.
 */
export function GuestIdUploadField({
  value, onChange, disabled, existingDoc, existingGuestName, reuseExisting, onReuseChange,
}: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function handlePicked(f: File | undefined) {
    if (!f) return;
    setError(null);
    if (f.size > 10 * 1024 * 1024) {
      setError("File too large (max 10 MB)");
      return;
    }
    const isImage = f.type.startsWith("image/");
    onReuseChange?.(false);
    onChange({
      file: f,
      previewUrl: isImage ? URL.createObjectURL(f) : null,
    });
  }

  function clear() {
    if (value?.previewUrl) URL.revokeObjectURL(value.previewUrl);
    onChange(null);
    if (cameraRef.current) cameraRef.current.value = "";
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold">ID Document (Optional)</div>
      {existingDoc && !value && (
        <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
          {driveThumbnailUrl(existingDoc.driveFileId) ? (
            <img
              src={driveThumbnailUrl(existingDoc.driveFileId)!}
              alt="Existing ID on file"
              className="h-14 w-14 rounded object-cover border bg-background"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="h-14 w-14 rounded border bg-background flex items-center justify-center">
              <FileText className="h-6 w-6 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate">
              Existing ID on file{existingGuestName ? ` for ${existingGuestName}` : ""}
              {existingDoc.uploadedAt
                ? ` — ${new Date(existingDoc.uploadedAt).toLocaleDateString("en-IN")}`
                : ""}
            </div>
            {existingDoc.documentName && (
              <div className="text-[11px] text-muted-foreground truncate">{existingDoc.documentName}</div>
            )}
            {existingDoc.driveViewUrl && (
              <a
                href={existingDoc.driveViewUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] underline text-muted-foreground"
              >
                View document
              </a>
            )}
            {reuseExisting && (
              <div className="text-[11px] text-emerald-600">Will be reused for this booking</div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={reuseExisting ? "secondary" : "default"}
              disabled={disabled}
              onClick={() => onReuseChange?.(!reuseExisting)}
            >
              {reuseExisting ? "Reusing" : "Use this"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => { onReuseChange?.(false); fileRef.current?.click(); }}
            >
              Replace
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => handlePicked(e.target.files?.[0])}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => handlePicked(e.target.files?.[0])}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera className="h-4 w-4 mr-1" /> Camera Capture
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => fileRef.current?.click()}
        >
          <FolderOpen className="h-4 w-4 mr-1" /> Upload File
        </Button>
      </div>
      {error && <div className="text-xs text-rose-600">{error}</div>}
      {value && (
        <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
          {value.previewUrl ? (
            <img
              src={value.previewUrl}
              alt="ID preview"
              className="h-14 w-14 rounded object-cover border"
            />
          ) : (
            <div className="h-14 w-14 rounded border bg-background flex items-center justify-center">
              <FileText className="h-6 w-6 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate">{value.file.name}</div>
            <div className="text-[11px] text-emerald-600">Ready to upload</div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={clear}
            disabled={disabled}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}