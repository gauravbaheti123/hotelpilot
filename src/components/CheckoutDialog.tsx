import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { inr, recomputeFolio } from "@/lib/billing";
import { fireTrigger } from "@/lib/whatsapp";
import { AlertTriangle, Plus, Trash2, Loader2 } from "lucide-react";

const PAY_MODES = [
  { v: "cash", label: "Cash" },
  { v: "card", label: "Card" },
  { v: "upi", label: "UPI" },
  { v: "bank_transfer", label: "Bank Transfer" },
  { v: "complimentary", label: "Complimentary" },
] as const;

interface Props {
  bookingId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone?: () => void;
}

interface SummaryRow {
  label: string;
  amount: number;
}

interface PendingKot {
  id: string;
  kot_number: string;
  status: string;
  total_amount: number;
  sub_total: number;
  gst_amount: number;
}

interface SplitRow {
  mode: string;
  amount: string;
  reference: string;
}

export function CheckoutDialog({ bookingId, open, onOpenChange, onDone }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [booking, setBooking] = useState<any>(null);
  const [folio, setFolio] = useState<any>(null);
  const [charges, setCharges] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [pendingKots, setPendingKots] = useState<PendingKot[]>([]);

  // Payment form
  const [splitMode, setSplitMode] = useState(false);
  const [singleMode, setSingleMode] = useState("cash");
  const [singleAmount, setSingleAmount] = useState("");
  const [singleRef, setSingleRef] = useState("");
  const [splits, setSplits] = useState<SplitRow[]>([
    { mode: "cash", amount: "", reference: "" },
    { mode: "upi", amount: "", reference: "" },
  ]);

  const load = useCallback(async () => {
    if (!bookingId) return;
    setLoading(true);
    const { data: b, error } = await supabase
      .from("bookings")
      .select(
        `id,booking_number,status,check_in,check_out,property_id,advance_amount,
         guests(name,mobile),
         booking_rooms(id,rate,check_in,check_out,rooms(id,room_number),room_categories(name))`,
      )
      .eq("id", bookingId)
      .single();
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    setBooking(b);

    const { data: folioId, error: fErr } = await supabase.rpc("get_or_create_folio", {
      _booking_id: bookingId,
    });
    if (fErr) {
      toast.error(fErr.message);
      setLoading(false);
      return;
    }

    const [{ data: f }, { data: c }, { data: p }, { data: pk }] = await Promise.all([
      supabase.from("folios").select("*").eq("id", folioId as any).single(),
      supabase.from("folio_charges").select("*").eq("folio_id", folioId as any),
      supabase.from("payments").select("*").eq("folio_id", folioId as any),
      supabase
        .from("kot_orders")
        .select("id,kot_number,status,total_amount,sub_total,gst_amount")
        .eq("booking_id", bookingId)
        .eq("is_wiped", false)
        .neq("kot_copy", "restaurant_copy")
        .not("status", "in", "(billed,cancelled,void)"),
    ]);
    setFolio(f);
    setCharges(c ?? []);
    setPayments(p ?? []);
    setPendingKots((pk ?? []) as unknown as PendingKot[]);
    setLoading(false);
  }, [bookingId]);

  useEffect(() => {
    if (open && bookingId) {
      setSplitMode(false);
      setSingleAmount("");
      setSingleRef("");
      setSingleMode("cash");
      load();
    }
  }, [open, bookingId, load]);

  // Auto seed room charges if missing
  useEffect(() => {
    if (!open || loading || !folio || !booking) return;
    if (charges.some((c: any) => c.charge_type === "room")) return;
    if (!booking.booking_rooms?.length) return;
    (async () => {
      const rows = booking.booking_rooms.map((br: any) => {
        const nights = Math.max(
          1,
          Math.round(
            (new Date(br.check_out).getTime() - new Date(br.check_in).getTime()) / 86400000,
          ),
        );
        const amt = nights * Number(br.rate);
        return {
          folio_id: folio.id,
          charge_type: "room",
          description: `Room ${br.rooms?.room_number ?? ""} · ${br.room_categories?.name ?? ""} · ${nights} night(s)`,
          qty: nights,
          rate: Number(br.rate),
          amount: amt,
          gst_rate: 12,
          gst_amount: Math.round(amt * 12) / 100,
          source_table: "booking_rooms",
          source_id: br.id,
          created_by: user?.id ?? null,
        };
      });
      await supabase.from("folio_charges").insert(rows as any);
      load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading, folio?.id, booking?.id]);

  const totals = useMemo(() => {
    const rooms: SummaryRow[] = [];
    const food: SummaryRow[] = [];
    const other: SummaryRow[] = [];
    for (const c of charges) {
      const row: SummaryRow = { label: c.description, amount: Number(c.amount) };
      if (c.charge_type === "room") rooms.push(row);
      else if (c.charge_type === "food") food.push(row);
      else other.push(row);
    }
    const sum = (rs: SummaryRow[]) => rs.reduce((s, r) => s + r.amount, 0);
    const roomTotal = sum(rooms);
    const foodTotal = sum(food);
    const otherTotal = sum(other);
    const gstMode = (folio?.gst_mode as "cash" | "gst") ?? "cash";
    const recomp = recomputeFolio(charges as any, gstMode);
    const grand = recomp.total_amount;
    const paid = payments.reduce((s, p) => s + Number(p.amount), 0);
    const balance = Math.max(0, grand - paid);
    return { rooms, food, other, roomTotal, foodTotal, otherTotal, grand, paid, balance };
  }, [charges, payments, folio?.gst_mode]);

  // Pre-fill single amount once balance computed
  useEffect(() => {
    if (!loading && singleAmount === "" && totals.balance > 0) {
      setSingleAmount(totals.balance.toFixed(2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, totals.balance]);

  async function addPendingToBill() {
    if (!folio || !booking || pendingKots.length === 0) return;
    setBusy(true);
    const existingSrc = new Set(
      charges.filter((c: any) => c.source_table === "kot_orders").map((c: any) => c.source_id),
    );
    const toAdd = pendingKots.filter((k) => !existingSrc.has(k.id));
    if (toAdd.length > 0) {
      const rows = toAdd.map((k) => ({
        folio_id: folio.id,
        charge_type: "food",
        description: `Food · ${k.kot_number}`,
        qty: 1,
        rate: Number(k.sub_total),
        amount: Number(k.sub_total),
        gst_rate:
          Number(k.sub_total) > 0
            ? Math.round((Number(k.gst_amount) / Number(k.sub_total)) * 100)
            : 5,
        gst_amount: Number(k.gst_amount),
        source_table: "kot_orders",
        source_id: k.id,
        created_by: user?.id ?? null,
      }));
      const { error } = await supabase.from("folio_charges").insert(rows as any);
      if (error) {
        setBusy(false);
        return toast.error(error.message);
      }
    }
    await supabase
      .from("kot_orders")
      .update({ status: "billed", billed_at: new Date().toISOString() } as any)
      .in("id", pendingKots.map((k) => k.id));
    toast.success("Food orders added to bill");
    setBusy(false);
    load();
  }

  function setSplit(i: number, patch: Partial<SplitRow>) {
    setSplits((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function collectAndCheckout() {
    if (!folio || !booking) return;
    if (pendingKots.length > 0) {
      return toast.error("Add pending food orders to bill first");
    }

    // Build payment rows
    const rows: { amount: number; mode: string; reference_no: string | null }[] = [];
    if (totals.balance > 0.01) {
      if (splitMode) {
        for (const s of splits) {
          const a = Number(s.amount);
          if (a > 0) rows.push({ amount: a, mode: s.mode, reference_no: s.reference || null });
        }
      } else {
        const a = Number(singleAmount);
        if (a > 0) {
          rows.push({ amount: a, mode: singleMode, reference_no: singleRef || null });
        }
      }
      const total = rows.reduce((s, r) => s + r.amount, 0);
      if (total + 0.01 < totals.balance) {
        return toast.error(
          `Pending balance ${inr(totals.balance - total)}. Collect full payment first.`,
        );
      }
    }

    setBusy(true);
    if (rows.length > 0) {
      const { error: payErr } = await supabase.from("payments").insert(
        rows.map((r) => ({
          property_id: booking.property_id,
          folio_id: folio.id,
          booking_id: booking.id,
          amount: r.amount,
          mode: r.mode,
          reference_no: r.reference_no,
          created_by: user?.id ?? null,
        })) as any,
      );
      if (payErr) {
        setBusy(false);
        return toast.error(payErr.message);
      }
    }

    // Recompute & settle
    const gstMode = (folio.gst_mode as "cash" | "gst") ?? "cash";
    const t = recomputeFolio(charges as any, gstMode);
    const paid = totals.paid + rows.reduce((s, r) => s + r.amount, 0);
    const balance = Math.max(0, t.total_amount - paid);
    if (balance > 0.01) {
      setBusy(false);
      return toast.error(`Pending balance ${inr(balance)}. Collect payment first.`);
    }

    const now = new Date().toISOString();
    await supabase
      .from("folios")
      .update({
        ...t,
        paid_amount: paid,
        balance_amount: 0,
        status: "settled",
        settled_at: now,
      } as any)
      .eq("id", folio.id);

    if (booking.status !== "checked_out" && booking.status !== "cancelled") {
      await supabase
        .from("bookings")
        .update({
          status: "checked_out",
          checked_out_at: now,
          checked_out_by: user?.id ?? null,
        } as any)
        .eq("id", booking.id);
    }

    const roomIds: string[] = [];
    for (const br of booking.booking_rooms ?? []) {
      await supabase
        .from("booking_rooms")
        .update({ actual_check_out: now } as any)
        .eq("id", br.id);
      if (br.rooms?.id) roomIds.push(br.rooms.id);
    }
    if (roomIds.length > 0) {
      await supabase
        .from("rooms")
        .update({ status: "vacant", housekeeping_status: "dirty" } as any)
        .in("id", roomIds);
    }

    try {
      if (booking.guests?.mobile) {
        fireTrigger("checkout_bill", {
          property_id: booking.property_id,
          booking_id: booking.id,
          phone: booking.guests.mobile,
        });
      }
    } catch {
      /* ignore */
    }

    setBusy(false);
    toast.success("Checked out");
    onOpenChange(false);
    onDone?.();
  }

  const advance = Number(booking?.advance_amount ?? 0);
  const roomNumbers =
    booking?.booking_rooms?.map((br: any) => br.rooms?.room_number).filter(Boolean).join(", ") ||
    "—";
  const nights = booking
    ? Math.max(
        1,
        Math.round(
          (new Date(booking.check_out).getTime() - new Date(booking.check_in).getTime()) /
            86400000,
        ),
      )
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Checkout Summary</DialogTitle>
        </DialogHeader>

        {loading || !booking || !folio ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Loading…
          </div>
        ) : pendingKots.length > 0 ? (
          <div className="space-y-4">
            <div className="rounded-md border border-destructive/60 bg-destructive/5 p-4">
              <div className="flex items-center gap-2 font-medium text-destructive mb-2">
                <AlertTriangle className="h-5 w-5" /> Cannot Checkout
              </div>
              <div className="text-sm mb-2">Unsettled food orders:</div>
              <div className="space-y-1 text-sm">
                {pendingKots.map((k) => (
                  <div key={k.id} className="flex justify-between">
                    <span>
                      {k.kot_number} <Badge variant="outline" className="ml-1 text-[10px] uppercase">{k.status}</Badge>
                    </span>
                    <span>{inr(k.total_amount)}</span>
                  </div>
                ))}
              </div>
              <div className="text-xs text-muted-foreground mt-3">
                Please add these to the room bill before checkout.
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={addPendingToBill} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Add to Bill
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="rounded border p-3 bg-muted/30">
              <div className="font-medium">
                Room {roomNumbers} · {booking.guests?.name ?? "—"}
              </div>
              <div className="text-xs text-muted-foreground">
                Check-in: {booking.check_in} · Check-out: {booking.check_out} · {nights} Night{nights > 1 ? "s" : ""}
              </div>
            </div>

            <Section title="Room Charges" rows={totals.rooms} total={totals.roomTotal} />
            <Section title="Food & Restaurant Bill" rows={totals.food} total={totals.foodTotal} empty="No food charges" />
            <Section title="Other Charges" rows={totals.other} total={totals.otherTotal} empty="—" />

            <div className="flex justify-between border-t-2 border-foreground pt-2 font-semibold text-base">
              <span>GRAND TOTAL</span>
              <span>{inr(totals.grand)}</span>
            </div>

            <div className="rounded border p-3 space-y-1">
              <div className="text-xs font-medium text-muted-foreground uppercase">Payment Received</div>
              {advance > 0 && (
                <div className="flex justify-between"><span>Advance at check-in</span><span>{inr(advance)}</span></div>
              )}
              {payments
                .filter((p) => Number(p.amount) > 0)
                .map((p) => (
                  <div key={p.id} className="flex justify-between">
                    <span className="capitalize">{p.mode}</span>
                    <span>{inr(p.amount)}</span>
                  </div>
                ))}
              {payments.length === 0 && advance === 0 && (
                <div className="text-xs text-muted-foreground">No payments yet</div>
              )}
              <div className="flex justify-between border-t pt-2 font-semibold">
                <span>Balance Due</span>
                <span className={totals.balance > 0 ? "text-destructive" : "text-emerald-600"}>
                  {inr(totals.balance)}
                </span>
              </div>
            </div>

            {totals.balance > 0.01 && (
              <div className="rounded border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">Collect Payment</div>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={splitMode}
                      onChange={(e) => setSplitMode(e.target.checked)}
                    />
                    Split payment
                  </label>
                </div>

                {!splitMode ? (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label className="text-xs">Amount</Label>
                      <Input
                        type="number"
                        value={singleAmount}
                        onChange={(e) => setSingleAmount(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Mode</Label>
                      <Select value={singleMode} onValueChange={setSingleMode}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PAY_MODES.map((m) => (
                            <SelectItem key={m.v} value={m.v}>{m.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Reference</Label>
                      <Input value={singleRef} onChange={(e) => setSingleRef(e.target.value)} />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {splits.map((s, i) => (
                      <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                        <div>
                          <Label className="text-xs">Mode</Label>
                          <Select value={s.mode} onValueChange={(v) => setSplit(i, { mode: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {PAY_MODES.map((m) => (
                                <SelectItem key={m.v} value={m.v}>{m.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">Amount</Label>
                          <Input
                            type="number"
                            value={s.amount}
                            onChange={(e) => setSplit(i, { amount: e.target.value })}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Reference</Label>
                          <Input
                            value={s.reference}
                            onChange={(e) => setSplit(i, { reference: e.target.value })}
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setSplits((rs) => rs.filter((_, idx) => idx !== i))}
                          disabled={splits.length <= 1}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSplits((rs) => [...rs, { mode: "cash", amount: "", reference: "" }])}
                    >
                      <Plus className="h-4 w-4 mr-1" /> Add payment row
                    </Button>
                    <div className="text-xs text-muted-foreground">
                      Split total: {inr(splits.reduce((s, r) => s + (Number(r.amount) || 0), 0))} ·
                      Required: {inr(totals.balance)}
                    </div>
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={collectAndCheckout} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Collect &amp; Checkout
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  rows,
  total,
  empty,
}: {
  title: string;
  rows: SummaryRow[];
  total: number;
  empty?: string;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground uppercase mb-1">{title}</div>
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">{empty ?? "—"}</div>
      ) : (
        <div className="space-y-1">
          {rows.map((r, i) => (
            <div key={i} className="flex justify-between">
              <span className="truncate pr-2">{r.label}</span>
              <span>{inr(r.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t pt-1 font-medium">
            <span>{title.split(" ")[0]} Total</span>
            <span>{inr(total)}</span>
          </div>
        </div>
      )}
    </div>
  );
}