import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { useAuth } from "@/hooks/use-auth";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import {
  FEEDBACK_SOURCES, FEEDBACK_STATUSES, STATUS_TONE, ratingTone, avg, npsCategory,
} from "@/lib/feedback";
import { Star, PlusCircle, MessageSquare } from "lucide-react";

export const Route = createFileRoute("/_authenticated/feedback/")({
  head: () => ({ meta: [{ title: "Guest Feedback — HotelPilot" }] }),
  component: FeedbackIndexPage,
});

interface Row {
  id: string;
  feedback_date: string;
  source: string;
  guest_name: string | null;
  overall_rating: number;
  cleanliness_rating: number | null;
  service_rating: number | null;
  food_rating: number | null;
  value_rating: number | null;
  would_recommend: boolean | null;
  comments: string | null;
  response_text: string | null;
  status: string;
  booking_id: string | null;
  guests: { name: string } | null;
  bookings: { booking_number: string } | null;
}

function StarRow({ n }: { n: number | null }) {
  if (n == null) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="flex">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`h-3.5 w-3.5 ${i <= n ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`} />
      ))}
    </div>
  );
}

function FeedbackIndexPage() {
  const { current, loading: propLoading } = useCurrentProperty();
  const { user, roles } = useAuth();
  const canRespond = roles.some((r) => ["superadmin", "owner", "manager"].includes(r));
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [response, setResponse] = useState("");
  const [status, setStatus] = useState("acknowledged");

  async function load() {
    if (!current) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("guest_feedback")
      .select("id,feedback_date,source,guest_name,overall_rating,cleanliness_rating,service_rating,food_rating,value_rating,would_recommend,comments,response_text,status,booking_id,guests(name),bookings(booking_number)")
      .eq("property_id", current.id)
      .order("feedback_date", { ascending: false })
      .limit(200);
    if (error) toast.error(error.message);
    setRows((data ?? []) as unknown as Row[]);
    setLoading(false);
  }

  useEffect(() => { if (current) load(); /* eslint-disable-next-line */ }, [current?.id]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filterStatus !== "all" && r.status !== filterStatus) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${r.guest_name ?? ""} ${r.guests?.name ?? ""} ${r.bookings?.booking_number ?? ""} ${r.comments ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filterStatus, search]);

  const stats = useMemo(() => {
    const total = rows.length;
    const overall = avg(rows.map((r) => r.overall_rating));
    const cleanliness = avg(rows.map((r) => r.cleanliness_rating));
    const service = avg(rows.map((r) => r.service_rating));
    const food = avg(rows.map((r) => r.food_rating));
    const value = avg(rows.map((r) => r.value_rating));
    const promoters = rows.filter((r) => npsCategory(r.overall_rating) === "promoter").length;
    const detractors = rows.filter((r) => npsCategory(r.overall_rating) === "detractor").length;
    const nps = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : 0;
    const open = rows.filter((r) => r.status === "new").length;
    return { total, overall, cleanliness, service, food, value, nps, open, promoters, detractors };
  }, [rows]);

  function openResponse(r: Row) {
    setEditing(r);
    setResponse(r.response_text ?? "");
    setStatus(r.status === "new" ? "acknowledged" : r.status);
  }

  async function saveResponse() {
    if (!editing) return;
    const { error } = await supabase
      .from("guest_feedback")
      .update({
        response_text: response.trim() || null,
        responded_at: response.trim() ? new Date().toISOString() : null,
        responded_by: response.trim() ? user?.id ?? null : null,
        status,
      })
      .eq("id", editing.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Response saved");
    setEditing(null);
    load();
  }

  if (propLoading) return <AppShell title="Guest Feedback"><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (!current) return <AppShell title="Guest Feedback"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="Guest Feedback">
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <StatCard label="Reviews" value={stats.total.toString()} />
          <StatCard label="Overall avg" value={stats.overall ? stats.overall.toFixed(2) : "—"} suffix={stats.overall ? "/5" : ""} tone={ratingTone(stats.overall ?? null)} />
          <StatCard label="NPS" value={`${stats.nps > 0 ? "+" : ""}${stats.nps}`} tone={stats.nps >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"} />
          <StatCard label="Open issues" value={stats.open.toString()} tone={stats.open > 0 ? "text-amber-700 dark:text-amber-300" : ""} />
          <StatCard label="Promoters" value={stats.promoters.toString()} tone="text-emerald-700 dark:text-emerald-300" />
          <StatCard label="Detractors" value={stats.detractors.toString()} tone="text-rose-700 dark:text-rose-300" />
        </div>

        <Card>
          <CardContent className="pt-6 flex flex-wrap gap-2 items-center">
            <Input placeholder="Search guest, booking, comment…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {FEEDBACK_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="ml-auto">
              <Link to="/feedback/new"><Button><PlusCircle className="h-4 w-4 mr-1" /> New Feedback</Button></Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">No feedback recorded yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Guest</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Overall</TableHead>
                    <TableHead>Comment</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => {
                    const src = FEEDBACK_SOURCES.find((s) => s.value === r.source);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs">{r.feedback_date}</TableCell>
                        <TableCell>
                          <div className="font-medium">{r.guest_name ?? r.guests?.name ?? "Anonymous"}</div>
                          {r.bookings?.booking_number && (
                            <div className="text-[10px] text-muted-foreground">{r.bookings.booking_number}</div>
                          )}
                        </TableCell>
                        <TableCell><Badge variant="outline">{src?.label ?? r.source}</Badge></TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <StarRow n={r.overall_rating} />
                            <span className={`text-xs font-medium ${ratingTone(r.overall_rating)}`}>{r.overall_rating}</span>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-xs">
                          <div className="text-xs truncate" title={r.comments ?? ""}>{r.comments ?? "—"}</div>
                          {r.response_text && (
                            <div className="text-[10px] text-emerald-700 dark:text-emerald-300 truncate" title={r.response_text}>
                              ↳ {r.response_text}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] ${STATUS_TONE[r.status] ?? ""}`}>
                            {FEEDBACK_STATUSES.find((s) => s.value === r.status)?.label ?? r.status}
                          </span>
                        </TableCell>
                        <TableCell>
                          {canRespond && (
                            <Button size="sm" variant="ghost" onClick={() => openResponse(r)}>
                              <MessageSquare className="h-4 w-4 mr-1" /> Respond
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Respond to feedback</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="rounded-md border p-3 bg-muted/30">
                <div className="flex items-center gap-2 mb-1">
                  <StarRow n={editing.overall_rating} />
                  <span className="text-xs text-muted-foreground">{editing.feedback_date} · {editing.guest_name ?? editing.guests?.name}</span>
                </div>
                <p className="text-sm">{editing.comments ?? <span className="text-muted-foreground">No comment</span>}</p>
              </div>
              <div>
                <label className="text-sm font-medium">Response</label>
                <Textarea rows={4} value={response} onChange={(e) => setResponse(e.target.value)} placeholder="Management response…" />
              </div>
              <div>
                <label className="text-sm font-medium">Status</label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FEEDBACK_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveResponse}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function StatCard({ label, value, suffix, tone }: { label: string; value: string; suffix?: string; tone?: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`text-xl font-semibold ${tone ?? ""}`}>{value}<span className="text-xs text-muted-foreground">{suffix ?? ""}</span></div>
      </CardContent>
    </Card>
  );
}