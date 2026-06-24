import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { useAuth } from "@/hooks/use-auth";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import { FEEDBACK_SOURCES } from "@/lib/feedback";
import { Star } from "lucide-react";

export const Route = createFileRoute("/_authenticated/feedback/new")({
  head: () => ({ meta: [{ title: "New Feedback — HotelPilot" }] }),
  component: NewFeedbackPage,
});

interface BookingOpt { id: string; booking_number: string; guests: { id: string; name: string } | null }

function Stars({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className="p-0.5 hover:scale-110 transition"
        >
          <Star className={`h-7 w-7 ${n <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
        </button>
      ))}
      {value > 0 && <span className="ml-2 text-sm text-muted-foreground">{value}/5</span>}
    </div>
  );
}

function NewFeedbackPage() {
  const router = useRouter();
  const { current } = useCurrentProperty();
  const { user } = useAuth();
  const [bookings, setBookings] = useState<BookingOpt[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    booking_id: "",
    guest_name: "",
    feedback_date: new Date().toISOString().slice(0, 10),
    source: "in_person",
    overall_rating: 0,
    cleanliness_rating: 0,
    service_rating: 0,
    food_rating: 0,
    value_rating: 0,
    would_recommend: true,
    comments: "",
  });

  useEffect(() => {
    if (!current) return;
    supabase
      .from("bookings")
      .select("id,booking_number,guests(id,name)")
      .eq("property_id", current.id)
      .in("status", ["checked_in", "checked_out"])
      .order("check_out", { ascending: false })
      .limit(50)
      .then(({ data }) => setBookings((data ?? []) as unknown as BookingOpt[]));
  }, [current?.id]);

  function set<K extends keyof typeof form>(k: K, v: any) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit() {
    if (!current) return;
    if (form.overall_rating < 1) { toast.error("Please rate overall experience"); return; }
    if (!form.booking_id && !form.guest_name.trim()) { toast.error("Select a booking or enter guest name"); return; }
    setBusy(true);
    const booking = bookings.find((b) => b.id === form.booking_id);
    const payload = {
      property_id: current.id,
      booking_id: form.booking_id || null,
      guest_id: booking?.guests?.id ?? null,
      guest_name: form.guest_name.trim() || booking?.guests?.name || null,
      feedback_date: form.feedback_date,
      source: form.source,
      overall_rating: form.overall_rating,
      cleanliness_rating: form.cleanliness_rating || null,
      service_rating: form.service_rating || null,
      food_rating: form.food_rating || null,
      value_rating: form.value_rating || null,
      would_recommend: form.would_recommend,
      comments: form.comments.trim() || null,
      created_by: user?.id ?? null,
    };
    const { error } = await supabase.from("guest_feedback").insert(payload);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Feedback recorded");
    router.navigate({ to: "/feedback" });
  }

  if (!current) return <AppShell title="New Feedback"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="New Feedback">
      <div className="max-w-3xl">
        <Card>
          <CardHeader><CardTitle>Record guest feedback</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Booking (optional)</Label>
                <Select value={form.booking_id} onValueChange={(v) => set("booking_id", v)}>
                  <SelectTrigger><SelectValue placeholder="Walk-in / external review" /></SelectTrigger>
                  <SelectContent>
                    {bookings.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.booking_number} — {b.guests?.name ?? "Guest"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Guest name (if no booking)</Label>
                <Input value={form.guest_name} onChange={(e) => set("guest_name", e.target.value)} placeholder="Name" />
              </div>
              <div className="space-y-2">
                <Label>Feedback date</Label>
                <Input type="date" value={form.feedback_date} onChange={(e) => set("feedback_date", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Source</Label>
                <Select value={form.source} onValueChange={(v) => set("source", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FEEDBACK_SOURCES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border p-4">
              <div>
                <Label className="text-base">Overall experience *</Label>
                <Stars value={form.overall_rating} onChange={(n) => set("overall_rating", n)} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Cleanliness</Label>
                  <Stars value={form.cleanliness_rating} onChange={(n) => set("cleanliness_rating", n)} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Service</Label>
                  <Stars value={form.service_rating} onChange={(n) => set("service_rating", n)} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Food</Label>
                  <Stars value={form.food_rating} onChange={(n) => set("food_rating", n)} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Value for money</Label>
                  <Stars value={form.value_rating} onChange={(n) => set("value_rating", n)} />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <Label className="text-base">Would recommend to others?</Label>
                <p className="text-xs text-muted-foreground">Used for NPS-style tracking</p>
              </div>
              <Switch checked={form.would_recommend} onCheckedChange={(v) => set("would_recommend", v)} />
            </div>

            <div className="space-y-2">
              <Label>Comments</Label>
              <Textarea
                rows={4}
                value={form.comments}
                onChange={(e) => set("comments", e.target.value)}
                placeholder="What did the guest say?"
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save feedback"}</Button>
              <Button variant="outline" onClick={() => router.navigate({ to: "/feedback" })}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}