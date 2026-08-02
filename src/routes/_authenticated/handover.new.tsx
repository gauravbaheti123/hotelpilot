import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { useAuth } from "@/hooks/use-auth";
import { usePaymentMethods, formatPaymentMethodLabel } from "@/hooks/use-payment-methods";
import { AppShell } from "@/components/AppShell";
import { RequirePermission } from "@/components/RequirePermission";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { userDisplayName } from "@/lib/activityLog";
import { fmtINR } from "@/lib/reportExports";

export const Route = createFileRoute("/_authenticated/handover/new")({
  head: () => ({ meta: [{ title: "Shift Handover — HotelPilot" }] }),
  component: () => (
    <RequirePermission module="shift_handover" action="create">
      <StartHandoverPage />
    </RequirePermission>
  ),
});

interface LineRow {
  mode: string;
  system_total: number;
  manual_entry: string; // input state as string
  note: string;
}

interface StaffOpt { id: string; name: string; }

function StartHandoverPage() {
  const { currentId: propertyId, current } = useCurrentProperty();
  const { user } = useAuth();
  const { methods } = usePaymentMethods(propertyId);
  const navigate = useNavigate();

  const [windowStart, setWindowStart] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [staffList, setStaffList] = useState<StaffOpt[]>([]);
  const [incomingUserId, setIncomingUserId] = useState<string>("none");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Load window start (last handover time or start of today)
  useEffect(() => {
    if (!propertyId) return;
    (async () => {
      const { data, error } = await supabase.rpc("last_handover_window_start" as any, {
        _property_id: propertyId,
      } as any);
      if (error) { toast.error(error.message); return; }
      setWindowStart(data as unknown as string);
    })();
  }, [propertyId]);

  // Load staff for "incoming manager" dropdown
  useEffect(() => {
    supabase.from("profiles").select("user_id,full_name,email").limit(500).then(({ data }) => {
      const list = ((data ?? []) as any[])
        .map((p) => ({ id: p.user_id, name: p.full_name ?? p.email ?? p.user_id.slice(0, 6) }))
        .filter((s) => s.id !== user?.id);
      setStaffList(list);
    });
  }, [user?.id]);

  // Compute per-mode system totals since window_start
  useEffect(() => {
    if (!propertyId || !windowStart || methods.length === 0) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("mode,amount")
        .eq("property_id", propertyId)
        .gte("paid_at", windowStart);
      if (cancelled) return;
      setLoading(false);
      if (error) { toast.error(error.message); return; }
      const totals = new Map<string, number>();
      for (const p of ((data ?? []) as any[])) {
        const m = (p.mode ?? "").toString();
        totals.set(m, (totals.get(m) ?? 0) + Number(p.amount ?? 0));
      }
      const active = methods.filter((m) => m.is_active);
      setLines(active.map((m) => ({
        mode: m.name,
        system_total: totals.get(m.name) ?? 0,
        manual_entry: "",
        note: "",
      })));
    })();
    return () => { cancelled = true; };
  }, [propertyId, windowStart, methods]);

  const totals = useMemo(() => {
    let sys = 0, man = 0, diff = 0;
    for (const l of lines) {
      sys += l.system_total;
      const manual = Number(l.manual_entry || 0);
      man += manual;
      diff += manual - l.system_total;
    }
    return { sys, man, diff };
  }, [lines]);

  function updateLine(i: number, patch: Partial<LineRow>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function submit() {
    if (!propertyId || !user || !windowStart) return;

    // Validate mismatch reason mandatory
    for (const l of lines) {
      const manual = Number(l.manual_entry);
      if (l.manual_entry === "" || Number.isNaN(manual)) {
        return toast.error(`Enter counted amount for ${formatPaymentMethodLabel(l.mode)}`);
      }
      const d = Number((manual - l.system_total).toFixed(2));
      if (Math.abs(d) > 0.009 && !l.note.trim()) {
        return toast.error(`Note required for ${formatPaymentMethodLabel(l.mode)} — difference ₹${d.toFixed(2)}`);
      }
    }

    const incomingId = incomingUserId === "none" ? null : incomingUserId;
    const incomingName = incomingId
      ? staffList.find((s) => s.id === incomingId)?.name ?? null
      : null;

    setSaving(true);
    const { data: h, error } = await supabase
      .from("shift_handovers")
      .insert({
        property_id: propertyId,
        outgoing_user_id: user.id,
        outgoing_user_name: userDisplayName(user as any),
        incoming_user_id: incomingId,
        incoming_user_name: incomingName,
        window_start: windowStart,
        total_system: totals.sys,
        total_manual: totals.man,
        total_difference: totals.diff,
        notes: notes.trim() || null,
      } as any)
      .select("id")
      .maybeSingle();
    if (error || !h) { setSaving(false); return toast.error(error?.message ?? "Failed to create handover"); }

    const lineRows = lines.map((l) => {
      const manual = Number(l.manual_entry);
      return {
        handover_id: (h as any).id,
        mode: l.mode,
        system_total: l.system_total,
        manual_entry: manual,
        difference: Number((manual - l.system_total).toFixed(2)),
        note: l.note.trim() || null,
      };
    });
    const { error: lErr } = await supabase.from("shift_handover_lines").insert(lineRows as any);
    setSaving(false);
    if (lErr) return toast.error(lErr.message);

    toast.success("Handover submitted");
    navigate({ to: "/reports/cash-handover" });
  }

  if (!propertyId) return <AppShell title="Shift Handover"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="Shift Handover">
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm uppercase tracking-wider">Cash Reconciliation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div>
                <Label className="text-xs">Property</Label>
                <div className="font-medium">{current?.name ?? "—"}</div>
              </div>
              <div>
                <Label className="text-xs">Outgoing Manager</Label>
                <div className="font-medium">{userDisplayName(user as any)}</div>
              </div>
              <div>
                <Label className="text-xs">Window Start</Label>
                <div className="font-medium">
                  {windowStart ? new Date(windowStart).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                </div>
              </div>
              <div>
                <Label className="text-xs">Incoming Manager (optional)</Label>
                <Select value={incomingUserId} onValueChange={setIncomingUserId}>
                  <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Not assigned —</SelectItem>
                    {staffList.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">Overall Notes (optional)</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Handover summary, key events…" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm uppercase tracking-wider">Payment Mode Reconciliation</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <p className="p-4 text-sm text-muted-foreground">Loading system totals…</p>
            ) : lines.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No active payment methods configured.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-2 text-left">Payment Mode</th>
                      <th className="px-3 py-2 text-right">System Auto Total</th>
                      <th className="px-3 py-2 text-right">Manual Entry</th>
                      <th className="px-3 py-2 text-right">Difference</th>
                      <th className="px-3 py-2 text-left">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {lines.map((l, i) => {
                      const manual = Number(l.manual_entry || 0);
                      const diff = Number((manual - l.system_total).toFixed(2));
                      const mismatch = l.manual_entry !== "" && Math.abs(diff) > 0.009;
                      const noteMissing = mismatch && !l.note.trim();
                      return (
                        <tr key={l.mode} className={mismatch ? "bg-rose-50/50" : ""}>
                          <td className="px-3 py-2 font-medium">{formatPaymentMethodLabel(l.mode)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtINR(l.system_total)}</td>
                          <td className="px-3 py-2 text-right">
                            <Input
                              type="number" step="0.01"
                              value={l.manual_entry}
                              onChange={(e) => updateLine(i, { manual_entry: e.target.value })}
                              className="ml-auto block w-32 text-right tabular-nums"
                              style={{ textAlign: "right" }}
                            />
                          </td>
                          <td className={`px-3 py-2 text-right tabular-nums ${mismatch ? "text-rose-700 font-semibold" : "text-muted-foreground"}`}>
                            {l.manual_entry === "" ? "—" : (diff > 0 ? "+" : "") + fmtINR(diff)}
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              value={l.note}
                              onChange={(e) => updateLine(i, { note: e.target.value })}
                              placeholder={mismatch ? "Reason required" : "Optional"}
                              className={noteMissing ? "border-rose-400 focus-visible:ring-rose-400" : ""}
                            />
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 bg-muted/30 font-semibold">
                      <td className="px-3 py-2">Totals</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtINR(totals.sys)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtINR(totals.man)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${Math.abs(totals.diff) > 0.009 ? "text-rose-700" : ""}`}>
                        {(totals.diff > 0 ? "+" : "") + fmtINR(totals.diff)}
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            <Badge variant="outline" className="mr-2">Immutable</Badge>
            Submitted handovers can only be modified by Owner/Superadmin via override.
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate({ to: "/reports/cash-handover" })}>Cancel</Button>
            <Button onClick={submit} disabled={saving || lines.length === 0}>
              {saving ? "Submitting…" : "Submit Handover"}
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}