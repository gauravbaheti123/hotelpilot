import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { fetchDailySummary, fetchOccupancy, todayIso, PAYMENT_MODE_LABELS } from "@/lib/reports";
import { inr } from "@/lib/billing";

export const Route = createFileRoute("/_authenticated/reports/night-audit")({
  head: () => ({ meta: [{ title: "Night Audit — HotelPilot" }] }),
  component: NightAuditPage,
});

interface ClosureRow {
  id: string; business_date: string; total_amount: number; rooms_occupied: number;
  rooms_available: number; cash_total: number; card_total: number; upi_total: number;
  closed_at: string;
}

interface OpenFolio { id: string; invoice_number: string; balance_amount: number; booking_id: string }

function NightAuditPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const [date, setDate] = useState<string>(todayIso());
  const [notes, setNotes] = useState("");
  const [closures, setClosures] = useState<ClosureRow[]>([]);
  const [openFolios, setOpenFolios] = useState<OpenFolio[]>([]);
  const [existing, setExisting] = useState<ClosureRow | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (!propertyId) return;
    const [{ data: cl }, { data: of }, ex] = await Promise.all([
      supabase.from("day_closures").select("id,business_date,total_amount,rooms_occupied,rooms_available,cash_total,card_total,upi_total,closed_at")
        .eq("property_id", propertyId).order("business_date", { ascending: false }).limit(30),
      supabase.from("folios").select("id,invoice_number,balance_amount,booking_id")
        .eq("property_id", propertyId).eq("status", "open").gt("balance_amount", 0)
        .order("created_at", { ascending: false }),
      supabase.from("day_closures").select("*").eq("property_id", propertyId).eq("business_date", date).maybeSingle(),
    ]);
    setClosures((cl ?? []) as ClosureRow[]);
    setOpenFolios((of ?? []) as OpenFolio[]);
    setExisting((ex.data as ClosureRow | null) ?? null);
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [propertyId, date]);

  async function closeDay() {
    if (!propertyId) return;
    setBusy(true);
    try {
      const [sum, occ] = await Promise.all([
        fetchDailySummary(propertyId, date),
        fetchOccupancy(propertyId, date),
      ]);
      const { error } = await supabase.from("day_closures").insert({
        property_id: propertyId,
        business_date: date,
        rooms_occupied: occ.rooms_occupied,
        rooms_available: occ.rooms_total,
        sub_total: sum.sub_total,
        gst_amount: sum.gst_amount,
        total_amount: sum.total_amount,
        cash_total: sum.by_mode.cash ?? 0,
        card_total: sum.by_mode.card ?? 0,
        upi_total: sum.by_mode.upi ?? 0,
        bank_total: sum.by_mode.bank ?? 0,
        other_total: (sum.by_mode.wallet ?? 0) + (sum.by_mode.other ?? 0),
        notes: notes || null,
      });
      if (error) throw error;
      toast.success("Day closed");
      setNotes("");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to close day");
    } finally { setBusy(false); }
  }

  if (!propertyId) return <AppShell title="Night Audit"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="Night Audit">
      <div className="flex items-end gap-3 mb-4">
        <div><Label>Business date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-48" /></div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Close {date}</CardTitle>
            {existing && <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300" variant="outline">Closed</Badge>}
          </CardHeader>
          <CardContent className="space-y-3">
            {existing ? (
              <div className="text-sm space-y-1">
                <div>Closed at <span className="font-medium">{new Date(existing.closed_at).toLocaleString()}</span></div>
                <div>Rooms occupied: <span className="font-medium">{existing.rooms_occupied}/{existing.rooms_available}</span></div>
                <div>Total invoiced: <span className="font-medium">{inr(existing.total_amount)}</span></div>
                <div className="text-xs text-muted-foreground">
                  Cash {inr(existing.cash_total)} · Card {inr(existing.card_total)} · UPI {inr(existing.upi_total)}
                </div>
              </div>
            ) : (
              <>
                <Textarea placeholder="Audit notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
                {openFolios.length > 0 && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                    <div className="font-medium mb-1">{openFolios.length} open folio(s) with balance</div>
                    <div>You can still close the day; balances carry forward.</div>
                  </div>
                )}
                <Button onClick={closeDay} disabled={busy}>{busy ? "Closing…" : "Close day"}</Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Open folios ({openFolios.length})</CardTitle></CardHeader>
          <CardContent className="p-0 divide-y max-h-72 overflow-auto">
            {openFolios.length === 0 && <p className="p-4 text-sm text-muted-foreground">No open balances.</p>}
            {openFolios.map((f) => (
              <a key={f.id} href={`/billing/folio/${f.booking_id}`} className="flex items-center justify-between px-4 py-2 text-sm hover:bg-accent">
                <span className="font-medium">{f.invoice_number}</span>
                <span className="text-muted-foreground">Bal {inr(f.balance_amount)}</span>
              </a>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader><CardTitle className="text-base">Recent closures</CardTitle></CardHeader>
        <CardContent className="p-0 divide-y">
          {closures.length === 0 && <p className="p-4 text-sm text-muted-foreground">No closures yet.</p>}
          {closures.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <div className="flex-1">
                <div className="font-medium">{c.business_date}</div>
                <div className="text-xs text-muted-foreground">
                  {c.rooms_occupied}/{c.rooms_available} rooms · Cash {inr(c.cash_total)} · Card {inr(c.card_total)} · UPI {inr(c.upi_total)}
                </div>
              </div>
              <div className="font-medium">{inr(c.total_amount)}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground mt-2">
        Payment modes summarised: {Object.values(PAYMENT_MODE_LABELS).join(", ")}.
      </p>
    </AppShell>
  );
}