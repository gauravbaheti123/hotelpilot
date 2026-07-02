import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { generateTotpSecret, verifyAndEnableTotp } from "@/lib/totp";
import { Copy, ShieldCheck } from "lucide-react";

interface UserProps {
  userId: string;
  email: string;
  name: string;
  enabled: boolean;
  lockedUntil: string | null;
  createdAt: string | null;
}

export function Manage2FADialog({ user, onClose }: { user: UserProps; onClose: () => void }) {
  const [phase, setPhase] = useState<"overview" | "setup">(user.enabled ? "overview" : "overview");
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const locked = !!user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now();

  async function startGenerate() {
    setBusy(true);
    try {
      const res = await generateTotpSecret(user.userId);
      setSecret(res.secret);
      setQrSvg(res.qrCodeSvg);
      setCode("");
      setPhase("setup");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to generate secret");
    } finally { setBusy(false); }
  }

  async function submitVerify() {
    if (code.length !== 6) return toast.error("Enter the 6-digit code");
    setBusy(true);
    try {
      const ok = await verifyAndEnableTotp(user.userId, code);
      if (!ok) { toast.error("Invalid code — ask the user to try again"); return; }
      toast.success("2FA activated");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Verification failed");
    } finally { setBusy(false); }
  }

  async function disable2FA() {
    if (!confirm(`This will remove 2FA protection for ${user.name || user.email}. Continue?`)) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("user_totp_secrets")
        .update({ enabled: false, failed_attempts: 0, locked_until: null })
        .eq("user_id", user.userId);
      if (error) throw error;
      toast.success("2FA disabled");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to disable");
    } finally { setBusy(false); }
  }

  async function unlock() {
    setBusy(true);
    try {
      const { error } = await supabase.from("user_totp_secrets")
        .update({ failed_attempts: 0, locked_until: null })
        .eq("user_id", user.userId);
      if (error) throw error;
      toast.success("Unlocked");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to unlock");
    } finally { setBusy(false); }
  }

  async function copySecret() {
    if (!secret) return;
    try { await navigator.clipboard.writeText(secret); toast.success("Secret copied"); }
    catch { toast.error("Copy failed"); }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Manage 2FA — {user.name || user.email}
          </DialogTitle>
          <DialogDescription>
            Admin-issued TOTP for Google Authenticator, Authy, 1Password and similar apps.
          </DialogDescription>
        </DialogHeader>

        {phase === "overview" && (
          <div className="space-y-3">
            {locked && (
              <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm">
                Locked until {new Date(user.lockedUntil!).toLocaleString()} after failed attempts.
                <div className="pt-2">
                  <Button size="sm" variant="outline" onClick={unlock} disabled={busy}>
                    Unlock now
                  </Button>
                </div>
              </div>
            )}
            {user.enabled ? (
              <div className="text-sm">
                <div className="font-medium text-green-700">Active</div>
                {user.createdAt && (
                  <div className="text-muted-foreground">
                    Since {new Date(user.createdAt).toLocaleDateString()}
                  </div>
                )}
                <div className="pt-3 flex gap-2">
                  <Button variant="outline" onClick={startGenerate} disabled={busy}>
                    Regenerate secret
                  </Button>
                  <Button variant="destructive" onClick={disable2FA} disabled={busy}>
                    Disable 2FA
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-sm space-y-3">
                <p className="text-muted-foreground">
                  Not enabled. Generate a secret and ask the user to scan the QR code with their
                  Authenticator app, then confirm with a 6-digit code.
                </p>
                <Button onClick={startGenerate} disabled={busy}>
                  Generate 2FA Secret
                </Button>
              </div>
            )}
          </div>
        )}

        {phase === "setup" && secret && qrSvg && (
          <div className="space-y-3">
            <div className="flex justify-center">
              <div
                className="bg-white p-2 rounded border"
                style={{ width: 220, height: 220 }}
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Secret (for manual entry)</Label>
              <div className="flex gap-2">
                <Input readOnly value={secret} className="font-mono text-xs" />
                <Button type="button" size="icon" variant="outline" onClick={copySecret}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                This secret is shown only once. Save it somewhere secure if you need to share it manually.
              </p>
            </div>
            <div className="space-y-1">
              <Label>
                Ask the user to scan this QR code now, then enter the code from their app here to confirm
              </Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                placeholder="6-digit code"
                className="font-mono text-center tracking-widest"
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPhase("overview")} disabled={busy}>Back</Button>
              <Button onClick={submitVerify} disabled={busy || code.length !== 6}>
                {busy ? "Verifying…" : "Verify & activate"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}