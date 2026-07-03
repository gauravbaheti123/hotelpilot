import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import { recomputeFolio, inr } from "@/lib/billing";
import { SUNDRY_CATEGORIES, categoryColor, categoryLabel } from "@/lib/sundry";
import { logActivity, userDisplayName } from "@/lib/activityLog";
import { Plus, Minus, Trash2, Receipt, Send } from "lucide-react";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/pos/")({
  validateSearch: (s: Record<string, unknown>) => ({
    booking_id: typeof s.booking_id === "string" ? s.booking_id : undefined,
  }),
  head: () => ({ meta: [{ title: "POS — HotelPilot" }] }),
  component: () => (<RequirePermission module="pos"><PosPage /></RequirePermission>),
});

interface Booking {
  id: string;
  booking_number: string;
  status: string;
  check_in: string;
  check_out: string;
  guests: { name: string } | null;
  booking_rooms: { rooms: { room_number: string } | null }[];
}
interface Item {
  id: string;
  name: string;
  category: string;
  rate: number;
  gst_rate: number;
  unit: string;
}
interface CartLine {
  item: Item;
  qty: number;
}

function PosPage() {
  const search = useSearch({ from: "/_authenticated/pos/" });
  const { current } = useCurrentProperty();
  const { user } = useAuth();
  const { can } = usePermissions();
  const canCreateCharge = can("pos", "create");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [bookingId, setBookingId] = useState<string>(search.booking_id ?? "");
  const [cat, setCat] = useState<string>("all");
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!current) return;
    Promise.all([
      supabase.from("bookings").select("id,booking_number,status,check_in,check_out,guests(name),booking_rooms(rooms!booking_rooms_room_id_fkey(room_number))").eq("property_id", current.id).in("status", ["checked_in", "reserved"]).order("check_in", { ascending: false }).limit(100),
      supabase.from("sundry_items").select("id,name,category,rate,gst_rate,unit").eq("property_id", current.id).eq("is_active", true).order("name"),
    ]).then(([b, i]) => {
      setBookings((b.data ?? []) as unknown as Booking[]);
      setItems((i.data ?? []) as Item[]);
    });
  }, [current?.id]);

  const filteredItems = useMemo(() => items.filter((it) => {
    if (cat !== "all" && it.category !== cat) return false;
    if (q && !it.name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [items, cat, q]);

  function addToCart(it: Item) {
    setCart((c) => ({ ...c, [it.id]: { item: it, qty: (c[it.id]?.qty ?? 0) + 1 } }));
  }
  function setQty(id: string, qty: number) {
    setCart((c) => {
      if (qty <= 0) {
        const { [id]: _, ...rest } = c;
        return rest;
      }
      return c[id] ? { ...c, [id]: { ...c[id], qty } } : c;
    });
  }
  function removeLine(id: string) {
    setCart((c) => {
      const { [id]: _, ...rest } = c;
      return rest;
    });
  }

  const lines = Object.values(cart);
  const totals = useMemo(() => {
    let sub = 0, gst = 0;
    for (const l of lines) {
      const amt = l.qty * Number(l.item.rate);
      sub += amt;
      gst += Math.round((amt * Number(l.item.gst_rate)) * 100) / 10000 * 100 / 100;
      // simpler: gst += amt * rate /100
    }
    // recompute cleanly
    sub = 0; gst = 0;
    for (const l of lines) {
      const amt = l.qty * Number(l.item.rate);
      sub += amt;
      gst += Math.round(amt * Number(l.item.gst_rate)) / 100;
    }
    return { sub: Math.round(sub * 100) / 100, gst: Math.round(gst * 100) / 100, total: Math.round((sub + gst) * 100) / 100 };
  }, [lines]);

  async function post(navigateAfter: boolean) {
    if (!current) return;
    if (!canCreateCharge) { toast.error("You do not have permission to post POS charges"); return; }
    if (!bookingId) { toast.error("Select a booking"); return; }
    if (lines.length === 0) { toast.error("Cart is empty"); return; }
    setBusy(true);
    // 1. get or create folio
    const { data: folioId, error: fe } = await supabase.rpc("get_or_create_folio", { _booking_id: bookingId });
    if (fe) { toast.error(fe.message); setBusy(false); return; }
    const fId = folioId as unknown as string;

    // 2. insert all lines
    const rows = lines.map((l) => {
      const amt = Math.round(l.qty * Number(l.item.rate) * 100) / 100;
      const gstAmt = Math.round(amt * Number(l.item.gst_rate)) / 100;
      return {
        folio_id: fId,
        charge_type: "extra" as const,
        description: `${categoryLabel(l.item.category)} · ${l.item.name}${l.qty !== 1 ? ` × ${l.qty} ${l.item.unit}` : ""}`,
        qty: l.qty,
        rate: Number(l.item.rate),
        amount: amt,
        gst_rate: Number(l.item.gst_rate),
        gst_amount: gstAmt,
        source_table: "sundry_items",
        source_id: l.item.id,
        created_by: user?.id ?? null,
      };
    });
    const { error: ie } = await supabase.from("folio_charges").insert(rows);
    if (ie) { toast.error(ie.message); setBusy(false); return; }

    // 3. recompute folio totals
    const { data: f } = await supabase.from("folios").select("gst_mode").eq("id", fId).single();
    const { data: allCharges } = await supabase.from("folio_charges").select("charge_type,amount,gst_rate,gst_amount").eq("folio_id", fId);
    const { data: pays } = await supabase.from("payments").select("amount").eq("folio_id", fId);
    const mode = ((f as any)?.gst_mode ?? "gst") as "cash" | "gst";
    const t = recomputeFolio((allCharges ?? []) as any[], mode);
    const paid = (pays ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0);
    await supabase.from("folios").update({
      ...t,
      paid_amount: paid,
      balance_amount: Math.max(0, t.total_amount - paid),
    }).eq("id", fId);

    toast.success(`Posted ${lines.length} charge(s) — ${inr(totals.total)}`);
    if (user && current) {
      logActivity({
        property_id: current.id,
        user_id: user.id,
        user_name: userDisplayName(user as any),
        action_type: "POS_CHARGE_ADDED",
        module: "POS",
        reference_id: bookingId,
        reference_label: `POS ${lines.length} item(s)`,
        details: {
          booking_id: bookingId,
          folio_id: fId,
          items: lines.map((l) => ({ name: l.item.name, qty: l.qty, rate: Number(l.item.rate) })),
          total: totals.total,
        },
      });
    }
    setCart({});
    setBusy(false);
    if (navigateAfter) {
      window.location.href = `/billing/folio/${bookingId}`;
    }
  }

  if (!current) return <AppShell title="POS"><EmptyPropertyState /></AppShell>;

  const selectedBooking = bookings.find((b) => b.id === bookingId);

  return (
    <AppShell title="POS — Sundry Charges">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Catalog */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardContent className="pt-6 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Post to booking</label>
                  <Select value={bookingId} onValueChange={setBookingId}>
                    <SelectTrigger><SelectValue placeholder="Select in-house guest" /></SelectTrigger>
                    <SelectContent>
                      {bookings.map((b) => {
                        const room = b.booking_rooms.map((r) => r.rooms?.room_number).filter(Boolean).join(",");
                        return (
                          <SelectItem key={b.id} value={b.id}>
                            {b.booking_number} — {b.guests?.name ?? "Guest"}{room ? ` · Rm ${room}` : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Search items</label>
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Coke, towel, taxi…" />
                </div>
              </div>

              <div className="flex gap-1 flex-wrap">
                <Button size="sm" variant={cat === "all" ? "default" : "outline"} onClick={() => setCat("all")}>All</Button>
                {SUNDRY_CATEGORIES.map((c) => (
                  <Button
                    key={c.value}
                    size="sm"
                    variant={cat === c.value ? "default" : "outline"}
                    onClick={() => setCat(c.value)}
                  >
                    <span className="inline-block h-2 w-2 rounded-full mr-1.5" style={{ background: c.color }} />
                    {c.label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {filteredItems.length === 0 ? (
              <Card className="col-span-full">
                <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                  No items match. <Link to="/masters/sundry-items" className="text-primary underline">Add items →</Link>
                </CardContent>
              </Card>
            ) : (
              filteredItems.map((it) => {
                const inCart = cart[it.id]?.qty ?? 0;
                return (
                  <button
                    key={it.id}
                    onClick={() => addToCart(it)}
                    className="text-left rounded-lg border bg-card hover:border-primary hover:shadow-md transition p-3 relative"
                    style={{ borderTop: `3px solid ${categoryColor(it.category)}` }}
                  >
                    {inCart > 0 && (
                      <span className="absolute top-2 right-2 inline-flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                        {inCart}
                      </span>
                    )}
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">{categoryLabel(it.category)}</div>
                    <div className="font-medium leading-tight">{it.name}</div>
                    <div className="mt-2 flex items-baseline justify-between">
                      <span className="font-semibold">{inr(it.rate)}</span>
                      <span className="text-[11px] text-muted-foreground">{it.gst_rate}% GST · /{it.unit}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Cart */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cart</CardTitle>
              {selectedBooking && (
                <p className="text-xs text-muted-foreground">
                  Posting to <span className="font-medium">{selectedBooking.booking_number}</span> · {selectedBooking.guests?.name}
                </p>
              )}
            </CardHeader>
            <CardContent>
              {lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">Tap an item to add it.</p>
              ) : (
                <div className="space-y-2">
                  {lines.map((l) => {
                    const amt = l.qty * Number(l.item.rate);
                    return (
                      <div key={l.item.id} className="flex items-center gap-2 border-b pb-2 last:border-0">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{l.item.name}</div>
                          <div className="text-[11px] text-muted-foreground">{inr(l.item.rate)} × {l.qty} {l.item.unit}</div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setQty(l.item.id, l.qty - 1)}>
                            <Minus className="h-3 w-3" />
                          </Button>
                          <Input
                            type="number"
                            value={l.qty}
                            onChange={(e) => setQty(l.item.id, Number(e.target.value) || 0)}
                            className="h-7 w-12 text-center px-1"
                          />
                          <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setQty(l.item.id, l.qty + 1)}>
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="w-20 text-right text-sm font-medium">{inr(amt)}</div>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeLine(l.item.id)}>
                          <Trash2 className="h-3 w-3 text-rose-600" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
              {lines.length > 0 && (
                <div className="mt-4 space-y-1 text-sm border-t pt-3">
                  <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{inr(totals.sub)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">GST</span><span>{inr(totals.gst)}</span></div>
                  <div className="flex justify-between font-semibold text-base pt-1 border-t"><span>Total</span><span>{inr(totals.total)}</span></div>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-2">
            <Button disabled={busy || lines.length === 0 || !bookingId || !canCreateCharge} onClick={() => post(false)}>
              <Send className="h-4 w-4 mr-1" /> Post to folio
            </Button>
            <Button variant="outline" disabled={busy || lines.length === 0 || !bookingId || !canCreateCharge} onClick={() => post(true)}>
              <Receipt className="h-4 w-4 mr-1" /> Post &amp; open folio
            </Button>
            {bookingId && (
              <Link to="/billing/folio/$bookingId" params={{ bookingId }}>
                <Button variant="ghost" className="w-full">View folio</Button>
              </Link>
            )}
          </div>

          {lines.length > 0 && (
            <Badge variant="secondary" className="w-full justify-center py-1">
              {lines.reduce((s, l) => s + l.qty, 0)} item{lines.reduce((s, l) => s + l.qty, 0) === 1 ? "" : "s"} ready to post
            </Badge>
          )}
        </div>
      </div>
    </AppShell>
  );
}