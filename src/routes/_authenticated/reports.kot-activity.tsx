import { createFileRoute, redirect } from "@tanstack/react-router";
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
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";

export const Route = createFileRoute("/_authenticated/reports/kot-activity")({
  head: () => ({ meta: [{ title: "KOT Activity Log — HotelPilot" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.rpc("get_current_user_roles" as never);
    const roles = (data ?? []) as unknown as string[];
    if (!roles.some((r) => r === "owner" || r === "superadmin")) {
      throw redirect({ to: "/reports" });
    }
  },
  component: KotActivityReport,
});

const ALL = "__all__";
const ACTIONS = ["KOT_EDITED", "KOT_VOIDED", "KOT_DELETED"];
const ACTION_LABEL: Record<string, string> = {
  KOT_EDITED: "Edited",
  KOT_VOIDED: "Voided",
  KOT_DELETED: "Deleted",
};
const ACTION_TONE: Record<string, string> = {
  KOT_EDITED: "bg-blue-100 text-blue-800 border-blue-300",
  KOT_VOIDED: "bg-amber-100 text-amber-800 border-amber-300",
  KOT_DELETED: "bg-rose-100 text-rose-800 border-rose-300",
};

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
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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

  async function exportXlsx() {
    const data = formatRows().map((r) => ({
      "Date-Time": r.when,
      "KOT Number": r.kotNumber,
      "Action": ACTION_LABEL[r.action] ?? r.action,
      "Performed By": r.staff,
      "Table / Room": r.loc,
      "Amount Before": r.before ?? "",
      "Amount After": r.action === "KOT_EDITED" ? (r.after ?? "") : "",
      "Reason": r.reason,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "KOT Activity");
    XLSX.writeFile(wb, `kot-activity-${from}-to-${to}.xlsx`);
  }

  function printPdf() { window.print(); }

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
              <Button size="sm" variant="outline" onClick={exportXlsx}><Download className="h-4 w-4 mr-1" /> Excel</Button>
              <Button size="sm" variant="outline" onClick={printPdf}><Printer className="h-4 w-4 mr-1" /> PDF</Button>
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