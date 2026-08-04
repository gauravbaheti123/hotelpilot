import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { verifyTotpLogin, markTotpVerified, clearTotpVerified } from "@/lib/totp";
import { toastError } from "@/lib/errorMessage";

export const Route = createFileRoute("/totp-challenge")({
  head: () => ({ meta: [{ title: "Two-factor sign-in — HotelPilot" }] }),
  component: TotpChallengePage,
});

function TotpChallengePage() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        navigate({ to: "/login", replace: true });
        return;
      }
      setUserId(data.user.id);
    });
  }, [navigate]);

  async function submit(value: string) {
    if (!userId || submittedRef.current) return;
    submittedRef.current = true;
    setBusy(true);
    try {
      const res = await verifyTotpLogin(userId, value);
      if (res.success) {
        markTotpVerified(userId);
        toast.success("Verified");
        navigate({ to: "/dashboard", replace: true });
        return;
      }
      if (res.locked && res.lockedUntil) setLockedUntil(res.lockedUntil);
      const msg = res.locked
        ? `Locked until ${new Date(res.lockedUntil!).toLocaleTimeString()}`
        : res.attemptsRemaining !== undefined
          ? `Invalid code — ${res.attemptsRemaining} attempts remaining`
          : (res.error ?? "Invalid code");
      toast.error(msg);
      setCode("");
    } catch (e) {
      toastError(e, "Verification failed");
    } finally {
      setBusy(false);
      submittedRef.current = false;
    }
  }

  function onChange(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6) submit(digits);
  }

  async function signOutAndBack() {
    clearTotpVerified();
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  }

  const locked = lockedUntil && new Date(lockedUntil).getTime() > Date.now();

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-3 justify-center">
          <Logo size={40} />
          <div className="font-semibold">HotelPilot</div>
        </div>
        <div className="text-center space-y-1">
          <h2 className="text-xl font-semibold">Two-factor verification</h2>
          <p className="text-sm text-muted-foreground">
            Enter the 6-digit code from your Authenticator app.
          </p>
        </div>
        <div className="space-y-3">
          <Label htmlFor="code" className="sr-only">Code</Label>
          <Input
            id="code"
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => onChange(e.target.value)}
            className="text-center text-2xl tracking-[0.5em] font-mono"
            placeholder="••••••"
            disabled={busy || !!locked}
          />
          {locked && (
            <p className="text-sm text-destructive text-center">
              Account locked until {new Date(lockedUntil!).toLocaleTimeString()}.
              Contact a superadmin to unlock.
            </p>
          )}
          <Button
            className="w-full" onClick={() => submit(code)}
            disabled={busy || code.length !== 6 || !!locked}
          >
            {busy ? "Verifying…" : "Verify"}
          </Button>
          <Button variant="ghost" className="w-full" onClick={signOutAndBack}>
            Cancel and sign out
          </Button>
        </div>
      </div>
    </div>
  );
}