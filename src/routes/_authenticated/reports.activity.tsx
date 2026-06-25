import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Download, Filter, RotateCcw } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";

export const Route = createFileRoute("/_authenticated/reports/activity")({
  head: () => ({ meta: [{ title: "Activity Log — HotelPilot" }] }),
  component: ActivityLogPage,
});

interface ActivityRow {
  id: string;
  created_at: string;
  user_id: string | null;
  user_name: string | null;
  action_type: string;
  module: string;
  reference_id: string | null;
  reference_label: string | null;
  details: Record<string, unknown> | null;
}

interface StaffOption { user_id: string; name: string }

const PAGE_SIZE = 50;
const ALL = "__all__";

function ActivityLogPage() {
  const { current, loading: propLoading } = useCurrentProperty();

  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [staff, setStaff] = useState<string>(ALL);
  const [module, setModule] = useState<string>(ALL);
  const [action, setAction] = useState<string>(ALL);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [staffOpts, setStaffOpts] = useState<StaffOption[]>([]);

  const load = useCallback(async () => {
    if (!current) return;
    setLoading(true);
    try {
      let q = supabase
        .from("activity_log" as any)
        .select("id,created_at,user_id,user_name,action_type,module,reference_id,reference_label,details", { count: "exact" })
        .eq("property_id", current.id)
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59.999`)
        .order("created_at", { ascending: false });
      if (staff !== ALL) q = q.eq("user_id", staff);
      if (module !== ALL) q = q.eq("module", module);
      if (action !== ALL) q = q.eq("action_type", action);
      q = q.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      const { data, count } = await q;
      setRows((data ?? []) as unknown as ActivityRow[]);
      setTotalCount(count ?? 0);
    } finally {
      setLoading(false);
    }
  }, [current, from, to, staff, module, action, page]);

  useEffect(() => { load(); }, [load]);

  // Build the staff dropdown from distinct user_ids on activity_log for this property.
  useEffect(() => {
    if (!current) return;
    (async () => {
      const { data } = await supabase
        .from("activity_log" as any)
        .select("user_id,user_name")
        .eq("property_id", current.id)
        .order("user_name", { ascending: true })
        .limit(1000);
      const seen = new Map<string, string>();
      ((data ?? []) as unknown as Array<{ user_id: string | null; user_name: string | null }>).forEach((r) => {
        if (r.user_id && !seen.has(r.user_id)) {
          seen.set(r.user_id, r.user_name ?? "Unknown");
        }
      });
      setStaffOpts(Array.from(seen.entries()).map(([user_id, name]) => ({ user_id, name })));
    })();
  }, [current]);

  const modules = useMemo(
    () => ["Front Desk", "Billing", "Food", "Rooms", "Housekeeping", "Inventory"],
    [],
  );
  const actions = useMemo(
    () => [
      "BOOKING_CREATED", "BOOKING_MODIFIED", "CHECKIN", "CHECKOUT",
      "BILL_CREATED", "PAYMENT_RECEIVED", "KOT_CREATED", "ROOM_STATUS_CHANGED",
    ],
    [],
  );

  function clearFilters() {
    setFrom(monthAgo); setTo(today);
    setStaff(ALL); setModule(ALL); setAction(ALL);
    setPage(0);
  }

  async function exportXlsx() {
    if (!current) return;
    let q = supabase
      .from("activity_log" as any)
      .select("created_at,user_name,action_type,module,reference_label,details")
      .eq("property_id", current.id)
      .gte("created_at", `${from}T00:00:00`)
      .lte("created_at", `${to}T23:59:59.999`)
      .order("created_at", { ascending: false })
      .limit(10000);
    if (staff !== ALL) q = q.eq("user_id", staff);
    if (module !== ALL) q = q.eq("module", module);
    if (action !== ALL) q = q.eq("action_type", action);
    const { data } = await q;
    const formatted = ((data ?? []) as unknown as Array<{
      created_at: string; user_name: string | null; action_type: string;
      module: string; reference_label: string | null; details: unknown;
    }>).map((r) => ({
      "Date-Time": new Date(r.created_at).toLocaleString(),
      Staff: r.user_name ?? "",
      Action: r.action_type,
      Module: r.module,
      Details: r.reference_label ?? "",
      Extra: r.details ? JSON.stringify(r.details) : "",
    }));
    const ws = XLSX.utils.json_to_sheet(formatted);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Activity");
    XLSX.writeFile(wb, `activity-log-${from}-to-${to}.xlsx`);
  }

  if (propLoading) return <AppShell title="Activity Log"><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (!current) return <AppShell title="Activity Log"><EmptyPropertyState /></AppShell>;

  const pages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <AppShell title="Activity Log">
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Filters</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-6 items-end">
              <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
              <Field label="Staff">
                <Select value={staff} onValueChange={(v) => { setStaff(v); setPage(0); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All staff</SelectItem>
                    {staffOpts.map((s) => <SelectItem key={s.user_id} value={s.user_id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Module">
                <Select value={module} onValueChange={(v) => { setModule(v); setPage(0); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All modules</SelectItem>
                    {modules.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Action">
                <Select value={action} onValueChange={(v) => { setAction(v); setPage(0); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All actions</SelectItem>
                    {actions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => { setPage(0); load(); }}>
                  <Filter className="h-4 w-4 mr-1" /> Apply
                </Button>
                <Button size="sm" variant="outline" onClick={clearFilters}>
                  <RotateCcw className="h-4 w-4 mr-1" /> Clear
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Results ({totalCount.toLocaleString()})</CardTitle>
            <Button size="sm" variant="outline" onClick={exportXlsx}>
              <Download className="h-4 w-4 mr-1" /> Export to Excel
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left p-3">Date-Time</th>
                    <th className="text-left p-3">Staff</th>
                    <th className="text-left p-3">Action</th>
                    <th className="text-left p-3">Module</th>
                    <th className="text-left p-3">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loading && (
                    <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
                  )}
                  {!loading && rows.length === 0 && (
                    <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No activity in this range.</td></tr>
                  )}
                  {!loading && rows.map((r) => (
                    <tr key={r.id} className="hover:bg-accent/30">
                      <td className="p-3 whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </td>
                      <td className="p-3">{r.user_name ?? "—"}</td>
                      <td className="p-3"><Badge variant="outline" className="text-[10px]">{r.action_type}</Badge></td>
                      <td className="p-3 text-xs">{r.module}</td>
                      <td className="p-3 text-xs">{r.reference_label ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalCount > PAGE_SIZE && (
              <div className="flex items-center justify-between p-3 border-t text-xs">
                <div className="text-muted-foreground">
                  Page {page + 1} of {pages}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</Button>
                  <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="mb-1 block text-xs">{label}</Label>{children}</div>;
}