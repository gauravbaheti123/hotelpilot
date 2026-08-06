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
  const [bill1Ids, setBill1Ids] = useState<Set<string>>(new Set());
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
    setParties([
      newParty({ name: guestName, mobile: guestMobile, gstin: guestGstin, bill_type: folioGst }),
      newParty({ name: "", mobile: "", gstin: "", bill_type: "gst_invoice" }),
    ]);
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

  const bill1Charges = useMemo(() => charges.filter((c) => bill1Ids.has(c.id)), [charges, bill1Ids]);
  const bill2Charges = useMemo(() => charges.filter((c) => !bill1Ids.has(c.id)), [charges, bill1Ids]);

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
  const bill1Total = useMemo(
    () => recomputeFolio(bill1Charges as any, party1.bill_type === "gst_invoice" ? "gst" : "cash", carriedDiscountFor(bill1Charges)).total_amount,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bill1Charges, party1.bill_type, charges, folio?.discount_type, folio?.discount_value],
  );
  const bill2Total = useMemo(
    () => recomputeFolio(bill2Charges as any, party2.bill_type === "gst_invoice" ? "gst" : "cash", carriedDiscountFor(bill2Charges)).total_amount,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bill2Charges, party2.bill_type, charges, folio?.discount_type, folio?.discount_value],
  );

  /**
   * The child bills this split will produce, with their expected totals.
   * Used to (a) seed the default payment allocation proportionally and
   * (b) label the allocation step. Index order matches the order the child
   * folios are created in, so allocations map 1:1 onto the new folio ids.
   */
  const childTargets = useMemo(() => {
    if (splitMode === "item") {
      return [
        { label: `Bill 1 — ${party1.name || guestName}`, total: Number(bill1Total) },
        { label: `Bill 2 — ${splitType === "same" ? (party1.name || guestName) : (party2.name || "Party 2")}`, total: Number(bill2Total) },
      ];
    }
    return parties.map((p, i) => {
      const net = Number(shareDistribution.nets[i] ?? 0);
      const gst = p.bill_type === "gst_invoice" ? round2(net * baseGstRate / 100) : 0;
      return { label: `Bill ${i + 1} — ${p.name || `Party ${i + 1}`}`, total: round2(net + gst) };
    });
  }, [splitMode, party1.name, party2.name, splitType, guestName, bill1Total, bill2Total, parties, shareDistribution, baseGstRate]);

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

  /**
   * Re-home every parent-folio payment onto the child folios BEFORE the parent
   * is voided, so void_folio_safe() succeeds normally with _force:false and no
   * payment history is orphaned or lost.
   *
   * A payment allocated entirely to one child is simply repointed (same row,
   * same id — reconciliation history preserved). A payment spanning several
   * children keeps its original row for the first share and gets sibling rows
   * for the rest, each tagged with the source payment id in `notes`.
   *
   * Returns an undo() that restores the original state, used if the void fails.
   */
  async function movePaymentsToChildren(childFolioIds: string[]) {
    const totals = childTargets.map((c) => c.total);
    const insertedIds: string[] = [];
    const moved: { id: string; amount: number }[] = [];
    const undo = async () => {
      if (insertedIds.length > 0) await supabase.from("payments").delete().in("id", insertedIds);
      for (const m of moved) {
        await supabase.from("payments")
          .update({ folio_id: folio.id, amount: m.amount } as any).eq("id", m.id);
      }
    };
    try {
      for (const p of parentPayments) {
        const alloc = allocFor(p, totals);
        const idxs = alloc.map((a, i) => ({ a, i })).filter((x) => x.a > 0);
        if (idxs.length === 0) continue;
        const [first, ...rest] = idxs;
        const { data: movedRow, error: upErr } = await supabase.from("payments").update({
          folio_id: childFolioIds[first.i],
          amount: first.a,
          notes: rest.length > 0
            ? `${p.notes ? `${p.notes} · ` : ""}Split from ${billNo(folio.invoice_number)} (₹${p.amount.toFixed(2)})`
            : p.notes,
        } as any).eq("id", p.id).select("id").maybeSingle();
        if (upErr) throw upErr;
        // A silent no-op update (e.g. blocked by row-level security) used to
        // leave the payment stranded on the parent folio, which then refused
        // to void and survived the split as a duplicate full-value bill.
        if (!movedRow) {
          // Nothing was logged the last time this happened, so the cause was
          // undiagnosable. Leave a trail before aborting.
          await logActivity({
            property_id: booking.property_id,
            user_id: user?.id ?? "",
            user_name: userDisplayName(user as any),
            action_type: "BILL_SPLIT_FAILED",
            module: "Billing",
            reference_id: booking.id,
            reference_label: `${billNo(folio.invoice_number)} — payment move returned 0 rows`,
            details: {
              reason: "payments update affected 0 rows",
              payment_id: p.id,
              payment_amount: p.amount,
              parent_folio_id: folio.id,
              target_folio_id: childFolioIds[first.i],
              child_folio_ids: childFolioIds,
              supabase_response: { data: movedRow ?? null, error: upErr ?? null },
            },
          });
          throw new BusinessError(
            "Could not move an existing payment onto the new bills — split cancelled so no duplicate bill is created.",
          );
        }
        moved.push({ id: p.id, amount: p.amount });
        for (const r of rest) {
          const { data: ins, error: insErr } = await supabase.from("payments").insert({
            property_id: p.property_id,
            folio_id: childFolioIds[r.i],
            booking_id: p.booking_id ?? booking.id,
            amount: r.a,
            mode: p.mode,
            reference_no: p.reference_no,
            paid_at: p.paid_at ?? undefined,
            notes: `${p.notes ? `${p.notes} · ` : ""}Split from ${billNo(folio.invoice_number)} (₹${p.amount.toFixed(2)}, source payment ${p.id})`,
            created_by: user?.id ?? null,
          } as any).select("id").single();
          if (insErr) throw insErr;
          insertedIds.push((ins as any).id);
        }
      }
      return { undo };
    } catch (e) {
      await undo();
      throw e;
    }
  }

  function moveToBill1(id: string) { setBill1Ids((s) => new Set([...s, id])); }

  /**
   * `void_folio_safe` can return without an error yet leave the parent alive
   * (nothing matched, or the update was filtered). If that goes unnoticed the
   * booking ends up with the parent AND its portions live, and every
   * single-folio sum (check-out above all) double-counts the bill. Verify and
   * roll back instead.
   */
  /**
   * Delete child folios (and their copied charges) created during a split
   * attempt. Called from every failure path so a half-finished split can never
   * leave unnumbered duplicate bills behind.
   */
  async function cleanupChildFolios(ids: string[]) {
    if (!ids || ids.length === 0) return;
    try {
      await supabase.from("folio_charges").delete().in("folio_id", ids);
      await supabase.from("folios").delete().in("id", ids);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[split] child folio cleanup failed", { ids, e });
    }
  }

  /**
   * Guard against compounding a previous failure: if the parent already has
   * live, unnumbered child folios from an aborted attempt, refuse to start a
   * new split until they are cleared.
   */
  async function assertNoOrphanChildren(): Promise<boolean> {
    const { data, error } = await supabase
      .from("folios")
      .select("id,invoice_number,status,is_deleted")
      .eq("parent_folio_id", folio.id);
    if (error) { reportQueryError("existing split bills", error); return false; }
    const orphans = ((data ?? []) as any[]).filter(
      (f) => !f.is_deleted && !["void", "refunded"].includes(String(f.status ?? "")) && !f.invoice_number,
    );
    if (orphans.length === 0) return true;
    toast.error(
      `A previous split attempt on ${billNo(folio.invoice_number)} didn't complete — ${orphans.length} incomplete bill${orphans.length > 1 ? "s" : ""} left behind. Retry cleanup or contact support before splitting again.`,
    );
    return false;
  }

  async function assertParentVoided(undoPayments: () => Promise<void>, newFolioIds: string[]) {
    const { data: after } = await supabase
      .from("folios").select("status").eq("id", folio.id).maybeSingle();
    if (String((after as any)?.status ?? "") === "void") return;
    await undoPayments();
    await cleanupChildFolios(newFolioIds);
    throw new BusinessError("The original bill could not be voided — split cancelled so no duplicate bill remains.");
  }

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
    if (bill1Charges.length === 0 || bill2Charges.length === 0) {
      return toast.error("Both bills must have at least one line item");
    }
    if (splitType === "different" && !party2.name.trim()) {
      return toast.error("Party 2 name required");
    }
    if (!isValidOrEmptyGSTIN(party1.gstin ?? "")) return toast.error(`Party 1: ${GSTIN_ERROR}`);
    if (splitType === "different" && !isValidOrEmptyGSTIN(party2.gstin ?? "")) return toast.error(`Party 2: ${GSTIN_ERROR}`);
    if (!(await assertNoOrphanChildren())) return;
    setBusy(true);
    // Tracked outside the try so ANY failure can remove the folios this
    // attempt created — no orphan duplicate bills, ever.
    const newFolioIds: string[] = [];
    let completed = false;
    try {
      // 1) Create Invoice A + Invoice B FIRST. Only void the original after both succeed.
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
          parent_folio_id: folio.id,
          gst_mode: mode,
          bill_type: party.bill_type,
          guest_gstin: party.gstin || null,
          guest_company: splitType === "different" && i === 1 ? party.name : (folio.guest_company ?? null),
          billing_company_id: childCompanyId(
            splitType === "different" && i === 1 ? party.name : (folio.guest_company ?? party.name),
          ),
          notes: `Split bill ${i + 1}/2 of voided ${billNo(folio.invoice_number)}${splitType === "different" ? ` — Party: ${party.name}` : ""}`,
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
          segment_bill_ref: c.segment_bill_ref ?? null,
          ...(c.charged_on ? { charged_on: c.charged_on } : {}),
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

      // 3) Move any existing parent payments onto the children, then void the
      //    original via the safe helper (which refuses to void a folio that
      //    still has payments — by now it has none).
      const { undo: undoPayments } = await movePaymentsToChildren(newFolioIds);
      const { error: voidErr } = await supabase.rpc("void_folio_safe" as any, {
        _folio_id: folio.id,
        _reason: `Split into 2 bills (${splitType})`,
        _user_id: user?.id ?? null,
        _force: false,
      } as any);
      if (voidErr) {
        // Rollback the newly created folios so we don't end up with 3 active bills.
        await undoPayments();
        await supabase.from("folios").delete().in("id", newFolioIds);
        throw voidErr;
      }
      await assertParentVoided(undoPayments, newFolioIds);
      await repointBills(folio.id, newFolioIds);
      completed = true;

      setCreatedBills(created);
      setPayRows(
        created.map((cb) => ({ mode: "cash", amount: cb.total.toFixed(2), reference: "" })),
      );
      logActivity({
        property_id: booking.property_id,
        user_id: user?.id ?? "",
        user_name: userDisplayName(user as any),
        action_type: "BILL_SPLIT",
        module: "Billing",
        reference_id: booking.id,
        reference_label: `${billNo(folio.invoice_number)} → ${billNo(created[0].invoice_number)} + ${billNo(created[1].invoice_number)}`,
        details: {
          original_bill: billNo(folio.invoice_number),
          bill1_number: billNo(created[0].invoice_number),
          bill2_number: billNo(created[1].invoice_number),
          split_type: splitType,
        },
      });
      toast.success(`Bills created: ${billNo(created[0].invoice_number)} + ${billNo(created[1].invoice_number)}`);
      setStep(4);
      onDone?.(newFolioIds);
    } catch (e: any) {
      if (!completed) await cleanupChildFolios(newFolioIds);
      toastError(e, "Could not split bill");
    } finally {
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

  /**
   * After a split, segment_bills / food_bills rows still point at the voided
   * parent folio. Repoint them to the child folio that actually received the
   * matching food charge rows (fallback: the largest child).
   */
  async function repointBills(parentFolioId: string, childFolioIds: string[]) {
    try {
      if (childFolioIds.length === 0) return;
      const { data: childCharges, error: __qe3 } = await supabase
        .from("folio_charges")
        .select("folio_id,source_table,source_id")
        .in("folio_id", childFolioIds);
      if (__qe3) reportQueryError("folio charges", __qe3);
      const bySegment = new Map<string, string>();
      for (const c of (childCharges ?? []) as any[]) {
        if (c.source_table === "segment_bills" && c.source_id) bySegment.set(c.source_id, c.folio_id);
      }
      const fallback = bySegment.size > 0
        ? [...bySegment.values()][0]
        : childFolioIds[childFolioIds.length - 1];

      const { data: segs, error: __qe4 } = await supabase
        .from("segment_bills")
        .select("id")
        .eq("folio_id", parentFolioId);
      if (__qe4) reportQueryError("segment bills", __qe4);
      for (const s of (segs ?? []) as any[]) {
        await supabase.from("segment_bills")
          .update({ folio_id: bySegment.get(s.id) ?? fallback } as any).eq("id", s.id);
      }
      await supabase.from("food_bills")
        .update({ folio_id: fallback } as any).eq("folio_id", parentFolioId);
    } catch { /* non-fatal — split already succeeded */ }
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

    if (!(await assertNoOrphanChildren())) return;
    setBusy(true);
    const newFolioIds: string[] = [];
    let completed = false;
    try {
      const scopeLabel = splitScope === "charge"
        ? (baseCharges[0]?.description ?? "charge")
        : "Bill";
      const nets = shareDistribution.nets; // rupees, sums exactly to baseNet
      const gstRate = baseGstRate;
      const created: typeof createdBills = [];
      for (let i = 0; i < parties.length; i++) {
        const party = parties[i];
        const mode = party.bill_type === "gst_invoice" ? "gst" : "cash";
        const partyNet = Number(nets[i] ?? 0);
        const partyGst = mode === "gst"
          ? round2(partyNet * gstRate / 100)
          : 0;
        const partyPct = round2(shareDistribution.pcts[i] ?? 0);
        const description = splitScope === "charge"
          ? `Share of ${scopeLabel} — ${partyPct}% of ${billNo(folio.invoice_number)}`
          : `Share of Bill — ${partyPct}% of ${billNo(folio.invoice_number)}`;
        const partyTotal = mode === "gst" ? round2(partyNet + partyGst) : round2(partyNet);
        const { data: f, error: fErr } = await supabase.from("folios").insert({
          property_id: booking.property_id,
          booking_id: booking.id,
          parent_folio_id: folio.id,
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
          paid_amount: 0,
          balance_amount: partyTotal,
          created_by: user?.id ?? null,
        } as any).select("id,invoice_number,total_amount").single();
        if (fErr) {
          if (newFolioIds.length > 0) {
            await supabase.from("folios").delete().in("id", newFolioIds);
          }
          throw fErr;
        }
        const newId = (f as any).id as string;
        newFolioIds.push(newId);

        // Single lump-sum charge line describing this party's share.
        const chargeRow = {
          folio_id: newId,
          charge_type: "share",
          description,
          qty: 1,
          rate: partyNet,
          amount: partyNet,
          gst_rate: gstRate,
          gst_amount: partyGst,
          source_table: "folios",
          source_id: folio.id,
          created_by: user?.id ?? null,
        };
        const { error: cErr } = await supabase.from("folio_charges").insert([chargeRow] as any);
        if (cErr) {
          await supabase.from("folios").delete().in("id", newFolioIds);
          throw cErr;
        }

        created.push({
          folio_id: newId,
          invoice_number: (f as any).invoice_number,
          party,
          total: Number((f as any).total_amount ?? partyTotal),
        });
      }

      // Move existing parent payments onto the children, then void the source
      // only after every share folio is safely persisted.
      const { undo: undoPayments } = await movePaymentsToChildren(newFolioIds);
      const { error: voidErr } = await supabase.rpc("void_folio_safe" as any, {
        _folio_id: folio.id,
        _reason: `Split by ${splitMode} into ${parties.length} bills (${splitScope})`,
        _user_id: user?.id ?? null,
        _force: false,
      } as any);
      if (voidErr) {
        await undoPayments();
        await supabase.from("folios").delete().in("id", newFolioIds);
        throw voidErr;
      }
      await assertParentVoided(undoPayments, newFolioIds);
      await repointBills(folio.id, newFolioIds);
      completed = true;

      setCreatedBills(created);
      setPayRows(
        created.map((cb) => ({ mode: "cash", amount: cb.total.toFixed(2), reference: "" })),
      );
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
      if (!completed) await cleanupChildFolios(newFolioIds);
      toastError(e, "Could not split bill");
    } finally {
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
      for (const b of createdBills) {
        if (b.folio_id) await finalizeFolioSettlement(b.folio_id);
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
    const items = discBillIdx === 0 ? bill1Charges : bill2Charges;
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
            <div className="text-sm font-medium">Step 1 — Split Mode</div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                How do you want to split?
              </Label>
              <div className="grid gap-2 sm:grid-cols-3">
                <ModeCard
                  active={splitMode === "item"}
                  title="Item-wise"
                  hint="Assign each charge line to one of two bills"
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
                      <span>Total</span><span>{inrRound(total)}</span>
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
            <PartyEditor label="Bill 1 Party" party={party1} setParty={setParty1} disabledName={splitType === "same"} />
            {splitType === "different" ? (
              <PartyEditor label="Bill 2 Party" party={party2} setParty={setParty2} showMobile />
            ) : (
              <div className="rounded border bg-muted/30 p-3 text-xs text-muted-foreground">
                Bill 2 will use the same party as Bill 1 ({party1.name}).
              </div>
            )}
            <div className="rounded border p-3 text-xs space-y-1">
              <div className="font-semibold">Summary</div>
              <div>Bill 1: {party1.name} · <Badge variant="outline" className="text-[10px]">{party1.bill_type}</Badge> · <b>{inrRound(bill1Total)}</b></div>
              <div>Bill 2: {splitType === "same" ? party1.name : (party2.name || "—")} · <Badge variant="outline" className="text-[10px]">{party2.bill_type}</Badge> · <b>{inrRound(bill2Total)}</b></div>
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
                  <div className="flex items-center justify-between text-sm">
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

      <div className="flex items-center justify-between rounded border p-2 text-xs">
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