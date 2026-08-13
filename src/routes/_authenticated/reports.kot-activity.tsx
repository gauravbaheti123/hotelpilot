import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Download, Filter, RotateCcw, Printer } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { useAuth, hasRole } from "@/hooks/use-auth";

import { RequirePermission } from "@/components/RequirePermission";
import { istDaysAgo, istToday } from "@/lib/date";
import { useReportBrand } from "@/hooks/use-report-brand";
import {
  exportExcelSections, exportSectionsPdf,
  type ExportSection, type ReportColumn,
} from "@/lib/reportExports";
export const Route = createFileRoute("/_authenticated/reports/kot-activity")({
  head: () => ({ meta: [{ title: "KOT Activity Log — HotelPilot" }] }),
  component: () => (<RequirePermission module="reports"><KotActivityReport /></RequirePermission>),
});

const ALL = "__all__";
const ACTIONS = [
  "SEGMENT_BILL_EDITED",
  "SEGMENT_BILL_DELETED",
  "SEGMENT_BILL_SETTLED",
  "SEGMENT_BILL_AUTO_CLOSED",
  "BILL_VOIDED",
  "RESTAURANT_DIRECT_CHARGE_DELETED",
  "KOT_PUNCH_DELETED",
];
const ACTION_LABEL: Record<string, string> = {
  SEGMENT_BILL_EDITED: "Bill Edited",
  SEGMENT_BILL_DELETED: "Bill Deleted",
  SEGMENT_BILL_SETTLED: "Bill Settled",
  SEGMENT_BILL_AUTO_CLOSED: "Auto-Closed",
  BILL_VOIDED: "Voided",
  RESTAURANT_DIRECT_CHARGE_DELETED: "Direct Charge Deleted",
  KOT_PUNCH_DELETED: "Punch Deleted",
};
const ACTION_TONE: Record<string, string> = {
  SEGMENT_BILL_EDITED: "bg-blue-100 text-blue-800 border-blue-300",
  SEGMENT_BILL_SETTLED: "bg-emerald-100 text-emerald-800 border-emerald-300",
  SEGMENT_BILL_AUTO_CLOSED: "bg-slate-100 text-slate-800 border-slate-300",
  BILL_VOIDED: "bg-amber-100 text-amber-800 border-amber-300",
  SEGMENT_BILL_DELETED: "bg-rose-100 text-rose-800 border-rose-300",
  RESTAURANT_DIRECT_CHARGE_DELETED: "bg-rose-100 text-rose-800 border-rose-300",
  KOT_PUNCH_DELETED: "bg-rose-100 text-rose-800 border-rose-300",
};

interface KotDisplayRow {
  when: string; kotNumber: string; action: string; staff: string;
  loc: string; before: number | null; after: number | null; reason: string;
}

const KOT_COLUMNS: ReportColumn<KotDisplayRow>[] = [
  { key: "when", header: "Date-Time", get: (r) => r.when, type: "date", sortValue: (r) => r.when },
  { key: "kot", header: "Bill / KOT Number", get: (r) => r.kotNumber },
  { key: "action", header: "Action", get: (r) => ACTION_LABEL[r.action] ?? r.action, type: "enum" },
  { key: "staff", header: "Performed By", get: (r) => r.staff, type: "enum" },
  { key: "loc", header: "Table / Room", get: (r) => r.loc, type: "enum" },
  { key: "before", header: "Amount Before", get: (r) => (r.before != null ? r.before : ""), currency: true },
  { key: "after", header: "Amount After", get: (r) => (r.after != null ? r.after : ""), currency: true },
  { key: "reason", header: "Reason", get: (r) => r.reason },
];

interface Row {
  id: string;
  created_at: string;
  user_name: string | null;
  action_type: string;
  reference_label: string | null;
  details: Record<string, unknown> | null;
}

function KotActivityReport() {
  const { current, loading: propLoading } = useCurrentProperty();
  const brand = useReportBrand(current?.id ?? null);
  const { roles, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const isOwner = hasRole(roles, "owner") || hasRole(roles, "superadmin");
  useEffect(() => {
    if (!authLoading && !isOwner) navigate({ to: "/reports" });
  }, [authLoading, isOwner, navigate]);
  const today = istToday();
  const monthAgo = istDaysAgo(30);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [action, setAction] = useState(ALL);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!current) return;
    setLoading(true);
    try {
      let q = supabase.from("activity_log" as any)
        .select("id,created_at,user_name,action_type,reference_label,details")
        .eq("property_id", current.id)
        .in("action_type", action === ALL ? ACTIONS : [action])
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59.999`)
        .order("created_at", { ascending: false })
        .limit(1000);
      const { data } = await q;
      setRows((data ?? []) as unknown as Row[]);
    } finally { setLoading(false); }
  }, [current, from, to, action]);

  useEffect(() => { load(); }, [load]);

  function reset() { setFrom(monthAgo); setTo(today); setAction(ALL); }

  const formatRows = () => rows.map((r) => {
    const d = (r.details ?? {}) as Record<string, unknown>;
    const kotNumber = String(d.kot_number ?? r.reference_label ?? "");
    const table = String(d.table_no ?? (d.snapshot as any)?.table_no ?? "");
    const room = String((d.snapshot as any)?.rooms?.room_number ?? "");
    const before = d.previous_total != null ? Number(d.previous_total) : null;
    const after = d.new_total != null ? Number(d.new_total) : null;
    const reason = String(d.reason ?? "");
    return {
      when: new Date(r.created_at).toLocaleString(),
      kotNumber, action: r.action_type,
      staff: r.user_name ?? "",
      loc: table ? `Table ${table}` : (room ? `Room ${room}` : "—"),
      before, after, reason,
    };
  });

  const exportMeta = { reportName: "KOT Activity Log", propertyName: current?.name ?? "", from, to };

  function buildSections(): ExportSection[] {
    const data = formatRows();
    const byAction = new Map<string, number>();
    for (const r of data) byAction.set(ACTION_LABEL[r.action] ?? r.action, (byAction.get(ACTION_LABEL[r.action] ?? r.action) ?? 0) + 1);
    return [{
      title: "KOT Activity Log",
      columns: KOT_COLUMNS as ReportColumn<any>[],
      rows: data,
      emptyText: "No KOT activity in this range",
      summary: [
        ["Total entries", data.length],
        ...Array.from(byAction.entries()).map(([a, n]) => [`  ${a}`, n] as [string, number]),
      ] as Array<[string, string | number]>,
    }];
  }

  async function exportXlsx() {
    await exportExcelSections(buildSections(), exportMeta);
  }

  function exportPdfDoc() {
    exportSectionsPdf(buildSections(), exportMeta, brand);
  }

  if (propLoading) return <AppShell title="KOT Activity Log"><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (!current) return <AppShell title="KOT Activity Log"><EmptyPropertyState /></AppShell>;

  const display = formatRows();

  return (
    <AppShell title="KOT Activity Log">
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Filters</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-5 items-end">
              <div><Label className="mb-1 block text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div><Label className="mb-1 block text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
              <div>
                <Label className="mb-1 block text-xs">Action</Label>
                <Select value={action} onValueChange={setAction}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All actions</SelectItem>
                    {ACTIONS.map((a) => <SelectItem key={a} value={a}>{ACTION_LABEL[a]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={load}><Filter className="h-4 w-4 mr-1" /> Apply</Button>
                <Button size="sm" variant="outline" onClick={reset}><RotateCcw className="h-4 w-4 mr-1" /> Clear</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Results ({display.length.toLocaleString()})</CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={exportXlsx}><Download className="h-4 w-4 mr-1" /> Export Excel</Button>
              <Button size="sm" variant="outline" onClick={exportPdfDoc}><Printer className="h-4 w-4 mr-1" /> Export PDF</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left p-3">Date-Time</th>
                    <th className="text-left p-3">KOT #</th>
                    <th className="text-left p-3">Action</th>
                    <th className="text-left p-3">Performed By</th>
                    <th className="text-left p-3">Table / Room</th>
                    <th className="text-right p-3">Before</th>
                    <th className="text-right p-3">After</th>
                    <th className="text-left p-3">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loading && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
                  {!loading && display.length === 0 && (
                    <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No KOT activity in this range.</td></tr>
                  )}
                  {!loading && display.map((r, i) => (
                    <tr key={i} className="hover:bg-accent/30">
                      <td className="p-3 whitespace-nowrap text-xs text-muted-foreground">{r.when}</td>
                      <td className="p-3 font-medium">{r.kotNumber}</td>
                      <td className="p-3"><Badge variant="outline" className={ACTION_TONE[r.action]}>{ACTION_LABEL[r.action] ?? r.action}</Badge></td>
                      <td className="p-3">{r.staff || "—"}</td>
                      <td className="p-3 text-xs">{r.loc}</td>
                      <td className="p-3 text-right">{r.before != null ? `₹${r.before.toLocaleString("en-IN")}` : "—"}</td>
                      <td className="p-3 text-right">{r.action === "KOT_EDITED" && r.after != null ? `₹${r.after.toLocaleString("en-IN")}` : "—"}</td>
                      <td className="p-3 text-xs text-muted-foreground max-w-xs truncate" title={r.reason}>{r.reason || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}