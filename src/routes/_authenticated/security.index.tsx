import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ShieldAlert, Loader2, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentProperty } from "@/hooks/use-property";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/security/")({
  component: SecurityPage,
});

const TABLE_OPTIONS: { key: string; label: string; danger?: boolean }[] = [
  { key: "payments", label: "Payments (cash transactions)" },
  { key: "folio_charges", label: "Folio Charges (food/room charges)" },
  { key: "kot_orders", label: "KOT Orders (food orders)" },
  { key: "guests", label: "Guests (name will be masked to 'Guest')" },
  { key: "expenses", label: "Expenses" },
  { key: "bookings", label: "Bookings", danger: true },
];

function fmtDate(d: Date) { return d.toISOString().slice(0, 10); }

function SecurityPage() {
  const { user, roles, loading: authLoading } = useAuth();
  const isOwner = roles.includes("owner") || roles.includes("superadmin");
  const isSuperadmin = roles.includes("superadmin");
  const { current } = useCurrentProperty();

  const today = new Date();
  const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);
  const [dateFrom, setDateFrom] = useState(fmtDate(weekAgo));
  const [dateTo, setDateTo] = useState(fmtDate(today));
  const [selected, setSelected] = useState<Record<string, boolean>>({
    payments: true, folio_charges: true, kot_orders: true, guests: true, expenses: true, bookings: false,
  });
  const [pct, setPct] = useState(100);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [working, setWorking] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [restoreOtp, setRestoreOtp] = useState("");
  const [restoreSent, setRestoreSent] = useState(false);

  function tablesSelected() {
    return Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
  }

  async function loadLogs() {
    const { data } = await (supabase as any).from("wipe_logs").select("*").order("wiped_at", { ascending: false }).limit(50);
    setLogs(data ?? []);
  }

  async function loadPreview() {
    const tables = tablesSelected();
    if (!tables.length) { setPreviewCount(0); return; }
    let total = 0;
    const fromTs = `${dateFrom}T00:00:00Z`;
    const toTs = `${dateTo}T23:59:59Z`;
    for (const t of tables) {
      let q: any = (supabase as any).from(t).select("id", { count: "exact", head: true }).gte("created_at", fromTs).lte("created_at", toTs).eq("is_wiped", false);
      if (current && t !== "folio_charges") q = q.eq("property_id", current.id);
      const { count } = await q;
      total += Math.floor(((count ?? 0) * pct) / 100);
    }
    setPreviewCount(total);
  }

  useEffect(() => { if (isOwner) loadLogs(); }, [isOwner]);
  useEffect(() => { if (isOwner) loadPreview(); /* eslint-disable-next-line */ }, [dateFrom, dateTo, JSON.stringify(selected), pct, current?.id]);

  function quickRange(days: number) {
    const to = new Date();
    const from = new Date(); from.setDate(to.getDate() - days);
    setDateFrom(fmtDate(from)); setDateTo(fmtDate(to));
  }

  async function startWipeFlow() {
    if (!tablesSelected().length) { toast.error("Select at least one table"); return; }
    setConfirmOpen(true);
    setOtp(""); setOtpSent(false);
    if (!user?.email) { toast.error("Owner email missing"); return; }
    const { error } = await supabase.auth.signInWithOtp({ email: user.email, options: { shouldCreateUser: false } });
    if (error) { toast.error("OTP send failed: " + error.message); return; }
    setOtpSent(true);
    toast.success(`OTP sent to ${user.email}`);
  }

  async function confirmWipe() {
    if (!otp.trim() || otp.length < 6) { toast.error("Enter 6-digit OTP"); return; }
    if (!user?.email) return;
    setWorking(true);
    try {
      const { error: vErr } = await supabase.auth.verifyOtp({ email: user.email, token: otp, type: "email" });
      if (vErr) throw new Error("OTP invalid: " + vErr.message);
      const { data, error } = await supabase.functions.invoke("execute-wipe", {
        body: {
          property_id: current?.id ?? null,
          date_from: dateFrom,
          date_to: dateTo,
          percentage: pct,
          tables: tablesSelected(),
        },
      });
      if (error) throw error;
      toast.success(`Wiped ${data?.records_wiped ?? 0} records`);
      setConfirmOpen(false);
      await loadLogs(); await loadPreview();
    } catch (e: any) {
      toast.error(e.message ?? "Wipe failed");
    } finally { setWorking(false); }
  }

  async function startRestore(id: string) {
    setRestoreId(id); setRestoreOtp(""); setRestoreSent(false);
    if (!user?.email) return;
    const { error } = await supabase.auth.signInWithOtp({ email: user.email, options: { shouldCreateUser: false } });
    if (error) { toast.error("OTP send failed: " + error.message); return; }
    setRestoreSent(true);
    toast.success(`OTP sent to ${user.email}`);
  }

  async function confirmRestore() {
    if (!restoreId || !user?.email) return;
    if (!restoreOtp.trim() || restoreOtp.length < 6) { toast.error("Enter 6-digit OTP"); return; }
    setWorking(true);
    try {
      const { error: vErr } = await supabase.auth.verifyOtp({ email: user.email, token: restoreOtp, type: "email" });
      if (vErr) throw new Error("OTP invalid: " + vErr.message);
      const { data, error } = await supabase.functions.invoke("restore-wipe", { body: { wipe_log_id: restoreId } });
      if (error) throw error;
      toast.success(`Restored ${data?.restored ?? 0} records`);
      setRestoreId(null);
      await loadLogs(); await loadPreview();
    } catch (e: any) {
      toast.error(e.message ?? "Restore failed");
    } finally { setWorking(false); }
  }

  if (authLoading) return <AppShell title="Security"><div className="p-6">Loading…</div></AppShell>;

  if (!isOwner) {
    throw redirect({ to: "/dashboard" });
  }

  return (
    <AppShell title="Security / Raid Protection">
      <div className="p-6 space-y-6 max-w-5xl">
        <Card className="border-2 border-destructive/60 bg-destructive/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-5 w-5" />
              Raid Protection — Wipe Front Data
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Hides selected transactional records from the front-end UI. Data remains safe in the backend archive and can be restored by a superadmin.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>Date From</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <Label>Date To</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Quick Select</Label>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => quickRange(7)}>7d</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => quickRange(15)}>15d</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => quickRange(30)}>30d</Button>
                </div>
              </div>
            </div>

            <div>
              <Label className="mb-2 block">Tables to Wipe</Label>
              <div className="space-y-2">
                {TABLE_OPTIONS.map((t) => (
                  <label key={t.key} className="flex items-center gap-3 text-sm">
                    <Checkbox
                      checked={!!selected[t.key]}
                      onCheckedChange={(v) => setSelected((s) => ({ ...s, [t.key]: !!v }))}
                    />
                    <span>{t.label}</span>
                    {t.danger && (
                      <Badge variant="destructive" className="text-[10px]">
                        <AlertTriangle className="h-3 w-3 mr-1" /> Dangerous
                      </Badge>
                    )}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Percentage to Wipe</Label>
                <span className="text-sm font-semibold">{pct}%</span>
              </div>
              <Slider min={10} max={100} step={5} value={[pct]} onValueChange={([v]) => setPct(v)} />
            </div>

            <div className="rounded-md bg-muted p-3 text-sm">
              Preview: This will hide approximately{" "}
              <span className="font-semibold text-destructive">{previewCount ?? "…"}</span> records.
            </div>

            <Button
              type="button"
              variant="destructive"
              size="lg"
              className="w-full text-base"
              onClick={startWipeFlow}
              disabled={working}
            >
              {working ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldAlert className="h-4 w-4 mr-2" />}
              CLEAR FRONT DATA
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Wipe History</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Tables</TableHead>
                  <TableHead>Records</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>%</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">No wipes yet</TableCell></TableRow>
                )}
                {logs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs">{new Date(l.wiped_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{(l.tables_selected ?? []).join(", ")}</TableCell>
                    <TableCell>{l.record_count}</TableCell>
                    <TableCell className="text-xs">{l.date_from} → {l.date_to}</TableCell>
                    <TableCell>{l.percentage}%</TableCell>
                    <TableCell>
                      {l.is_restored
                        ? <Badge variant="secondary">Restored</Badge>
                        : <Badge variant="destructive">Wiped</Badge>}
                    </TableCell>
                    <TableCell>
                      {!l.is_restored && isSuperadmin && (
                        <Button size="sm" variant="outline" onClick={() => startRestore(l.id)}>
                          <RotateCcw className="h-3 w-3 mr-1" /> Restore
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Wipe confirm dialog */}
      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!working) setConfirmOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2"><ShieldAlert className="h-5 w-5" /> Confirm Wipe</DialogTitle>
            <DialogDescription>
              This will hide the selected data from the front screen. Data remains safe in backend and can be restored by a superadmin.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm">
              An OTP has been sent to <span className="font-medium">{user?.email}</span>. Enter the 6-digit code to proceed.
            </div>
            <Input placeholder="6-digit OTP" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} />
            {!otpSent && <div className="text-xs text-muted-foreground">Sending OTP…</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={working}>Cancel</Button>
            <Button variant="destructive" onClick={confirmWipe} disabled={working || !otpSent}>
              {working && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Confirm Wipe
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore confirm dialog */}
      <Dialog open={!!restoreId} onOpenChange={(o) => { if (!working && !o) setRestoreId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><RotateCcw className="h-5 w-5" /> Restore Wiped Data</DialogTitle>
            <DialogDescription>
              Records hidden by this wipe will become visible again across the system.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm">
              An OTP has been sent to <span className="font-medium">{user?.email}</span>.
            </div>
            <Input placeholder="6-digit OTP" value={restoreOtp} onChange={(e) => setRestoreOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} />
            {!restoreSent && <div className="text-xs text-muted-foreground">Sending OTP…</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreId(null)} disabled={working}>Cancel</Button>
            <Button onClick={confirmRestore} disabled={working || !restoreSent}>
              {working && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Confirm Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}