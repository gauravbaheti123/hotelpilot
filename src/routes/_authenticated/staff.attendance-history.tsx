import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { RequirePermission } from "@/components/RequirePermission";
import {
  ATTENDANCE_LABEL, ATTENDANCE_TONE, type AttendanceStatus,
  monthStart, monthEnd,
} from "@/lib/staff-hr";

export const Route = createFileRoute("/_authenticated/staff/attendance-history")({
  head: () => ({ meta: [{ title: "Attendance History — HotelPilot" }] }),
  component: () => (<RequirePermission module="staff_hr"><AttHistoryPage /></RequirePermission>),
});

interface Row {
  id: string;
  attendance_date: string;
  status: AttendanceStatus;
  hours_worked: number;
  notes: string | null;
  staff: { name: string; designation: string | null } | null;
}

interface StaffOpt { id: string; name: string }

function AttHistoryPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(monthEnd());
  const [staffId, setStaffId] = useState<string>("all");
  const [staff, setStaff] = useState<StaffOpt[]>([]);
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    let qy = supabase.from("attendance")
      .select("id,attendance_date,status,hours_worked,notes,staff(name,designation)")
      .eq("property_id", propertyId)
      .gte("attendance_date", from)
      .lte("attendance_date", to)
      .order("attendance_date", { ascending: false })
      .limit(500);
    if (staffId !== "all") qy = qy.eq("staff_id", staffId);
    const { data } = await qy;
    setRows((data ?? []) as unknown as Row[]);
  }, [propertyId, from, to, staffId]);

  const loadStaff = useCallback(async () => {
    if (!propertyId) return;
    const { data } = await supabase.from("staff").select("id,name")
      .eq("property_id", propertyId).order("name");
    setStaff((data ?? []) as StaffOpt[]);
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadStaff(); }, [loadStaff]);

  const totals = useMemo(() => {
    const t = { entries: rows.length, hours: 0 };
    rows.forEach((r) => { t.hours += Number(r.hours_worked); });
    return t;
  }, [rows]);

  if (!propertyId) return <AppShell title="Attendance History"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="Attendance History">
      <div className="space-y-4 max-w-6xl">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <div className="text-[10px] uppercase text-muted-foreground">From</div>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <div className="text-[10px] uppercase text-muted-foreground">To</div>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          <Select value={staffId} onValueChange={setStaffId}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All staff</SelectItem>
              {staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="ml-auto text-sm text-muted-foreground">
            {totals.entries} entries · {totals.hours.toFixed(1)} hrs
          </div>
        </div>

        <Card><CardContent className="pt-6">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No records.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Staff</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{r.attendance_date}</TableCell>
                    <TableCell>
                      <div className="font-medium">{r.staff?.name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{r.staff?.designation ?? ""}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={ATTENDANCE_TONE[r.status]}>
                        {ATTENDANCE_LABEL[r.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{Number(r.hours_worked).toFixed(2)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.notes ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent></Card>
      </div>
    </AppShell>
  );
}