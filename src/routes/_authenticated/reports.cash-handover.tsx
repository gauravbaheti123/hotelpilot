import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { ReportShell } from "@/components/ReportShell";
import { RequirePermission } from "@/components/RequirePermission";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { usePermissions } from "@/hooks/use-permissions";
import { toast } from "sonner";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  exportExcel, exportPdf, fmtDateTime, fmtINR, firstOfMonthIso, type ReportColumn,
} from "@/lib/reportExports";
import { formatPaymentMethodLabel } from "@/hooks/use-payment-methods";
import { Plus, ChevronDown, ChevronRight, Printer, Trash2 } from "lucide-react";
import { printHandover } from "@/lib/handoverPrint";
import { istToday } from "@/lib/date";
import { reportQueryError } from "@/lib/queryError";

export const Route = createFileRoute("/_authenticated/reports/cash-handover")({
  head: () => ({ meta: [{ title: "Cash Handover Report — HotelPilot" }] }),
  component: () => (
    <RequirePermission module="shift_handover" action="view">
      <Page />
    </RequirePermission>
  ),
});

interface LineRow {
  id: string; mode: string; system_total: number; manual_entry: number; difference: number; note: string | null;
}
interface HandoverRow {
  id: string;
  created_at: string;
  window_start: string;
  window_end?: string | null;
  opening_cash: number | null;
  closing_cash: number | null;
  outgoing_user_id: string;
  outgoing_user_name: string;
  incoming_user_id: string | null;
  incoming_user_name: string | null;
  total_system: number;
  total_manual: number;
  total_difference: number;
  notes: string | null;
  lines: LineRow[];
}

function Page() {
  const { current, currentId: propertyId } = useCurrentProperty();
  const today = istToday();
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(today);
  const [managerId, setManagerId] = useState("all");
  const [mismatchOnly, setMismatchOnly] = useState(false);
  const [rows, setRows] = useState<HandoverRow[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { can, isSuperadmin } = usePermissions();
  const canDelete = isSuperadmin || can("shift_handover", "delete");
  const [deleteTarget, setDeleteTarget] = useState<HandoverRow | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [latestId, setLatestId] = useState<string | null>(null);

  const loadLatest = useCallback(async () => {
    if (!propertyId) { setLatestId(null); return; }
    const { data, error: __qe1 } = await supabase
      .from("shift_handovers")
      .select("id,window_end,created_at")
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (__qe1) reportQueryError("shift handovers", __qe1);
    setLatestId((data as any)?.id ?? null);
  }, [propertyId]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    if (!deleteReason.trim()) return toast.error("Reason is required");
    setDeleting(true);
    const { error } = await supabase.rpc("delete_shift_handover" as any, {
      _id: deleteTarget.id,
      _reason: deleteReason.trim(),
    } as any);
    setDeleting(false);
    if (error) return toast.error(error.message);
    toast.success("Handover deleted");
    setDeleteTarget(null);
    setDeleteReason("");
    await Promise.all([load(), loadLatest()]);
  };

  const load = useCallback(async () => {
    if (!propertyId) return;
    const { data, error: __qe2 } = await supabase
      .from("shift_handovers")
      .select("id,created_at,window_start,window_end,opening_cash,closing_cash,outgoing_user_id,outgoing_user_name,incoming_user_id,incoming_user_name,total_system,total_manual,total_difference,notes,shift_handover_lines(id,mode,system_total,manual_entry,difference,note)")
      .eq("property_id", propertyId)
      .gte("created_at", `${from}T00:00:00`)
      .lte("created_at", `${to}T23:59:59`)
      .order("created_at", { ascending: false });
    if (__qe2) reportQueryError("shift handovers", __qe2);
    const mapped: HandoverRow[] = ((data ?? []) as any[]).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      window_start: r.window_start,
      window_end: r.window_end ?? null,
      opening_cash: r.opening_cash === null || r.opening_cash === undefined ? null : Number(r.opening_cash),
      closing_cash: r.closing_cash === null || r.closing_cash === undefined ? null : Number(r.closing_cash),
      outgoing_user_id: r.outgoing_user_id,
      outgoing_user_name: r.outgoing_user_name,
      incoming_user_id: r.incoming_user_id,
      incoming_user_name: r.incoming_user_name,
      total_system: Number(r.total_system ?? 0),
      total_manual: Number(r.total_manual ?? 0),
      total_difference: Number(r.total_difference ?? 0),
      notes: r.notes ?? null,
      lines: ((r.shift_handover_lines ?? []) as any[]).map((l) => ({
        id: l.id, mode: l.mode, system_total: Number(l.system_total ?? 0),
        manual_entry: Number(l.manual_entry ?? 0), difference: Number(l.difference ?? 0), note: l.note,
      })),
    }));
    setRows(mapped);
  }, [propertyId, from, to]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadLatest(); }, [loadLatest]);

  const managers = useMemo(() => {
    const set = new Map<string, string>();
    rows.forEach((r) => {
      set.set(r.outgoing_user_id, r.outgoing_user_name);
      if (r.incoming_user_id) set.set(r.incoming_user_id, r.incoming_user_name ?? r.incoming_user_id);
    });
    return Array.from(set.entries()).map(([id, name]) => ({ id, name }));
  }, [rows]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (managerId !== "all" && r.outgoing_user_id !== managerId && r.incoming_user_id !== managerId) return false;
    if (mismatchOnly && Math.abs(r.total_difference) < 0.009) return false;
    return true;
  }), [rows, managerId, mismatchOnly]);

  const columns: ReportColumn<HandoverRow>[] = useMemo(() => [
    { key: "created_at", header: "Submitted", get: (r) => fmtDateTime(r.created_at), type: "date", sortValue: (r) => r.created_at, dateValue: (r) => r.created_at },
    { key: "window_start", header: "Window Start", get: (r) => fmtDateTime(r.window_start), type: "date", sortValue: (r) => r.window_start },
    { key: "outgoing", header: "Outgoing", get: (r) => r.outgoing_user_name, type: "enum" },
    { key: "incoming", header: "Incoming", get: (r) => r.incoming_user_name ?? "—", type: "enum" },
    { key: "total_system", header: "System Total", get: (r) => r.total_system, currency: true, sortValue: (r) => r.total_system },
    { key: "total_manual", header: "Manual Total", get: (r) => r.total_manual, currency: true, sortValue: (r) => r.total_manual },
    { key: "total_difference", header: "Difference", get: (r) => r.total_difference, currency: true, sortValue: (r) => r.total_difference },
  ], []);

  const meta = {
    reportName: "Cash Handover Report",
    propertyName: current?.name ?? "Property",
    from, to,
    totals: [
      ["Handovers", filtered.length],
      ["Total mismatches", filtered.filter((r) => Math.abs(r.total_difference) > 0.009).length],
      ["Net difference", fmtINR(filtered.reduce((s, r) => s + r.total_difference, 0))],
    ] as [string, string | number][],
  };

  return (
    <ReportShell
      title="Cash Handover Report"
      filters={<>
        <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
        <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
        <div>
          <Label>Manager</Label>
          <Select value={managerId} onValueChange={setManagerId}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All managers</SelectItem>
              {managers.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button size="sm" variant={mismatchOnly ? "default" : "outline"} onClick={() => setMismatchOnly((v) => !v)}>
            {mismatchOnly ? "Mismatches only ✓" : "Mismatches only"}
          </Button>
        </div>
        <div className="flex items-end ml-auto">
          <Link to="/handover/new">
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Start Handover</Button>
          </Link>
        </div>
      </>}
      onExcel={() => exportExcel(filtered, columns, meta)}
      onPdf={() => exportPdf(filtered, columns, meta)}
      disabled={filtered.length === 0}
    >
      <Card>
        <CardContent className="p-0 divide-y">
          {filtered.length === 0 && <p className="p-4 text-sm text-muted-foreground">No handovers in range.</p>}
          {filtered.map((r) => {
            const isMismatch = Math.abs(r.total_difference) > 0.009;
            const open = expanded[r.id];
            return (
              <div key={r.id} className={isMismatch ? "bg-rose-50/40" : ""}>
                <button
                  type="button"
                  onClick={() => setExpanded((s) => ({ ...s, [r.id]: !s[r.id] }))}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
                >
                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{fmtDateTime(r.created_at)}</span>
                      <span className="text-xs text-muted-foreground">
                        {r.outgoing_user_name} → {r.incoming_user_name ?? "—"}
                      </span>
                      {isMismatch && <Badge variant="outline" className="bg-rose-100 text-rose-800 border-rose-300">MISMATCH</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Window from {fmtDateTime(r.window_start)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Difference</div>
                    <div className={`text-sm font-semibold tabular-nums ${isMismatch ? "text-rose-700" : ""}`}>
                      {(r.total_difference > 0 ? "+" : "") + fmtINR(r.total_difference)}
                    </div>
                  </div>
                </button>
                {open && (
                  <div className="px-4 pb-4">
                    <div className="overflow-x-auto rounded border">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/40 uppercase tracking-wider">
                          <tr>
                            <th className="px-2 py-1.5 text-left">Mode</th>
                            <th className="px-2 py-1.5 text-right">System</th>
                            <th className="px-2 py-1.5 text-right">Manual</th>
                            <th className="px-2 py-1.5 text-right">Difference</th>
                            <th className="px-2 py-1.5 text-left">Note</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {r.lines.map((l) => {
                            const rowMismatch = Math.abs(l.difference) > 0.009;
                            return (
                              <tr key={l.id} className={rowMismatch ? "bg-rose-50" : ""}>
                                <td className="px-2 py-1.5">{formatPaymentMethodLabel(l.mode)}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums">{fmtINR(l.system_total)}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums">{fmtINR(l.manual_entry)}</td>
                                <td className={`px-2 py-1.5 text-right tabular-nums ${rowMismatch ? "text-rose-700 font-semibold" : ""}`}>
                                  {(l.difference > 0 ? "+" : "") + fmtINR(l.difference)}
                                </td>
                                <td className="px-2 py-1.5 text-muted-foreground">{l.note ?? ""}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {r.notes && (
                      <p className="mt-2 text-xs text-muted-foreground"><b>Overall notes:</b> {r.notes}</p>
                    )}
                    {(r.opening_cash !== null || r.closing_cash !== null) && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        <b>Cash float:</b> opening {fmtINR(r.opening_cash ?? 0)} → closing (expected) {fmtINR(r.closing_cash ?? 0)}.
                        The Cash line above already nets opening float, petty cash in/out and cash expenses.
                      </p>
                    )}
                    <div className="mt-3 flex justify-end gap-2">
                      {canDelete && latestId === r.id && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive border-destructive/40 hover:bg-destructive/10"
                          onClick={() => { setDeleteTarget(r); setDeleteReason(""); }}
                        >
                          <Trash2 className="h-4 w-4 mr-1" /> Delete Handover
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => printHandover({
                          id: r.id,
                          propertyId: propertyId!,
                          propertyName: current?.name ?? "Property",
                          outgoing_user_name: r.outgoing_user_name,
                          incoming_user_name: r.incoming_user_name,
                          window_start: r.window_start,
                          window_end: r.window_end ?? null,
                          submitted_at: r.created_at,
                          notes: r.notes,
                          total_system: r.total_system,
                          total_manual: r.total_manual,
                          total_difference: r.total_difference,
                          lines: r.lines.map((l) => ({
                            mode: l.mode,
                            system_total: l.system_total,
                            manual_entry: l.manual_entry,
                            difference: l.difference,
                            note: l.note,
                          })),
                        })}
                      >
                        <Printer className="h-4 w-4 mr-1" /> Print Handover
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setDeleteReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete handover?</DialogTitle>
            <DialogDescription>
              This permanently removes the handover submitted on{" "}
              {deleteTarget ? fmtDateTime(deleteTarget.created_at) : ""} and all its cash lines.
              A full snapshot is written to the audit log. Only the latest handover can be deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason (required)</Label>
            <Textarea
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="Why is this handover being deleted?"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting || !deleteReason.trim()}>
              {deleting ? "Deleting…" : "Delete Handover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ReportShell>
  );
}