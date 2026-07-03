/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { inr, recomputeFolio, computeBillDiscountAmount, type BillDiscount } from "@/lib/billing";
import { DiscountDialog, type DiscType } from "@/components/DiscountDialog";
import { logActivity, userDisplayName } from "@/lib/activityLog";
import { useAuth, hasRole } from "@/hooks/use-auth";
import { ArrowLeft, ArrowRight, Loader2, SplitSquareHorizontal } from "lucide-react";
import { Percent } from "lucide-react";

const PAY_MODES = [
  { v: "cash", label: "Cash" },
  { v: "card", label: "Card" },
  { v: "upi", label: "UPI" },
  { v: "bank_transfer", label: "Bank Transfer" },
  { v: "credit", label: "Credit" },
] as const;

interface Charge {
  id: string; charge_type: string; description: string;
  qty: number; rate: number; amount: number;
  gst_rate: number; gst_amount: number;
  hsn_code?: string | null;
  source_table?: string | null; source_id?: string | null;
  discount_type?: DiscType | null;
  discount_value?: number | null;
  discount_amount?: number | null;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  folio: any;
  booking: any;
  charges: Charge[];
  onDone?: (newFolioIds: string[]) => void;
}

type SplitType = "same" | "different";

interface PartyDetails {
  name: string;
  mobile?: string;
  gstin?: string;
  bill_type: "cash_bill" | "gst_invoice";
}

interface PaymentRow { mode: string; amount: string; reference: string }

export function SplitBillDialog({ open, onOpenChange, folio, booking, charges, onDone }: Props) {
  const { user, roles } = useAuth();
  // Cash Bill toggle is strictly owner-only (superadmin excluded).
  const isOwnerStrict = roles.includes("owner") && !roles.includes("superadmin");
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [splitType, setSplitType] = useState<SplitType>("same");
  const [bill1Ids, setBill1Ids] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [maxDiscPct, setMaxDiscPct] = useState<number>(100);
  const [discOpen, setDiscOpen] = useState(false);
  const [discBillIdx, setDiscBillIdx] = useState<0 | 1>(0);

  // Resolve current user's max-discount % once dialog opens
  useEffect(() => {
    (async () => {
      if (!open || !user?.id || !booking?.property_id) return;
      const { data: pct } = await supabase.rpc("user_max_discount_pct", {
        _user_id: user.id, _property_id: booking.property_id,
      });
      const n = Number(pct);
      setMaxDiscPct(Number.isFinite(n) ? n : 0);
    })();
  }, [open, user?.id, booking?.property_id]);

  const guestName = booking?.guests?.name ?? "Guest";
  const guestMobile = booking?.guests?.mobile ?? "";
  const guestGstin = booking?.guests?.gst_number ?? "";
  const folioGst = (folio?.bill_type ?? (folio?.gst_mode === "gst" ? "gst_invoice" : "cash_bill")) as
    "cash_bill" | "gst_invoice";

  const [party1, setParty1] = useState<PartyDetails>({
    name: guestName, mobile: guestMobile, gstin: guestGstin, bill_type: folioGst,
  });
  const [party2, setParty2] = useState<PartyDetails>({
    name: "", mobile: "", gstin: "",
    // Non-owners cannot generate a cash bill — default silently to GST Invoice.
    bill_type: isOwnerStrict ? "cash_bill" : "gst_invoice",
  });

  const [createdBills, setCreatedBills] = useState<
    { folio_id: string; invoice_number: string; party: PartyDetails; total: number }[]
  >([]);
  const [payRows, setPayRows] = useState<PaymentRow[]>([
    { mode: "cash", amount: "", reference: "" },
    { mode: "cash", amount: "", reference: "" },
  ]);

  // Default assignment: room/sundry/extra/discount → Bill 1; food → Bill 2.
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSplitType("same");
    setBusy(false);
    setCreatedBills([]);
    setParty1({ name: guestName, mobile: guestMobile, gstin: guestGstin, bill_type: folioGst });
    setParty2({
      name: "", mobile: "", gstin: "",
      bill_type: isOwnerStrict ? "cash_bill" : "gst_invoice",
    });
    const ids = new Set<string>();
    for (const c of charges) {
      if (c.charge_type !== "food") ids.add(c.id);
    }
    setBill1Ids(ids);
    setPayRows([
      { mode: "cash", amount: "", reference: "" },
      { mode: "cash", amount: "", reference: "" },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, folio?.id]);

  const bill1Charges = useMemo(() => charges.filter((c) => bill1Ids.has(c.id)), [charges, bill1Ids]);
  const bill2Charges = useMemo(() => charges.filter((c) => !bill1Ids.has(c.id)), [charges, bill1Ids]);

  const bill1Total = useMemo(
    () => recomputeFolio(bill1Charges as any, party1.bill_type === "gst_invoice" ? "gst" : "cash").total_amount,
    [bill1Charges, party1.bill_type],
  );
  const bill2Total = useMemo(
    () => recomputeFolio(bill2Charges as any, party2.bill_type === "gst_invoice" ? "gst" : "cash").total_amount,
    [bill2Charges, party2.bill_type],
  );

  function moveToBill1(id: string) { setBill1Ids((s) => new Set([...s, id])); }
  function moveToBill2(id: string) {
    setBill1Ids((s) => { const n = new Set(s); n.delete(id); return n; });
  }
  function quickRoomsToBill1() {
    setBill1Ids((s) => {
      const n = new Set(s);
      for (const c of charges) if (c.charge_type === "room" || c.charge_type === "extra" || c.charge_type === "sundry" || c.charge_type === "discount") n.add(c.id);
      return n;
    });
  }
  function quickFoodToBill2() {
    setBill1Ids((s) => {
      const n = new Set(s);
      for (const c of charges) if (c.charge_type === "food") n.delete(c.id);
      return n;
    });
  }

  async function confirmSplit() {
    if (!folio || !booking) return;
    if (bill1Charges.length === 0 || bill2Charges.length === 0) {
      return toast.error("Both bills must have at least one line item");
    }
    if (splitType === "different" && !party2.name.trim()) {
      return toast.error("Party 2 name required");
    }
    setBusy(true);
    try {
      // 1) Create Invoice A + Invoice B FIRST. Only void the original after both succeed.
      const newFolioIds: string[] = [];
      const created: typeof createdBills = [];
      for (let i = 0; i < 2; i++) {
        const party = i === 0 ? party1 : (splitType === "same" ? party1 : party2);
        const mode = party.bill_type === "gst_invoice" ? "gst" : "cash";
        const items = i === 0 ? bill1Charges : bill2Charges;
        // Carry forward parent's bill-level discount proportionally to this split's net subtotal.
        const parentBillDisc: BillDiscount | null =
          folio?.discount_type && Number(folio?.discount_value) > 0
            ? { type: folio.discount_type, value: Number(folio.discount_value) }
            : null;
        // Parent-wide net subtotal (after per-line discs)
        const netSubOf = (arr: Charge[]) => arr.reduce((s, c) => {
          if (c.charge_type === "discount" || c.charge_type === "tax") return s;
          const amt = Math.abs(Number(c.amount) || 0);
          const ld = Math.min(Number(c.discount_amount) || 0, amt);
          return s + (amt - ld);
        }, 0);
        const parentNet = netSubOf(charges);
        const parentBillDiscAmt = computeBillDiscountAmount(parentNet, parentBillDisc);
        const thisNet = netSubOf(items);
        const shareAmt =
          parentBillDiscAmt > 0 && parentNet > 0
            ? Math.round((parentBillDiscAmt * (thisNet / parentNet)) * 100) / 100
            : 0;
        const carryDisc: BillDiscount | null = shareAmt > 0 ? { type: "amount", value: shareAmt } : null;
        const totals = recomputeFolio(items as any, mode, carryDisc);
        const { data: f, error: fErr } = await supabase.from("folios").insert({
          property_id: booking.property_id,
          booking_id: booking.id,
          gst_mode: mode,
          bill_type: party.bill_type,
          guest_gstin: party.gstin || null,
          guest_company: splitType === "different" && i === 1 ? party.name : (folio.guest_company ?? null),
          notes: `Split bill ${i + 1}/2 of voided ${folio.invoice_number}${splitType === "different" ? ` — Party: ${party.name}` : ""}`,
          discount_type: carryDisc?.type ?? null,
          discount_value: carryDisc?.value ?? 0,
          ...totals,
          paid_amount: 0,
          balance_amount: totals.total_amount,
          created_by: user?.id ?? null,
        } as any).select("id,invoice_number,total_amount").single();
        if (fErr) {
          // Rollback any folio we just created so we don't leak orphans.
          if (newFolioIds.length > 0) {
            await supabase.from("folios").delete().in("id", newFolioIds);
          }
          throw fErr;
        }
        const newId = (f as any).id as string;
        newFolioIds.push(newId);
        created.push({
          folio_id: newId,
          invoice_number: (f as any).invoice_number,
          party,
          total: Number((f as any).total_amount),
        });

        // 2) Copy charges to the new folio (originals stay on the source folio for audit).
        const rows = items.map((c) => ({
          folio_id: newId,
          charge_type: c.charge_type,
          description: c.description,
          qty: c.qty,
          rate: c.rate,
          amount: c.amount,
          gst_rate: c.gst_rate,
          gst_amount: c.gst_amount,
          hsn_code: (c as any).hsn_code ?? null,
          source_table: c.source_table ?? null,
          source_id: c.source_id ?? null,
          discount_type: c.discount_type ?? null,
          discount_value: c.discount_value ?? 0,
          discount_amount: c.discount_amount ?? 0,
          created_by: user?.id ?? null,
        }));
        const { error: cErr } = await supabase.from("folio_charges").insert(rows as any);
        if (cErr) {
          await supabase.from("folios").delete().in("id", newFolioIds);
          throw cErr;
        }
      }

      // 3) Both invoices verified — now void the original via the safe helper.
      //    void_folio_safe refuses to void a folio that still has payments, so
      //    we don't silently lose payment history.
      const { error: voidErr } = await supabase.rpc("void_folio_safe" as any, {
        _folio_id: folio.id,
        _reason: `Split into 2 bills (${splitType})`,
        _user_id: user?.id ?? null,
      });
      if (voidErr) {
        // Rollback the newly created folios so we don't end up with 3 active bills.
        await supabase.from("folios").delete().in("id", newFolioIds);
        throw voidErr;
      }

      setCreatedBills(created);
      setPayRows([
        { mode: "cash", amount: created[0].total.toFixed(2), reference: "" },
        { mode: "cash", amount: created[1].total.toFixed(2), reference: "" },
      ]);
      logActivity({
        property_id: booking.property_id,
        user_id: user?.id ?? "",
        user_name: userDisplayName(user as any),
        action_type: "BILL_SPLIT",
        module: "Billing",
        reference_id: booking.id,
        reference_label: `${folio.invoice_number} → ${created[0].invoice_number} + ${created[1].invoice_number}`,
        details: {
          original_bill: folio.invoice_number,
          bill1_number: created[0].invoice_number,
          bill2_number: created[1].invoice_number,
          split_type: splitType,
        },
      });
      toast.success(`Bills created: ${created[0].invoice_number} + ${created[1].invoice_number}`);
      // Log any resulting cash bills separately for audit.
      for (const cb of created) {
        if (cb.party.bill_type === "cash_bill" && user) {
          logActivity({
            property_id: booking.property_id,
            user_id: user.id,
            user_name: userDisplayName(user as any),
            action_type: "CASH_BILL_GENERATED",
            module: "Billing",
            reference_id: cb.folio_id,
            reference_label: cb.invoice_number,
            details: {
              bill_number: cb.invoice_number,
              amount: cb.total,
              party_name: cb.party.name,
              generated_by: user.id,
              via: "split_bill",
            },
          });
        }
      }
      setStep(4);
      onDone?.(newFolioIds);
    } catch (e: any) {
      toast.error(e.message ?? "Could not split bill");
    } finally {
      setBusy(false);
    }
  }

  async function completeCheckout() {
    if (createdBills.length !== 2) return;
    setBusy(true);
    try {
      for (let i = 0; i < 2; i++) {
        const b = createdBills[i];
        const row = payRows[i];
        const amt = Number(row.amount);
        if (row.mode !== "credit" && !(amt > 0)) {
          setBusy(false);
          return toast.error(`Bill ${i + 1}: enter payment amount`);
        }
        if (row.mode !== "credit") {
          await supabase.from("payments").insert({
            property_id: booking.property_id,
            folio_id: b.folio_id,
            booking_id: booking.id,
            amount: amt,
            mode: row.mode,
            reference_no: row.reference || null,
            created_by: user?.id ?? null,
          } as any);
          // Paid / Balance / Status are recomputed by the payments_sync trigger.
          logActivity({
            property_id: booking.property_id,
            user_id: user?.id ?? "",
            user_name: userDisplayName(user as never),
            action_type: "PAYMENT_RECEIVED",
            module: "Billing",
            reference_id: b.folio_id,
            reference_label: booking.booking_number ?? null,
            details: {
              booking_id: booking.id,
              folio_id: b.folio_id,
              amount: amt,
              mode: row.mode,
              source: "split_bill",
            },
          });
        }
      }
      // Mark booking checked-out.
      if (booking.status !== "checked_out" && booking.status !== "cancelled") {
        const now = new Date().toISOString();
        await supabase.from("bookings").update({
          status: "checked_out", checked_out_at: now, checked_out_by: user?.id ?? null,
        } as any).eq("id", booking.id);
        const { data: brs } = await supabase.from("booking_rooms").select("id,room_id").eq("booking_id", booking.id);
        const roomIds = ((brs ?? []) as any[]).map((x) => x.room_id).filter(Boolean);
        for (const br of (brs ?? []) as any[]) {
          await supabase.from("booking_rooms").update({ actual_check_out: now } as any).eq("id", br.id);
        }
        if (roomIds.length > 0) {
          await supabase.from("rooms").update({ status: "vacant", housekeeping_status: "dirty" } as any).in("id", roomIds);
        }
      }
      toast.success("Split checkout complete");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Could not complete checkout");
    } finally {
      setBusy(false);
    }
  }

  const roomLabel = booking?.booking_rooms?.[0]?.rooms?.room_number ?? "—";

  const unlimitedDisc = () => hasRole(roles, "owner") || hasRole(roles, "superadmin");

  async function saveSplitBillDiscount({ type, value, rupees }: { type: DiscType; value: number; rupees: number }) {
    const target = createdBills[discBillIdx];
    if (!target) return;
    // Re-fetch this folio's charges to recompute totals with the new bill discount
    const { data: chargeRows } = await supabase.from("folio_charges")
      .select("*").eq("folio_id", target.folio_id);
    const rows = (chargeRows ?? []) as any[];
    const gstMode = target.party.bill_type === "gst_invoice" ? "gst" : "cash";
    const billDisc: BillDiscount | null = value > 0 ? { type, value } : null;
    const totals = recomputeFolio(rows, gstMode, billDisc);
    const { error } = await supabase.from("folios").update({
      discount_type: value > 0 ? type : null,
      discount_value: value > 0 ? value : 0,
      ...totals,
      balance_amount: totals.total_amount,
    } as any).eq("id", target.folio_id);
    if (error) { toast.error(error.message); return; }
    // Update local state so the summary reflects the new total
    setCreatedBills((arr) => arr.map((cb, idx) => idx === discBillIdx
      ? { ...cb, total: Number(totals.total_amount) } : cb));
    setPayRows((arr) => arr.map((r, idx) => idx === discBillIdx
      ? { ...r, amount: Number(totals.total_amount).toFixed(2) } : r));
    if (user) {
      logActivity({
        property_id: booking.property_id,
        user_id: user.id,
        user_name: userDisplayName(user as any),
        action_type: "DISCOUNT_APPLIED",
        module: "Billing",
        reference_id: target.folio_id,
        reference_label: target.invoice_number,
        details: {
          bill_number: target.invoice_number,
          level: "bill",
          discount_type: type,
          discount_value: value,
          discount_amount: rupees,
          via: "split_bill",
          applied_by: userDisplayName(user as any),
          role: roles.join(","),
        },
      });
    }
    toast.success(value > 0 ? "Bill discount applied" : "Bill discount cleared");
  }

  // Net subtotal for the currently-targeted split bill (base for bill-level %/₹)
  const discBase = (() => {
    const items = discBillIdx === 0 ? bill1Charges : bill2Charges;
    return items.reduce((s, c) => {
      if (c.charge_type === "discount" || c.charge_type === "tax") return s;
      const amt = Math.abs(Number(c.amount) || 0);
      const ld = Math.min(Number(c.discount_amount) || 0, amt);
      return s + (amt - ld);
    }, 0);
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SplitSquareHorizontal className="h-5 w-5" />
            Split Bill — Room {roomLabel}, {guestName}
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1 text-xs">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className={`flex-1 h-1.5 rounded ${step >= s ? "bg-primary" : "bg-muted"}`} />
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div className="text-sm font-medium">Step 1 — Select Split Type</div>
            <RadioGroup value={splitType} onValueChange={(v) => setSplitType(v as SplitType)} className="gap-3">
              <label className="flex items-start gap-3 rounded border p-3 cursor-pointer hover:bg-accent">
                <RadioGroupItem value="same" id="same" className="mt-0.5" />
                <div>
                  <div className="text-sm font-medium">Same Party</div>
                  <div className="text-xs text-muted-foreground">Two separate bills, same guest.</div>
                </div>
              </label>
              <label className="flex items-start gap-3 rounded border p-3 cursor-pointer hover:bg-accent">
                <RadioGroupItem value="different" id="different" className="mt-0.5" />
                <div>
                  <div className="text-sm font-medium">Different Parties</div>
                  <div className="text-xs text-muted-foreground">Each bill to a different person / company.</div>
                </div>
              </label>
            </RadioGroup>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => setStep(2)}>Next <ArrowRight className="h-4 w-4 ml-1" /></Button>
            </DialogFooter>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="text-sm font-medium">Step 2 — Assign Line Items</div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={quickRoomsToBill1}>Move all Room → Bill 1</Button>
              <Button size="sm" variant="outline" onClick={quickFoodToBill2}>Move all Food → Bill 2</Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[1, 2].map((side) => {
                const items = side === 1 ? bill1Charges : bill2Charges;
                const total = side === 1 ? bill1Total : bill2Total;
                return (
                  <div key={side} className="rounded border">
                    <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase">
                      Bill {side}
                    </div>
                    <div className="divide-y max-h-72 overflow-y-auto">
                      {items.length === 0 ? (
                        <div className="p-3 text-xs text-muted-foreground italic">No items</div>
                      ) : items.map((c) => (
                        <div key={c.id} className="flex items-center gap-2 p-2 text-xs">
                          {side === 2 && (
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moveToBill1(c.id)}>
                              <ArrowLeft className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="truncate">{c.description}</div>
                            <div className="text-[10px] uppercase text-muted-foreground">{c.charge_type}</div>
                          </div>
                          <div className="tabular-nums font-medium">{inr(c.amount)}</div>
                          {side === 1 && (
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moveToBill2(c.id)}>
                              <ArrowRight className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between border-t px-3 py-2 text-sm font-semibold">
                      <span>Total</span><span>{inr(total)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(1)}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
              <Button onClick={() => setStep(3)}>Next <ArrowRight className="h-4 w-4 ml-1" /></Button>
            </DialogFooter>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="text-sm font-medium">Step 3 — Party Details</div>
            <PartyEditor label="Bill 1 Party" party={party1} setParty={setParty1} disabledName={splitType === "same"} showBillType={isOwnerStrict} />
            {splitType === "different" ? (
              <PartyEditor label="Bill 2 Party" party={party2} setParty={setParty2} showMobile showBillType={isOwnerStrict} />
            ) : (
              <div className="rounded border bg-muted/30 p-3 text-xs text-muted-foreground">
                Bill 2 will use the same party as Bill 1 ({party1.name}).
              {isOwnerStrict && (
                <div className="mt-2 flex items-center gap-3">
                  <Label className="text-xs">Bill 2 Type</Label>
                  <BillTypeToggle value={party2.bill_type}
                    onChange={(v) => setParty2({ ...party2, bill_type: v, name: party1.name, mobile: party1.mobile, gstin: party1.gstin })} />
                </div>
              )}
              </div>
            )}
            <div className="rounded border p-3 text-xs space-y-1">
              <div className="font-semibold">Summary</div>
              <div>Bill 1: {party1.name} · <Badge variant="outline" className="text-[10px]">{party1.bill_type}</Badge> · <b>{inr(bill1Total)}</b></div>
              <div>Bill 2: {splitType === "same" ? party1.name : (party2.name || "—")} · <Badge variant="outline" className="text-[10px]">{party2.bill_type}</Badge> · <b>{inr(bill2Total)}</b></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(2)}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
              <Button onClick={confirmSplit} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Confirm &amp; Split
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="text-sm font-medium">Step 4 — Collect Payment per Bill</div>
            {createdBills.map((b, i) => (
              <div key={b.folio_id} className="rounded border p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <div>
                    <div className="font-semibold">{b.invoice_number}</div>
                    <div className="text-xs text-muted-foreground">{b.party.name}</div>
                  </div>
                  <div className="font-semibold tabular-nums">{inr(b.total)}</div>
                </div>
                <div className="flex justify-end">
                  <Button size="sm" variant="outline"
                    onClick={() => { setDiscBillIdx(i as 0 | 1); setDiscOpen(true); }}>
                    <Percent className="h-3.5 w-3.5 mr-1" />
                    Apply discount on Bill {i + 1}
                  </Button>
                </div>
                <div className="grid grid-cols-[1fr_1fr_1fr] gap-2">
                  <div>
                    <Label className="text-xs">Mode</Label>
                    <Select value={payRows[i].mode} onValueChange={(v) => setPayRows((rs) => rs.map((r, idx) => idx === i ? { ...r, mode: v } : r))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PAY_MODES.map((m) => <SelectItem key={m.v} value={m.v}>{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Amount</Label>
                    <Input type="number" value={payRows[i].amount}
                      onChange={(e) => setPayRows((rs) => rs.map((r, idx) => idx === i ? { ...r, amount: e.target.value } : r))} />
                  </div>
                  <div>
                    <Label className="text-xs">Reference</Label>
                    <Input value={payRows[i].reference}
                      onChange={(e) => setPayRows((rs) => rs.map((r, idx) => idx === i ? { ...r, reference: e.target.value } : r))} />
                  </div>
                </div>
              </div>
            ))}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              <Button onClick={completeCheckout} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Complete Checkout
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
    <DiscountDialog
      open={discOpen}
      onOpenChange={setDiscOpen}
      kind="bill"
      base={discBase}
      initialType="percent"
      initialValue={0}
      unlimited={unlimitedDisc()}
      maxPct={maxDiscPct}
      onSave={saveSplitBillDiscount}
      title={`Apply discount on Bill ${discBillIdx + 1}`}
    />
    </>
  );
}

function BillTypeToggle({ value, onChange }: { value: "cash_bill" | "gst_invoice"; onChange: (v: "cash_bill" | "gst_invoice") => void }) {
  return (
    <div className="flex gap-1 rounded-md border p-0.5 bg-muted/30">
      <button type="button" onClick={() => onChange("cash_bill")}
        className={`px-2 py-1 text-xs rounded ${value === "cash_bill" ? "bg-background shadow font-medium" : "text-muted-foreground"}`}>
        Cash Bill
      </button>
      <button type="button" onClick={() => onChange("gst_invoice")}
        className={`px-2 py-1 text-xs rounded ${value === "gst_invoice" ? "bg-background shadow font-medium" : "text-muted-foreground"}`}>
        GST Invoice
      </button>
    </div>
  );
}

function PartyEditor({
  label, party, setParty, showMobile, disabledName, showBillType,
}: {
  label: string;
  party: PartyDetails;
  setParty: (p: PartyDetails) => void;
  showMobile?: boolean;
  disabledName?: boolean;
  showBillType?: boolean;
}) {
  return (
    <div className="rounded border p-3 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider">{label}</div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Name *</Label>
          <Input value={party.name} disabled={disabledName}
            onChange={(e) => setParty({ ...party, name: e.target.value })} />
        </div>
        {showMobile && (
          <div>
            <Label className="text-xs">Mobile</Label>
            <Input value={party.mobile ?? ""}
              onChange={(e) => setParty({ ...party, mobile: e.target.value })} />
          </div>
        )}
        <div>
          <Label className="text-xs">GSTIN (optional)</Label>
          <Input value={party.gstin ?? ""}
            onChange={(e) => setParty({ ...party, gstin: e.target.value })} />
        </div>
        {showBillType && (
          <div>
            <Label className="text-xs">Bill Type</Label>
            <div><BillTypeToggle value={party.bill_type} onChange={(v) => setParty({ ...party, bill_type: v })} /></div>
          </div>
        )}
      </div>
    </div>
  );
}