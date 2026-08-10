import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchBanquetScope, isBanquetRecord } from "@/lib/banquetScope";
import { fetchEventRevenue } from "@/lib/banquetEvent";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FolioOpenButton } from "@/components/FolioOpenButton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentProperty } from "@/hooks/use-property";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { supabase } from "@/integrations/supabase/client";
import { billNo } from "@/lib/billNumber";
import { toast } from "sonner";
import { fetchDailySummary, fetchOccupancy, todayIso, PAYMENT_MODE_LABELS } from "@/lib/reports";
import { inr } from "@/lib/billing";
import { AlertTriangle, CheckCircle2, Lock, Printer, FileText, FileSpreadsheet } from "lucide-react";

import { RequirePermission } from "@/components/RequirePermission";
import { istDateISO } from "@/lib/date";
import { reportQueryError } from "@/lib/queryError";
import { useReportBrand } from "@/hooks/use-report-brand";
import {
  exportExcelSections, exportSectionsPdf, buildKpiIntroHtml, kpiSection, fmtDate,
  type ExportSection, type KpiEntry, type ReportColumn,
} from "@/lib/reportExports";
import { toastError } from "@/lib/errorMessage";
export const Route = createFileRoute("/_authenticated/reports/night-audit")({
  head: () => ({ meta: [{ title: "Night Audit — HotelPilot" }] }),
  component: () => (<RequirePermission module="day_close"><NightAuditPage /></RequirePermission>),
});

const NA_OCCUPIED_COLUMNS: ReportColumn<OccupiedRow>[] = [
  { key: "room", header: "Room", get: (r) => r.room_number, type: "enum" },
  { key: "guest", header: "Guest", get: (r) => r.guest_name ?? "—" },
  { key: "ci", header: "Check-in", get: (r) => fmtDate(r.check_in), type: "date", sortValue: (r) => r.check_in },
  { key: "co", header: "Check-out", get: (r) => fmtDate(r.check_out), type: "date", sortValue: (r) => r.check_out },
];

const NA_KOT_COLUMNS: ReportColumn<OpenKotRow>[] = [
  { key: "kot", header: "KOT No", get: (r) => r.kot_number },
  { key: "room", header: "Room", get: (r) => r.room_number ?? "—", type: "enum" },
  { key: "items", header: "Items", get: (r) => r.items },
  { key: "status", header: "Status", get: (r) => r.status, type: "enum" },
  { key: "total", header: "Amount", get: (r) => Number(r.total_amount ?? 0), currency: true },
];

const NA_UNSETTLED_COLUMNS: ReportColumn<UnsettledRow>[] = [
  { key: "inv", header: "Invoice No", get: (r) => r.invoice_number ?? r.id.slice(0, 8) },
  { key: "guest", header: "Guest", get: (r) => r.guest_name ?? "—" },
  { key: "bal", header: "Balance", get: (r) => Number(r.balance_amount ?? 0), currency: true },
];

const NA_TARIFF_COLUMNS: ReportColumn<{ roomNumber: string; guest: string; amount: number }>[] = [
  { key: "room", header: "Room", get: (r) => r.roomNumber, type: "enum" },
  { key: "guest", header: "Guest", get: (r) => r.guest },
  { key: "amt", header: "Amount", get: (r) => Number(r.amount ?? 0), currency: true },
];

interface OccupiedRow {
  booking_id: string;
  room_id: string;
  room_number: string;
  guest_name: string | null;
  check_in: string;
  check_out: string;
  category_id: string | null;
}

interface OpenKotRow {
  id: string;
  kot_number: string;
  room_number: string | null;
  total_amount: number;
  status: string;
  items: string;
}

interface UnsettledRow {
  id: string;
  invoice_number: string | null;
  booking_id: string;
  guest_name: string | null;
  balance_amount: number;
}

interface AuditReport {
  id: string;
  audit_date: string;
  closed_by: string | null;
  closed_at: string;
  occupancy_count: number;
  rooms_total: number;
  total_revenue: number;
  total_collections: number;
  total_expenses: number;
  cash_difference: number;
  closing_cash_actual: number;
  notes: string | null;
  report_data: any;
}

function NightAuditPage() {
  const { currentId: propertyId, current } = useCurrentProperty();
  const { user } = useAuth();
  const { can } = usePermissions();
  // Night audit override / delete: use day_close (closest existing module).
  const isOwner = can("day_close", "delete");

  const brand = useReportBrand(propertyId);
  const [date, setDate] = useState<string>(todayIso());
  const [notes, setNotes] = useState("");
  const [actualCash, setActualCash] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const [occupied, setOccupied] = useState<OccupiedRow[]>([]);
  const [openKots, setOpenKots] = useState<OpenKotRow[]>([]);
  const [unsettled, setUnsettled] = useState<UnsettledRow[]>([]);
  const [byMode, setByMode] = useState<Record<string, number>>({});
  const [expenses, setExpenses] = useState(0);
  const [revenueRoom, setRevenueRoom] = useState(0);
  const [revenueFood, setRevenueFood] = useState(0);
  const [revenueBanquet, setRevenueBanquet] = useState(0);
  const [revenueOther, setRevenueOther] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalCollections, setTotalCollections] = useState(0);
  const [openingCash, setOpeningCash] = useState(0);
  const [tariffPosts, setTariffPosts] = useState<Array<{ bookingId: string; roomNumber: string; guest: string; amount: number; folioId: string | null }>>([]);
  const [existing, setExisting] = useState<AuditReport | null>(null);
  const [history, setHistory] = useState<AuditReport[]>([]);
  const [viewReport, setViewReport] = useState<AuditReport | null>(null);

  const dueToday = useMemo(() => occupied.filter((o) => o.check_out === date), [occupied, date]);

  const refresh = useCallback(async () => {
    if (!propertyId) return;

    // Existing audit
    const ex = await supabase
      .from("night_audit_reports").select("*")
      .eq("property_id", propertyId).eq("audit_date", date).maybeSingle();
    setExisting((ex.data as AuditReport | null) ?? null);

    // History (last 30)
    const hist = await supabase
      .from("night_audit_reports").select("*")
      .eq("property_id", propertyId)
      .order("audit_date", { ascending: false }).limit(30);
    setHistory((hist.data as AuditReport[] | null) ?? []);

    // Occupied rooms (spans selected date)
    const occ = await supabase
      .from("booking_rooms")
      .select("booking_id, room_id, rate, rooms:room_id(room_number, category_id), bookings!booking_rooms_booking_id_fkey!inner(check_in, check_out, status, property_id, guests(name))")
      .eq("property_id", propertyId)
      .lte("bookings.check_in", date)
      .gt("bookings.check_out", date)
      .in("bookings.status", ["checked_in", "reserved"]);
    if (occ.error) console.error("[night-audit] occupied rooms load failed:", occ.error);
    const occRows: OccupiedRow[] = (occ.data ?? []).map((r: any) => ({
      booking_id: r.booking_id,
      room_id: r.room_id,
      room_number: r.rooms?.room_number ?? "—",
      guest_name: r.bookings?.guests?.name ?? null,
      check_in: r.bookings?.check_in,
      check_out: r.bookings?.check_out,
      category_id: r.rooms?.category_id ?? null,
    }));
    setOccupied(occRows);

    // Build tariff post preview using booking_rooms.rate (fallback) — only for checked_in rooms
    const checkedIn = occRows.filter(() => true);
    const rateMap = new Map<string, number>();
    (occ.data ?? []).forEach((r: any) => {
      rateMap.set(`${r.booking_id}|${r.room_id}`, Number(r.rate || 0));
    });
    // Folio lookup
    const bookingIds = Array.from(new Set(checkedIn.map((c) => c.booking_id)));
    const folioMap = new Map<string, string>();
    if (bookingIds.length) {
      const { data: fs, error: __qe1 } = await supabase
        .from("folios").select("id, booking_id, status, is_deleted")
        .eq("property_id", propertyId).in("booking_id", bookingIds);
      if (__qe1) reportQueryError("folios", __qe1);
      (fs ?? []).forEach((f: any) => {
        if (f.is_deleted || f.status === "void") return;
        if (!folioMap.has(f.booking_id)) folioMap.set(f.booking_id, f.id);
      });
      // One-time correction: auto-create active folio for any booking missing one.
      const missing = bookingIds.filter((b) => !folioMap.has(b));
      for (const bId of missing) {
        const { data: fid, error: fErr } = await supabase.rpc("get_or_create_folio", { _booking_id: bId });
        if (!fErr && fid) folioMap.set(bId, fid as unknown as string);
      }
    }
    setTariffPosts(checkedIn.map((c) => ({
      bookingId: c.booking_id,
      roomNumber: c.room_number,
      guest: c.guest_name ?? "Guest",
      amount: rateMap.get(`${c.booking_id}|${c.room_id}`) ?? 0,
      folioId: folioMap.get(c.booking_id) ?? null,
    })));

    // Open KOTs
    const { data: kots, error: __qe2 } = await supabase
      .from("kot_orders")
      .select("id, kot_number, total_amount, status, rooms(room_number), kot_items(item_name, qty)")
      .eq("property_id", propertyId).eq("kot_copy", "hotel_copy")
      .in("status", ["open", "printed", "served"]);
    if (__qe2) reportQueryError("kot orders", __qe2);
    setOpenKots(((kots ?? []) as any[]).map((k) => ({
      id: k.id, kot_number: k.kot_number,
      room_number: k.rooms?.room_number ?? null,
      total_amount: Number(k.total_amount || 0),
      status: k.status,
      items: (k.kot_items ?? []).map((i: any) => `${i.item_name}×${i.qty}`).join(", "),
    })));

    // Unsettled bills
    const { data: uf, error: __qe3 } = await supabase
      .from("folios")
      .select("id, invoice_number, booking_id, balance_amount, status, bookings(source,guests(name))")
      .eq("property_id", propertyId)
      .neq("status", "void").eq("is_deleted", false)
      .gt("balance_amount", 0);
    if (__qe3) reportQueryError("folios", __qe3);
    // Banquet event-block folios count normally for 48h after the event ends.
    const bqScope = await fetchBanquetScope(propertyId);
    setUnsettled(((uf ?? []) as any[]).filter(
      (f) => !isBanquetRecord(bqScope, { booking_id: f.booking_id, folio_id: f.id }),
    ).map((f) => ({
      id: f.id, invoice_number: f.invoice_number, booking_id: f.booking_id,
      guest_name: f.bookings?.guests?.name ?? null,
      balance_amount: Number(f.balance_amount || 0),
    })));

    // Daily summary (collections + revenue + counts)
    const sum = await fetchDailySummary(propertyId, date);
    setByMode(sum.by_mode || {});
    setTotalCollections(sum.payments_total);
    setTotalRevenue(sum.total_amount);

    // Expenses
    const startIso = `${date}T00:00:00`;
    const endD = new Date(`${date}T00:00:00`); endD.setDate(endD.getDate() + 1);
    const endIso = endD.toISOString();
    const { data: exp, error: __qe4 } = await supabase
      .from("expenses").select("amount").eq("property_id", propertyId)
      .gte("expense_date", date).lte("expense_date", date);
    if (__qe4) reportQueryError("expenses", __qe4);
    setExpenses((exp ?? []).reduce((a, x: any) => a + Number(x.amount || 0), 0));

    // Split revenue by source (best-effort)
    const { data: folioRows, error: __qe5 } = await supabase
      .from("folios").select("id, total_amount, bookings(source)")
      .eq("property_id", propertyId).neq("status", "void").eq("is_deleted", false)
      .gte("created_at", startIso).lt("created_at", endIso);
    if (__qe5) reportQueryError("folios", __qe5);
    const folioIds = ((folioRows ?? []) as any[])
      .filter((f) => !isBanquetRecord(bqScope, { folio_id: f.id }))
      .map((f) => f.id);
    let roomRev = 0, foodRev = 0, otherRev = 0;
    if (folioIds.length) {
      const { data: ch, error: __qe6 } = await supabase
        .from("folio_charges").select("folio_id, charge_type, amount, gst_amount").in("folio_id", folioIds);
      if (__qe6) reportQueryError("folio charges", __qe6);
      (ch ?? []).forEach((c: any) => {
        const t = (c.charge_type ?? "").toLowerCase();
        const v = Number(c.amount || 0) + Number(c.gst_amount || 0);
        if (t.includes("room")) roomRev += v;
        else if (t.includes("food") || t.includes("kot")) foodRev += v;
        else otherRev += v;
      });
    }
    setRevenueRoom(roomRev);
    setRevenueFood(foodRev);
    setRevenueOther(otherRev);

    const bq = await fetchEventRevenue(propertyId, date, date);
    setRevenueBanquet(bq.reduce((a, x) => a + Number(x.total_amount || 0), 0));

    // Opening cash = previous day's closing_cash_actual, fallback 0
    const prevD = new Date(`${date}T00:00:00`); prevD.setDate(prevD.getDate() - 1);
    const prevIso = istDateISO(prevD);
    const { data: prev, error: __qe7 } = await supabase
      .from("night_audit_reports").select("closing_cash_actual")
      .eq("property_id", propertyId).eq("audit_date", prevIso).maybeSingle();
    if (__qe7) reportQueryError("night audit reports", __qe7);
    setOpeningCash(Number((prev as any)?.closing_cash_actual ?? 0));
  }, [propertyId, date]);

  useEffect(() => { refresh(); }, [refresh]);

  const cashCollected = Number(byMode.cash || 0);
  const expectedClosing = openingCash + cashCollected - expenses;
  const difference = (Number(actualCash) || 0) - expectedClosing;

  async function closeDay() {
    if (!propertyId) return;
    if (!actualCash) { toast.error("Enter actual cash in hand"); return; }
    if (Math.abs(difference) > 0.01 && !notes.trim()) {
      toast.error("Notes are required when cash difference is not zero");
      return;
    }
    setBusy(true);
    try {
      // 1) Post nightly room charges via idempotent RPC
      const { data: postedCount, error: postErr } = await supabase.rpc(
        "post_nightly_room_charges",
        { _property_id: propertyId, _audit_date: date },
      );
      if (postErr) throw postErr;
      const posted = Number(postedCount ?? 0);

      // 2) Build occupancy/revenue snapshot
      const occSnap = await fetchOccupancy(propertyId, date);
      const totalRev = revenueRoom + revenueFood + revenueBanquet + revenueOther;

      const reportData = {
        date,
        occupied_rooms: occupied.map((o) => ({ room: o.room_number, guest: o.guest_name, check_out: o.check_out })),
        open_kots: openKots,
        unsettled: unsettled,
        by_mode: byMode,
        expenses,
        tariff_posts: tariffPosts.filter((tp) => tp.folioId && tp.amount > 0),
      };

      // 3) Upsert audit report (unique on property_id, audit_date)
      const { error: nerr } = await supabase.from("night_audit_reports").upsert({
        property_id: propertyId,
        audit_date: date,
        closed_by: user?.id ?? null,
        occupancy_count: occSnap.rooms_occupied,
        rooms_total: occSnap.rooms_total,
        total_revenue: totalRev,
        room_revenue: revenueRoom,
        food_revenue: revenueFood,
        banquet_revenue: revenueBanquet,
        other_revenue: revenueOther,
        total_collections: totalCollections,
        total_expenses: expenses,
        opening_cash: openingCash,
        closing_cash_expected: expectedClosing,
        closing_cash_actual: Number(actualCash),
        cash_difference: difference,
        notes: notes || null,
        report_data: reportData,
      } as any, { onConflict: "property_id,audit_date" });
      if (nerr) throw nerr;

      // 4) Also insert day_closures for back-compat
      await supabase.from("day_closures").upsert({
        property_id: propertyId,
        business_date: date,
        rooms_occupied: occSnap.rooms_occupied,
        rooms_available: occSnap.rooms_total,
        sub_total: 0,
        gst_amount: 0,
        total_amount: totalRev,
        cash_total: byMode.cash || 0,
        card_total: byMode.card || 0,
        upi_total: byMode.upi || 0,
        bank_total: byMode.bank || 0,
        other_total: (byMode.wallet || 0) + (byMode.other || 0),
        opening_cash: openingCash,
        closing_cash_expected: expectedClosing,
        closing_cash_actual: Number(actualCash),
        cash_difference: difference,
        expense_total: expenses,
        notes: notes || null,
      } as any, { onConflict: "property_id,business_date" });

      toast.success(`Day closed. Posted ${posted} room charge(s).`);
      setNotes(""); setActualCash("");
      await refresh();
    } catch (e: any) {
      toastError(e, "Failed to close day");
    } finally { setBusy(false); }
  }

  async function deleteAudit(id: string) {
    if (!isOwner) { toast.error("Only owners can override a closed day"); return; }
    if (!confirm("Override and delete this day's audit?")) return;
    const { error } = await supabase.rpc("delete_night_audit", { _id: id });
    if (error) { toastError(error); return; }
    toast.success("Audit removed — day unlocked");
    refresh();
  }

  if (!propertyId) return <AppShell title="Night Audit"><EmptyPropertyState /></AppShell>;

  const hasWarnings = dueToday.length > 0 || openKots.length > 0 || unsettled.length > 0;

  /* ---------------- Exports ---------------- */
  const exportKpis: KpiEntry[] = useMemo(() => [
    { label: "Business date", value: date },
    { label: "Day status", value: existing ? "Closed" : "Open for closing" },
    { label: "Occupied rooms", value: occupied.length },
    { label: "Due to check out", value: dueToday.length },
    { label: "Open KOTs", value: openKots.length },
    { label: "Unsettled bills", value: unsettled.length },
    { label: "Room revenue", value: inr(revenueRoom) },
    { label: "Food revenue", value: inr(revenueFood) },
    { label: "Banquet revenue", value: inr(revenueBanquet) },
    { label: "Other revenue", value: inr(revenueOther) },
    { label: "Total revenue", value: inr(totalRevenue) },
    ...Object.keys(PAYMENT_MODE_LABELS).map((m) => ({
      label: `Collected — ${PAYMENT_MODE_LABELS[m]}`, value: inr(byMode[m] || 0),
    })),
    { label: "Total collected", value: inr(totalCollections) },
    { label: "Opening cash", value: inr(openingCash) },
    { label: "Expenses", value: inr(expenses) },
    { label: "Expected closing cash", value: inr(expectedClosing) },
  ], [date, existing, occupied, dueToday, openKots, unsettled, revenueRoom, revenueFood,
      revenueBanquet, revenueOther, totalRevenue, byMode, totalCollections, openingCash,
      expenses, expectedClosing]);

  const exportMeta = { reportName: "Night Audit / Day Close", propertyName: current?.name ?? "", from: date, to: date };

  const buildExportSections = (): ExportSection[] => [
    kpiSection("Day summary", exportKpis),
    {
      title: "Occupied rooms",
      columns: NA_OCCUPIED_COLUMNS as ReportColumn<any>[],
      rows: occupied,
      emptyText: "No occupied rooms",
      summary: [["Rooms", occupied.length], ["Due to check out", dueToday.length]] as Array<[string, string | number]>,
    },
    {
      title: "Open KOTs",
      columns: NA_KOT_COLUMNS as ReportColumn<any>[],
      rows: openKots,
      emptyText: "No open KOTs",
      summary: [["Open KOTs", openKots.length],
        ["Value", inr(openKots.reduce((a, k) => a + Number(k.total_amount ?? 0), 0))]] as Array<[string, string | number]>,
    },
    {
      title: "Unsettled bills",
      columns: NA_UNSETTLED_COLUMNS as ReportColumn<any>[],
      rows: unsettled,
      emptyText: "No unsettled bills",
      summary: [["Bills", unsettled.length],
        ["Outstanding", inr(unsettled.reduce((a, u) => a + Number(u.balance_amount ?? 0), 0))]] as Array<[string, string | number]>,
    },
    {
      title: "Room charges to be posted",
      columns: NA_TARIFF_COLUMNS as ReportColumn<any>[],
      rows: tariffPosts,
      emptyText: "Nothing pending",
      summary: [["Total", inr(tariffPosts.reduce((a, t) => a + Number(t.amount ?? 0), 0))]] as Array<[string, string | number]>,
    },
  ];

  return (
    <AppShell title="Night Audit">
      <div className="space-y-4">
        {/* Date selector + property */}
        <Card>
          <CardContent className="pt-6 flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">Business Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-48" />
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" className="print:hidden"
                onClick={() => exportExcelSections(buildExportSections(), exportMeta)}>
                <FileSpreadsheet className="h-4 w-4 mr-1" /> Export Excel
              </Button>
              <Button variant="outline" size="sm" className="print:hidden"
                onClick={() => exportSectionsPdf(buildExportSections(), exportMeta, brand, {
                  orientation: "portrait",
                  introTitle: "Day summary",
                  introHtml: buildKpiIntroHtml(exportKpis),
                })}>
                <Printer className="h-4 w-4 mr-1" /> Export PDF
              </Button>
              {existing ? (
                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300" variant="outline">
                  <Lock className="h-3 w-3 mr-1" /> Day Closed
                </Badge>
              ) : (
                <Badge variant="outline">Open For Closing</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Pre-Audit Checklist */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {/* Occupied */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center justify-between">
                Occupied Rooms
                <Badge variant="secondary">{occupied.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {dueToday.length > 0 && (
                <div className="text-xs rounded border border-amber-300 bg-amber-50 p-2 text-amber-900 flex gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 flex-none mt-0.5" />
                  {dueToday.length} Guest(s) Due Checkout Today — Complete Checkout Before Closing
                </div>
              )}
              <div className="max-h-40 overflow-auto text-xs space-y-1">
                {occupied.slice(0, 10).map((o) => (
                  <div key={o.booking_id + o.room_id} className="flex justify-between">
                    <span className="font-medium">{o.room_number}</span>
                    <span className="truncate ml-2">{o.guest_name ?? "—"}</span>
                    <span className="ml-2 text-muted-foreground">{o.check_out}</span>
                  </div>
                ))}
                {occupied.length > 10 && <div className="text-muted-foreground">+{occupied.length - 10} more</div>}
              </div>
            </CardContent>
          </Card>

          {/* Open KOTs */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center justify-between">
                Open KOTs
                <Badge variant="secondary">{openKots.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {openKots.length > 0 && (
                <div className="text-xs rounded border border-amber-300 bg-amber-50 p-2 text-amber-900 flex gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 flex-none mt-0.5" />
                  {openKots.length} KOTs Still Open — Settle Or Transfer Before Closing
                </div>
              )}
              <div className="max-h-40 overflow-auto text-xs space-y-1">
                {openKots.slice(0, 10).map((k) => (
                  <div key={k.id} className="flex justify-between">
                    <span className="font-medium">{k.kot_number}</span>
                    <span className="ml-2 text-muted-foreground">{k.room_number ?? "—"}</span>
                    <span className="ml-2 font-medium">{inr(k.total_amount)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Unsettled */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center justify-between">
                Unsettled Bills
                <Badge variant="secondary">{unsettled.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {unsettled.length > 0 && (
                <div className="text-xs rounded border border-amber-300 bg-amber-50 p-2 text-amber-900 flex gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 flex-none mt-0.5" />
                  {unsettled.length} Bills Have Pending Balance
                </div>
              )}
              <div className="max-h-40 overflow-auto text-xs space-y-1">
                {unsettled.slice(0, 10).map((u) => (
                  <FolioOpenButton key={u.id} unstyled bookingId={u.booking_id}
                    className="w-full flex justify-between hover:bg-accent rounded px-1 text-left">
                    <span className="font-medium">{billNo(u.invoice_number)}</span>
                    <span className="ml-2 text-muted-foreground truncate">{u.guest_name ?? "—"}</span>
                    <span className="ml-2 font-medium">{inr(u.balance_amount)}</span>
                  </FolioOpenButton>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Cash Summary */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Cash Summary</CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-1">
              {Object.keys(PAYMENT_MODE_LABELS).map((m) => (
                <div key={m} className="flex justify-between">
                  <span>{PAYMENT_MODE_LABELS[m]}</span>
                  <span className="font-medium">{inr(byMode[m] || 0)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t pt-1 mt-1">
                <span className="font-semibold">Total Collected</span>
                <span className="font-semibold">{inr(totalCollections)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Expenses</span><span>{inr(expenses)}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-semibold">
                <span>Net Cash</span><span>{inr(cashCollected - expenses)}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Closing form */}
        {!existing ? (
          <>
            <Card>
              <CardHeader><CardTitle className="text-base">Room Charges To Be Posted</CardTitle></CardHeader>
              <CardContent>
                {tariffPosts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No occupied rooms to post charges for.</p>
                ) : (
                  <div className="overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs uppercase text-muted-foreground">
                        <tr><th className="py-2 pr-3">Room</th><th>Guest</th><th className="text-right">Tariff</th><th></th></tr>
                      </thead>
                      <tbody>
                        {tariffPosts.map((tp) => (
                          <tr key={tp.bookingId + tp.roomNumber} className="border-t">
                            <td className="py-2 pr-3 font-medium">{tp.roomNumber}</td>
                            <td className="pr-3">{tp.guest}</td>
                            <td className="pr-3 text-right">{inr(tp.amount)}</td>
                            <td className="text-right text-xs text-muted-foreground">
                              {tp.folioId ? "" : "No active folio"}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t font-semibold">
                          <td colSpan={2} className="py-2">Total Room Charges</td>
                          <td className="text-right">{inr(tariffPosts.reduce((a, t) => a + t.amount, 0))}</td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Cash Closing</CardTitle></CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label className="text-xs">Opening Cash Balance</Label>
                  <Input value={inr(openingCash)} readOnly />
                </div>
                <div>
                  <Label className="text-xs">Total Collections (Cash)</Label>
                  <Input value={inr(cashCollected)} readOnly />
                </div>
                <div>
                  <Label className="text-xs">Total Expenses</Label>
                  <Input value={inr(expenses)} readOnly />
                </div>
                <div>
                  <Label className="text-xs">Expected Closing Balance</Label>
                  <Input value={inr(expectedClosing)} readOnly />
                </div>
                <div>
                  <Label className="text-xs">Actual Cash In Hand *</Label>
                  <Input type="number" step="0.01" value={actualCash} onChange={(e) => setActualCash(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Difference</Label>
                  <Input
                    value={actualCash ? inr(difference) : "—"}
                    readOnly
                    className={Math.abs(difference) < 0.01 ? "text-emerald-700" : "text-red-700"}
                  />
                </div>
                <div className="md:col-span-2">
                  <Label className="text-xs">
                    Notes {Math.abs(difference) > 0.01 && actualCash && <span className="text-red-600">(required for difference)</span>}
                  </Label>
                  <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <div className="md:col-span-2 flex items-center gap-2">
                  {hasWarnings && (
                    <div className="text-xs text-amber-700 flex-1">
                      ⚠ There are unresolved items above. You can still close the day.
                    </div>
                  )}
                  <Button onClick={closeDay} disabled={busy}>
                    {busy ? "Closing…" : "Close Day & Generate Report"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <ReportView report={existing} propertyName={current?.name ?? ""} onPrint={() => window.print()} onDelete={isOwner ? () => deleteAudit(existing.id) : undefined} isOwner={isOwner} />
        )}

        {/* History */}
        <Card>
          <CardHeader><CardTitle className="text-base">Recent Closures</CardTitle></CardHeader>
          <CardContent className="p-0">
            {history.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No closures yet.</div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground bg-muted/30">
                    <tr>
                      <th className="py-2 px-3">Date</th>
                      <th className="px-3">Occupancy</th>
                      <th className="px-3 text-right">Revenue</th>
                      <th className="px-3 text-right">Cash Diff</th>
                      <th className="px-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id} className="border-t">
                        <td className="py-2 px-3 font-medium">{h.audit_date}</td>
                        <td className="px-3">{h.occupancy_count}/{h.rooms_total}</td>
                        <td className="px-3 text-right">{inr(h.total_revenue)}</td>
                        <td className={`px-3 text-right ${Math.abs(Number(h.cash_difference)) < 0.01 ? "text-emerald-700" : "text-red-700"}`}>
                          {inr(h.cash_difference)}
                        </td>
                        <td className="px-3 text-right">
                          <Button size="sm" variant="outline" onClick={() => setViewReport(h)}>
                            <FileText className="h-3 w-3 mr-1" /> View Report
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={!!viewReport} onOpenChange={(o) => !o && setViewReport(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-auto">
            <DialogHeader>
              <DialogTitle>Audit Report — {viewReport?.audit_date}</DialogTitle>
            </DialogHeader>
            {viewReport && (
              <ReportView report={viewReport} propertyName={current?.name ?? ""} onPrint={() => window.print()} />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}

function ReportView({
  report, propertyName, onPrint, onDelete, isOwner,
}: { report: AuditReport; propertyName: string; onPrint: () => void; onDelete?: () => void; isOwner?: boolean }) {
  const data = (report.report_data ?? {}) as any;
  const byMode = (data.by_mode ?? {}) as Record<string, number>;
  const occPct = report.rooms_total > 0 ? Math.round((report.occupancy_count / report.rooms_total) * 1000) / 10 : 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          Night Audit Report — {report.audit_date} — {propertyName}
        </CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onPrint}>
            <Printer className="h-4 w-4 mr-1" /> Print Report
          </Button>
          {isOwner && onDelete && (
            <Button size="sm" variant="destructive" onClick={onDelete}>Override (Owner)</Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2 text-sm">
        <section>
          <h3 className="font-semibold mb-1">Occupancy Summary</h3>
          <div className="text-xs space-y-0.5">
            <div>Rooms Occupied: <span className="font-medium">{report.occupancy_count} / {report.rooms_total}</span></div>
            <div>Occupancy: <span className="font-medium">{occPct}%</span></div>
          </div>
        </section>
        <section>
          <h3 className="font-semibold mb-1">Revenue Summary</h3>
          <div className="text-xs space-y-0.5">
            <div className="flex justify-between"><span>Room Revenue</span><span>{inr((report as any).room_revenue ?? 0)}</span></div>
            <div className="flex justify-between"><span>Food Revenue</span><span>{inr((report as any).food_revenue ?? 0)}</span></div>
            <div className="flex justify-between"><span>Banquet Revenue</span><span>{inr((report as any).banquet_revenue ?? 0)}</span></div>
            <div className="flex justify-between"><span>Other Revenue</span><span>{inr((report as any).other_revenue ?? 0)}</span></div>
            <div className="flex justify-between border-t pt-0.5"><span>Total Revenue</span><span className="font-semibold">{inr(report.total_revenue)}</span></div>
          </div>
        </section>
        <section>
          <h3 className="font-semibold mb-1">Collections By Mode</h3>
          <div className="text-xs space-y-0.5">
            {Object.keys(PAYMENT_MODE_LABELS).map((m) => (
              <div key={m} className="flex justify-between"><span>{PAYMENT_MODE_LABELS[m]}</span><span>{inr(byMode[m] || 0)}</span></div>
            ))}
            <div className="flex justify-between border-t pt-0.5 font-semibold"><span>Total</span><span>{inr(report.total_collections)}</span></div>
          </div>
        </section>
        <section>
          <h3 className="font-semibold mb-1">Cash Position</h3>
          <div className="text-xs space-y-0.5">
            <div className="flex justify-between"><span>Opening Balance</span><span>{inr(report.report_data?.opening_cash ?? data.opening_cash ?? 0)}</span></div>
            <div className="flex justify-between"><span>Collections (Cash)</span><span>+{inr(byMode.cash || 0)}</span></div>
            <div className="flex justify-between"><span>Expenses</span><span>-{inr(report.total_expenses)}</span></div>
            <div className="flex justify-between"><span>Expected Closing</span><span>{inr((data.opening_cash ?? 0) + (byMode.cash || 0) - report.total_expenses)}</span></div>
            <div className="flex justify-between"><span>Actual Closing</span><span>{inr(report.closing_cash_actual)}</span></div>
            <div className={`flex justify-between font-semibold ${Math.abs(Number(report.cash_difference)) < 0.01 ? "text-emerald-700" : "text-red-700"}`}>
              <span>Difference</span><span>{inr(report.cash_difference)}</span>
            </div>
          </div>
        </section>
        {report.notes && (
          <section className="md:col-span-2">
            <h3 className="font-semibold mb-1">Notes</h3>
            <p className="text-xs whitespace-pre-wrap">{report.notes}</p>
          </section>
        )}
      </CardContent>
    </Card>
  );
}