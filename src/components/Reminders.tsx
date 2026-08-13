import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Bell, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { reportQueryError } from "@/lib/queryError";
import { toastError } from "@/lib/errorMessage";

export interface Reminder {
  id: string;
  property_id: string;
  title: string;
  reminder_datetime: string;
  notes: string | null;
  is_dismissed: boolean;
  created_at: string;
  is_read?: boolean;
  type?: string;
  category?: string | null;
  message?: string | null;
}

function playBeep() {
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
    setTimeout(() => ctx.close(), 1000);
  } catch { /* ignore */ }
}

function fmtWhen(iso: string) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso ?? "");
    return d.toLocaleString("en-IN", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    try { return new Date(iso).toString(); } catch { return String(iso ?? ""); }
  }
}

/**
 * Single source of truth for the reminders poll.
 *
 * PERF: the bell and the dashboard section used to each own a
 * `setInterval(..., 60_000)` firing its own query — two network calls per
 * minute for the same rows (~29.6k calls observed). They now share one
 * React Query entry with `refetchInterval`, so React Query dedupes them into
 * ONE request per minute no matter how many consumers are mounted. Never
 * re-add a component-local reminders poll.
 */
const remindersKey = (propertyId: string | null) => ["reminders", propertyId] as const;

function useRemindersQuery(propertyId: string | null) {
  return useQuery<Reminder[]>({
    queryKey: remindersKey(propertyId),
    enabled: !!propertyId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      if (!propertyId) return [];
      const { data, error: __qe1 } = await supabase
        .from("reminders")
        .select("id, property_id, title, reminder_datetime, notes, is_dismissed, created_at, is_read, type, category, message")
        .eq("property_id", propertyId)
        .eq("is_dismissed", false)
        .order("created_at", { ascending: false })
        .limit(100);
      if (__qe1) reportQueryError("reminders", __qe1);
      return (data ?? []) as Reminder[];
    },
  });
}

export function RemindersBell({ propertyId, userId }: { propertyId: string | null; userId: string }) {
  const qc = useQueryClient();
  const qKey = remindersKey(propertyId);
  const { data: reminders = [] } = useRemindersQuery(propertyId);
  const setReminders = (updater: (rs: Reminder[]) => Reminder[]) => {
    qc.setQueryData<Reminder[]>(qKey, (rs) => updater(rs ?? []));
  };
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [notes, setNotes] = useState("");
  const alertedRef = useRef<Map<string, { pre: boolean; now: boolean }>>(new Map());

  const load = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: remindersKey(propertyId) });
  }, [qc, propertyId]);

  // 60-second local tick: evaluates the 15-min advance window against the
  // rows the shared query already holds. NO fetch here — refetching is owned
  // by useRemindersQuery's refetchInterval.
  useEffect(() => {
    if (!propertyId) return;
    const tick = () => {
      const now = Date.now();
      reminders.forEach((r) => {
        if (r.is_dismissed) return;
        const state = alertedRef.current.get(r.id) ?? { pre: false, now: false };
        // Arrival alerts are created by the hourly system job with
        // reminder_datetime = creation time, so they may already be in the
        // past when the page loads. Alert once per session on first sight.
        if (r.type === "system" && r.category === "reservation_arrival") {
          if (!state.now && !r.is_read) {
            state.now = true;
            toast(`🛎️ ${r.title}`, {
              description: r.message ?? r.notes ?? undefined,
              duration: 10000,
              action: { label: "Dismiss", onClick: () => dismiss(r.id) },
            });
            playBeep();
          }
          alertedRef.current.set(r.id, state);
          return;
        }
        const t = new Date(r.reminder_datetime).getTime();
        const diffMs = t - now;
        if (!state.pre && diffMs > 0 && diffMs <= 15 * 60 * 1000) {
          state.pre = true;
          const mins = Math.max(1, Math.round(diffMs / 60000));
          toast(`⏰ Reminder: ${r.title} — in ${mins} minute${mins === 1 ? "" : "s"}`, {
            description: r.notes ?? undefined,
            duration: 10000,
            action: { label: "Dismiss", onClick: () => dismiss(r.id) },
          });
          playBeep();
        }
        if (!state.now && diffMs <= 0 && diffMs > -2 * 60 * 1000) {
          state.now = true;
          toast(`⏰ Reminder now: ${r.title}`, {
            description: r.notes ?? undefined,
            duration: 10000,
            action: { label: "Dismiss", onClick: () => dismiss(r.id) },
          });
          playBeep();
        }
        alertedRef.current.set(r.id, state);
      });
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, reminders]);

  async function dismiss(id: string) {
    await supabase.from("reminders").update({ is_dismissed: true }).eq("id", id);
    setReminders((rs) => rs.filter((r) => r.id !== id));
  }

  async function markRead(id: string) {
    await supabase.from("reminders")
      .update({ is_read: true, read_by: userId, read_at: new Date().toISOString() } as any)
      .eq("id", id);
    setReminders((rs) => rs.map((r) => (r.id === id ? { ...r, is_read: true } : r)));
  }

  async function markAllRead() {
    if (!propertyId) return;
    await supabase.from("reminders")
      .update({ is_read: true, read_by: userId, read_at: new Date().toISOString() } as any)
      .eq("property_id", propertyId)
      .eq("is_dismissed", false)
      .eq("is_read", false);
    setReminders((rs) => rs.map((r) => ({ ...r, is_read: true })));
  }

  async function addReminder() {
    if (!propertyId) return;
    if (!title.trim()) { toast.error("Title is required"); return; }
    if (!when) { toast.error("Date & time is required"); return; }
    const { error } = await supabase.from("reminders").insert({
      property_id: propertyId,
      created_by: userId || null,
      title: title.trim(),
      reminder_datetime: new Date(when).toISOString(),
      notes: notes.trim() || null,
      type: "manual",
    } as any);
    if (error) { toastError(error); return; }
    toast.success("Reminder added");
    setTitle(""); setWhen(""); setNotes("");
    setAddOpen(false);
    load();
  }

  const count = reminders.filter((r) => !r.is_read).length;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="relative h-10 w-10" aria-label="Reminders">
            <Bell style={{ width: 24, height: 24 }} />
            {count > 0 && (
              <span className="absolute -top-1 -right-1 inline-flex items-center justify-center rounded-full bg-red-600 px-1 font-bold text-white" style={{ height: 18, minWidth: 18, fontSize: 11 }}>
                {count}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b">
            <div className="font-semibold text-sm">Reminders</div>
            <div className="flex items-center gap-1">
              {count > 0 && (
                <Button size="sm" variant="ghost" className="text-xs h-7" onClick={markAllRead}>
                  Mark all read
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setAddOpen(true); }}>
                <Plus className="h-4 w-4 mr-1" /> Add
              </Button>
            </div>
          </div>
          <div className="max-h-80 overflow-auto">
            {reminders.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">No reminders</div>
            ) : reminders.map((r) => (
              <div
                key={r.id}
                onClick={() => { if (!r.is_read) markRead(r.id); }}
                className={`px-3 py-2 border-b last:border-0 text-sm cursor-pointer ${
                  r.is_read ? "bg-background" : "bg-primary/5"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className={`truncate ${r.is_read ? "font-medium" : "font-semibold"}`}>
                      {!r.is_read && <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary mr-1.5 align-middle" />}
                      {r.title}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.type === "system" && r.category ? `${r.category.replace(/_/g, " ")} · ` : ""}
                      {fmtWhen(r.reminder_datetime)}
                    </div>
                    {(r.message || r.notes) && (
                      <div className="text-xs text-muted-foreground mt-1">{r.message || r.notes}</div>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={(e) => { e.stopPropagation(); dismiss(r.id); }}
                    aria-label="Dismiss"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add reminder</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Title *</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Call vendor" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Date & time *</Label>
              <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={addReminder}>Save reminder</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RemindersSection({ propertyId, userId }: { propertyId: string | null; userId: string }) {
  const qc = useQueryClient();
  // Shares the SAME query entry as RemindersBell — one poll, two consumers.
  const { data: fetched = [], refetch } = useRemindersQuery(propertyId);
  const reminders = [...fetched].sort(
    (a, b) => a.reminder_datetime.localeCompare(b.reminder_datetime),
  );
  const setReminders = (updater: (rs: Reminder[]) => Reminder[]) => {
    qc.setQueryData<Reminder[]>(remindersKey(propertyId), (rs) => updater(rs ?? []));
  };
  const [addOpen, setAddOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => { await refetch(); }, [refetch]);

  async function dismiss(id: string) {
    await supabase.from("reminders").update({ is_dismissed: true }).eq("id", id);
    setReminders((rs) => rs.filter((r) => r.id !== id));
  }

  async function add() {
    if (!propertyId) return;
    if (!title.trim()) { toast.error("Title required"); return; }
    if (!when) { toast.error("Date & time required"); return; }
    const { error } = await supabase.from("reminders").insert({
      property_id: propertyId,
      created_by: userId || null,
      title: title.trim(),
      reminder_datetime: new Date(when).toISOString(),
      notes: notes.trim() || null,
    } as any);
    if (error) { toastError(error); return; }
    toast.success("Reminder added");
    setTitle(""); setWhen(""); setNotes("");
    setAddOpen(false);
    load();
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4" /> Reminders
            <Badge variant="secondary" className="text-[10px]">{reminders.length}</Badge>
          </CardTitle>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Reminder
          </Button>
        </CardHeader>
        <CardContent>
          {reminders.length === 0 ? (
            <div className="text-sm text-muted-foreground">No upcoming reminders.</div>
          ) : (
            <ul className="divide-y">
              {reminders.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{r.title}</div>
                    <div className="text-xs text-muted-foreground">{fmtWhen(r.reminder_datetime)}</div>
                    {r.notes && <div className="text-xs text-muted-foreground mt-0.5">{r.notes}</div>}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => dismiss(r.id)}>Dismiss</Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add reminder</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Title *</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Call vendor" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Date & time *</Label>
              <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={add}>Save reminder</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}