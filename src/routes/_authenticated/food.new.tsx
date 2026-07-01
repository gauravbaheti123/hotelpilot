import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import { computeKotTotals } from "@/lib/food";
import { Plus, Minus, Trash2 } from "lucide-react";
import { ACTIVITY, logActivity, userDisplayName } from "@/lib/activityLog";

export const Route = createFileRoute("/_authenticated/food/new")({
  head: () => ({ meta: [{ title: "New KOT — HotelPilot" }] }),
  component: NewKotPage,
});

interface MenuItem {
  id: string; name: string; price: number; gst_rate: number;
  kot_station: string; is_available: boolean; category_id: string | null;
  kitchen_type?: string;
  kitchen_printer_id?: string | null;
}
interface MenuCategory { id: string; name: string; kot_printer_id?: string | null }
interface PrinterOption { id: string; name: string; location: string | null }
interface InHouseRow {
  id: string; booking_id: string; room_id: string;
  rooms: { room_number: string } | null;
  bookings: { id: string; booking_number: string; guests: { name: string } | null } | null;
}

interface CartLine {
  menu_item_id: string;
  item_name: string;
  qty: number;
  rate: number;
  gst_rate: number;
  kot_station: string;
  kitchen_type: string;
  printer_id: string | null;
  printer_name: string;
  notes?: string;
}

function NewKotPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { currentId: propertyId } = useCurrentProperty();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [cats, setCats] = useState<MenuCategory[]>([]);
  const [printers, setPrinters] = useState<PrinterOption[]>([]);
  const [inhouse, setInhouse] = useState<InHouseRow[]>([]);
  const [activeCat, setActiveCat] = useState<string>("all");
  const [search, setSearch] = useState("");

  const [kotType, setKotType] = useState<"restaurant" | "room">("restaurant");
  const [tableNo, setTableNo] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [notes, setNotes] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [saving, setSaving] = useState(false);
  // Idempotency: a per-form UUID is sent as `client_ref`. A unique index on
  // (property_id, client_ref) guarantees that double-clicking Save will not
  // create a duplicate KOT — the second insert hits 23505 and we recover the
  // first row instead of inserting again.
  const [clientRef, setClientRef] = useState<string>(() =>
    (typeof crypto !== "undefined" && "randomUUID" in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  useEffect(() => {
    if (!propertyId) return;
    (async () => {
      const [mi, mc, pr, ih] = await Promise.all([
        supabase.from("menu_items").select("id,name,price,gst_rate,kot_station,is_available,category_id,kitchen_type,kitchen_printer_id")
          .eq("property_id", propertyId).eq("is_available", true).order("name"),
        supabase.from("menu_categories").select("id,name,kot_printer_id").eq("property_id", propertyId).order("name"),
        supabase.from("printers").select("id,name,location")
          .eq("property_id", propertyId).eq("is_active", true).in("type", ["kot", "both"]).order("name"),
        supabase.from("booking_rooms")
          .select("id,booking_id,room_id,status,rooms!booking_rooms_room_id_fkey(room_number),bookings!inner(id,booking_number,status,guests(name,mobile))")
          .eq("property_id", propertyId)
          .eq("status", "active")
          .eq("bookings.status", "checked_in")
          .order("room_id"),
      ]);
      setItems((mi.data ?? []) as MenuItem[]);
      setCats((mc.data ?? []) as MenuCategory[]);
      setPrinters((pr.data ?? []) as PrinterOption[]);
      setInhouse((ih.data ?? []) as unknown as InHouseRow[]);
    })();
  }, [propertyId]);

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (activeCat !== "all" && i.category_id !== activeCat) return false;
      if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [items, activeCat, search]);

  const totals = useMemo(() => computeKotTotals(cart), [cart]);

  function addItem(it: MenuItem) {
    setCart((prev) => {
      const ex = prev.find((c) => c.menu_item_id === it.id);
      if (ex) return prev.map((c) => c === ex ? { ...c, qty: c.qty + 1 } : c);
      const cat = cats.find((c) => c.id === it.category_id);
      const printerId = it.kitchen_printer_id ?? cat?.kot_printer_id ?? null;
      const printer = printers.find((p) => p.id === printerId);
      const printerName = printer?.name ?? (it.kot_station || "kitchen");
      return [...prev, {
        menu_item_id: it.id, item_name: it.name, qty: 1,
        rate: Number(it.price), gst_rate: Number(it.gst_rate ?? 5),
        kot_station: printerName,
        kitchen_type: it.kitchen_type ?? "hotel",
        printer_id: printerId,
        printer_name: printerName,
      }];
    });
  }

  function bumpQty(id: string, d: number) {
    setCart((prev) => prev
      .map((c) => c.menu_item_id === id ? { ...c, qty: Math.max(0, c.qty + d) } : c)
      .filter((c) => c.qty > 0));
  }

  function removeLine(id: string) {
    setCart((prev) => prev.filter((c) => c.menu_item_id !== id));
  }

  async function save(printNow: boolean) {
    if (!propertyId) return;
    if (cart.length === 0) return toast.error("Add at least one item");
    if (kotType === "restaurant" && !tableNo) return toast.error("Enter table no");
    if (kotType === "room" && !bookingId) return toast.error("Pick in-house booking");
    setSaving(true);
    try {
      const br = inhouse.find((r) => r.booking_id === bookingId);
      const insertPayload = {
        property_id: propertyId,
        kot_type: kotType,
        table_no: kotType === "restaurant" ? tableNo : null,
        booking_id: kotType === "room" ? bookingId : null,
        room_id: kotType === "room" ? (br?.room_id ?? null) : null,
        guest_name: kotType === "room" ? (br?.bookings?.guests?.name ?? null) : null,
        status: printNow ? "printed" : "open",
        sub_total: totals.sub_total,
        gst_amount: totals.gst_amount,
        total_amount: totals.total_amount,
        notes: notes || null,
        printed_at: printNow ? new Date().toISOString() : null,
        created_by: user?.id ?? null,
        kot_copy: "hotel_copy",
        client_ref: clientRef,
      };
      let kot: { id: string } | null = null;
      const { data: kotData, error } = await supabase
        .from("kot_orders").insert(insertPayload as any).select("id").single();
      if (error) {
        // 23505 = unique_violation on (property_id, client_ref). Treat as
        // "already created" and return the existing row instead of failing.
        if ((error as any).code === "23505") {
          const { data: existing } = await supabase
            .from("kot_orders")
            .select("id")
            .eq("property_id", propertyId)
            .eq("client_ref", clientRef)
            .maybeSingle();
          if (existing) {
            toast.info("KOT already saved — opening existing copy");
            router.navigate({ to: "/food/kot/$id", params: { id: existing.id } });
            return;
          }
        }
        throw error;
      }
      kot = kotData;
      const lines = cart.map((c) => ({
        kot_id: kot!.id,
        menu_item_id: c.menu_item_id,
        item_name: c.item_name,
        qty: c.qty,
        rate: c.rate,
        amount: c.qty * c.rate,
        gst_rate: c.gst_rate,
        kot_station: c.kot_station,
        notes: c.notes ?? null,
      }));
      const { error: e2 } = await supabase.from("kot_items").insert(lines as any);
      if (e2) throw e2;

      // === Dual KOT: auto-generate restaurant copy if any restaurant items present ===
      const restaurantItems = cart.filter((c) => c.kitchen_type === "restaurant");
      if (restaurantItems.length > 0) {
        const { data: parent } = await supabase
          .from("kot_orders")
          .select("kot_number,total_amount,gst_amount,sub_total")
          .eq("id", kot!.id).single();
        const rTotals = restaurantItems.reduce((a, c) => {
          const amt = c.qty * c.rate;
          const gst = (amt * c.gst_rate) / 100;
          return { sub: a.sub + amt, gst: a.gst + gst, total: a.total + amt + gst };
        }, { sub: 0, gst: 0, total: 0 });
        const roomNo = kotType === "room" ? (br?.rooms?.room_number ?? "") : "";
        const gName = kotType === "room" ? (br?.bookings?.guests?.name ?? "") : "";
        const headerNote = `HOTEL ORDER | Room ${roomNo} | ${gName}`;
        const copyPayload: any = {
          ...insertPayload,
          kot_copy: "restaurant_copy",
          parent_kot_id: kot!.id,
          kot_number: parent?.kot_number ?? null,
          sub_total: rTotals.sub,
          gst_amount: rTotals.gst,
          total_amount: rTotals.total,
          notes: [headerNote, notes].filter(Boolean).join(" — "),
          // CRITICAL: restaurant copy is a separate row and MUST have its own
          // client_ref, otherwise it collides with the hotel_copy on the unique
          // (property_id, client_ref) index and the insert fails with 23505.
          client_ref:
            (typeof crypto !== "undefined" && "randomUUID" in crypto)
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        };
        const { data: copyKot, error: cErr } = await supabase
          .from("kot_orders").insert(copyPayload).select("id").single();
        if (!cErr && copyKot) {
          const copyLines = restaurantItems.map((c) => ({
            kot_id: copyKot.id,
            menu_item_id: c.menu_item_id,
            item_name: c.item_name,
            qty: c.qty,
            rate: c.rate,
            amount: c.qty * c.rate,
            gst_rate: c.gst_rate,
            kot_station: c.kot_station,
            notes: c.notes ?? null,
          }));
          await supabase.from("kot_items").insert(copyLines as any);
          toast.success(`Restaurant copy routed (${restaurantItems.length} items)`);
        }
      }

      toast.success(printNow ? "KOT printed" : "KOT saved");
      // Rotate the client_ref so the same form can be reused for the next KOT.
      setClientRef(
        (typeof crypto !== "undefined" && "randomUUID" in crypto)
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      logActivity({
        property_id: propertyId!,
        user_id: user?.id ?? "",
        user_name: userDisplayName(user as any),
        ...ACTIVITY.KOT_CREATED,
        reference_id: kot!.id,
        reference_label:
          kotType === "room"
            ? `Room ${br?.rooms?.room_number ?? ""} — ${br?.bookings?.guests?.name ?? ""}`
            : "Walk-in",
        details: { items: cart.length, total: totals.total_amount },
      });
      // Notify guest via WhatsApp for room orders (best-effort)
      if (kotType === "room" && bookingId) {
        const { fireTrigger } = await import("@/lib/whatsapp");
        const { data: bg } = await supabase
          .from("bookings")
          .select("guests(id,mobile)")
          .eq("id", bookingId).maybeSingle();
        const g = (bg as any)?.guests ?? null;
        if (g?.mobile) {
          fireTrigger("food_ordered", {
            property_id: propertyId,
            booking_id: bookingId,
            guest_id: g.id,
            phone: g.mobile,
          });
        }
      }
      router.navigate({ to: "/food/kot/$id", params: { id: kot!.id } });
    } catch (e: any) {
      toast.error(e.message ?? "Failed to save KOT");
    } finally {
      setSaving(false);
    }
  }

  if (!propertyId) return <AppShell title="New KOT"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="New KOT">
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Menu</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={activeCat === "all" ? "default" : "outline"} onClick={() => setActiveCat("all")}>All</Button>
              {cats.map((c) => (
                <Button key={c.id} size="sm" variant={activeCat === c.id ? "default" : "outline"} onClick={() => setActiveCat(c.id)}>{c.name}</Button>
              ))}
            </div>
            <Input placeholder="Search items…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="grid gap-2 sm:grid-cols-2">
              {filtered.map((it) => (
                <button key={it.id} onClick={() => addItem(it)}
                  className="text-left rounded border p-2 hover:bg-accent transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-sm">{it.name}</div>
                    <Badge variant="outline" className="text-[10px]">{it.kot_station}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">₹{Number(it.price).toLocaleString("en-IN")} · GST {it.gst_rate}%</div>
                </button>
              ))}
              {filtered.length === 0 && <p className="text-xs text-muted-foreground col-span-full">No items.</p>}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Order details</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Type</Label>
                <Select value={kotType} onValueChange={(v) => setKotType(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="restaurant">Restaurant / Table</SelectItem>
                    <SelectItem value="room">Room service (in-house)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {kotType === "restaurant" ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Table no *</Label>
                  <Input value={tableNo} onChange={(e) => setTableNo(e.target.value)} placeholder="e.g. T-04" />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs">In-house booking *</Label>
                  <Select value={bookingId} onValueChange={setBookingId}>
                    <SelectTrigger>
                      <SelectValue placeholder={inhouse.length === 0 ? "No guests currently checked in" : "Pick room / guest"} />
                    </SelectTrigger>
                    <SelectContent>
                      {inhouse.map((r) => (
                        <SelectItem key={r.id} value={r.booking_id}>
                          Room {r.rooms?.room_number ?? "—"} — {r.bookings?.guests?.name ?? "Guest"}
                        </SelectItem>
                      ))}
                      {inhouse.length === 0 && (
                        <div className="px-2 py-2 text-xs text-muted-foreground">No guests currently checked in</div>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">Notes</Label>
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Cart</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {cart.length === 0 && <p className="text-xs text-muted-foreground">Tap menu items to add.</p>}
              {cart.map((c) => (
                <div key={c.menu_item_id} className="flex items-center gap-2 text-sm border rounded px-2 py-1.5">
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{c.item_name}</div>
                    <div className="text-xs text-muted-foreground">₹{c.rate} · {c.kot_station}</div>
                  </div>
                  <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => bumpQty(c.menu_item_id, -1)}><Minus className="h-3 w-3" /></Button>
                  <div className="w-6 text-center">{c.qty}</div>
                  <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => bumpQty(c.menu_item_id, +1)}><Plus className="h-3 w-3" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeLine(c.menu_item_id)}><Trash2 className="h-3 w-3" /></Button>
                </div>
              ))}
              <div className="pt-2 border-t text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Sub-total</span><span>₹{totals.sub_total.toLocaleString("en-IN")}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">GST</span><span>₹{totals.gst_amount.toLocaleString("en-IN")}</span></div>
                <div className="flex justify-between font-semibold"><span>Total</span><span>₹{totals.total_amount.toLocaleString("en-IN")}</span></div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1" disabled={saving} onClick={() => save(false)}>Save draft</Button>
                <Button className="flex-1" disabled={saving} onClick={() => save(true)}>Save & print</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}