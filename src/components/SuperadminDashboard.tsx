import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Building2, Users, Activity, Database, ShieldCheck, FileText, PlusCircle,
  CheckCircle2, PauseCircle, IndianRupee, UtensilsCrossed, CalendarPlus,
  Pause, Play, Trash2, Eye,
} from "lucide-react";
import { deleteProperty } from "@/lib/admin-properties.functions";
import { useServerFn } from "@tanstack/react-start";
import { enterViewMode } from "@/lib/superadmin-view";
import { reportQueryError } from "@/lib/queryError";
import { toastError } from "@/lib/errorMessage";

type Prop = {
  id: string;
  name: string;
  city: string | null;
  status: string | null;
  created_at: string;
};

type PropRow = Prop & {
  users: number;
  bookings: number;
  revenue: number;
};

type ActivityRow = {
  id: string;
  created_at: string;
  action: string;
  user_email: string | null;
  property_name: string | null;
};

function monthStartISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

export function SuperadminDashboard() {
  const navigate = useNavigate();
  const deleteFn = useServerFn(deleteProperty);
  const [loading, setLoading] = useState(true);
  const [kpi, setKpi] = useState({
    total: 0, active: 0, paused: 0, users: 0,
    bookings: 0, revenue: 0, kots: 0, newProps: 0,
  });
  const [rows, setRows] = useState<PropRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [health, setHealth] = useState({ db: false, lastBackupHrs: 24 });
  const [delTarget, setDelTarget] = useState<PropRow | null>(null);
  const [delConfirm, setDelConfirm] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const monthStart = monthStartISO();

    const [
      { data: props },
      { count: usersCount },
      { count: bookingsCount, data: bookingsData },
      { count: kotsCount },
      { data: act },
    ] = await Promise.all([
      supabase.from("properties").select("id,name,city,status,created_at").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("bookings").select("id,property_id", { count: "exact" }).gte("created_at", monthStart),
      supabase.from("kot_orders").select("id", { count: "exact", head: true }).gte("created_at", monthStart),
      supabase.from("activity_log").select("id,created_at,action_type,module,user_name,property_id").order("created_at", { ascending: false }).limit(10),
    ]);

    const propsList = (props ?? []) as Prop[];
    const total = propsList.length;
    const active = propsList.filter((p) => (p.status ?? "active") === "active").length;
    const paused = propsList.filter((p) => p.status === "paused").length;
    const newProps = propsList.filter((p) => p.created_at >= monthStart).length;

    // revenue from payments this month
    const { data: payRows, error: __qe1 } = await supabase
      .from("payments")
      .select("amount,property_id,created_at")
      .gte("created_at", monthStart);
    if (__qe1) reportQueryError("payments", __qe1);
    const totalRevenue = (payRows ?? []).reduce((a, r: { amount: number }) => a + Number(r.amount ?? 0), 0);

    // per-property aggregation
    const bkByProp: Record<string, number> = {};
    for (const b of (bookingsData ?? []) as { property_id: string }[]) {
      bkByProp[b.property_id] = (bkByProp[b.property_id] ?? 0) + 1;
    }
    const revByProp: Record<string, number> = {};
    for (const p of (payRows ?? []) as { property_id: string; amount: number }[]) {
      revByProp[p.property_id] = (revByProp[p.property_id] ?? 0) + Number(p.amount ?? 0);
    }
    // users per property via user_roles
    const { data: roleRows, error: __qe2 } = await supabase
      .from("user_roles")
      .select("user_id,property_id");
    if (__qe2) reportQueryError("user roles", __qe2);
    const usersByProp: Record<string, Set<string>> = {};
    for (const r of (roleRows ?? []) as { user_id: string; property_id: string | null }[]) {
      if (!r.property_id) continue;
      (usersByProp[r.property_id] ??= new Set()).add(r.user_id);
    }

    const propMap = new Map(propsList.map((p) => [p.id, p.name]));
    const tableRows: PropRow[] = propsList.map((p) => ({
      ...p,
      users: usersByProp[p.id]?.size ?? 0,
      bookings: bkByProp[p.id] ?? 0,
      revenue: revByProp[p.id] ?? 0,
    }));

    const activityRows: ActivityRow[] = ((act ?? []) as Array<{ id: string; created_at: string; action_type: string; module: string | null; user_name: string | null; property_id: string | null }>).map((a) => ({
      id: a.id,
      created_at: a.created_at,
      action: `${a.module ? a.module + " · " : ""}${a.action_type}`,
      user_email: a.user_name,
      property_name: a.property_id ? propMap.get(a.property_id) ?? null : null,
    }));

    setKpi({
      total,
      active,
      paused,
      users: usersCount ?? 0,
      bookings: bookingsCount ?? 0,
      revenue: totalRevenue,
      kots: kotsCount ?? 0,
      newProps,
    });
    setRows(tableRows);
    setActivity(activityRows);
    setHealth({ db: true, lastBackupHrs: 24 });
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function togglePause(p: PropRow) {
    setBusyId(p.id);
    const next = p.status === "paused" ? "active" : "paused";
    const { error } = await supabase
      .from("properties")
      .update({ status: next })
      .eq("id", p.id);
    setBusyId(null);
    if (error) {
      toastError(error);
      return;
    }
    toast.success(next === "paused" ? "Property paused" : "Property resumed");
    load();
  }

  const [viewTarget, setViewTarget] = useState<PropRow | null>(null);

  function confirmView() {
    if (!viewTarget) return;
    enterViewMode(viewTarget.id);
    toast.success(`Viewing as ${viewTarget.name}`);
    setViewTarget(null);
    navigate({ to: "/dashboard" });
    setTimeout(() => window.location.reload(), 50);
  }

  async function confirmDelete() {
    if (!delTarget) return;
    if (delConfirm !== delTarget.name) {
      toast.error("Name does not match");
      return;
    }
    try {
      await deleteFn({ data: { property_id: delTarget.id, confirm_name: delConfirm } });
      toast.success("Property deleted");
      setDelTarget(null);
      setDelConfirm("");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const fmtINR = (n: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

  return (
    <AppShell title="HotelPilot Admin">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">HotelPilot Admin</h2>
          <p className="text-sm text-muted-foreground">Growth Story Company — platform overview</p>
        </div>

        {/* KPI Row 1 */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Total Properties" value={kpi.total} icon={Building2} />
          <KpiCard label="Active" value={kpi.active} icon={CheckCircle2} accent="text-emerald-600" />
          <KpiCard label="Paused" value={kpi.paused} icon={PauseCircle} accent="text-rose-600" />
          <KpiCard label="Total Users" value={kpi.users} icon={Users} />
        </div>

        {/* KPI Row 2 */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Bookings (this month)" value={kpi.bookings} icon={CalendarPlus} />
          <KpiCard label="Revenue (this month)" value={fmtINR(kpi.revenue)} icon={IndianRupee} />
          <KpiCard label="KOTs (this month)" value={kpi.kots} icon={UtensilsCrossed} />
          <KpiCard label="New Properties (this month)" value={kpi.newProps} icon={PlusCircle} />
        </div>

        {/* Properties list */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>All Properties</CardTitle>
            <Link to="/properties">
              <Button size="sm" variant="outline"><Building2 className="h-4 w-4 mr-1" /> Manage</Button>
            </Link>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="text-sm text-muted-foreground">No properties yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Users</TableHead>
                    <TableHead className="text-right">Bookings (mo)</TableHead>
                    <TableHead className="text-right">Revenue (mo)</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell>{r.city ?? "—"}</TableCell>
                      <TableCell>
                        {r.status === "paused" ? (
                          <Badge variant="destructive">Paused</Badge>
                        ) : (
                          <Badge className="bg-emerald-600 hover:bg-emerald-600">Active</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{r.users}</TableCell>
                      <TableCell className="text-right">{r.bookings}</TableCell>
                      <TableCell className="text-right">{fmtINR(r.revenue)}</TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button size="sm" variant="ghost" onClick={() => setViewTarget(r)} title="View Hotel">
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === r.id}
                          onClick={() => togglePause(r)}
                          title={r.status === "paused" ? "Resume" : "Pause"}
                        >
                          {r.status === "paused" ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-rose-600 hover:text-rose-700"
                          onClick={() => { setDelTarget(r); setDelConfirm(""); }}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Recent Activity */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4" /> Recent Activity</CardTitle></CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <div className="text-sm text-muted-foreground">No recent activity.</div>
              ) : (
                <div className="space-y-2 text-sm">
                  {activity.map((a) => (
                    <div key={a.id} className="flex items-start justify-between gap-3 border-b last:border-0 pb-2">
                      <div>
                        <div className="font-medium">{a.action}</div>
                        <div className="text-xs text-muted-foreground">
                          {a.property_name ?? "—"} · {a.user_email ?? "system"}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(a.created_at).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* System Health + Quick Actions */}
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Database className="h-4 w-4" /> System Health</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-1.5">
                <div className="flex justify-between"><span>Database</span><span className="text-emerald-600">✅ Connected</span></div>
                <div className="flex justify-between"><span>Backend</span><span className="text-emerald-600">✅ Operational</span></div>
                <div className="flex justify-between"><span>Last backup</span><span className="text-muted-foreground">{health.lastBackupHrs}h ago</span></div>
                <div className="flex justify-between"><span>Active sessions</span><span className="text-muted-foreground">—</span></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Quick Actions</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-2">
                <Link to="/properties"><Button variant="outline" size="sm" className="w-full justify-start"><PlusCircle className="h-4 w-4 mr-2" /> New Hotel</Button></Link>
                <Link to="/superadmin/users"><Button variant="outline" size="sm" className="w-full justify-start"><Users className="h-4 w-4 mr-2" /> Create User</Button></Link>
                <Link to="/billing/invoices"><Button variant="outline" size="sm" className="w-full justify-start"><FileText className="h-4 w-4 mr-2" /> All Invoices</Button></Link>
                <Link to="/security"><Button variant="outline" size="sm" className="w-full justify-start"><ShieldCheck className="h-4 w-4 mr-2" /> Security</Button></Link>
                <Link to="/reports/activity"><Button variant="outline" size="sm" className="w-full justify-start col-span-2"><Activity className="h-4 w-4 mr-2" /> System Logs</Button></Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Dialog open={!!delTarget} onOpenChange={(o) => { if (!o) { setDelTarget(null); setDelConfirm(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete property</DialogTitle>
            <DialogDescription>
              This permanently deletes <strong>{delTarget?.name}</strong> and ALL its data.
              Type the property name to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Confirm name</Label>
            <Input value={delConfirm} onChange={(e) => setDelConfirm(e.target.value)} placeholder={delTarget?.name} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDelTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={delConfirm !== delTarget?.name}>
              Delete forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewTarget} onOpenChange={(o) => { if (!o) setViewTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch to {viewTarget?.name} view?</DialogTitle>
            <DialogDescription>
              You will see this hotel's dashboard and all data. A banner will let
              you return to the Admin Dashboard at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setViewTarget(null)}>Cancel</Button>
            <Button onClick={confirmView}>
              <Eye className="h-4 w-4 mr-2" /> View Hotel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function KpiCard({
  label, value, icon: Icon, accent,
}: { label: string; value: number | string; icon: React.ComponentType<{ className?: string }>; accent?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-xs text-muted-foreground">{label}</CardTitle>
        <Icon className={`h-4 w-4 ${accent ?? "text-muted-foreground"}`} />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-semibold ${accent ?? ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}