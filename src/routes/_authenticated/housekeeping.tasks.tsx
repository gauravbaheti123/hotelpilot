import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import {
  TASK_STATUSES, TASK_STATUS_TONE, PRIORITY_TONE,
  type TaskStatus,
} from "@/lib/housekeeping";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { logActivity, userDisplayName } from "@/lib/activityLog";
import { useAuth } from "@/hooks/use-auth";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/housekeeping/tasks")({
  head: () => ({ meta: [{ title: "Housekeeping Tasks — HotelPilot" }] }),
  component: () => (<RequirePermission module="tasks"><TasksPage /></RequirePermission>),
});

interface TaskRow {
  id: string; task_type: string; status: string; priority: string;
  due_date: string | null; notes: string | null; created_at: string;
  rooms: { room_number: string; floor: string | null } | null;
  staff: { name: string } | null;
}

function TasksPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const { user } = useAuth();
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | TaskStatus>("pending");

  const load = useCallback(async () => {
    if (!propertyId) return;
    let qy = supabase.from("housekeeping_tasks")
      .select("id,task_type,status,priority,due_date,notes,created_at,rooms(room_number,floor),staff(name)")
      .eq("property_id", propertyId)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(300);
    if (status !== "all") qy = qy.eq("status", status);
    const { data } = await qy;
    setRows((data ?? []) as unknown as TaskRow[]);
  }, [propertyId, status]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => rows.filter((r) =>
    !q || (r.rooms?.room_number ?? "").includes(q) ||
    (r.notes ?? "").toLowerCase().includes(q.toLowerCase()) ||
    r.task_type.includes(q.toLowerCase())), [rows, q]);

  async function setStatusOf(id: string, next: TaskStatus) {
    const prev = rows.find((r) => r.id === id);
    const patch: {
      status: TaskStatus;
      completed_at?: string | null;
      completed_by?: string | null;
    } = { status: next };
    if (next === "done") {
      patch.completed_at = new Date().toISOString();
      const { data } = await supabase.auth.getUser();
      patch.completed_by = data.user?.id ?? null;
    }
    const { error } = await supabase.from("housekeeping_tasks").update(patch).eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Updated");
      if (propertyId && user && prev) {
        logActivity({
          property_id: propertyId,
          user_id: user.id,
          user_name: userDisplayName(user as never),
          action_type: "HK_TASK_UPDATED",
          module: "Housekeeping",
          reference_id: id,
          reference_label: prev.rooms?.room_number ? `Room ${prev.rooms.room_number}` : prev.task_type,
          details: {
            task_id: id,
            room_id: (prev as unknown as { room_id?: string | null }).room_id ?? null,
            old_status: prev.status,
            new_status: next,
          },
        });
      }
      load();
    }
  }

  if (!propertyId) return <AppShell title="Tasks"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="Housekeeping Tasks">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus | "all")}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button asChild><Link to="/housekeeping/new"><Plus className="h-4 w-4 mr-1" />New task</Link></Button>
        </div>
      </div>

      <Card><CardContent className="p-0 divide-y">
        {filtered.length === 0 && <p className="p-4 text-sm text-muted-foreground">No tasks.</p>}
        {filtered.map((r) => (
          <div key={r.id} className="flex items-start gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-medium text-sm">
                  {r.rooms ? `Room ${r.rooms.room_number}` : "—"} · {r.task_type}
                </div>
                <Badge variant="outline" className={`${TASK_STATUS_TONE[r.status]} text-[10px]`}>{r.status.replace("_", " ")}</Badge>
                <Badge variant="outline" className={`${PRIORITY_TONE[r.priority]} text-[10px]`}>{r.priority}</Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 truncate">
                {r.due_date ? `Due ${r.due_date} · ` : ""}{r.staff?.name ? `Assigned ${r.staff.name} · ` : ""}{r.notes ?? ""}
              </div>
            </div>
            <div className="flex gap-1">
              {r.status !== "done" && (
                <>
                  {r.status === "pending" && (
                    <Button size="sm" variant="outline" onClick={() => setStatusOf(r.id, "in_progress")}>Start</Button>
                  )}
                  <Button size="sm" onClick={() => setStatusOf(r.id, "done")}>Done</Button>
                </>
              )}
            </div>
          </div>
        ))}
      </CardContent></Card>
    </AppShell>
  );
}