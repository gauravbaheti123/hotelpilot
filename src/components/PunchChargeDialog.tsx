import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Trash2, Plus, Printer, Check, ChevronsUpDown } from "lucide-react";
import { inr } from "@/lib/billing";
import { usePaymentMethods, formatPaymentMethodLabel } from "@/hooks/use-payment-methods";
import { useAuth } from "@/hooks/use-auth";
import { ItemPickerCombobox, type PickerItem } from "@/components/ItemPickerCombobox";
import { buildKotPrintPlan, runKotPrintJobs, printThermalHtml, type PrinterInfo, type KotItemForPrint } from "@/lib/kotPrint";
import {
  fetchBillPrinter,
  getPrintContainerWidth,
  getThermalFeedCss,
  THERMAL_FEED_HTML,
} from "@/lib/printStyles";
import { resolveLogoUrl } from "@/lib/invoiceTemplates";
import { reportQueryError, guardQuery } from "@/lib/queryError";
import { toastError } from "@/lib/errorMessage";

export type SegmentKind = "food" | "laundry";

interface Line {
  key: string;
  description: string;
  qty: number;
  rate: number;
  gst_rate: number;
  menu_item_id?: string | null;
  master_id?: string | null;
  printer_id?: string | null;
  /** Per-item preparation instruction — prints on the KOT/service ticket only. */
  note?: string;
}


interface Props {
  open: boolean;
  onClose: () => void;
  segment: SegmentKind;
  propertyId: string;
  propertyName?: string;
  bookingId?: string | null;
  roomId?: string | null;
  roomNumber?: string | null;
  guestName?: string | null;
  onSaved?: () => void;
}

function uid() { return Math.random().toString(36).slice(2, 10); }

export function PunchChargeDialog({
  open, onClose, segment, propertyId, propertyName,
  bookingId, roomId, roomNumber, guestName, onSaved,
}: Props) {
  const { user } = useAuth();
  const { methods: paymentMethods } = usePaymentMethods(propertyId);
  const [lines, setLines] = useState<Line[]>([]);
  const [pickerItems, setPickerItems] = useState<PickerItem[]>([]);
  const [walkin, setWalkin] = useState(!bookingId);
  const [walkinGuest, setWalkinGuest] = useState("");
  const [payMode, setPayMode] = useState<string>("cash");
  // Per-action busy state so one button's click never renders/locks the other's label.
  const [busy, setBusy] = useState<null | "kot" | "bill" | "save">(null);
  const inFlight = useRef(false);
  const saving = busy !== null;
  const [defaultGst, setDefaultGst] = useState<number>(segment === "food" ? 5 : 5);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [printerByItem, setPrinterByItem] = useState<Map<string, string | null>>(new Map());
  /** Optional banquet event link for walk-in food sales (routes numbering to the EVT-F series). */
  const [events, setEvents] = useState<{ id: string; label: string }[]>([]);
  const [eventId, setEventId] = useState<string | null>(null);
  const [eventOpen, setEventOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLines([{ key: uid(), description: "", qty: 1, rate: 0, gst_rate: segment === "food" ? 5 : 5, note: "" }]);
    setWalkin(!bookingId);
    setWalkinGuest("");
    setEventId(null);
  }, [open, segment, bookingId]);

  useEffect(() => {
    if (!open || !propertyId || segment !== "food") { setEvents([]); return; }
    let cancelled = false;
    supabase.from("bookings")
      .select("id,banquet_number,event_name,event_date,host_name,event_status")
      .eq("property_id", propertyId)
      .eq("booking_type", "banquet" as any)
      .gte("event_date", new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))
      .order("event_date", { ascending: true })
      .limit(200)
      .then(guardQuery("banquet events")).then(({ data }) => {
        if (cancelled) return;
        setEvents(((data ?? []) as any[])
          .filter((b) => !["cancelled"].includes(String(b.event_status ?? "")))
          .map((b) => ({
            id: b.id,
            label: [b.banquet_number ?? "Event", b.event_name, b.host_name, b.event_date]
              .filter(Boolean).join(" · "),
          })));
      });
    return () => { cancelled = true; };
  }, [open, propertyId, segment]);

  useEffect(() => {
    if (!open || !propertyId) return;
    let cancelled = false;
    if (segment === "food") {
      supabase.from("menu_items")
        .select("id,name,price,gst_rate,short_code,is_available,kitchen_printer_id,menu_categories(kot_printer_id)")
        .eq("property_id", propertyId)
        .eq("is_available", true)
        .order("name")
        .then(guardQuery("menu items")).then(({ data }) => {
          if (cancelled) return;
          setPickerItems((data ?? []).map((m: any) => ({
            id: m.id, name: m.name, rate: Number(m.price ?? 0),
            gst_rate: m.gst_rate, short_code: m.short_code, category: null,
          })));
          setPrinterByItem(new Map((data ?? []).map((m: any) => [
            m.id,
            m.kitchen_printer_id ?? m.menu_categories?.kot_printer_id ?? null,
          ])));
        });
    } else {
      supabase.from("sundry_items")
        .select("id,name,rate,gst_rate,short_code,sku,category,is_active")
        .eq("property_id", propertyId)
        .eq("is_active", true)
        .order("name")
        .then(guardQuery("sundry items")).then(({ data }) => {
          if (cancelled) return;
          setPickerItems((data ?? []).map((s: any) => ({
            id: s.id, name: s.name, rate: Number(s.rate ?? 0),
            gst_rate: s.gst_rate, short_code: s.short_code ?? s.sku, category: s.category,
          })));
        });
    }
    return () => { cancelled = true; };
  }, [open, segment, propertyId]);

  // Printers for kitchen ticket routing (food only)
  useEffect(() => {
    if (!open || segment !== "food" || !propertyId) return;
    let cancelled = false;
    supabase.from("printers")
      .select("id,name,paper_size,printer_role,type,is_active")
      .eq("property_id", propertyId)
      .eq("is_active", true)
      .then(guardQuery("printers")).then(({ data }) => {
        if (cancelled) return;
        setPrinters((data ?? []).map((p: any) => ({
          id: p.id, name: p.name, paper_size: p.paper_size, printer_role: p.printer_role,
        })));
      });
    return () => { cancelled = true; };
  }, [open, segment, propertyId]);

  // Fetch first active GST slab as sensible default for laundry
  useEffect(() => {
    if (!open || segment !== "laundry" || !propertyId) return;
    supabase.rpc("get_gst_rate", { p_property_id: propertyId, p_category: "sundry", p_amount: 100 })
      .then(guardQuery("get gst rate")).then(({ data }) => { if (typeof data === "number") setDefaultGst(data); });
  }, [open, segment, propertyId]);

  const totals = useMemo(() => {
    let sub = 0, gst = 0;
    for (const l of lines) {
      const amt = Number(l.qty || 0) * Number(l.rate || 0);
      sub += amt;
      gst += amt * Number(l.gst_rate || 0) / 100;
    }
    return { sub: Math.round(sub * 100) / 100, gst: Math.round(gst * 100) / 100, total: Math.round((sub + gst) * 100) / 100 };
  }, [lines]);

  function addLine() {
    setLines((prev) => [...prev, { key: uid(), description: "", qty: 1, rate: 0, gst_rate: defaultGst, note: "" }]);
  }
  function removeLine(k: string) {
    setLines((prev) => prev.length === 1 ? prev : prev.filter((l) => l.key !== k));
  }
  function updateLine(k: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => l.key === k ? { ...l, ...patch } : l));
  }
  function pickItem(k: string, it: PickerItem) {
    updateLine(k, {
      master_id: it.id,
      menu_item_id: segment === "food" ? it.id : null,
      description: it.name,
      rate: Number(it.rate ?? 0),
      gst_rate: Number(it.gst_rate ?? defaultGst),
      printer_id: segment === "food" ? (printerByItem.get(it.id) ?? null) : null,
    });
  }

  /** Kitchen ticket + counter copy, matching the removed legacy New KOT flow. */
  async function printKitchenTicket(billNumber: string, clean: Line[]) {
    if (segment !== "food") return;
    const items: KotItemForPrint[] = clean.map((l) => ({
      item_name: l.description.trim(),
      qty: Number(l.qty),
      rate: Number(l.rate),
      printer_id: l.printer_id ?? null,
      notes: (l.note ?? "").trim() || null,
    }));
    const counter = printers.find((p) => (p.printer_role ?? "").toLowerCase() === "counter copy") ?? null;
    const { jobs, warnings, unroutedItems } = buildKotPrintPlan(items, printers, counter, "kitchen+counter");
    warnings.forEach((w) =>
      unroutedItems.length > 0 && w.includes("no kitchen printer")
        ? toast.error(w, { duration: 15000 })
        : toast.warning(w),
    );
    if (jobs.length === 0) return;
    await runKotPrintJobs({
      kot_number: billNumber,
      kot_type: roomNumber && !walkin ? "room" : "table",
      room_number: walkin ? null : (roomNumber ?? null),
      guest_name: walkin ? walkinGuest.trim() : (guestName ?? null),
      notes: null,
      created_at: new Date().toISOString(),
    }, jobs);
  }

  async function ensureFolio(): Promise<string | null> {
    if (!bookingId) return null;
    const { data, error } = await supabase.rpc("get_or_create_folio", { _booking_id: bookingId });
    if (error) {
      toastError(error);
      return null;
    }
    return (data as string) ?? null;
  }

  /** Start of today in IST, as an ISO timestamp — day boundary for bill consolidation. */
  function istDayStartIso() {
    const now = new Date();
    const ist = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000);
    ist.setHours(0, 0, 0, 0);
    return new Date(ist.getTime() - (330 + now.getTimezoneOffset()) * 60000).toISOString();
  }

  function cleanLines() {
    return lines.filter((l) => l.description.trim() && Number(l.qty) > 0 && Number(l.rate) >= 0);
  }

  function itemRowsFor(billId: string, src: Line[]) {
    return src.map((l) => {
      const amt = Number(l.qty) * Number(l.rate);
      const gAmt = (amt * Number(l.gst_rate || 0)) / 100;
      return {
        segment_bill_id: billId,
        description: l.description.trim(),
        qty: l.qty,
        rate: l.rate,
        amount: Math.round(amt * 100) / 100,
        gst_rate: l.gst_rate,
        gst_amount: Math.round(gAmt * 100) / 100,
        note: (l.note ?? "").trim() || null,
      };
    });
  }

  /**
   * Finds today's OPEN segment bill for this room+segment, or creates one.
   * Day-scoped on purpose: a new day always starts a fresh bill number.
   */
  async function getOrCreateTodayBill(): Promise<{ id: string; bill_number: string; folio_id: string | null }> {
    const { data: existing, error: exErr } = await supabase
      .from("segment_bills" as any)
      .select("id,bill_number,folio_id")
      .eq("property_id", propertyId)
      .eq("segment", segment)
      .eq("status", "open")
      .eq("is_walkin", false)
      .eq("booking_id", bookingId!)
      .gte("created_at", istDayStartIso())
      .order("created_at", { ascending: false })
      .limit(1);
    if (exErr) throw exErr;
    if (existing && existing.length > 0) return existing[0] as any;

    const folioId = await ensureFolio();
    const { data: bill, error: bErr } = await supabase
      .from("segment_bills" as any)
      .insert({
        property_id: propertyId,
        segment,
        booking_id: bookingId,
        folio_id: folioId,
        room_id: roomId,
        is_walkin: false,
        guest_name: guestName ?? null,
        total_amount: 0,
        gst_amount: 0,
        paid_amount: 0,
        status: "open",
        created_by: user?.id ?? null,
      } as any)
      .select("id,bill_number,folio_id")
      .single();
    if (bErr) throw bErr;
    return bill as any;
  }

  async function recalcBillTotals(billId: string) {
    const { data: items, error } = await supabase
      .from("segment_bill_items" as any)
      .select("amount,gst_amount")
      .eq("segment_bill_id", billId);
    if (error) throw error;
    const sub = (items ?? []).reduce((s: number, i: any) => s + Number(i.amount || 0), 0);
    const gst = (items ?? []).reduce((s: number, i: any) => s + Number(i.gst_amount || 0), 0);
    const total = Math.round((sub + gst) * 100) / 100;
    const { error: uErr } = await supabase
      .from("segment_bills" as any)
      .update({ total_amount: total, gst_amount: Math.round(gst * 100) / 100 })
      .eq("id", billId);
    if (uErr) throw uErr;
    return { sub: Math.round(sub * 100) / 100, gst: Math.round(gst * 100) / 100, total };
  }

  /** Append the currently punched lines to today's consolidated bill. */
  async function appendToTodayBill(clean: Line[]) {
    const bill = await getOrCreateTodayBill();
    const { error } = await supabase.from("segment_bill_items" as any).insert(itemRowsFor(bill.id, clean) as any);
    if (error) throw error;
    await recalcBillTotals(bill.id);
    return bill;
  }

  async function findTodayBill() {
    const { data, error } = await supabase
      .from("segment_bills" as any)
      .select("id,bill_number,folio_id")
      .eq("property_id", propertyId)
      .eq("segment", segment)
      .eq("status", "open")
      .eq("is_walkin", false)
      .eq("booking_id", bookingId!)
      .gte("created_at", istDayStartIso())
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    return (data && data.length > 0 ? (data[0] as any) : null) as { id: string; bill_number: string; folio_id: string | null } | null;
  }

  /** KOT punch: append items + print the kitchen/service ticket only. No folio posting. */
  /**
   * KOT punch — strictly kitchen-side. Appends to today's single open bill and
   * prints the station ticket. Never touches folio_charges, never settles the
   * bill, never prints the customer bill.
   */
  async function printKot() {
    if (inFlight.current) return;
    const clean = cleanLines();
    if (clean.length === 0) { toast.error("Add at least one item"); return; }
    inFlight.current = true;
    setBusy("kot");
    try {
      const bill = await appendToTodayBill(clean);
      try {
        await printKitchenTicket(bill.bill_number, clean);
      } catch (pe: any) {
        toastError(pe, "Kitchen print failed");
      }
      toast.success(`Added to ${bill.bill_number} — ticket sent`);
      onSaved?.();
      onClose();
    } catch (e: any) {
      toastError(e, "Failed to punch order");
    } finally {
      setBusy(null);
      inFlight.current = false;
    }
  }

  /** Consolidated bill: append any pending lines, print everything for today, post to folio once. */
  async function printBill() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy("bill");
    try {
      const clean = cleanLines();
      let bill: { id: string; bill_number: string; folio_id: string | null };
      if (clean.length > 0) {
        bill = await appendToTodayBill(clean);
      } else {
        const existing = await findTodayBill();
        if (!existing) { toast.error("Nothing to bill yet"); return; }
        bill = existing;
      }
      const { data: allItems, error: iErr } = await supabase
        .from("segment_bill_items" as any)
        .select("description,qty,rate,amount,gst_rate,gst_amount")
        .eq("segment_bill_id", bill.id)
        .order("id");
      if (iErr) throw iErr;
      const rowsAll = (allItems ?? []) as any[];
      if (rowsAll.length === 0) { toast.error("Nothing to bill yet"); return; }
      const t = await recalcBillTotals(bill.id);

      // Ensure a folio exists for in-house bills, then settle through the single
      // shared DB routine (same one the 23:59 auto-close job uses).
      if (!bill.folio_id) await ensureFolio();
      const { data: settleRes, error: settleErr } = await supabase.rpc(
        "settle_segment_bill" as any,
        { _bill_id: bill.id, _actor: user?.id ?? null, _auto: false } as any,
      );
      if (settleErr) throw settleErr;
      const settled = settleRes as any;
      if (settled && settled.ok === false) {
        throw new Error(settled.reason === "no_items" ? "Nothing to bill yet" : "Could not settle bill");
      }

      printSegmentBill({
        billNumber: bill.bill_number, segment, propertyName: propertyName ?? "", propertyId,
        guestName: guestName ?? "Guest",
        roomNumber: roomNumber ?? null,
        items: rowsAll.map((l) => ({
          description: l.description, qty: Number(l.qty), rate: Number(l.rate),
          amount: Number(l.amount), gst_rate: Number(l.gst_rate),
        })),
        sub: t.sub, gst: t.gst, total: t.total,
        isWalkin: false, paymentMode: null,
      });
      toast.success(`${bill.bill_number} posted to folio`);
      onSaved?.();
      onClose();
    } catch (e: any) {
      toastError(e, "Failed to print bill");
    } finally {
      setBusy(null);
      inFlight.current = false;
    }
  }

  async function save() {
    const clean = lines.filter((l) => l.description.trim() && Number(l.qty) > 0 && Number(l.rate) >= 0);
    if (clean.length === 0) { toast.error("Add at least one item"); return; }
    if (walkin && !walkinGuest.trim()) { toast.error("Enter walk-in customer name"); return; }
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy("save");
    try {
      const folioId = walkin ? null : await ensureFolio();
      const insertBill = {
        property_id: propertyId,
        segment,
        booking_id: walkin ? null : bookingId,
        folio_id: walkin ? null : folioId,
        room_id: walkin ? null : roomId,
        is_walkin: walkin,
        event_booking_id: walkin && segment === "food" ? eventId : null,
        guest_name: walkin ? walkinGuest.trim() : (guestName ?? null),
        total_amount: totals.total,
        gst_amount: totals.gst,
        paid_amount: walkin ? totals.total : 0,
        payment_mode: walkin ? payMode : null,
        status: walkin ? "settled" : "open",
        settled_at: walkin ? new Date().toISOString() : null,
        created_by: user?.id ?? null,
      };
      const { data: bill, error: bErr } = await supabase
        .from("segment_bills").insert(insertBill as any).select("id,bill_number").single();
      if (bErr) throw bErr;
      const billNumber = (bill as any).bill_number as string;
      const billId = (bill as any).id as string;

      const items = clean.map((l) => {
        const amt = Number(l.qty) * Number(l.rate);
        const gAmt = amt * Number(l.gst_rate || 0) / 100;
        return {
          segment_bill_id: billId,
          description: l.description.trim(),
          qty: l.qty,
          rate: l.rate,
          amount: Math.round(amt * 100) / 100,
          gst_rate: l.gst_rate,
          gst_amount: Math.round(gAmt * 100) / 100,
          note: (l.note ?? "").trim() || null,
        };
      });
      const { error: iErr } = await supabase.from("segment_bill_items").insert(items as any);
      if (iErr) throw iErr;

      // Post to folio if linked to a booking
      if (!walkin && folioId) {
        const chargeType = segment === "food" ? "food" : "laundry";
        const rows = clean.map((l) => {
          const amt = Number(l.qty) * Number(l.rate);
          const gAmt = amt * Number(l.gst_rate || 0) / 100;
          return {
            folio_id: folioId,
            charge_type: chargeType,
            description: `${l.description.trim()} (${billNumber})`,
            qty: l.qty,
            rate: l.rate,
            amount: Math.round(amt * 100) / 100,
            gst_rate: l.gst_rate,
            gst_amount: Math.round(gAmt * 100) / 100,
            source_table: "segment_bills",
            source_id: billId,
            segment_bill_ref: billNumber,
            created_by: user?.id ?? null,
          };
        });
        const { error: fcErr } = await supabase.from("folio_charges").insert(rows as any);
        if (fcErr) throw fcErr;
      }

      toast.success(`${segment === "food" ? "Food" : "Laundry"} bill ${billNumber} created`);
      try {
        await printKitchenTicket(billNumber, clean);
      } catch (pe: any) {
        toastError(pe, "Kitchen print failed");
      }
      printSegmentBill({
        billNumber, segment, propertyName: propertyName ?? "", propertyId,
        guestName: walkin ? walkinGuest.trim() : (guestName ?? "Guest"),
        roomNumber: walkin ? null : (roomNumber ?? null),
        items: clean.map((l) => ({
          description: l.description.trim(), qty: l.qty, rate: l.rate,
          amount: Number(l.qty) * Number(l.rate), gst_rate: l.gst_rate,
        })),
        sub: totals.sub, gst: totals.gst, total: totals.total,
        isWalkin: walkin, paymentMode: walkin ? payMode : null,
      });
      onSaved?.();
      onClose();
    } catch (e: any) {
      toastError(e, "Failed to save");
    } finally {
      setBusy(null);
      inFlight.current = false;
    }
  }

  const title = segment === "food" ? "Punch Food Charge" : "Punch Laundry Charge";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {title}
            {roomNumber && !walkin ? <Badge variant="secondary">Room {roomNumber}</Badge> : null}
            {walkin ? <Badge>Walk-in / Counter Sale</Badge> : null}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
          <div className="text-sm">
            {walkin ? (
              <span className="text-muted-foreground">No folio — settled at counter</span>
            ) : (
              <span>Posts to folio for <b>{guestName ?? "Guest"}</b></span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="walkin-toggle" className="text-xs">Walk-in</Label>
            <Switch
              id="walkin-toggle"
              checked={walkin}
              onCheckedChange={(v) => { if (bookingId || !v) setWalkin(v); }}
              disabled={!bookingId}
            />
          </div>
        </div>

        {walkin && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Customer name</Label>
              <Input value={walkinGuest} onChange={(e) => setWalkinGuest(e.target.value)} placeholder="Walk-in customer" />
            </div>
            <div>
              <Label>Payment mode</Label>
              <Select value={payMode} onValueChange={setPayMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {paymentMethods.map((m) => (
                    <SelectItem key={m.id} value={m.name}>{formatPaymentMethodLabel(m.name)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {walkin && segment === "food" && (
          <div>
            <Label>Link to event (optional)</Label>
            <Popover open={eventOpen} onOpenChange={setEventOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="w-full justify-between font-normal">
                  <span className="truncate">
                    {eventId ? (events.find((e) => e.id === eventId)?.label ?? "Selected event") : "No event — regular food bill"}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
                <Command>
                  <CommandInput placeholder="Search event…" />
                  <CommandList>
                    <CommandEmpty>No events found.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem value="none" onSelect={() => { setEventId(null); setEventOpen(false); }}>
                        <Check className={`mr-2 h-4 w-4 ${eventId ? "opacity-0" : "opacity-100"}`} />
                        No event — regular food bill
                      </CommandItem>
                      {events.map((e) => (
                        <CommandItem key={e.id} value={e.label} onSelect={() => { setEventId(e.id); setEventOpen(false); }}>
                          <Check className={`mr-2 h-4 w-4 ${eventId === e.id ? "opacity-100" : "opacity-0"}`} />
                          <span className="truncate">{e.label}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Linking to an event numbers this bill in the banquet food series.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {lines.map((l, idx) => (
            <div key={l.key} className="space-y-1 rounded-md border p-2">
            <div className="grid gap-2 items-end" style={{ gridTemplateColumns: "1fr 80px 100px 80px 36px" }}>
              <div>
                {idx === 0 && <Label className="text-xs">Item</Label>}
                <ItemPickerCombobox
                  items={pickerItems}
                  value={l.description}
                  selectedId={l.master_id ?? null}
                  onSelect={(it) => pickItem(l.key, it)}
                  placeholder={segment === "food" ? "Search food item…" : "Search laundry / sundry item…"}
                />
              </div>
              <div>
                {idx === 0 && <Label className="text-xs">Qty</Label>}
                <Input type="number" min={0} step="0.5" value={l.qty}
                  onChange={(e) => updateLine(l.key, { qty: Number(e.target.value || 0) })} />
              </div>
              <div>
                {idx === 0 && <Label className="text-xs">Rate</Label>}
                <Input type="number" min={0} step="0.01" value={l.rate}
                  onChange={(e) => updateLine(l.key, { rate: Number(e.target.value || 0) })} />
              </div>
              <div>
                {idx === 0 && <Label className="text-xs">GST%</Label>}
                <Input type="number" min={0} step="0.01" value={l.gst_rate}
                  onChange={(e) => updateLine(l.key, { gst_rate: Number(e.target.value || 0) })} />
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(l.key)} disabled={lines.length === 1}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <Input
              className="h-8 text-xs"
              value={l.note ?? ""}
              maxLength={200}
              onChange={(e) => updateLine(l.key, { note: e.target.value })}
              placeholder={segment === "food" ? "Instruction for this item (e.g. less spicy)" : "Instruction for this item (e.g. handle delicate)"}
            />
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={addLine}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add line
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Item notes print on the {segment === "food" ? "KOT" : "service"} ticket only — never on the guest bill.
        </p>

        <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
          <div className="flex justify-between"><span>Subtotal</span><span>{inr(totals.sub)}</span></div>
          <div className="flex justify-between"><span>GST</span><span>{inr(totals.gst)}</span></div>
          <div className="flex justify-between font-semibold text-base border-t pt-1"><span>Total</span><span>{inr(totals.total)}</span></div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          {walkin ? (
            <Button type="button" onClick={save} disabled={saving}>
              <Printer className="h-4 w-4 mr-1.5" />
              {busy === "save" ? "Saving..." : "Save & Print"}
            </Button>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={printKot} disabled={saving}>
                <Printer className="h-4 w-4 mr-1.5" />
                {busy === "kot" ? "Working..." : segment === "food" ? "Print KOT" : "Print Ticket"}
              </Button>
              <Button type="button" onClick={printBill} disabled={saving}>
                <Printer className="h-4 w-4 mr-1.5" />
                {busy === "bill" ? "Working..." : "Print Bill"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --- Standalone segment bill print (window.print in hidden iframe) --- */
export function printSegmentBill(opts: {
  billNumber: string;
  segment: SegmentKind;
  propertyName: string;
  propertyId?: string | null;
  guestName: string;
  roomNumber: string | null;
  items: { description: string; qty: number; rate: number; amount: number; gst_rate: number }[];
  sub: number; gst: number; total: number;
  isWalkin: boolean;
  paymentMode: string | null;
}) {
  void (async () => {
    let head = { name: opts.propertyName, address: "", phone: "", gstin: "", fssai: "", logo: "" };
    if (opts.propertyId) {
      try {
        const { data, error: __qe1 } = await supabase
          .from("properties")
          .select("name,address_line1,address_line2,city,state,pin_code,phone,gstin,fssai,logo_url")
          .eq("id", opts.propertyId).maybeSingle();
        if (__qe1) reportQueryError("properties", __qe1);
        if (data) {
          const p = data as any;
          head = {
            name: p.name || opts.propertyName,
            address: [p.address_line1, p.address_line2, [p.city, p.pin_code].filter(Boolean).join(" "), p.state]
              .filter(Boolean).join(", "),
            phone: p.phone || "",
            gstin: p.gstin || "",
            fssai: p.fssai || "",
            logo: (await resolveLogoUrl(p.logo_url)) || "",
          };
        }
      } catch { /* branding is best-effort */ }
    }
    const printer = await fetchBillPrinter(opts.propertyId);
    renderSegmentBill(opts, head, printer);
  })();
}

interface SegBillHead { name: string; address: string; phone: string; gstin: string; fssai: string; logo: string }

function renderSegmentBill(opts: {
  billNumber: string;
  segment: SegmentKind;
  guestName: string;
  roomNumber: string | null;
  items: { description: string; qty: number; rate: number; amount: number; gst_rate: number }[];
  sub: number; gst: number; total: number;
  isWalkin: boolean;
  paymentMode: string | null;
}, head: SegBillHead, printer: { name: string; paper_size: string } | null) {
  const paperSize = printer?.paper_size ?? "80mm";
  const contentWidth = getPrintContainerWidth(paperSize);
  const rowsHtml = opts.items.map((it) => `
    <tr>
      <td>${escape(it.description)}</td>
      <td class="r">${it.qty}</td>
      <td class="r">${it.rate.toFixed(2)}</td>
      <td class="r">${it.gst_rate}%</td>
      <td class="r">${it.amount.toFixed(2)}</td>
    </tr>`).join("");
  const now = new Date();
  const dt = now.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  const heading = opts.segment === "food" ? "Food Bill" : "Laundry Bill";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${opts.billNumber}</title>
<style>
  @page { size: ${paperSize} auto; margin: 2mm; }
  html, body { margin: 0; padding: 0; font-family: Arial, sans-serif; color: #000;
    width: ${contentWidth}; height: auto !important; min-height: 0 !important; }
  body { width: ${contentWidth}; max-width: ${contentWidth}; font-size: 12px; box-sizing: border-box; line-height: 1.5; }
  * { box-sizing: border-box; max-width: 100%; }
  h1 { font-size: 14px; margin: 5px 0 3px; text-align: center; line-height: 1.4; }
  .prop { text-align: center; font-weight: bold; font-size: 12px; }
  /* Phase 60 — stacked, centered brand block: large logo on top, large bold
     property name directly below, small meta lines under it. Widths stay
     inside the 72mm printable area. */
  .brandhead { text-align: center; border-bottom: 1px solid #000; padding-bottom: 5px; }
  .brandhead img { display: block; margin: 0 auto 2px; max-height: 22mm; max-width: 55mm; width: auto; object-fit: contain; }
  .brandinfo { text-align: center; }
  .brandinfo .nm { font-family: 'Arial Black', Arial, sans-serif; font-weight: 900; font-size: 22px; line-height: 1.2; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 4px; word-break: break-word; }
  /* Phase 63.1 — roomier meta lines so address / phone / GSTIN / FSSAI never
     look stacked on top of each other on the roll. */
  .brandinfo .ln { font-size: 10px; line-height: 1.6; margin-bottom: 1.5px; }
  .brandinfo .ln:last-child { margin-bottom: 0; }
  .sign { margin-top: 10mm; text-align: right; font-size: 11px; }
  .sign .line { border-top: 1px solid #000; width: 40mm; margin-left: auto; padding-top: 2px; }
  .meta { display: flex; justify-content: space-between; font-size: 11px; margin: 5px 0; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 4px 0; line-height: 1.5; }
  table { width: 100%; table-layout: fixed; border-collapse: collapse; }
  col.c-item { width: 40%; } col.c-qty { width: 11%; } col.c-rate { width: 17%; }
  col.c-gst { width: 14%; } col.c-amt { width: 18%; }
  th, td { padding: 4px 0; text-align: left; font-size: 11px; line-height: 1.45; word-break: break-word; overflow-wrap: anywhere; }
  th { border-bottom: 1px solid #000; }
  td.r, th.r { text-align: right; }
  tfoot td { border-top: 1px dashed #000; }
  .total { font-weight: bold; font-size: 13px; line-height: 1.5; border-top: 1px solid #000; padding-top: 5px; margin-top: 5px; display: flex; justify-content: space-between; }
  .foot { text-align: center; margin-top: 8px; font-size: 11px; line-height: 1.5; }
  /* Phase 63.2 — extra blank run below "Thank you!" so nothing sits on the tear edge. */
  .tailgap { height: 10mm; min-height: 10mm; }
  ${getThermalFeedCss()}
</style></head>
<body>
  <div class="brandhead">
    ${head.logo ? `<img src="${escape(head.logo)}" alt="logo"/>` : ""}
    <div class="brandinfo">
      <div class="nm">${escape(head.name)}</div>
      ${head.address ? `<div class="ln">${escape(head.address)}</div>` : ""}
      ${head.phone ? `<div class="ln">Ph: ${escape(head.phone)}</div>` : ""}
      ${head.gstin ? `<div class="ln">GSTIN: ${escape(head.gstin)}</div>` : ""}
      ${head.fssai ? `<div class="ln">FSSAI: ${escape(head.fssai)}</div>` : ""}
    </div>
  </div>
  <h1>${heading}</h1>
  <div class="meta">
    <span>${escape(opts.billNumber)}</span>
    <span>${escape(dt)}</span>
  </div>
  <div style="font-size:11px; line-height:1.5; margin:3px 0;">Guest: <b>${escape(opts.guestName)}</b>${opts.roomNumber ? ` · Room ${escape(opts.roomNumber)}` : ""}${opts.isWalkin ? " · Walk-in" : ""}</div>
  <table>
    <colgroup><col class="c-item"/><col class="c-qty"/><col class="c-rate"/><col class="c-gst"/><col class="c-amt"/></colgroup>
    <thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">GST</th><th class="r">Amt</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div style="display:flex; justify-content:space-between; margin-top:6px; font-size:11px; line-height:1.5;"><span>Subtotal</span><span>${opts.sub.toFixed(2)}</span></div>
  <div style="display:flex; justify-content:space-between; font-size:11px; line-height:1.5;"><span>GST</span><span>${opts.gst.toFixed(2)}</span></div>
  <div class="total"><span>Total</span><span>₹${opts.total.toFixed(2)}</span></div>
  ${opts.isWalkin && opts.paymentMode ? `<div style="margin-top:3px; font-size:11px;">Paid via ${escape(opts.paymentMode.toUpperCase())}</div>` : ""}
  <div class="sign"><div class="line">Customer Signature</div></div>
  <div class="foot">Thank you!</div>
  <div class="tailgap"></div>
  ${THERMAL_FEED_HTML}
</body></html>`;
  // Silent auto-print to the assigned bill printer (QZ Tray); falls back to
  // the browser dialog only when QZ or the printer is unreachable.
  void printThermalHtml({
    printerName: printer?.name ?? null,
    html,
    paperSize,
    label: opts.segment === "food" ? "Food bill" : "Laundry bill",
    useDriverPrintableArea: true,
  });
}

function escape(s: string) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}