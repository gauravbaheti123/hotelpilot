import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import { TASK_TYPES, TASK_PRIORITIES, type TaskType, type TaskPriority } from "@/lib/housekeeping";

import { RequirePermission } from "@/components/RequirePermission";
import { reportQueryError } from "@/lib/queryError";
export const Route = createFileRoute("/_authenticated/housekeeping/new")({
  head: () => ({ meta: [{ title: "New Task — HotelPilot" }] }),
  component: () => (<RequirePermission module="tasks"><NewTaskPage /></RequirePermission>),
});

function NewTaskPage() {
  const router = useRouter();
  const { currentId: propertyId } = useCurrentProperty();
  const [rooms, setRooms] = useState<{ id: string; room_number: string }[]>([]);
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  const [roomId, setRoomId] = useState<string>("");
  const [taskType, setTaskType] = useState<TaskType>("cleaning");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [dueDate, setDueDate] = useState<string>("");
  const [assignedTo, setAssignedTo] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!propertyId) return;
    (async () => {
      const [{ data: r, error: __qp1 }, { data: s, error: __qp2 }] = await Promise.all([
        supabase.from("rooms").select("id,room_number").eq("property_id", propertyId).eq("is_active", true).order("room_number"),
        supabase.from("staff").select("id,name").eq("property_id", propertyId).eq("is_active", true).order("name"),
      ]);
      if (__qp1) reportQueryError("r", __qp1);
      if (__qp2) reportQueryError("s", __qp2);
      setRooms((r ?? []) as typeof rooms);
      setStaff((s ?? []) as typeof staff);
    })();
  }, [propertyId]);

  async function submit() {
    if (!propertyId) return;
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("housekeeping_tasks").insert({
        property_id: propertyId,
        room_id: roomId || null,
        task_type: taskType,
        priority,
        due_date: dueDate || null,
        assigned_to: assignedTo || null,
        notes: notes || null,
        created_by: u.user?.id ?? null,
      });
      if (error) throw error;
      toast.success("Task created");
      router.navigate({ to: "/housekeeping/tasks" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  if (!propertyId) return <AppShell title="New Task"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="New Housekeeping Task">
      <Card className="max-w-2xl">
        <CardHeader><CardTitle className="text-base">Task details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Room</Label>
              <Select value={roomId} onValueChange={setRoomId}>
                <SelectTrigger><SelectValue placeholder="No specific room" /></SelectTrigger>
                <SelectContent>
                  {rooms.map((r) => <SelectItem key={r.id} value={r.id}>Room {r.room_number}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Type</Label>
              <Select value={taskType} onValueChange={(v) => setTaskType(v as TaskType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Due date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <Label>Assign to</Label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  {staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label>Notes</Label>
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => router.history.back()}>Cancel</Button>
            <Button onClick={submit} disabled={busy}>{busy ? "Creating…" : "Create task"}</Button>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}