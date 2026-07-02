import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import { DeliveryProof } from "@/components/DeliveryProof";
import { AlertTriangle, PlusCircle, RefreshCcw, X, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/food/dashboard")({
  head: () => ({ meta: [{ title: "Food Dashboard — HotelPilot" }] }),
  component: FoodDashboardPage,
});

interface KotItem { id: string; item_name: string; qty: number; kot_station: string | null; is_void: boolean | null }
interface KotRow {
  id: string;
  kot_number: string;
  kot_type: string;
  table_no: string | null;
  guest_name: string | null;
  status: string;
  total_amount: number;
  created_at: string;
  printed_at: string | null;
  served_at: string | null;
  billed_at: string | null;
  booking_id: string | null;
  room_id: string | null;
  kot_copy: string | null;
  delivery_proof_url: string | null;
  delivery_photo_taken_at: string | null;
  delivery_photo_taken_by: string | null;
  rooms: { room_number: string } | null;
  bookings: { id: string; check_out: string; guests: { name: string } | null } | null;
  kot_items: KotItem[];
}

const STATUS_META = {
  open:    { label: "Open",    header: "bg-amber-500 text-white",  count: "bg-amber-100 text-amber-900" },
  printed: { label: "Printed", header: "bg-blue-500 text-white",   count: "bg-blue-100 text-blue-900" },
  served:  { label: "Served",  header: "bg-orange-500 text-white", count: "bg-orange-100 text-orange-900" },
  billed:  { label: "Billed",  header: "bg-emerald-600 text-white",count: "bg-emerald-100 text-emerald-900" },
} as const;

function minutesSince(iso: string | null) {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}
function ago(iso: string | null) {
  const m = minutesSince(iso);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}
function isoStartOfToday() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function todayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

function FoodDashboardPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const { user } = useAuth();
  const [rows, setRows] = useState<KotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [kitchen, setKitchen] = useState<string>("all");
  const [dismissBanner, setDismissBanner] = useState(false);
  const [posting, setPosting] = useState<string | null>(null);
  const [requireProof, setRequireProof] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!propertyId) return;
    const { data } = await supabase
      .from("kot_orders")
      .select(
        "id,kot_number,kot_type,table_no,guest_name,status,total_amount,created_at,printed_at,served_at,billed_at,booking_id,room_id,kot_copy," +
          "delivery_proof_url,delivery_photo_taken_at,delivery_photo_taken_by," +
          "rooms(room_number)," +
          "bookings(id,check_out,guests(name))," +
          "kot_items(id,item_name,qty,kot_station,is_void)",
      )
      .eq("property_id", propertyId)
      .neq("kot_copy", "restaurant_copy")
      .gte("created_at", isoStartOfToday())
      .order("created_at", { ascending: false });
    setRows((data ?? []) as unknown as KotRow[]);
    setLoading(false);
  }, [propertyId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Load property-level "require delivery proof" setting
  useEffect(() => {
    if (!propertyId) return;
    (async () => {
      const { data } = await supabase.from("properties")
        .select("require_delivery_proof").eq("id", propertyId).maybeSingle();
      setRequireProof(!!data?.require_delivery_proof);
    })();
  }, [propertyId]);

  // Realtime + polling fallback
  useEffect(() => {
    if (!propertyId) return;
    const ch = supabase
      .channel(`food-dashboard-live-${propertyId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "kot_orders", filter: `property_id=eq.${propertyId}` },
        () => load(),
      )
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    const poll = setInterval(load, 30000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(poll);
    };
  }, [propertyId, load]);

  const kitchens = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.kot_items?.forEach((it) => it.kot_station && s.add(it.kot_station)));
    return Array.from(s).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    if (kitchen === "all") return rows;
    return rows.filter((r) => r.kot_items?.some((it) => it.kot_station === kitchen));
  }, [rows, kitchen]);

  const byStatus = (s: "open" | "printed" | "served" | "billed") =>
    filtered.filter((r) => r.status === s);

  const pendingKots = filtered.filter((r) => ["open", "printed", "served"].includes(r.status));
  const paymentPendingAmt = pendingKots.reduce((a, r) => a + Number(r.total_amount || 0), 0);
  const billedToday = filtered.filter((r) => r.status === "billed")
    .reduce((a, r) => a + Number(r.total_amount || 0), 0);

  // Group pending by room/booking
  const pendingByRoom = useMemo(() => {
    const map = new Map<string, {
      booking_id: string; room_no: string; guest_name: string;
      amount: number; last_time: string; check_out: string | null; kot_ids: string[];
    }>();
    for (const r of pendingKots) {
      if (!r.booking_id) continue;
      const key = r.booking_id;
      const cur = map.get(key);
      const rec = cur ?? {
        booking_id: r.booking_id,
        room_no: r.rooms?.room_number ?? "—",
        guest_name: r.bookings?.guests?.name ?? r.guest_name ?? "Guest",
        amount: 0, last_time: r.created_at,
        check_out: r.bookings?.check_out ?? null,
        kot_ids: [],
      };
      rec.amount += Number(r.total_amount || 0);
      rec.kot_ids.push(r.id);
      if (new Date(r.created_at) > new Date(rec.last_time)) rec.last_time = r.created_at;
      map.set(key, rec);
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [pendingKots]);

  const checkoutToday = pendingByRoom.filter((p) => p.check_out === todayDateStr() && p.amount > 0);

  async function markPrinted(id: string) {
    await supabase.from("kot_orders").update({ status: "printed", printed_at: new Date().toISOString() }).eq("id", id);
    toast.success("Marked printed"); load();
  }
  async function markServed(id: string) {
    await supabase.from("kot_orders").update({ status: "served", served_at: new Date().toISOString() }).eq("id", id);
    toast.success("Marked served"); load();
  }

  async function addKotToBill(k: KotRow): Promise<boolean> {
    if (requireProof && !k.delivery_proof_url) {
      toast.error(`Capture delivery proof for ${k.kot_number} before billing`);
      return false;
    }
    if (!k.booking_id) {
      const { error } = await supabase.from("kot_orders").update({ status: "billed", billed_at: new Date().toISOString() }).eq("id", k.id);
      if (error) { toast.error(error.message); return false; }
      return true;
    }
    const f = await (supabase as any).rpc("get_or_create_folio", { _booking_id: k.booking_id });
    if (f.error) { toast.error(f.error.message); return false; }
    const amt = Number(k.total_amount || 0);
    const { error: fcErr } = await supabase.from("folio_charges").insert({
      folio_id: f.data,
      charge_type: "food",
      description: `Food — KOT ${k.kot_number}`,
      qty: 1, rate: amt, amount: amt,
      gst_rate: 0, gst_amount: 0,
      source_table: "kot_orders", source_id: k.id,
      created_by: user?.id ?? null,
    } as any);
    if (fcErr) { toast.error(fcErr.message); return false; }
    const { error: uErr } = await supabase.from("kot_orders")
      .update({ status: "billed", billed_at: new Date().toISOString() }).eq("id", k.id);
    if (uErr) { toast.error(uErr.message); return false; }
    return true;
  }

  async function addAllToBill(bookingId: string, ids: string[]) {
    setPosting(bookingId);
    let ok = 0;
    for (const id of ids) {
      const k = rows.find((r) => r.id === id);
      if (!k) continue;
      const done = await addKotToBill(k);
      if (done) ok++;
    }
    setPosting(null);
    if (ok) toast.success(`${ok} KOT(s) added to bill`);
    load();
  }

  if (!propertyId) return <AppShell title="Food Dashboard"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="Food Dashboard">
      {/* Checkout alert banner */}
      {!dismissBanner && checkoutToday.length > 0 && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="font-semibold text-red-900">
                {checkoutToday.length} guest(s) due for checkout today have pending food bills!
              </div>
              <div className="mt-2 space-y-1.5">
                {checkoutToday.map((c) => (
                  <div key={c.booking_id} className="flex items-center gap-2 text-sm">
                    <span className="font-medium">Room {c.room_no}</span>
                    <span className="text-muted-foreground">— {c.guest_name} —</span>
                    <span className="font-semibold text-red-700">₹{c.amount.toLocaleString("en-IN")} pending</span>
                    <Button size="sm" variant="outline" className="h-7 ml-auto"
                      disabled={posting === c.booking_id}
                      onClick={() => addAllToBill(c.booking_id, c.kot_ids)}>
                      Add to Bill
                    </Button>
                  </div>
                ))}
              </div>
            </div>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDismissBanner(true)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Today's Operations</h2>
          <span className={`inline-flex items-center gap-1 text-xs ${live ? "text-emerald-600" : "text-muted-foreground"}`}>
            <span className={`h-2 w-2 rounded-full ${live ? "bg-emerald-500" : "bg-gray-400"}`} />
            {live ? "Live" : "Offline"}
          </span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load}><RefreshCcw className="h-4 w-4 mr-1" />Refresh</Button>
          <Link to="/food/new"><Button size="sm"><PlusCircle className="h-4 w-4 mr-1" />New KOT</Button></Link>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-4">
        <button onClick={() => boardRef.current?.scrollIntoView({ behavior: "smooth" })}
          className="text-left">
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Pending KOTs</div>
              <div className={`mt-1 text-2xl font-bold ${pendingKots.length > 0 ? "text-red-600" : ""}`}>
                {pendingKots.length}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Not yet billed</div>
            </CardContent>
          </Card>
        </button>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Payment Pending</div>
            <div className={`mt-1 text-2xl font-bold ${paymentPendingAmt > 0 ? "text-red-600" : ""}`}>
              ₹{paymentPendingAmt.toLocaleString("en-IN")}
            </div>
            <div className="text-xs text-muted-foreground mt-1">At risk at checkout</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Today's Food Billed</div>
            <div className="mt-1 text-2xl font-bold text-emerald-600">
              ₹{billedToday.toLocaleString("en-IN")}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Posted to folios</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Total KOTs Today</div>
            <div className="mt-1 text-2xl font-bold">{filtered.length}</div>
            <div className="text-xs text-muted-foreground mt-1">All statuses</div>
          </CardContent>
        </Card>
      </div>

      {/* Kitchen filter tabs */}
      {kitchens.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <Button size="sm" variant={kitchen === "all" ? "default" : "outline"} onClick={() => setKitchen("all")}>
            All Kitchens
          </Button>
          {kitchens.map((k) => (
            <Button key={k} size="sm" variant={kitchen === k ? "default" : "outline"} onClick={() => setKitchen(k)}>
              {k}
            </Button>
          ))}
        </div>
      )}

      {/* KOT board */}
      <div ref={boardRef} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 mb-6">
        {(["open", "printed", "served", "billed"] as const).map((st) => {
          const meta = STATUS_META[st];
          const list = byStatus(st);
          return (
            <div key={st} className="rounded-lg border bg-card overflow-hidden flex flex-col">
              <div className={`px-3 py-2 flex items-center justify-between ${meta.header}`}>
                <span className="font-semibold text-sm">{meta.label}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded ${meta.count}`}>{list.length}</span>
              </div>
              <div className="p-2 space-y-2 max-h-[560px] overflow-y-auto">
                {loading && <p className="text-xs text-muted-foreground p-2">Loading…</p>}
                {!loading && list.length === 0 && <p className="text-xs text-muted-foreground p-2">Empty.</p>}
                {list.map((r) => {
                  const stampIso = st === "printed" ? r.printed_at : st === "served" ? r.served_at : st === "billed" ? r.billed_at : r.created_at;
                  const mins = minutesSince(stampIso);
                  const warnPrinted = st === "printed" && mins > 20;
                  const warnServed  = st === "served"  && mins > 15;
                  const cardCls = warnServed
                    ? "border-red-400 bg-red-50"
                    : warnPrinted ? "border-amber-400 bg-amber-50" : "";
                  const items = (r.kot_items ?? []).filter((it) => !it.is_void);
                  return (
                    <div key={r.id} className={`rounded border p-2 text-sm ${cardCls}`}>
                      <div className="flex items-center justify-between gap-2">
                        <Link to="/food/kot/$id" params={{ id: r.id }} className="font-medium text-primary hover:underline">
                          {r.kot_number}
                        </Link>
                        <div className="text-xs text-muted-foreground">{ago(stampIso)}</div>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {r.kot_type === "room"
                          ? `Room ${r.rooms?.room_number ?? "—"} · ${r.bookings?.guests?.name ?? r.guest_name ?? ""}`
                          : `Table ${r.table_no ?? "—"}`}
                      </div>
                      <div className="mt-1 text-xs space-y-0.5">
                        {items.slice(0, 4).map((it) => (
                          <div key={it.id} className="flex justify-between">
                            <span className="truncate">{it.item_name}</span>
                            <span className="text-muted-foreground shrink-0">× {it.qty}</span>
                          </div>
                        ))}
                        {items.length > 4 && <div className="text-muted-foreground">+{items.length - 4} more…</div>}
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <div className="text-sm font-semibold">₹{Number(r.total_amount).toLocaleString("en-IN")}</div>
                        {st === "open" && (
                          <Button size="sm" className="h-7" onClick={() => markPrinted(r.id)}>Mark Printed</Button>
                        )}
                        {st === "printed" && (
                          <Button size="sm" className="h-7" onClick={() => markServed(r.id)}>Mark Served</Button>
                        )}
                        {st === "served" && (
                          <Button size="sm" className="h-7" disabled={posting === r.id}
                            onClick={async () => {
                              setPosting(r.id);
                              const ok = await addKotToBill(r);
                              setPosting(null);
                              if (ok) { toast.success("Added to bill"); load(); }
                            }}>Add to Bill</Button>
                        )}
                        {st === "billed" && r.billed_at && (
                          <div className="text-xs text-emerald-700">Billed</div>
                        )}
                      </div>
                      {(st === "served" || (st === "billed" && r.delivery_proof_url)) && (
                        <div className="mt-2 pt-2 border-t">
                          <DeliveryProof compact
                            kotId={r.id}
                            propertyId={propertyId}
                            kotNumber={r.kot_number}
                            proofUrl={r.delivery_proof_url}
                            takenAt={r.delivery_photo_taken_at}
                            takenBy={r.delivery_photo_taken_by}
                            onSaved={load}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Payment pending table */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <h3 className="font-semibold">Guests with Pending Food Bills</h3>
          </div>
          {pendingByRoom.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-emerald-700 py-4">
              <CheckCircle2 className="h-4 w-4" /> All food bills settled
            </div>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="px-2 py-2">Room</th>
                    <th className="px-2 py-2">Guest</th>
                    <th className="px-2 py-2">Pending</th>
                    <th className="px-2 py-2">Last Order</th>
                    <th className="px-2 py-2">Check-out</th>
                    <th className="px-2 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingByRoom.map((p) => {
                    const isToday = p.check_out === todayDateStr();
                    return (
                      <tr key={p.booking_id} className="border-b last:border-0">
                        <td className="px-2 py-2 font-medium">{p.room_no}</td>
                        <td className="px-2 py-2">{p.guest_name}</td>
                        <td className="px-2 py-2 font-semibold text-red-600">
                          ₹{p.amount.toLocaleString("en-IN")}
                        </td>
                        <td className="px-2 py-2 text-xs text-muted-foreground">{ago(p.last_time)}</td>
                        <td className={`px-2 py-2 text-xs ${isToday ? "text-red-600 font-semibold" : ""}`}>
                          {p.check_out ?? "—"}
                          {isToday && <Badge variant="destructive" className="ml-1 h-4 text-[10px]">TODAY</Badge>}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Button size="sm" variant="outline" className="h-7"
                            disabled={posting === p.booking_id}
                            onClick={() => addAllToBill(p.booking_id, p.kot_ids)}>
                            Add All to Bill
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}