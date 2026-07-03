import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import { RequirePermission } from "@/components/RequirePermission";
import {
  ATTENDANCE_STATUSES, ATTENDANCE_LABEL, ATTENDANCE_TONE,
  type AttendanceStatus,
} from "@/lib/staff-hr";

export const Route = createFileRoute("/_authenticated/staff/attendance")({
  head: () => ({ meta: [{ title: "Attendance — HotelPilot" }] }),
  component: () => (<RequirePermission module="staff_hr"><AttendancePage /></RequirePermission>),
});

interface StaffRow { id: string; name: string; designation: string | null; department: string | null }
interface AttRow {
  id: string; staff_id: string; status: AttendanceStatus;
  check_in: string | null; check_out: string | null;
  hours_worked: number; notes: string | null;
}

function today() { return new Date().toISOString().slice(0, 10); }

function AttendancePage() {
  const { currentId: propertyId } = useCurrentProperty();
  const [date, setDate] = useState(today());
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [att, setAtt] = useState<Record<string, AttRow>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const loadStaff = useCallback(async () => {
    if (!propertyId) return;
    const { data } = await supabase.from("staff")
      .select("id,name,designation,department")
      .eq("property_id", propertyId).eq("is_active", true)
      .order("name");
    setStaff((data ?? []) as StaffRow[]);
  }, [propertyId]);

  const loadAtt = useCallback(async () => {
    if (!propertyId) return;
    const { data } = await supabase.from("attendance")
      .select("id,staff_id,status,check_in,check_out,hours_worked,notes")
      .eq("property_id", propertyId).eq("attendance_date", date);
    const map: Record<string, AttRow> = {};
    (data ?? []).forEach((r) => { map[(r as AttRow).staff_id] = r as AttRow; });
    setAtt(map);
  }, [propertyId, date]);

  useEffect(() => { loadStaff(); }, [loadStaff]);
  useEffect(() => { loadAtt(); }, [loadAtt]);

  async function setStatus(staffId: string, status: AttendanceStatus) {
    if (!propertyId) return;
    setSaving(staffId);
    const existing = att[staffId];
    const hours = status === "present" || status === "week_off" ? 8 : status === "half_day" ? 4 : 0;
    const { data: u } = await supabase.auth.getUser();
    const payload = {
      property_id: propertyId,
      staff_id: staffId,
      attendance_date: date,
      status,
      hours_worked: hours,
      marked_by: u.user?.id ?? null,
    };
    const { error } = existing
      ? await supabase.from("attendance").update(payload).eq("id", existing.id)
      : await supabase.from("attendance").insert(payload as never);
    setSaving(null);
    if (error) toast.error(error.message); else { toast.success("Marked"); loadAtt(); }
  }

  async function markAllPresent() {
    if (!propertyId) return;
    const targets = staff.filter((s) => !att[s.id]);
    if (targets.length === 0) return toast.info("Already marked");
    const { data: u } = await supabase.auth.getUser();
    const rows = targets.map((s) => ({
      property_id: propertyId, staff_id: s.id, attendance_date: date,
      status: "present", hours_worked: 8, marked_by: u.user?.id ?? null,
    }));
    const { error } = await supabase.from("attendance").insert(rows as never);
    if (error) toast.error(error.message);
    else { toast.success(`Marked ${rows.length} present`); loadAtt(); }
  }

  const summary = useMemo(() => {
    const counts: Record<AttendanceStatus, number> = {
      present: 0, absent: 0, half_day: 0, leave: 0, week_off: 0,
    };
    Object.values(att).forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
    return counts;
  }, [att]);

  if (!propertyId) return <AppShell title="Attendance"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="Attendance">
      <div className="space-y-4 max-w-6xl">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <div className="text-[10px] uppercase text-muted-foreground">Date</div>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
          </div>
          <div className="ml-auto"><Button onClick={markAllPresent}>Mark all present</Button></div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
          <Card><CardContent className="pt-3">
            <div className="text-[10px] uppercase text-muted-foreground">Total staff</div>
            <div className="text-xl font-semibold">{staff.length}</div>
          </CardContent></Card>
          {ATTENDANCE_STATUSES.map((s) => (
            <Card key={s}><CardContent className="pt-3">
              <div className="text-[10px] uppercase text-muted-foreground">{ATTENDANCE_LABEL[s]}</div>
              <div className="text-xl font-semibold">{summary[s]}</div>
            </CardContent></Card>
          ))}
        </div>

        <Card><CardContent className="p-0 divide-y">
          {staff.length === 0 && <p className="p-4 text-sm text-muted-foreground">No active staff.</p>}
          {staff.map((s) => {
            const r = att[s.id];
            return (
              <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{s.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.designation ?? "—"}{s.department ? ` · ${s.department}` : ""}
                  </div>
                </div>
                {r && (
                  <Badge variant="outline" className={ATTENDANCE_TONE[r.status]}>
                    {ATTENDANCE_LABEL[r.status]}
                  </Badge>
                )}
                <Select
                  value={r?.status ?? ""}
                  onValueChange={(v) => setStatus(s.id, v as AttendanceStatus)}
                  disabled={saving === s.id}
                >
                  <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Mark…" /></SelectTrigger>
                  <SelectContent>
                    {ATTENDANCE_STATUSES.map((st) => (
                      <SelectItem key={st} value={st}>{ATTENDANCE_LABEL[st]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </CardContent></Card>
      </div>
    </AppShell>
  );
}