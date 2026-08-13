import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { fmtINR, fmtDateTime } from "@/lib/reportExports";
import {
  CASH_MODE, PETTY_TYPE_LABEL, buildCashBreakdown, fetchPreviousClosingCash,
  fetchUnreconciledCashExpenses, fetchUnreconciledPetty, pettySign,
  type CashExpenseRow, type PettyCashEntry,
} from "@/lib/pettyCash";
import { toastError } from "@/lib/errorMessage";

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

  // Petty cash / cash-expense reconciliation state
  const [openingCash, setOpeningCash] = useState("0");
  const [openingLocked, setOpeningLocked] = useState(false);
  const [petty, setPetty] = useState<PettyCashEntry[]>([]);
  const [cashExpenses, setCashExpenses] = useState<CashExpenseRow[]>([]);

  // Load window start (last handover time or start of today)
  useEffect(() => {
    if (!propertyId) return;
    (async () => {
      const { data, error } = await supabase.rpc("last_handover_window_start" as any, {
        _property_id: propertyId,
      } as any);
      if (error) { toastError(error); return; }
      setWindowStart(data as unknown as string);
    })();
  }, [propertyId]);

  // Carry the previous shift's closing float forward as this shift's opening.
  useEffect(() => {
    if (!propertyId) return;
    let cancelled = false;
    (async () => {
      const prev = await fetchPreviousClosingCash(propertyId);
      if (cancelled) return;
      if (prev === null) {
        // Very first shift for this property — editable once.
        setOpeningCash("0");
        setOpeningLocked(false);
      } else {
        setOpeningCash(String(prev));
        setOpeningLocked(true);
      }
    })();
    return () => { cancelled = true; };
  }, [propertyId]);

  // Pending petty cash entries + cash expenses inside the open window.
  useEffect(() => {
    if (!propertyId || !windowStart) return;
    let cancelled = false;
    (async () => {
      try {
        const [p, e] = await Promise.all([
          fetchUnreconciledPetty(propertyId),
          fetchUnreconciledCashExpenses(propertyId, windowStart),
        ]);
        if (cancelled) return;
        setPetty(p);
        setCashExpenses(e);
      } catch (err) {
        if (!cancelled) toast.error((err as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [propertyId, windowStart]);

  // Load staff for "incoming manager" dropdown.
  // Uses a security-definer RPC: profiles RLS only exposes your own row to
  // non-owner roles, so a direct profiles query returns an empty list.
  useEffect(() => {
    if (!propertyId) { setStaffList([]); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("list_property_staff" as any, {
        _property_id: propertyId,
      } as any);
      if (cancelled) return;
      if (error) { toastError(error); return; }
      const SELECTABLE = new Set(["manager", "receptionist", "owner", "superadmin"]);
      const byId = new Map<string, string>();
      for (const r of ((data ?? []) as any[])) {
        if (!SELECTABLE.has(String(r.role))) continue;
        if (r.user_id === user?.id) continue;
        if (!byId.has(r.user_id)) {
          byId.set(r.user_id, r.display_name ?? r.email ?? String(r.user_id).slice(0, 8));
        }
      }
      setStaffList(Array.from(byId.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)));
    })();
    return () => { cancelled = true; };
  }, [propertyId, user?.id]);

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
      if (error) { toastError(error); return; }
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

  const cashPayments = useMemo(
    () => lines.find((l) => l.mode === CASH_MODE)?.system_total ?? 0,
    [lines],
  );

  const cashBreak = useMemo(
    () => buildCashBreakdown(Number(openingCash || 0), cashPayments, petty, cashExpenses),
    [openingCash, cashPayments, petty, cashExpenses],
  );

  /** Expected figure for a line: cash uses the enriched formula, others unchanged. */
  const expectedFor = useCallback(
    (l: LineRow) => (l.mode === CASH_MODE ? cashBreak.expected : l.system_total),
    [cashBreak.expected],
  );

  const totals = useMemo(() => {
    let sys = 0, man = 0, diff = 0;
    for (const l of lines) {
      const expected = l.mode === CASH_MODE ? cashBreak.expected : l.system_total;
      sys += expected;
      const manual = Number(l.manual_entry || 0);
      man += manual;
      diff += manual - expected;
    }
    return { sys, man, diff };
  }, [lines, cashBreak.expected]);

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
      const d = Number((manual - expectedFor(l)).toFixed(2));
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
        window_end: new Date().toISOString(),
        opening_cash: cashBreak.opening,
        closing_cash: cashBreak.expected,
        total_system: totals.sys,
        total_manual: totals.man,
        total_difference: totals.diff,
        notes: notes.trim() || null,
      } as any)
      .select("id")
      .maybeSingle();
    if (error || !h) { setSaving(false); return toastError(error, "Failed to create handover"); }

    const lineRows = lines.map((l) => {
      const manual = Number(l.manual_entry);
      const expected = expectedFor(l);
      return {
        handover_id: (h as any).id,
        mode: l.mode,
        system_total: expected,
        manual_entry: manual,
        difference: Number((manual - expected).toFixed(2)),
        note: l.note.trim() || null,
      };
    });
    const { error: lErr } = await supabase.from("shift_handover_lines").insert(lineRows as any);
    if (lErr) { setSaving(false); return toastError(lErr); }

    // Mark everything folded into this window as reconciled so the next shift
    // does not double-count it.
    const handoverId = (h as any).id as string;
    if (petty.length > 0) {
      const { error: pErr } = await supabase
        .from("petty_cash_entries")
        .update({ handover_id: handoverId } as any)
        .in("id", petty.map((p) => p.id));
      if (pErr) toastError(pErr, "Petty cash not marked reconciled");
    }
    if (cashExpenses.length > 0) {
      const { error: eErr } = await supabase
        .from("expenses")
        .update({ handover_id: handoverId } as any)
        .in("id", cashExpenses.map((e) => e.id));
      if (eErr) toastError(eErr, "Cash expenses not marked reconciled");
    }
    setSaving(false);

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
                <Label className="text-xs">Opening Cash (float)</Label>
                {openingLocked ? (
                  <div className="font-medium tabular-nums">
                    {fmtINR(Number(openingCash || 0))}
                    <span className="ml-2 text-[10px] text-muted-foreground">carried forward</span>
                  </div>
                ) : (
                  <Input
                    type="number" step="0.01" value={openingCash}
                    onChange={(e) => setOpeningCash(e.target.value)}
                    className="tabular-nums"
                  />
                )}
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
                      const expected = expectedFor(l);
                      const diff = Number((manual - expected).toFixed(2));
                      const mismatch = l.manual_entry !== "" && Math.abs(diff) > 0.009;
                      const noteMissing = mismatch && !l.note.trim();
                      return (
                        <tr key={l.mode} className={mismatch ? "bg-rose-50/50" : ""}>
                          <td className="px-3 py-2 font-medium">
                            {formatPaymentMethodLabel(l.mode)}
                            {l.mode === CASH_MODE && (
                              <div className="text-[10px] font-normal text-muted-foreground">
                                incl. float, petty cash &amp; cash expenses
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtINR(expected)}</td>
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

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm uppercase tracking-wider">Cash Line Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-sm">
                <tbody className="divide-y">
                  <tr><td className="px-3 py-1.5">Opening cash (float)</td><td className="px-3 py-1.5 text-right tabular-nums">{fmtINR(cashBreak.opening)}</td></tr>
                  <tr><td className="px-3 py-1.5">+ Cash payments received</td><td className="px-3 py-1.5 text-right tabular-nums">{fmtINR(cashBreak.payments)}</td></tr>
                  <tr><td className="px-3 py-1.5">+ Petty cash in</td><td className="px-3 py-1.5 text-right tabular-nums">{fmtINR(cashBreak.cashIn)}</td></tr>
                  <tr><td className="px-3 py-1.5">− Petty cash out</td><td className="px-3 py-1.5 text-right tabular-nums">{fmtINR(cashBreak.cashOut)}</td></tr>
                  <tr><td className="px-3 py-1.5">− Cash expenses in window</td><td className="px-3 py-1.5 text-right tabular-nums">{fmtINR(cashBreak.expenses)}</td></tr>
                  <tr className="bg-muted/30 font-semibold">
                    <td className="px-3 py-2">= Expected cash in drawer</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtINR(cashBreak.expected)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Pending petty cash ({petty.length})
                </div>
                {petty.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No pending entries.</p>
                ) : (
                  <ul className="divide-y rounded border text-xs">
                    {petty.map((p) => (
                      <li key={p.id} className="flex items-center gap-2 px-2 py-1.5">
                        <span className="w-24 shrink-0 text-muted-foreground">{fmtDateTime(p.created_at)}</span>
                        <span className="shrink-0">{PETTY_TYPE_LABEL[p.entry_type]}</span>
                        <span className="flex-1 truncate text-muted-foreground">{p.reason ?? ""}</span>
                        <span className={`tabular-nums ${p.entry_type === "out" ? "text-rose-700" : ""}`}>
                          {(pettySign(p.entry_type) > 0 ? "+" : "−") + fmtINR(p.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Cash expenses in window ({cashExpenses.length})
                </div>
                {cashExpenses.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No cash expenses pending.</p>
                ) : (
                  <ul className="divide-y rounded border text-xs">
                    {cashExpenses.map((e) => (
                      <li key={e.id} className="flex items-center gap-2 px-2 py-1.5">
                        <span className="w-24 shrink-0 text-muted-foreground">
                          {fmtDateTime(e.paid_at)}{e.paid_at_approx ? " ~" : ""}
                        </span>
                        <span className="flex-1 truncate text-muted-foreground">
                          {e.description || e.reference || "Expense"}
                        </span>
                        <span className="tabular-nums text-rose-700">−{fmtINR(e.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              “~” marks historical expenses whose exact payment time is approximate (backfilled to midday of the expense date).
            </p>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-2 gap-3">
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