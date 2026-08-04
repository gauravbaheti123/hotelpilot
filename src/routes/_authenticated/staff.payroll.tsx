import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import { Wand2 } from "lucide-react";
import { RequirePermission } from "@/components/RequirePermission";
import {
  ATTENDANCE_WEIGHT, daysInMonth, formatMonth, monthStart,
  type AttendanceStatus,
} from "@/lib/staff-hr";
import { istDateISO } from "@/lib/date";
import { reportQueryError } from "@/lib/queryError";
import { toastError } from "@/lib/errorMessage";

export const Route = createFileRoute("/_authenticated/staff/payroll")({
  head: () => ({ meta: [{ title: "Payroll — HotelPilot" }] }),
  component: () => (<RequirePermission module="staff_hr"><PayrollPage /></RequirePermission>),
});

interface PayrollRow {
  id: string; staff_id: string; period_month: string;
  gross_salary: number; present_days: number; absent_days: number; total_days: number;
  deductions: number; bonus: number; advance: number; net_pay: number;
  status: "draft" | "paid"; paid_at: string | null; paid_via: string | null; notes: string | null;
  staff: { name: string; designation: string | null; salary: number } | null;
}

interface StaffRow { id: string; name: string; designation: string | null; salary: number }

function PayrollPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const [period, setPeriod] = useState(monthStart());
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [editing, setEditing] = useState<PayrollRow | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    if (!propertyId) return;
    const { data, error: __qe1 } = await supabase.from("payroll_runs")
      .select("id,staff_id,period_month,gross_salary,present_days,absent_days,total_days,deductions,bonus,advance,net_pay,status,paid_at,paid_via,notes,staff(name,designation,salary)")
      .eq("property_id", propertyId)
      .eq("period_month", period)
      .order("created_at", { ascending: true });
    if (__qe1) reportQueryError("payroll runs", __qe1);
    setRows((data ?? []) as unknown as PayrollRow[]);
  }, [propertyId, period]);

  useEffect(() => { load(); }, [load]);

  async function generate() {
    if (!propertyId) return;
    setGenerating(true);
    try {
      const days = daysInMonth(period);
      const monthEnd = new Date(period);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      monthEnd.setDate(0);
      const fromStr = period;
      const toStr = istDateISO(monthEnd);

      const { data: staff, error: __qe2 } = await supabase.from("staff")
        .select("id,name,designation,salary")
        .eq("property_id", propertyId).eq("is_active", true);
      if (__qe2) reportQueryError("staff", __qe2);
      const staffList = (staff ?? []) as StaffRow[];

      const { data: att, error: __qe3 } = await supabase.from("attendance")
        .select("staff_id,status")
        .eq("property_id", propertyId)
        .gte("attendance_date", fromStr).lte("attendance_date", toStr);
      if (__qe3) reportQueryError("attendance", __qe3);
      const byStaff = new Map<string, { present: number; absent: number }>();
      (att ?? []).forEach((r) => {
        const rec = byStaff.get(r.staff_id) ?? { present: 0, absent: 0 };
        const w = ATTENDANCE_WEIGHT[r.status as AttendanceStatus] ?? 0;
        if (w > 0) rec.present += w; else rec.absent += 1;
        byStaff.set(r.staff_id, rec);
      });

      const { data: u } = await supabase.auth.getUser();
      const payload = staffList.map((s) => {
        const a = byStaff.get(s.id) ?? { present: 0, absent: 0 };
        const gross = Number(s.salary) || 0;
        const perDay = gross / days;
        const net = +(perDay * a.present).toFixed(2);
        return {
          property_id: propertyId, staff_id: s.id, period_month: period,
          gross_salary: gross,
          present_days: a.present, absent_days: a.absent, total_days: days,
          deductions: 0, bonus: 0, advance: 0, net_pay: net,
          status: "draft", created_by: u.user?.id ?? null,
        };
      });

      const { error } = await supabase.from("payroll_runs")
        .upsert(payload as never, { onConflict: "property_id,staff_id,period_month" });
      if (error) throw error;
      toast.success(`Generated payroll for ${payload.length} staff`);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  function recalcNet(row: PayrollRow): number {
    const perDay = row.total_days > 0 ? Number(row.gross_salary) / row.total_days : 0;
    return +(perDay * Number(row.present_days) + Number(row.bonus) - Number(row.deductions) - Number(row.advance)).toFixed(2);
  }

  async function saveEdit() {
    if (!editing) return;
    const net = recalcNet(editing);
    const { error } = await supabase.from("payroll_runs").update({
      present_days: editing.present_days,
      absent_days: editing.absent_days,
      deductions: editing.deductions,
      bonus: editing.bonus,
      advance: editing.advance,
      net_pay: net,
      notes: editing.notes,
    }).eq("id", editing.id);
    if (error) return toastError(error);
    toast.success("Saved");
    setEditing(null);
    load();
  }

  async function markPaid(row: PayrollRow, mode: "cash" | "card" | "upi" | "bank") {
    const { error } = await supabase.from("payroll_runs").update({
      status: "paid", paid_at: new Date().toISOString(), paid_via: mode,
    }).eq("id", row.id);
    if (error) return toastError(error);
    toast.success("Marked paid");
    load();
  }

  const totals = useMemo(() => ({
    gross: rows.reduce((s, r) => s + Number(r.gross_salary), 0),
    net: rows.reduce((s, r) => s + Number(r.net_pay), 0),
    paid: rows.filter((r) => r.status === "paid").reduce((s, r) => s + Number(r.net_pay), 0),
  }), [rows]);

  if (!propertyId) return <AppShell title="Payroll"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="Payroll">
      <div className="space-y-4 max-w-6xl">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <div className="text-[10px] uppercase text-muted-foreground">Period</div>
            <Input type="month"
              value={period.slice(0, 7)}
              onChange={(e) => setPeriod(e.target.value + "-01")}
              className="w-40" />
          </div>
          <div className="text-sm text-muted-foreground">{formatMonth(period)}</div>
          <div className="ml-auto">
            <Button onClick={generate} disabled={generating}>
              <Wand2 className="h-4 w-4 mr-1" />
              {generating ? "Generating…" : "Generate from attendance"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Card><CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Gross</div>
            <div className="text-2xl font-semibold">₹{totals.gross.toFixed(2)}</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Net Payable</div>
            <div className="text-2xl font-semibold">₹{totals.net.toFixed(2)}</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Paid</div>
            <div className="text-2xl font-semibold text-green-600">₹{totals.paid.toFixed(2)}</div>
          </CardContent></Card>
        </div>

        <Card><CardContent className="pt-6">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No payroll for this period. Click "Generate from attendance".
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Present</TableHead>
                  <TableHead className="text-right">Absent</TableHead>
                  <TableHead className="text-right">Bonus</TableHead>
                  <TableHead className="text-right">Ded.</TableHead>
                  <TableHead className="text-right">Advance</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{r.staff?.name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{r.staff?.designation ?? ""}</div>
                    </TableCell>
                    <TableCell className="text-right">₹{Number(r.gross_salary).toFixed(0)}</TableCell>
                    <TableCell className="text-right">{Number(r.present_days).toFixed(1)}</TableCell>
                    <TableCell className="text-right">{Number(r.absent_days).toFixed(0)}</TableCell>
                    <TableCell className="text-right">₹{Number(r.bonus).toFixed(0)}</TableCell>
                    <TableCell className="text-right">₹{Number(r.deductions).toFixed(0)}</TableCell>
                    <TableCell className="text-right">₹{Number(r.advance).toFixed(0)}</TableCell>
                    <TableCell className="text-right font-semibold">₹{Number(r.net_pay).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "paid" ? "default" : "outline"}>
                        {r.status === "paid" ? `Paid · ${r.paid_via ?? ""}` : "Draft"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {r.status !== "paid" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setEditing({ ...r })}>Edit</Button>
                            <Select onValueChange={(v) => markPaid(r, v as "cash" | "card" | "upi" | "bank")}>
                              <SelectTrigger className="w-28 h-8 text-xs"><SelectValue placeholder="Pay" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="cash">Cash</SelectItem>
                                <SelectItem value="upi">UPI</SelectItem>
                                <SelectItem value="bank">Bank</SelectItem>
                                <SelectItem value="card">Card</SelectItem>
                              </SelectContent>
                            </Select>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent></Card>

        <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit payroll · {editing?.staff?.name}</DialogTitle></DialogHeader>
            {editing && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label className="text-xs">Present days</Label>
                  <Input type="number" step="0.5" value={editing.present_days}
                    onChange={(e) => setEditing({ ...editing, present_days: Number(e.target.value) })} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Absent days</Label>
                  <Input type="number" step="0.5" value={editing.absent_days}
                    onChange={(e) => setEditing({ ...editing, absent_days: Number(e.target.value) })} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Bonus</Label>
                  <Input type="number" step="0.01" value={editing.bonus}
                    onChange={(e) => setEditing({ ...editing, bonus: Number(e.target.value) })} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Deductions</Label>
                  <Input type="number" step="0.01" value={editing.deductions}
                    onChange={(e) => setEditing({ ...editing, deductions: Number(e.target.value) })} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Advance</Label>
                  <Input type="number" step="0.01" value={editing.advance}
                    onChange={(e) => setEditing({ ...editing, advance: Number(e.target.value) })} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Net (preview)</Label>
                  <Input value={`₹${recalcNet(editing).toFixed(2)}`} readOnly /></div>
                <div className="col-span-2 space-y-1.5"><Label className="text-xs">Notes</Label>
                  <Input value={editing.notes ?? ""} maxLength={200}
                    onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={saveEdit}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}