import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import { CHANNELS, STATUSES, STATUS_TONE, CHANNEL_TONE } from "@/lib/comms";
import { PlusCircle, MessageSquare, Phone, Mail, Smartphone } from "lucide-react";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/comms/")({
  head: () => ({ meta: [{ title: "Guest Communications — HotelPilot" }] }),
  component: () => (<RequirePermission module="communications"><CommsIndexPage /></RequirePermission>),
});

interface Row {
  id: string;
  created_at: string;
  channel: string;
  direction: string;
  recipient: string;
  recipient_name: string | null;
  subject: string | null;
  body: string;
  status: string;
  sent_at: string | null;
  delivered_at: string | null;
  guests: { name: string } | null;
  bookings: { booking_number: string } | null;
}

function ChannelIcon({ ch }: { ch: string }) {
  if (ch === "whatsapp") return <Smartphone className="h-3.5 w-3.5" />;
  if (ch === "sms") return <MessageSquare className="h-3.5 w-3.5" />;
  if (ch === "email") return <Mail className="h-3.5 w-3.5" />;
  if (ch === "call") return <Phone className="h-3.5 w-3.5" />;
  return <MessageSquare className="h-3.5 w-3.5" />;
}

function CommsIndexPage() {
  const { current, loading: propLoading } = useCurrentProperty();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("all");
  const [status, setStatus] = useState("all");

  async function load() {
    if (!current) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("communications")
      .select("id,created_at,channel,direction,recipient,recipient_name,subject,body,status,sent_at,delivered_at,guests(name),bookings(booking_number)")
      .eq("property_id", current.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) toast.error(error.message);
    setRows((data ?? []) as unknown as Row[]);
    setLoading(false);
  }
  useEffect(() => { if (current) load(); /* eslint-disable-next-line */ }, [current?.id]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (channel !== "all" && r.channel !== channel) return false;
    if (status !== "all" && r.status !== status) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = `${r.recipient_name ?? ""} ${r.recipient} ${r.guests?.name ?? ""} ${r.bookings?.booking_number ?? ""} ${r.body}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [rows, search, channel, status]);

  const stats = useMemo(() => {
    const total = rows.length;
    const sent = rows.filter((r) => ["sent", "delivered", "read"].includes(r.status)).length;
    const failed = rows.filter((r) => r.status === "failed").length;
    const inbound = rows.filter((r) => r.direction === "inbound").length;
    return { total, sent, failed, inbound };
  }, [rows]);

  async function markSent(id: string) {
    const { error } = await supabase
      .from("communications")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Marked as sent");
    load();
  }

  if (propLoading) return <AppShell title="Communications"><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (!current) return <AppShell title="Communications"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="Guest Communications">
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Total" value={stats.total.toString()} />
          <Stat label="Sent / delivered" value={stats.sent.toString()} tone="text-emerald-700 dark:text-emerald-300" />
          <Stat label="Inbound" value={stats.inbound.toString()} tone="text-indigo-700 dark:text-indigo-300" />
          <Stat label="Failed" value={stats.failed.toString()} tone={stats.failed > 0 ? "text-rose-700 dark:text-rose-300" : ""} />
        </div>

        <Card>
          <CardContent className="pt-6 flex flex-wrap gap-2 items-center">
            <Input placeholder="Search recipient, booking, body…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All channels</SelectItem>
                {CHANNELS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="ml-auto">
              <Link to="/comms/new"><Button><PlusCircle className="h-4 w-4 mr-1" /> New Message</Button></Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">No messages yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(r.created_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                        <div className="text-[10px] text-muted-foreground">{r.direction === "inbound" ? "← In" : "→ Out"}</div>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] ${CHANNEL_TONE[r.channel] ?? ""}`}>
                          <ChannelIcon ch={r.channel} />
                          {CHANNELS.find((c) => c.value === r.channel)?.label ?? r.channel}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{r.recipient_name ?? r.guests?.name ?? "—"}</div>
                        <div className="text-[10px] text-muted-foreground">{r.recipient}</div>
                        {r.bookings?.booking_number && (
                          <div className="text-[10px] text-muted-foreground">{r.bookings.booking_number}</div>
                        )}
                      </TableCell>
                      <TableCell className="max-w-md">
                        {r.subject && <div className="text-xs font-medium">{r.subject}</div>}
                        <div className="text-xs text-muted-foreground line-clamp-2">{r.body}</div>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex px-2 py-0.5 rounded text-[11px] ${STATUS_TONE[r.status] ?? ""}`}>
                          {STATUSES.find((s) => s.value === r.status)?.label ?? r.status}
                        </span>
                      </TableCell>
                      <TableCell>
                        {(r.status === "draft" || r.status === "queued") && (
                          <Button size="sm" variant="ghost" onClick={() => markSent(r.id)}>Mark sent</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`text-xl font-semibold ${tone ?? ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}