import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Camera, Check, Loader2, Eye, Download, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { uploadFileToDrive, validateDriveImage, safeName, driveFileExtension, logDriveUploadFailure } from "@/lib/driveUpload";

const BUCKET = "kot-delivery-proofs";

interface Props {
  kotId: string;
  propertyId: string | null | undefined;
  proofUrl: string | null;
  takenAt: string | null;
  takenBy: string | null;
  onSaved?: () => void;
  compact?: boolean;
  kotNumber?: string | null;
}

/** Renders a signed URL preview, capture button, and viewer for a KOT delivery proof. */
export function DeliveryProof({ kotId, propertyId, proofUrl, takenAt, takenBy, onSaved, compact, kotNumber }: Props) {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [signed, setSigned] = useState<string | null>(null);
  const [viewOpen, setViewOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!proofUrl) { setSigned(null); return; }
    // Google Drive (or any absolute URL) is used directly; legacy bucket
    // paths still resolve via a signed URL for backwards compatibility.
    if (/^https?:\/\//i.test(proofUrl)) { setSigned(proofUrl); return; }
    (async () => {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(proofUrl, 60 * 60);
      if (!cancelled) setSigned(data?.signedUrl ?? null);
    })();
    return () => { cancelled = true; };
  }, [proofUrl]);

  async function handleFile(file: File) {
    if (!propertyId) { toast.error("No property selected"); return; }
    try { validateDriveImage(file); } catch (e: any) { toast.error(e.message); return; }
    setSaving(true);
    try {
      const ts = Date.now();
      const fileName = `KOT${safeName(kotNumber || kotId.slice(0, 8))}_${ts}.${driveFileExtension(file)}`;
      const res = await uploadFileToDrive(file, "kot_proof", fileName);
      const { error } = await supabase.from("kot_orders").update({
        delivery_proof_url: res.viewUrl,
        delivery_photo_taken_at: new Date().toISOString(),
        delivery_photo_taken_by: user?.id ?? null,
      }).eq("id", kotId);
      if (error) throw error;
      toast.success("Delivery proof captured");
      onSaved?.();
    } catch (e: any) {
      await logDriveUploadFailure(e, { stage: "persist", folderType: "kot_proof", file, extra: { kotId } });
      toast.error(e.message ?? "Upload failed");
    } finally {
      setSaving(false);
    }
  }

  const hasProof = !!proofUrl;

  if (compact) {
    return (
      <div className="inline-flex items-center gap-1">
        {hasProof ? (
          <button type="button" onClick={() => setViewOpen(true)}
            className="inline-flex items-center gap-1 text-[11px] text-emerald-700 hover:underline">
            <Camera className="h-3 w-3" /> Proof ✓
          </button>
        ) : (
          <>
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Camera className="h-3 w-3" /> No proof
            </span>
            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]"
              disabled={saving} onClick={() => inputRef.current?.click()}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Capture"}
            </Button>
          </>
        )}
        <input ref={inputRef} type="file" accept="image/*" capture="environment"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.currentTarget.value = ""; }} />
        <ProofDialog open={viewOpen} onOpenChange={setViewOpen} signed={signed} takenAt={takenAt} />
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-3 bg-card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Camera className="h-4 w-4" /> Delivery Proof
          {hasProof && <span className="inline-flex items-center gap-1 text-emerald-700 text-xs"><Check className="h-3 w-3" /> Captured</span>}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant={hasProof ? "outline" : "default"}
            disabled={saving} onClick={() => inputRef.current?.click()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : hasProof ? <RotateCcw className="h-4 w-4 mr-1" /> : <Camera className="h-4 w-4 mr-1" />}
            {hasProof ? "Retake" : "Capture Delivery Photo"}
          </Button>
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/*" capture="environment"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.currentTarget.value = ""; }} />

      {hasProof && (
        <div className="mt-3 flex items-start gap-3">
          {signed ? (
            <button type="button" onClick={() => setViewOpen(true)} className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={signed} alt="Delivery proof" className="h-24 w-24 object-cover rounded border" />
            </button>
          ) : (
            <div className="h-24 w-24 rounded border bg-muted animate-pulse" />
          )}
          <div className="text-xs text-muted-foreground space-y-1">
            {takenAt && <div>Captured: {new Date(takenAt).toLocaleString()}</div>}
            {takenBy && <div className="truncate max-w-[220px]">By: {takenBy}</div>}
            <div className="flex gap-2 pt-1">
              <Button size="sm" variant="outline" className="h-7" onClick={() => setViewOpen(true)}>
                <Eye className="h-3 w-3 mr-1" /> View
              </Button>
              {signed && (
                <a href={signed} download target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline" className="h-7">
                    <Download className="h-3 w-3 mr-1" /> Download
                  </Button>
                </a>
              )}
            </div>
          </div>
        </div>
      )}
      <ProofDialog open={viewOpen} onOpenChange={setViewOpen} signed={signed} takenAt={takenAt} />
    </div>
  );
}

function ProofDialog({ open, onOpenChange, signed, takenAt }: {
  open: boolean; onOpenChange: (v: boolean) => void; signed: string | null; takenAt: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-[95vw]">
        <DialogHeader><DialogTitle>Delivery Proof</DialogTitle></DialogHeader>
        {signed ? (
          <img src={signed} alt="Delivery proof full" className="w-full h-auto rounded" />
        ) : (
          <div className="h-64 bg-muted animate-pulse rounded" />
        )}
        {takenAt && <div className="text-xs text-muted-foreground">Captured {new Date(takenAt).toLocaleString()}</div>}
      </DialogContent>
    </Dialog>
  );
}