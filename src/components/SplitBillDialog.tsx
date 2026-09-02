/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from "react";
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
import { billNo } from "@/lib/billNumber";
import { toast } from "sonner";
import {
  inr, inrRound, recomputeFolio, computeBillDiscountAmount,
  distributeWithRemainder, weightedGstRate, netSubtotalOf,
  realPaidTotal, isHoldPayment, overpaymentError, expandRoomNights,
  type BillDiscount,
} from "@/lib/billing";
import { DiscountDialog, type DiscType } from "@/components/DiscountDialog";
import { useDiscountLimit } from "@/hooks/use-discount-limit";
import { logActivity, userDisplayName } from "@/lib/activityLog";
import { isValidOrEmptyGSTIN, GSTIN_ERROR } from "@/lib/gstin";
import { useAuth, hasRole } from "@/hooks/use-auth";
import { usePaymentMethods, formatPaymentMethodLabel } from "@/hooks/use-payment-methods";
import { ArrowLeft, ArrowRight, Loader2, SplitSquareHorizontal, Plus, Trash2 } from "lucide-react";
import { Percent } from "lucide-react";
import { reportQueryError } from "@/lib/queryError";
import { toastError, BusinessError } from "@/lib/errorMessage";
import { finalizeFolioSettlement } from "@/lib/folioFinalize";

interface Charge {
  id: string; charge_type: string; description: string;
  qty: number; rate: number; amount: number;
  gst_rate: number; gst_amount: number;
  hsn_code?: string | null;
  source_table?: string | null; source_id?: string | null;
  /** Ref of the segment (food/laundry) bill this charge came from — must be
   *  carried onto split copies, otherwise the folio print can no longer
   *  consolidate the items into one "Food Bill (Ref: …)" line. */
  segment_bill_ref?: string | null;
  charged_on?: string | null;
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

// New: split MODE — the historic 2-party item flow is "item"; the new modes
// share the entire bill (or a specific charge line) across N parties either
// by percentage or by ₹ amount.
type SplitMode = "item" | "percent" | "amount";
type SplitScope = "whole" | "charge";

interface ShareParty extends PartyDetails {
  key: string;
  share: string; // free-form input (% in percent mode, ₹ in amount mode)
}

interface PartyDetails {
  name: string;
  mobile?: string;
  gstin?: string;
  bill_type: "cash_bill" | "gst_invoice";
}

interface PaymentRow { mode: string; amount: string; reference: string }

/** A payment already recorded on the parent folio before the split. */
interface ParentPayment {
  id: string;
  amount: number;
  mode: string;
  reference_no: string | null;
  paid_at: string | null;
  notes: string | null;
  booking_id: string | null;
  property_id: string;
}

function newParty(base: Partial<PartyDetails> = {}): ShareParty {
  return {
    key: Math.random().toString(36).slice(2),
    name: base.name ?? "",
    mobile: base.mobile ?? "",
    gstin: base.gstin ?? "",
    bill_type: base.bill_type ?? "gst_invoice",
    share: "",
  };
}

function round2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

export function SplitBillDialog({ open, onOpenChange, folio, booking, charges, onDone }: Props) {
  const { user, roles } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [splitType, setSplitType] = useState<SplitType>("same");
  const [splitMode, setSplitMode] = useState<SplitMode>("item");
  const [splitScope, setSplitScope] = useState<SplitScope>("whole");
  const [scopeChargeId, setScopeChargeId] = useState<string>("");
  /** How many bills this split produces (item mode). 2 = the historic flow. */
  const [billCount, setBillCount] = useState<number>(2);
  /** chargeId -> destination bill index (0-based). */
  const [assign, setAssign] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [maxDiscPct, setMaxDiscPct] = useState<number>(100);
  const [discOpen, setDiscOpen] = useState(false);
  const [discBillIdx, setDiscBillIdx] = useState<number>(0);
  // Parties list for percent/amount modes (min 2, no hard max).
  const [parties, setParties] = useState<ShareParty[]>([]);
  const { methods: payMethods } = usePaymentMethods(booking?.property_id ?? null);
  const { limit: discountLimit } = useDiscountLimit();

  // Payments already recorded on the parent folio (must be re-homed on split).
  const [parentPayments, setParentPayments] = useState<ParentPayment[]>([]);
  // paymentId -> per-child allocation strings (index matches child bill index)
  const [payAlloc, setPayAlloc] = useState<Record<string, string[]>>({});
  const allocConfirmedRef = useRef(false);

  // Resolve current user's max-discount % once dialog opens
  useEffect(() => {
    (async () => {
      if (!open || !user?.id || !booking?.property_id) return;
      const { data: pct, error: __qe1 } = await supabase.rpc("user_max_discount_pct", {
        _user_id: user.id, _property_id: booking.property_id,
      });
      if (__qe1) reportQueryError("user max discount pct", __qe1);
      const n = Number(pct);
      setMaxDiscPct(Number.isFinite(n) ? n : 0);
    })();
  }, [open, user?.id, booking?.property_id]);

  const guestName = booking?.guests?.name ?? "Guest";
  const guestMobile = booking?.guests?.mobile ?? "";
  const guestGstin = booking?.guests?.gst_number ?? "";
  const folioGst = "gst_invoice" as const;

  /** Parent folio's Bill-To company (when the bill is billed to a company).
   *  Split children must inherit this — the guest's personal GSTIN is only a
   *  fallback for individually-billed folios. */
  const [parentCompany, setParentCompany] = useState<
    { id: string; name: string; gstin: string | null } | null
  >(null);

  const [party1, setParty1] = useState<PartyDetails>({
    name: guestName, mobile: guestMobile, gstin: guestGstin, bill_type: folioGst,
  });
  const [party2, setParty2] = useState<PartyDetails>({
    name: "", mobile: "", gstin: "",
    bill_type: "gst_invoice",
  });
  /** Parties for bills 3..N (index 0 here = Bill 3). */
  const [moreParties, setMoreParties] = useState<PartyDetails[]>([]);

  // Resolve the parent folio's Bill-To company and seed Party 1 from it.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const companyId = folio?.billing_company_id ?? null;
      if (!companyId) {
        setParentCompany(null);
        // No Bill-To company — fall back to the folio snapshot, then the guest.
        setParty1((p) => ({
          ...p,
          name: folio?.guest_company || guestName,
          gstin: folio?.guest_gstin || guestGstin,
        }));
        return;
      }
      const { data, error } = await supabase
        .from("billing_companies" as any)
        .select("id,name,gstin")
        .eq("id", companyId)
        .maybeSingle();
      if (cancelled) return;
      if (error) reportQueryError("bill-to company", error);
      const co = (data ?? null) as { id: string; name: string; gstin: string | null } | null;
      setParentCompany(co);
      setParty1((p) => ({
        ...p,
        name: co?.name || folio?.guest_company || guestName,
        gstin: co?.gstin || folio?.guest_gstin || guestGstin,
      }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, folio?.billing_company_id, folio?.guest_company, folio?.guest_gstin]);

  /** Carry the parent's Bill-To company onto a child folio only when that
   *  child still bills the same party (i.e. the Bill-To wasn't changed here). */
  const childCompanyId = (partyName: string): string | null => {
    if (!parentCompany) return null;
    return partyName.trim().toLowerCase() === parentCompany.name.trim().toLowerCase()
      ? parentCompany.id
      : null;
  };

  const [createdBills, setCreatedBills] = useState<
    { folio_id: string; invoice_number: string | null; party: PartyDetails; total: number }[]
  >([]);
  const [payRows, setPayRows] = useState<PaymentRow[]>([
    { mode: "cash", amount: "", reference: "" },
    { mode: "cash", amount: "", reference: "" },
  ]);

  /**
   * Assignable units for Step 2 (display + assignment only — storage is
   * unchanged). Room charges spanning several nights are expanded into one
   * derived row per night (amounts distributed with remainder so they sum
   * EXACTLY to the stored charge). Food charges that came from a segment bill
   * are grouped into one row per bill reference; their underlying item rows
   * still travel individually into the split payload. Everything else stays
   * a single row, as before.
   */
  const units = useMemo(() => {
    const list: { id: string; label: string; kind: string; amount: number; members: Charge[] }[] = [];
    const groupAt = new Map<string, number>();
    for (const c of charges) {
      const nights = Math.round(Number(c.qty ?? 0));
      if (c.charge_type === "room" && nights > 1) {
        const parts = expandRoomNights([c as any]) as any[];
        parts.forEach((p, i) => {
          const day = String(p.charged_on ?? "").slice(0, 10);
          list.push({
            id: String(p.id ?? `${c.id}:n${i}`),
            label: `${p.description}${day ? ` — ${day.split("-").reverse().join("/")}` : ` — Night ${i + 1}`}`,
            kind: "room (night)",
            amount: Number(p.amount ?? 0),
            members: [{ ...(c as any), ...p, id: String(p.id ?? `${c.id}:n${i}`) } as Charge],
          });
        });
        continue;
      }
      const ref = (c.segment_bill_ref ?? "").trim();
      if (c.charge_type === "food" && ref) {
        const key = `food::${ref}`;
        const at = groupAt.get(key);
        if (at === undefined) {
          groupAt.set(key, list.length);
          list.push({
            id: `seg:${key}`,
            label: `Food Bill ${ref}`,
            kind: "food",
            amount: Number(c.amount ?? 0),
            members: [c],
          });
        } else {
          const row = list[at]!;
          row.amount = round2(row.amount + Number(c.amount ?? 0));
          row.members.push(c);
        }
        continue;
      }
      list.push({
        id: c.id,
        label: c.description,
        kind: c.charge_type,
        amount: Number(c.amount ?? 0),
        members: [c],
      });
    }
    return list;
  }, [charges]);

  // Default assignment: room/sundry/extra/discount → Bill 1; food → Bill 2.
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSplitType("same");
    setSplitMode("item");
    setSplitScope("whole");
    setScopeChargeId("");
    setBusy(false);
    setCreatedBills([]);
    setParty1({ name: guestName, mobile: guestMobile, gstin: guestGstin, bill_type: folioGst });
    setParty2({
      name: "", mobile: "", gstin: "",
      bill_type: "gst_invoice",
    });
    setMoreParties([]);
    setBillCount(2);
    setParties([
      newParty({ name: guestName, mobile: guestMobile, gstin: guestGstin, bill_type: folioGst }),
      newParty({ name: "", mobile: "", gstin: "", bill_type: "gst_invoice" }),
    ]);
    const nextAssign: Record<string, number> = {};
    for (const u of units) nextAssign[u.id] = u.kind === "food" ? 1 : 0;
    setAssign(nextAssign);
    setPayRows([
      { mode: "cash", amount: "", reference: "" },
      { mode: "cash", amount: "", reference: "" },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, folio?.id]);

  // Load payments already recorded against the parent folio.
  useEffect(() => {
    (async () => {
      setParentPayments([]);
      setPayAlloc({});
      allocConfirmedRef.current = false;
      if (!open || !folio?.id) return;
      const { data, error: __qe2 } = await supabase
        .from("payments")
        .select("id,amount,mode,reference_no,paid_at,notes,booking_id,property_id")
        .eq("folio_id", folio.id);
      if (__qe2) reportQueryError("payments", __qe2);
      setParentPayments(
        ((data ?? []) as any[]).map((p) => ({
          id: p.id,
          amount: Number(p.amount ?? 0),
          mode: p.mode,
          reference_no: p.reference_no ?? null,
          paid_at: p.paid_at ?? null,
          notes: p.notes ?? null,
          booking_id: p.booking_id ?? null,
          property_id: p.property_id,
        })),
      );
    })();
  }, [open, folio?.id]);

  /** Charges grouped per destination bill — index 0..billCount-1. */
  const billCharges = useMemo(() => {
    const buckets: Charge[][] = Array.from({ length: billCount }, () => []);
    for (const u of units) {
      const idx = Math.min(Math.max(0, assign[u.id] ?? 0), billCount - 1);
      for (const m of u.members) buckets[idx].push(m);
    }
    return buckets;
  }, [units, assign, billCount]);
  const bill1Charges = billCharges[0] ?? [];
  const bill2Charges = billCharges[1] ?? [];

  /** Party details for a given bill index (same-party mode reuses Party 1). */
  const partyForBill = (i: number): PartyDetails => {
    if (i === 0 || splitType === "same") return party1;
    if (i === 1) return party2;
    return moreParties[i - 2] ?? { name: "", mobile: "", gstin: "", bill_type: "gst_invoice" };
  };
  const setPartyForBill = (i: number, p: PartyDetails) => {
    if (i === 0) return setParty1(p);
    if (i === 1) return setParty2(p);
    setMoreParties((prev) => {
      const next = [...prev];
      while (next.length < i - 1) next.push({ name: "", mobile: "", gstin: "", bill_type: "gst_invoice" });
      next[i - 2] = p;
      return next;
    });
  };

  // === Base charges for share (% / ₹) modes ===
  //   whole  → every non-tax charge line
  //   charge → the single selected charge line
  const baseCharges = useMemo(() => {
    if (splitMode === "item") return [] as Charge[];
    if (splitScope === "charge") {
      const found = charges.find((c) => c.id === scopeChargeId);
      return found ? [found] : [];
    }
    // Include everything except explicit tax rows; discounts and negatives
    // are folded into the net subtotal by netSubtotalOf.
    return charges.filter((c) => c.charge_type !== "tax");
  }, [charges, splitMode, splitScope, scopeChargeId]);

  const baseNet = useMemo(() => netSubtotalOf(baseCharges as any), [baseCharges]);
  const baseGstRate = useMemo(() => weightedGstRate(baseCharges as any), [baseCharges]);

  // Live-computed distribution for the parties list.
  const shareDistribution = useMemo(() => {
    if (splitMode === "item" || parties.length === 0 || baseNet <= 0) {
      return {
        weights: [] as number[],
        nets: [] as number[],
        pcts: [] as number[],
        sumInput: 0,
        target: splitMode === "percent" ? 100 : baseNet,
        valid: false,
        remainder: 0,
      };
    }
    const raw = parties.map((p) => Math.max(0, Number(p.share) || 0));
    const sumInput = raw.reduce((s, x) => s + x, 0);
    // In amount mode: weights ARE the amounts. In percent mode: weights ARE
    // the percentages. distributeWithRemainder normalises either way, and
    // absorbs the paise remainder into the last party.
    const nets = distributeWithRemainder(baseNet, raw);
    const pcts = nets.map((n) => (baseNet > 0 ? (n / baseNet) * 100 : 0));
    const target = splitMode === "percent" ? 100 : baseNet;
    // Validity: sum of the user's raw inputs must land within a tiny epsilon
    // of the target. Percent target = 100, amount target = baseNet.
    const valid = Math.abs(sumInput - target) < (splitMode === "percent" ? 0.01 : 0.5);
    const remainder = Math.abs(nets.length ? nets[nets.length - 1] - (baseNet / (nets.length || 1)) : 0);
    return { weights: raw, nets, pcts, sumInput, target, valid, remainder };
  }, [parties, baseNet, splitMode]);

  /** Parent bill-level discount, proportionally carried to a subset of charges
   *  — mirrors the allocation used when the split bills are actually created. */
  const carriedDiscountFor = (subset: Charge[]): BillDiscount | null => {
    const parentBillDisc: BillDiscount | null =
      folio?.discount_type && Number(folio?.discount_value) > 0
        ? { type: folio.discount_type, value: Number(folio.discount_value) }
        : null;
    if (!parentBillDisc) return null;
    const netSubOf = (arr: Charge[]) => arr.reduce((s, c) => {
      if (c.charge_type === "discount" || c.charge_type === "tax") return s;
      const amt = Math.abs(Number(c.amount) || 0);
      const ld = Math.min(Number(c.discount_amount) || 0, amt);
      return s + (amt - ld);
    }, 0);
    const parentNet = netSubOf(charges);
    const amt = computeBillDiscountAmount(parentNet, parentBillDisc);
    if (!(amt > 0) || parentNet <= 0) return null;
    const share = Math.round((amt * (netSubOf(subset) / parentNet)) * 100) / 100;
    return share > 0 ? { type: "amount", value: share } : null;
  };
  /** Live total per destination bill (item mode). */
  const billTotals = useMemo(
    () => billCharges.map((items, i) =>
      recomputeFolio(
        items as any,
        partyForBill(i).bill_type === "gst_invoice" ? "gst" : "cash",
        carriedDiscountFor(items),
      ).total_amount),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [billCharges, party1.bill_type, party2.bill_type, moreParties, splitType, charges, folio?.discount_type, folio?.discount_value],
  );
  const bill1Total = billTotals[0] ?? 0;
  const bill2Total = billTotals[1] ?? 0;

  /**
   * The child bills this split will produce, with their expected totals.
   * Used to (a) seed the default payment allocation proportionally and
   * (b) label the allocation step. Index order matches the order the child
   * folios are created in, so allocations map 1:1 onto the new folio ids.
   */
  const childTargets = useMemo(() => {
    if (splitMode === "item") {
      return billTotals.map((t, i) => ({
        label: `Bill ${i + 1} — ${partyForBill(i).name || (i === 0 ? guestName : `Party ${i + 1}`)}`,
        total: Number(t),
      }));
    }
    return parties.map((p, i) => {
      const net = Number(shareDistribution.nets[i] ?? 0);
      const gst = p.bill_type === "gst_invoice" ? round2(net * baseGstRate / 100) : 0;
      return { label: `Bill ${i + 1} — ${p.name || `Party ${i + 1}`}`, total: round2(net + gst) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitMode, party1.name, party2.name, moreParties, splitType, guestName, billTotals, parties, shareDistribution, baseGstRate]);

  /** Default (proportional) allocation of a payment across the child bills. */
  function defaultAllocFor(amount: number, totals: number[]): number[] {
    const weights = totals.map((t) => Math.max(0, Number(t) || 0));
    const sum = weights.reduce((s, x) => s + x, 0);
    if (sum <= 0) return totals.map((_, i) => (i === 0 ? round2(amount) : 0));
    return distributeWithRemainder(amount, weights);
  }

  /** Current allocation numbers for a payment (user input or the default). */
  function allocFor(p: ParentPayment, totals: number[]): number[] {
    const raw = payAlloc[p.id];
    if (!raw) return defaultAllocFor(p.amount, totals);
    return totals.map((_, i) => round2(Number(raw[i] ?? 0) || 0));
  }

  const allocValid = useMemo(() => {
    if (parentPayments.length === 0) return true;
    const totals = childTargets.map((c) => c.total);
    return parentPayments.every((p) => {
      const sum = allocFor(p, totals).reduce((s, x) => s + x, 0);
      return Math.abs(sum - p.amount) < 0.01;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentPayments, payAlloc, childTargets]);

  /**
   * Step 4 defaults: each child's payment box pre-fills with the amount still
   * OUTSTANDING after the payments carried over from the parent folio.
   */
  function seedPayRows(created: { total: number }[]): PaymentRow[] {
    const totals = childTargets.map((c) => c.total);
    const carried = created.map((_, i) =>
      parentPayments.reduce((s, p) => s + (allocFor(p, totals)[i] ?? 0), 0));
    return created.map((cb, i) => ({
      mode: "cash",
      amount: Math.max(0, round2(cb.total - (carried[i] ?? 0))).toFixed(2),
      reference: "",
    }));
  }

  /** Payment re-home instructions handed to the atomic split RPC. */
  function paymentPayload() {
    const totals = childTargets.map((c) => c.total);
    return parentPayments.map((p) => {
      const alloc = allocFor(p, totals);
      const spans = alloc.filter((a) => a > 0).length > 1;
      return {
        payment_id: p.id,
        notes: spans
          ? `${p.notes ? `${p.notes} · ` : ""}Split from ${billNo(folio.invoice_number)} (₹${p.amount.toFixed(2)})`
          : p.notes,
        allocations: alloc
          .map((amount, child_index) => ({ child_index, amount: round2(amount) }))
          .filter((a) => a.amount > 0),
      };
    });
  }

  /**
   * The whole split now happens inside ONE SECURITY DEFINER transaction:
   * child folios, their charges, payment re-homing and the parent void either
   * all commit or none do. A single permission check runs at the top of the
   * function, so no sub-step can silently no-op under RLS and leave orphan
   * duplicate bills behind (the cause of the 6 Aug double-payment incident).
   */
  async function runAtomicSplit(children: any[], reason: string) {
    const { data, error } = await supabase.rpc("split_folio_bill" as any, {
      _folio_id: folio.id,
      _payload: { reason, children, payments: paymentPayload() },
    } as any);
    if (error) {
      throw new BusinessError(
        error.message?.trim() || "The bill could not be split. Nothing was changed.",
      );
    }
    const rows = (((data as any)?.children ?? []) as Array<{
      folio_id: string; invoice_number: string | null;
      total_amount: number; balance_amount: number;
    }>);
    if (rows.length !== children.length) {
      throw new BusinessError("The bill could not be split. Nothing was changed — please refresh and try again.");
    }
    return rows;
  }

  /**
   * Safeguard run after EVERY split attempt (success or failure): if the parent
   * plus its live children now add up to more than the parent's pre-split
   * total, money is double-counted — record it immediately instead of waiting
   * for someone to notice on a screenshot.
   */
  async function checkSplitIntegrity(parentTotalBefore: number) {
    try {
      const { data, error } = await supabase
        .from("folios")
        .select("id,total_amount,status,is_deleted,parent_folio_id,invoice_number")
        .or(`id.eq.${folio.id},parent_folio_id.eq.${folio.id}`);
      if (error) return;
      const live = ((data ?? []) as any[]).filter(
        (f) => !f.is_deleted && !["void", "refunded"].includes(String(f.status ?? "")),
      );
      const sum = live.reduce((s, f) => s + (Number(f.total_amount) || 0), 0);
      if (sum <= parentTotalBefore + 1) return;
      await logActivity({
        property_id: booking.property_id,
        user_id: user?.id ?? "",
        user_name: userDisplayName(user as any),
        action_type: "BILL_INTEGRITY_WARNING",
        module: "Billing",
        reference_id: booking.id,
        reference_label: `${billNo(folio.invoice_number)} — live bills total ₹${sum.toFixed(2)} vs original ₹${parentTotalBefore.toFixed(2)}`,
        details: {
          parent_folio_id: folio.id,
          parent_total_before: parentTotalBefore,
          live_total_after: sum,
          live_folios: live.map((f) => ({
            id: f.id, invoice_number: f.invoice_number,
            total_amount: f.total_amount, status: f.status,
            is_child: !!f.parent_folio_id,
          })),
        },
      });
      toast.error(
        "Bill integrity warning: the bills for this stay now add up to more than the original. This has been logged — please verify before collecting payment.",
      );
    } catch {
      /* never block the user on the safety net itself */
    }
  }

  function assignCharge(id: string, billIdx: number) {
    setAssign((prev) => ({ ...prev, [id]: billIdx }));
  }
  /** Auto-group: Lodge → Bill 1, Food → Bill 2, Laundry → Bill 3 (when it exists). */
  function autoGroupBySegment() {
    setAssign(() => {
      const next: Record<string, number> = {};
      for (const u of units) {
        const t = u.members[0]?.charge_type ?? "";
        let idx = 0;
        if (t === "food") idx = Math.min(1, billCount - 1);
        else if (t === "laundry" || t === "sundry") idx = Math.min(2, billCount - 1);
        next[u.id] = idx;
      }
      return next;
    });
  }
  /** Changing the bill count clamps any assignment that points past the end. */
  function changeBillCount(n: number) {
    const count = Math.max(2, Math.min(6, Math.round(n) || 2));
    setBillCount(count);
    setAssign((prev) => {
      const next = { ...prev };
      for (const u of units) next[u.id] = Math.min(next[u.id] ?? 0, count - 1);
      return next;
    });
  }

  async function confirmSplit() {
    if (!folio || !booking) return;
    // Payments already on the parent must be allocated to the child bills first.
    if (parentPayments.length > 0 && !allocConfirmedRef.current) {
      const totals = childTargets.map((c) => c.total);
      setPayAlloc((prev) => {
        const next = { ...prev };
        for (const p of parentPayments) {
          if (!next[p.id]) next[p.id] = defaultAllocFor(p.amount, totals).map((n) => n.toFixed(2));
        }
        return next;
      });
      setStep(5);
      return;
    }
    if (splitMode !== "item") {
      return confirmShareSplit();
    }
    const emptyIdx = billCharges.findIndex((items) => items.length === 0);
    if (emptyIdx >= 0) {
      return toast.error(`Bill ${emptyIdx + 1} has no line items — every bill needs at least one`);
    }
    for (let i = 0; i < billCount; i++) {
      const party = partyForBill(i);
      if (splitType === "different" && i > 0 && !party.name.trim()) {
        return toast.error(`Party ${i + 1} name required`);
      }
      if (!isValidOrEmptyGSTIN(party.gstin ?? "")) return toast.error(`Party ${i + 1}: ${GSTIN_ERROR}`);
    }
    setBusy(true);
    const parentTotalBefore = Number(folio?.total_amount) || 0;
    try {
      // Build both child bills, then hand the WHOLE split to one atomic RPC.
      const parentBillDisc: BillDiscount | null =
        folio?.discount_type && Number(folio?.discount_value) > 0
          ? { type: folio.discount_type, value: Number(folio.discount_value) }
          : null;
      const netSubOf = (arr: Charge[]) => arr.reduce((s, c) => {
        if (c.charge_type === "discount" || c.charge_type === "tax") return s;
        const amt = Math.abs(Number(c.amount) || 0);
        const ld = Math.min(Number(c.discount_amount) || 0, amt);
        return s + (amt - ld);
      }, 0);
      const parentNet = netSubOf(charges);
      const parentBillDiscAmt = computeBillDiscountAmount(parentNet, parentBillDisc);

      const splitParties = Array.from({ length: billCount }, (_, i) => partyForBill(i));
      const children = splitParties.map((party, i) => {
        const mode = party.bill_type === "gst_invoice" ? "gst" : "cash";
        const items = billCharges[i] ?? [];
        const thisNet = netSubOf(items);
        const shareAmt =
          parentBillDiscAmt > 0 && parentNet > 0
            ? Math.round((parentBillDiscAmt * (thisNet / parentNet)) * 100) / 100
            : 0;
        const carryDisc: BillDiscount | null = shareAmt > 0 ? { type: "amount", value: shareAmt } : null;
        const totals = recomputeFolio(items as any, mode, carryDisc);
        return {
          gst_mode: mode,
          bill_type: party.bill_type,
          guest_gstin: party.gstin || null,
          guest_company: splitType === "different" && i > 0 ? party.name : (folio.guest_company ?? null),
          billing_company_id: childCompanyId(
            splitType === "different" && i > 0 ? party.name : (folio.guest_company ?? party.name),
          ),
          notes: `Split bill ${i + 1}/${billCount} of voided ${billNo(folio.invoice_number)}${splitType === "different" ? ` — Party: ${party.name}` : ""}`,
          discount_type: carryDisc?.type ?? null,
          discount_value: carryDisc?.value ?? 0,
          ...totals,
          charges: items.map((c) => ({
            charge_type: c.charge_type,
            description: c.description,
            qty: c.qty,
            rate: c.rate,
            amount: c.amount,
            gst_rate: c.gst_rate,
            gst_amount: c.gst_amount,
            hsn_code: (c as any).hsn_code ?? null,
            segment_bill_ref: c.segment_bill_ref ?? null,
            charged_on: c.charged_on ?? null,
            source_table: c.source_table ?? null,
            source_id: c.source_id ?? null,
            discount_type: c.discount_type ?? null,
            discount_value: c.discount_value ?? 0,
            discount_amount: c.discount_amount ?? 0,
          })),
        };
      });

      const rows = await runAtomicSplit(children, `Split into ${billCount} bills (${splitType})`);
      const created: typeof createdBills = rows.map((r, i) => ({
        folio_id: r.folio_id,
        invoice_number: r.invoice_number,
        party: splitParties[i],
        total: Number(r.total_amount) || 0,
      }));
      const newFolioIds = created.map((c) => c.folio_id);

      setCreatedBills(created);
      setPayRows(seedPayRows(created));
      logActivity({
        property_id: booking.property_id,
        user_id: user?.id ?? "",
        user_name: userDisplayName(user as any),
        action_type: "BILL_SPLIT",
        module: "Billing",
        reference_id: booking.id,
        reference_label: `${billNo(folio.invoice_number)} → ${created.map((c) => billNo(c.invoice_number)).join(" + ")}`,
        details: {
          original_bill: billNo(folio.invoice_number),
          split_type: splitType,
          bill_count: created.length,
          bills: created.map((c) => ({
            bill_number: billNo(c.invoice_number),
            party: c.party.name,
            amount: c.total,
          })),
        },
      });
      toast.success(`Bills created: ${created.map((c) => billNo(c.invoice_number)).join(" + ")}`);
      setStep(4);
      onDone?.(newFolioIds);
    } catch (e: any) {
      toastError(e, "Could not split bill");
    } finally {
      await checkSplitIntegrity(parentTotalBefore);
      setBusy(false);
    }
  }

  /**
   * Confirm handler for the new %/Amount modes. Creates one folio per party
   * with a SINGLE lump-sum "Share of Bill" charge line, then voids the
   * original folio via the safe helper. GST is applied proportionally to
   * each share at the weighted average GST rate of the base scope, so the
   * per-party GST totals reconcile back to the original bill's GST.
   *
   * Rounding: distributeWithRemainder guarantees `sum(shares) === base` at
   * the paise level; the last party absorbs the remainder.
   */
  async function confirmShareSplit() {
    return confirmShareSplitInner();
  }

  async function confirmShareSplitInner() {
    if (!folio || !booking) return;
    if (parties.length < 2) return toast.error("Add at least two parties");
    if (parties.some((p) => !p.name.trim())) return toast.error("Every party needs a name");
    const badIdx = parties.findIndex((p) => !isValidOrEmptyGSTIN(p.gstin ?? ""));
    if (badIdx >= 0) return toast.error(`Party ${badIdx + 1}: ${GSTIN_ERROR}`);
    if (baseCharges.length === 0) return toast.error("Nothing to split — pick a charge line or use the whole bill");
    if (!shareDistribution.valid) {
      return toast.error(
        splitMode === "percent"
          ? `Percentages must total 100 (currently ${shareDistribution.sumInput.toFixed(2)})`
          : `Amounts must total ₹${baseNet.toFixed(2)} (currently ₹${shareDistribution.sumInput.toFixed(2)})`,
      );
    }

    setBusy(true);
    const parentTotalBefore = Number(folio?.total_amount) || 0;
    try {
      const scopeLabel = splitScope === "charge"
        ? (baseCharges[0]?.description ?? "charge")
        : "Bill";
      const nets = shareDistribution.nets; // rupees, sums exactly to baseNet
      const gstRate = baseGstRate;

      const children = parties.map((party, i) => {
        const mode = party.bill_type === "gst_invoice" ? "gst" : "cash";
        const partyNet = Number(nets[i] ?? 0);
        const partyGst = mode === "gst" ? round2(partyNet * gstRate / 100) : 0;
        const partyPct = round2(shareDistribution.pcts[i] ?? 0);
        const partyTotal = mode === "gst" ? round2(partyNet + partyGst) : round2(partyNet);
        const description = splitScope === "charge"
          ? `Share of ${scopeLabel} — ${partyPct}% of ${billNo(folio.invoice_number)}`
          : `Share of Bill — ${partyPct}% of ${billNo(folio.invoice_number)}`;
        return {
          gst_mode: mode,
          bill_type: party.bill_type,
          guest_gstin: party.gstin || null,
          guest_company: party.name,
          billing_company_id: childCompanyId(party.name),
          notes: `Split bill ${i + 1}/${parties.length} (${splitMode === "percent" ? "%" : "₹"}) of voided ${billNo(folio.invoice_number)} — Party: ${party.name}`,
          discount_type: null,
          discount_value: 0,
          sub_total: partyNet,
          discount_amount: 0,
          gst_amount: partyGst,
          total_amount: partyTotal,
          round_off_amount: 0,
          charges: [{
            charge_type: "share",
            description,
            qty: 1,
            rate: partyNet,
            amount: partyNet,
            gst_rate: gstRate,
            gst_amount: partyGst,
            source_table: "folios",
            source_id: folio.id,
          }],
        };
      });

      const rows = await runAtomicSplit(
        children,
        `Split by ${splitMode} into ${parties.length} bills (${splitScope})`,
      );
      const created: typeof createdBills = rows.map((r, i) => ({
        folio_id: r.folio_id,
        invoice_number: r.invoice_number,
        party: parties[i],
        total: Number(r.total_amount) || 0,
      }));
      const newFolioIds = created.map((c) => c.folio_id);

      setCreatedBills(created);
      setPayRows(seedPayRows(created));
      logActivity({
        property_id: booking.property_id,
        user_id: user?.id ?? "",
        user_name: userDisplayName(user as any),
        action_type: "BILL_SPLIT",
        module: "Billing",
        reference_id: booking.id,
        reference_label: `${billNo(folio.invoice_number)} → ${created.map((c) => billNo(c.invoice_number)).join(" + ")}`,
        details: {
          original_bill: billNo(folio.invoice_number),
          split_mode: splitMode,
          split_scope: splitScope,
          scope_charge_id: splitScope === "charge" ? scopeChargeId : null,
          base_net: baseNet,
          base_gst_rate: gstRate,
          parties: created.map((c) => ({
            bill_number: billNo(c.invoice_number),
            party: c.party.name,
            amount: c.total,
          })),
        },
      });
      toast.success(`Created ${created.length} bill${created.length > 1 ? "s" : ""}`);
      setStep(4);
      onDone?.(newFolioIds);
    } catch (e: any) {
      toastError(e, "Could not split bill");
    } finally {
      await checkSplitIntegrity(parentTotalBefore);
      setBusy(false);
    }
  }

  async function completeCheckout() {
    if (createdBills.length < 2) return;
    setBusy(true);
    try {
      for (let i = 0; i < createdBills.length; i++) {
        const b = createdBills[i];
        const row = payRows[i];
        const amt = Number(row.amount);
        // 0 is legitimate when the bill was already covered by a payment
        // carried over from the parent folio during the split.
        if (row.mode !== "credit" && amt < 0) {
          setBusy(false);
          return toast.error(`Bill ${i + 1}: payment amount cannot be negative`);
        }
        if (row.mode !== "credit" && amt > 0) {
          // Hard-block overpayment on each split portion.
          const { data: prevPays } = await supabase
            .from("payments")
            .select("amount,mode")
            .eq("folio_id", b.folio_id);
          const due = Number(b.total ?? 0) - realPaidTotal((prevPays ?? []) as any[]);
          const overErr = isHoldPayment(row.mode) ? null : overpaymentError(amt, due);
          if (overErr) {
            setBusy(false);
            return toast.error(`Bill ${i + 1}: ${overErr}`);
          }
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
      // Explicitly finalize each split bill that has nothing left to collect —
      // a zero-balance (or re-opened) folio never triggers a payment insert,
      // so the recompute trigger would never settle it.
      const settleFailures: string[] = [];
      for (const b of createdBills) {
        if (!b.folio_id) continue;
        try {
          await finalizeFolioSettlement(b.folio_id);
        } catch (e) {
          // A portion that still carries a balance is expected to stay open;
          // anything else is surfaced so staff know it needs attention.
          settleFailures.push((e as any)?.message ?? "Unknown error");
        }
      }
      if (settleFailures.length > 0) {
        console.error("[SplitBillDialog] settle failures", settleFailures);
      }
      // Mark booking checked-out.
      if (booking.status !== "checked_out" && booking.status !== "cancelled") {
        const now = new Date().toISOString();
        await supabase.from("bookings").update({
          status: "checked_out", checked_out_at: now, checked_out_by: user?.id ?? null,
        } as any).eq("id", booking.id);
        const { data: brs, error: __qe5 } = await supabase.from("booking_rooms").select("id,room_id").eq("booking_id", booking.id);
        if (__qe5) reportQueryError("booking rooms", __qe5);
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
      toastError(e, "Could not complete checkout");
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
    const { data: chargeRows, error: __qe6 } = await supabase.from("folio_charges")
      .select("*").eq("folio_id", target.folio_id);
    if (__qe6) reportQueryError("folio charges", __qe6);
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
    if (error) { toastError(error); return; }
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
        reference_label: billNo(target.invoice_number),
        details: {
          bill_number: billNo(target.invoice_number),
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
    const items = billCharges[discBillIdx] ?? [];
    return items.reduce((s, c) => {
      if (c.charge_type === "discount" || c.charge_type === "tax") return s;
      const amt = Math.abs(Number(c.amount) || 0);
      const ld = Math.min(Number(c.discount_amount) || 0, amt);
      return s + (amt - ld);
    }, 0);
  })();

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-3xl max-h-[90dvh] overflow-y-auto">
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
            <div className="text-sm font-medium">Step 1 — Split Mode</div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                How do you want to split?
              </Label>
              <div className="grid gap-2 sm:grid-cols-3">
                <ModeCard
                  active={splitMode === "item"}
                  title="Item-wise"
                  hint="Assign each charge line to any of the N bills"
                  onClick={() => setSplitMode("item")}
                />
                <ModeCard
                  active={splitMode === "percent"}
                  title="By %"
                  hint="Split across N parties by percentage"
                  onClick={() => setSplitMode("percent")}
                />
                <ModeCard
                  active={splitMode === "amount"}
                  title="By Amount ₹"
                  hint="Split across N parties by exact ₹"
                  onClick={() => setSplitMode("amount")}
                />
              </div>
            </div>
            {splitMode === "item" && (
              <>
            <div className="space-y-2 pt-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                How many bills?
              </Label>
              <div className="flex flex-wrap items-center gap-2">
                {[2, 3, 4].map((n) => (
                  <Button
                    key={n}
                    type="button"
                    size="sm"
                    variant={billCount === n ? "default" : "outline"}
                    onClick={() => changeBillCount(n)}
                  >
                    {n} bills
                  </Button>
                ))}
                <Input
                  type="number"
                  min={2}
                  max={6}
                  className="h-9 w-24"
                  value={billCount}
                  onChange={(e) => changeBillCount(Number(e.target.value))}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                e.g. 3 bills for Lodge / Food / Laundry. Maximum 6.
              </p>
            </div>
            <div className="text-xs font-medium text-muted-foreground pt-2">Party type</div>
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
              </>
            )}
            {splitMode !== "item" && (
              <div className="space-y-2 pt-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Scope</Label>
                <RadioGroup value={splitScope} onValueChange={(v) => setSplitScope(v as SplitScope)} className="gap-2">
                  <label className="flex items-start gap-3 rounded border p-3 cursor-pointer hover:bg-accent">
                    <RadioGroupItem value="whole" className="mt-0.5" />
                    <div className="flex-1">
                      <div className="text-sm font-medium">Split entire bill</div>
                      <div className="text-xs text-muted-foreground">
                        Full bill net ₹{netSubtotalOf(charges.filter((c) => c.charge_type !== "tax") as any).toFixed(2)}
                        {" "}(GST {weightedGstRate(charges.filter((c) => c.charge_type !== "tax") as any).toFixed(2)}%)
                      </div>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 rounded border p-3 cursor-pointer hover:bg-accent">
                    <RadioGroupItem value="charge" className="mt-0.5" />
                    <div className="flex-1 space-y-2">
                      <div className="text-sm font-medium">Split a specific charge</div>
                      <Select
                        value={scopeChargeId}
                        onValueChange={(v) => { setScopeChargeId(v); setSplitScope("charge"); }}
                        disabled={splitScope !== "charge"}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Pick a charge line…" />
                        </SelectTrigger>
                        <SelectContent>
                          {charges.filter((c) => c.charge_type !== "tax" && c.charge_type !== "discount").map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.description} — {inr(c.amount)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </label>
                </RadioGroup>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                onClick={() => {
                  if (splitMode !== "item" && splitScope === "charge" && !scopeChargeId) {
                    return toast.error("Pick a charge line to split");
                  }
                  setStep(2);
                }}
              >
                Next <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 2 && splitMode === "item" && (
          <div className="space-y-3">
            <div className="text-sm font-medium">Step 2 — Assign Line Items ({billCount} bills)</div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={autoGroupBySegment}>
                Auto-group: Lodge / Food / Laundry
              </Button>
            </div>
            <div className="rounded border divide-y max-h-80 overflow-y-auto">
              {charges.map((c) => (
                <div key={c.id} className="flex items-center gap-2 p-2 text-xs">
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{c.description}</div>
                    <div className="text-[10px] uppercase text-muted-foreground">{c.charge_type}</div>
                  </div>
                  <div className="tabular-nums font-medium">{inr(c.amount)}</div>
                  <Select
                    value={String(Math.min(assign[c.id] ?? 0, billCount - 1))}
                    onValueChange={(v) => assignCharge(c.id, Number(v))}
                  >
                    <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: billCount }, (_, i) => (
                        <SelectItem key={i} value={String(i)}>Bill {i + 1}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {billCharges.map((items, i) => (
                <div key={i} className="rounded border p-2 text-xs">
                  <div className="flex justify-between font-semibold">
                    <span>Bill {i + 1}</span>
                    <span className="tabular-nums">{inrRound(billTotals[i] ?? 0)}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {items.length === 0 ? "No items" : `${items.length} line${items.length > 1 ? "s" : ""}`}
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded border bg-muted/30 p-2 text-xs flex justify-between">
              <span>Sum of all bills</span>
              <span className="tabular-nums font-semibold">
                {inrRound(billTotals.reduce((a, b) => a + Number(b || 0), 0))}
                <span className="text-muted-foreground"> / original {inrRound(Number(folio?.total_amount) || 0)}</span>
              </span>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(1)}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
              <Button onClick={() => setStep(3)}>Next <ArrowRight className="h-4 w-4 ml-1" /></Button>
            </DialogFooter>
          </div>
        )}

        {step === 2 && splitMode !== "item" && (
          <ShareEditor
            splitMode={splitMode}
            baseNet={baseNet}
            baseGstRate={baseGstRate}
            baseChargeCount={baseCharges.length}
            scopeLabel={splitScope === "charge" ? (baseCharges[0]?.description ?? "charge") : "Entire bill"}
            parties={parties}
            setParties={setParties}
            distribution={shareDistribution}
            onBack={() => setStep(1)}
            onNext={confirmSplit}
            busy={busy}
          />
        )}

        {step === 3 && splitMode === "item" && (
          <div className="space-y-4">
            <div className="text-sm font-medium">Step 3 — Party Details</div>
            {Array.from({ length: billCount }, (_, i) => (
              i === 0 || splitType === "different" ? (
                <PartyEditor
                  key={i}
                  label={`Bill ${i + 1} Party`}
                  party={partyForBill(i)}
                  setParty={(p) => setPartyForBill(i, p)}
                  disabledName={i === 0 && splitType === "same"}
                  showMobile={i > 0}
                />
              ) : null
            ))}
            {splitType === "same" && (
              <div className="rounded border bg-muted/30 p-3 text-xs text-muted-foreground">
                All {billCount} bills will use the same party ({party1.name}).
              </div>
            )}
            <div className="rounded border p-3 text-xs space-y-1">
              <div className="font-semibold">Summary</div>
              {Array.from({ length: billCount }, (_, i) => {
                const party = partyForBill(i);
                return (
                  <div key={i}>
                    Bill {i + 1}: {party.name || "—"} ·{" "}
                    <Badge variant="outline" className="text-[10px]">{party.bill_type}</Badge> ·{" "}
                    {(billCharges[i] ?? []).length} line(s) · <b>{inrRound(billTotals[i] ?? 0)}</b>
                  </div>
                );
              })}
              <div className="pt-1 border-t">
                Total across bills: <b>{inrRound(billTotals.reduce((a, b) => a + Number(b || 0), 0))}</b>
                {" "}vs original <b>{inrRound(Number(folio?.total_amount) || 0)}</b>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Each bill draws its own number from this property's bill series; the split is atomic —
                if any part fails nothing is changed.
              </div>
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

        {step === 5 && (
          <div className="space-y-4">
            <div className="text-sm font-medium">Allocate Existing Payments</div>
            <div className="rounded border bg-amber-50 p-3 text-xs text-amber-900">
              This bill already has {parentPayments.length} recorded payment
              {parentPayments.length > 1 ? "s" : ""} totalling{" "}
              <b>{inr(parentPayments.reduce((s, p) => s + p.amount, 0))}</b>. Decide how each
              payment should be shared across the new bills — the amounts must add up to the
              original payment. Defaults are proportional to each bill's total.
            </div>
            {parentPayments.map((p) => {
              const totals = childTargets.map((c) => c.total);
              const alloc = allocFor(p, totals);
              const sum = alloc.reduce((s, x) => s + x, 0);
              const ok = Math.abs(sum - p.amount) < 0.01;
              return (
                <div key={p.id} className="rounded border p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <div>
                      <div className="font-semibold">{inr(p.amount)} · {formatPaymentMethodLabel(p.mode)}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.paid_at ? new Date(p.paid_at).toLocaleString("en-IN") : ""}
                        {p.reference_no ? ` · Ref ${p.reference_no}` : ""}
                      </div>
                    </div>
                    <Badge variant="outline" className={ok ? "border-emerald-400 text-emerald-700" : "border-amber-400 text-amber-700"}>
                      {ok ? "Balanced ✓" : `Off by ${inr(sum - p.amount)}`}
                    </Badge>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {childTargets.map((c, i) => (
                      <div key={i}>
                        <Label className="text-xs">{c.label} · {inrRound(c.total)}</Label>
                        <Input
                          type="number"
                          value={payAlloc[p.id]?.[i] ?? (alloc[i] ?? 0).toFixed(2)}
                          onChange={(e) => setPayAlloc((prev) => {
                            const cur = prev[p.id] ?? alloc.map((n) => n.toFixed(2));
                            const next = [...cur];
                            next[i] = e.target.value;
                            return { ...prev, [p.id]: next };
                          })}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(splitMode === "item" ? 3 : 2)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button
                disabled={busy || !allocValid}
                onClick={() => { allocConfirmedRef.current = true; void confirmSplit(); }}
              >
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
                    <div className="font-semibold">{billNo(b.invoice_number)}</div>
                    <div className="text-xs text-muted-foreground">{b.party.name}</div>
                  </div>
                  <div className="font-semibold tabular-nums">{inrRound(b.total)}</div>
                </div>
                <div className="flex justify-end">
                  <Button size="sm" variant="outline"
                    onClick={() => { setDiscBillIdx(i); setDiscOpen(true); }}>
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
                        {payMethods.map((m) => (
                          <SelectItem key={m.id} value={m.name}>
                            {formatPaymentMethodLabel(m.name)}
                          </SelectItem>
                        ))}
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
      limit={discountLimit}
      onSave={saveSplitBillDiscount}
      title={`Apply discount on Bill ${discBillIdx + 1}`}
    />
    </>
  );
}

function PartyEditor({
  label, party, setParty, showMobile, disabledName,
}: {
  label: string;
  party: PartyDetails;
  setParty: (p: PartyDetails) => void;
  showMobile?: boolean;
  disabledName?: boolean;
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
          <Input
            value={party.gstin ?? ""}
            maxLength={15}
            placeholder="e.g. 27AASFB5351R1ZM"
            onChange={(e) => setParty({ ...party, gstin: e.target.value.toUpperCase() })}
            className={party.gstin && !isValidOrEmptyGSTIN(party.gstin) ? "border-red-500 focus-visible:ring-red-500" : ""}
          />
          {party.gstin && !isValidOrEmptyGSTIN(party.gstin) && (
            <p className="mt-1 text-[11px] text-red-600">{GSTIN_ERROR}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ModeCard({
  active, title, hint, onClick,
}: {
  active: boolean;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded border p-3 space-y-1 transition ${
        active ? "border-primary bg-primary/5" : "hover:bg-accent/50"
      }`}
    >
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
    </button>
  );
}

interface ShareDistribution {
  weights: number[];
  nets: number[];
  pcts: number[];
  sumInput: number;
  target: number;
  valid: boolean;
  remainder: number;
}

function ShareEditor({
  splitMode, baseNet, baseGstRate, baseChargeCount, scopeLabel, parties, setParties,
  distribution, onBack, onNext, busy,
}: {
  splitMode: "percent" | "amount";
  baseNet: number;
  baseGstRate: number;
  baseChargeCount: number;
  scopeLabel: string;
  parties: ShareParty[];
  setParties: (p: ShareParty[] | ((prev: ShareParty[]) => ShareParty[])) => void;
  distribution: ShareDistribution;
  onBack: () => void;
  onNext: () => void;
  busy: boolean;
}) {
  const isPct = splitMode === "percent";
  const target = isPct ? 100 : baseNet;
  const diff = distribution.sumInput - target;
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">Step 2 — Parties &amp; Shares</div>
      <div className="rounded border bg-muted/30 p-3 text-xs space-y-1">
        <div>
          Splitting: <span className="font-medium">{scopeLabel}</span>
          {baseChargeCount > 1 && <span className="text-muted-foreground"> ({baseChargeCount} lines)</span>}
        </div>
        <div>
          Base subtotal (pre-GST): <b>₹{baseNet.toFixed(2)}</b>
          {baseGstRate > 0 && <span className="text-muted-foreground"> · GST rate {baseGstRate.toFixed(2)}%</span>}
        </div>
      </div>

      <div className="space-y-2">
        {parties.map((p, i) => {
          const partyNet = distribution.nets[i] ?? 0;
          const partyPct = distribution.pcts[i] ?? 0;
          return (
            <div key={p.key} className="rounded border p-2 space-y-2">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_120px_auto] items-end">
                <div>
                  <Label className="text-[10px] uppercase tracking-wider">Party {i + 1} name *</Label>
                  <Input
                    value={p.name}
                    onChange={(e) => setParties((prev) => prev.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))}
                    placeholder={`Party ${i + 1}`}
                  />
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-wider">GSTIN / Mobile</Label>
                  <Input
                    value={p.gstin ?? p.mobile ?? ""}
                    onChange={(e) => setParties((prev) => prev.map((x, idx) => idx === i ? { ...x, gstin: e.target.value } : x))}
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-wider">
                    {isPct ? "Share %" : "Amount ₹"}
                  </Label>
                  <Input
                    type="number"
                    value={p.share}
                    onChange={(e) => setParties((prev) => prev.map((x, idx) => idx === i ? { ...x, share: e.target.value } : x))}
                    placeholder={isPct ? "e.g. 50" : "e.g. 500"}
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9 text-destructive"
                    disabled={parties.length <= 2}
                    onClick={() => setParties((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                <span>
                  → Net ₹<span className="font-medium text-foreground">{partyNet.toFixed(2)}</span>
                </span>
                <span>
                  Effective <span className="font-medium text-foreground">{partyPct.toFixed(2)}%</span>
                </span>
                {baseGstRate > 0 && (
                  <span>
                    GST @ {baseGstRate.toFixed(2)}% = ₹
                    <span className="font-medium text-foreground">
                      {(partyNet * baseGstRate / 100).toFixed(2)}
                    </span>
                  </span>
                )}
                {i === parties.length - 1 && distribution.valid && Math.abs(diff) < 0.01 && (
                  <span className="text-[10px] italic">
                    Last party absorbs paise-level rounding so party totals equal the source exactly.
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-xs">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" onClick={() => setParties((prev) => [...prev, newParty()])}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add party
          </Button>
          <span>
            Sum: <span className="font-medium">
              {isPct ? `${distribution.sumInput.toFixed(2)}%` : `₹${distribution.sumInput.toFixed(2)}`}
            </span>
            {" / "}
            <span className="text-muted-foreground">
              {isPct ? "100%" : `₹${target.toFixed(2)}`}
            </span>
          </span>
        </div>
        <Badge
          variant="outline"
          className={
            distribution.valid
              ? "border-emerald-400 text-emerald-700"
              : "border-amber-400 text-amber-700"
          }
        >
          {distribution.valid
            ? "Balanced ✓"
            : isPct
              ? `Off by ${diff.toFixed(2)}%`
              : `Off by ₹${diff.toFixed(2)}`}
        </Badge>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Button onClick={onNext} disabled={busy || !distribution.valid}>
          {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
          Confirm &amp; Split
        </Button>
      </DialogFooter>
    </div>
  );
}