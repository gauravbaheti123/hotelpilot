import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Send, MessageCircle, Search, AlertCircle } from "lucide-react";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { supabase } from "@/integrations/supabase/client";
import { sendWhatsApp } from "@/lib/whatsapp";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/whatsapp/")({
  head: () => ({ meta: [{ title: "WhatsApp Inbox — HotelPilot" }] }),
  component: WhatsAppInboxPage,
});

interface Msg {
  id: string;
  property_id: string;
  guest_id: string | null;
  booking_id: string | null;
  wa_number: string;
  direction: "inbound" | "outbound";
  content: string | null;
  category: string | null;
  status: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string;
  guest?: { name: string | null } | null;
  room_no?: string | null;
}

const FILTERS = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "food", label: "Food" },
  { id: "complaints", label: "Complaints" },
  { id: "checkout", label: "Checkout" },
] as const;
type FilterId = typeof FILTERS[number]["id"];

function categoryMatches(filter: FilterId, m: Msg): boolean {
  if (filter === "all") return true;
  if (filter === "unread") return m.direction === "inbound" && !m.read_at;
  if (filter === "food") return m.category === "food";
  if (filter === "complaints") return m.category === "housekeeping" || /complain|issue|problem/i.test(m.content ?? "");
  if (filter === "checkout") return m.category === "checkout";
  return true;
}

function WhatsAppInboxPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [activeNumber, setActiveNumber] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState<FilterId>("all");
  const [search, setSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!propertyId) return;
    const { data } = await supabase
      .from("whatsapp_messages")
      .select("id,property_id,guest_id,booking_id,wa_number,direction,content,category,status,sent_at,delivered_at,read_at,created_at,guests(name)")
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false })
      .limit(500);
    const rows: Msg[] = (data ?? []).map((r: any) => ({
      ...r, guest: r.guests ?? null,
    }));
    setMsgs(rows);
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);

  // Realtime subscription for new messages
  useEffect(() => {
    if (!propertyId) return;
    const ch = supabase
      .channel(`wa-${propertyId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_messages", filter: `property_id=eq.${propertyId}` },
        () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [propertyId, load]);

  // Group by wa_number
  const conversations = useMemo(() => {
    const map = new Map<string, { number: string; name: string | null; last: Msg; unread: number; all: Msg[] }>();
    for (const m of msgs) {
      const k = m.wa_number;
      const existing = map.get(k);
      if (!existing) {
        map.set(k, { number: k, name: m.guest?.name ?? null, last: m, unread: m.direction === "inbound" && !m.read_at ? 1 : 0, all: [m] });
      } else {
        existing.all.push(m);
        if (m.direction === "inbound" && !m.read_at) existing.unread += 1;
        if (new Date(m.created_at) > new Date(existing.last.created_at)) existing.last = m;
        if (!existing.name && m.guest?.name) existing.name = m.guest.name;
      }
    }
    return Array.from(map.values())
      .filter((c) => filter === "all" || c.all.some((m) => categoryMatches(filter, m)))
      .filter((c) =>
        !search ||
        (c.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
        c.number.includes(search))
      .sort((a, b) => +new Date(b.last.created_at) - +new Date(a.last.created_at));
  }, [msgs, filter, search]);

  const activeConv = conversations.find((c) => c.number === activeNumber)
    ?? (conversations[0] ?? null);
  const thread = activeConv
    ? [...activeConv.all].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
    : [];

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread.length, activeConv?.number]);

  // Mark inbound as read when opening
  useEffect(() => {
    if (!activeConv) return;
    const unread = activeConv.all.filter((m) => m.direction === "inbound" && !m.read_at);
    if (unread.length === 0) return;
    supabase.from("whatsapp_messages")
      .update({ read_at: new Date().toISOString() })
      .in("id", unread.map((u) => u.id))
      .then(() => load());
  }, [activeConv?.number]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    if (!activeConv || !reply.trim() || !propertyId) return;
    setSending(true);
    const lastWithBooking = activeConv.all.find((m) => m.booking_id);
    const res = await sendWhatsApp({
      property_id: propertyId,
      destination: activeConv.number,
      body_preview: reply,
      guest_id: activeConv.all[0]?.guest_id ?? null,
      booking_id: lastWithBooking?.booking_id ?? null,
    });
    setSending(false);
    if (!res?.ok) { toast.error(res?.error ?? "Send failed"); return; }
    setReply("");
    load();
  }

  if (!propertyId) return <AppShell title="WhatsApp Inbox"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="WhatsApp Inbox">
      <div className="grid gap-3 md:grid-cols-[320px_1fr] h-[calc(100vh-12rem)] min-h-[500px]">
        {/* Left: conversation list */}
        <Card className="flex flex-col overflow-hidden">
          <div className="p-2 border-b space-y-2">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search name or number"
                value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="flex gap-1 flex-wrap">
              {FILTERS.map((f) => (
                <Button key={f.id} size="sm" variant={filter === f.id ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setFilter(f.id)}>{f.label}</Button>
              ))}
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {conversations.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                No conversations yet
              </div>
            )}
            {conversations.map((c) => (
              <button
                key={c.number}
                onClick={() => setActiveNumber(c.number)}
                className={`w-full text-left px-3 py-2.5 border-b hover:bg-muted/50 transition ${
                  activeConv?.number === c.number ? "bg-muted" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium truncate">{c.name ?? c.number}</div>
                  {c.unread > 0 && (
                    <Badge className="h-5 px-1.5 text-[10px] bg-emerald-600">{c.unread}</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate">{c.last.content ?? "—"}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {new Date(c.last.created_at).toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        </Card>

        {/* Right: chat */}
        <Card className="flex flex-col overflow-hidden">
          {!activeConv ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              Select a conversation
            </div>
          ) : (
            <>
              <div className="p-3 border-b flex items-center justify-between">
                <div>
                  <div className="font-medium">{activeConv.name ?? "Unknown guest"}</div>
                  <div className="text-xs text-muted-foreground">{activeConv.number}</div>
                </div>
                {thread.some((m) => m.status === "failed") && (
                  <Badge variant="destructive" className="text-[10px]"><AlertCircle className="h-3 w-3 mr-1" /> Delivery issue</Badge>
                )}
              </div>
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2 bg-muted/20">
                {thread.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                      m.direction === "outbound"
                        ? "bg-emerald-600 text-white rounded-br-sm"
                        : "bg-white border rounded-bl-sm"
                    }`}>
                      <div className="whitespace-pre-wrap break-words">{m.content ?? "—"}</div>
                      <div className={`text-[10px] mt-1 flex items-center gap-1 ${m.direction === "outbound" ? "text-emerald-50/80 justify-end" : "text-muted-foreground"}`}>
                        {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        {m.direction === "outbound" && (
                          <span className="ml-1">
                            {m.status === "read" ? "✓✓" : m.status === "delivered" ? "✓✓" : m.status === "sent" ? "✓" : m.status === "failed" ? "!" : "…"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-3 border-t flex gap-2">
                <Input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Type a reply…"
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                />
                <Button onClick={send} disabled={sending || !reply.trim()}>
                  <Send className="h-4 w-4 mr-1" /> Send
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>
    </AppShell>
  );
}