import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, FileCheck2, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { uploadToDrive, isDriveConfigured } from "@/lib/googleDrive";

interface Props {
  propertyId: string;
  propertyName: string;
  guestId?: string | null;
  bookingId?: string | null;
  guestName: string;
  existingUrl?: string | null;
  onUploaded?: (info: { url: string; name: string }) => void;
}

export function IdDocumentUploader({
  propertyId, propertyName, guestId, bookingId, guestName, existingUrl, onUploaded,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(existingUrl ?? null);

  async function handle(file: File) {
    if (!isDriveConfigured()) {
      return toast.error("Google Drive not configured. Add VITE_GOOGLE_CLIENT_ID and VITE_GOOGLE_API_KEY.");
    }
    if (!guestName.trim()) return toast.error("Enter guest name first");
    setBusy(true);
    try {
      const res = await uploadToDrive(file, propertyName, guestName, bookingId ?? "new");
      setUrl(res.viewUrl);
      onUploaded?.({ url: res.viewUrl, name: file.name });

      if (guestId) {
        await supabase.from("guests").update({
          id_document_url: res.viewUrl,
          id_document_name: file.name,
          id_document_uploaded_at: new Date().toISOString(),
        } as any).eq("id", guestId);

        await supabase.from("guest_documents").insert({
          property_id: propertyId,
          guest_id: guestId,
          booking_id: bookingId ?? null,
          document_name: file.name,
          drive_file_id: res.fileId,
          drive_view_url: res.viewUrl,
          drive_folder_path: res.folderPath,
        } as any);
      }
      toast.success("ID uploaded to Google Drive");
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <Label className="text-xs">ID Document (Google Drive)</Label>
      <div className="flex items-center gap-2">
        <Input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handle(f);
          }}
        />
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {!busy && url && (
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-emerald-600">
            <FileCheck2 className="h-3 w-3" /> View <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      {!isDriveConfigured() && (
        <p className="text-[10px] text-muted-foreground">
          <Upload className="inline h-3 w-3 mr-0.5" />
          Drive not configured — uploads disabled.
        </p>
      )}
    </div>
  );
}