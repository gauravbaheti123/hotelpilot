import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/BackButton";
import { ArrowLeft, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { billNo } from "@/lib/billNumber";
import { toast } from "sonner";
import { inr } from "@/lib/billing";
import { fmtDate } from "@/lib/reportExports";
import { RequirePermission } from "@/components/RequirePermission";
import { resolveEventIds } from "@/lib/banquetEvent";
import { reportQueryError } from "@/lib/queryError";
import { toastError } from "@/lib/errorMessage";

export const Route = createFileRoute("/_authenticated/banquet/master-bill/$id")({
  head: () => ({ meta: [{ title: "Banquet Master Bill — HotelPilot" }] }),
  component: () => (
    <RequirePermission module="banquet">
      <MasterBillPage />
    </RequirePermission>
  ),
});

interface Item {
  id: string;
  booking_id: string;
  room_number: string;
  room_category: string | null;
  food_amount: number;
  gst_amount: number;
  food_bill_number: string | null;
}
interface MB {
  id: string;
  bill_number: string;
  food_subtotal: number;
  gst_amount: number;
  total_amount: number;
  created_at: string;
  property_id: string;
  bookings: {
    id: string;
    banquet_number: string;
    event_name: string | null;
    function_type: string;
    event_date: string;
    pax: number;
    guests: { name: string; mobile: string | null } | null;
    halls: { name: string } | null;
  } | null;
}
interface PropertyInfo {
  name: string;
  gstin: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
}

function MasterBillPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const [mb, setMb] = useState<MB | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [prop, setProp] = useState<PropertyInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    let bookingId = id;
    try {
      const r = await resolveEventIds(id);
      if (r?.bookingId) bookingId = r.bookingId;
    } catch {
      /* fall back to the raw param */
    }
    const { data, error } = await (supabase as any)
      .from("banquet_master_bills")
      .select(
        `id,bill_number,food_subtotal,gst_amount,total_amount,created_at,property_id,
               bookings!banquet_master_bills_booking_id_fkey(id,banquet_number,event_name,function_type,event_date,pax,
                 guests(name,mobile), halls(name))`,
      )
      .eq("booking_id", bookingId)
      .maybeSingle();
    if (error) {
      toastError(error);
      setLoading(false);
      return;
    }
    if (!data) {
      setLoading(false);
      return;
    }
    setMb(data as MB);
    const { data: its } = await (supabase as any)
      .from("banquet_master_bill_items")
      .select("id,booking_id,room_number,room_category,food_amount,gst_amount,food_bill_number")
      .eq("master_bill_id", (data as any).id)
      .order("room_number");
    setItems((its ?? []) as Item[]);
    const { data: p, error: __qe1 } = await supabase
      .from("properties")
      .select("name,gstin,address,city,state,pincode,phone,email")
      .eq("id", (data as any).property_id)
      .single();
    if (__qe1) reportQueryError("properties", __qe1);
    setProp(p as PropertyInfo);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  function doPrint() {
    window.print();
  }

  if (loading) {
    return (
      <AppShell title="Banquet Master Bill">
        <div className="p-6">Loading…</div>
      </AppShell>
    );
  }
  if (!mb) {
    return (
      <AppShell title="Banquet Master Bill">
        <div className="p-6 space-y-3">
          <BackButton variant="ghost" fallbackTo={`/banquet/event/${id}`} />
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No Master Bill yet. It will be generated automatically once a room under this event
              checks out.
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  const ev = mb.bookings!;
  return (
    <AppShell title="Banquet Master Bill">
      <style>{`@media print {
        @page { size: A4; margin: 12mm; }
        body * { visibility: hidden; }
        #master-bill, #master-bill * { visibility: visible; }
        #master-bill { position: absolute; left: 0; top: 0; width: 100%; }
        .no-print { display: none !important; }
      }`}</style>
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <div className="flex items-center justify-between no-print">
          <BackButton variant="ghost" fallbackTo={`/banquet/event/${ev.id}`} />
          <Button size="sm" onClick={doPrint}>
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
        </div>

        <Card id="master-bill">
          <CardContent className="p-8 space-y-4">
            <div className="text-center border-b pb-3">
              <div className="text-xl font-bold">{prop?.name ?? ""}</div>
              <div className="text-xs text-muted-foreground">
                {[prop?.address, prop?.city, prop?.state, prop?.pincode].filter(Boolean).join(", ")}
              </div>
              <div className="text-xs text-muted-foreground">
                {prop?.phone ? `Ph: ${prop.phone}` : ""}
                {prop?.email ? ` · ${prop.email}` : ""}
                {prop?.gstin ? ` · GSTIN: ${prop.gstin}` : ""}
              </div>
              <div className="mt-3 text-lg font-bold tracking-wider">BANQUET MASTER BILL</div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div>
                  <span className="text-muted-foreground">Bill No: </span>
                  <span className="font-semibold">{mb.bill_number}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Event Ref: </span>
                  {billNo(ev.banquet_number)}
                </div>
                <div>
                  <span className="text-muted-foreground">Event: </span>
                  <span className="font-semibold">{ev.event_name ?? ev.function_type}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Type: </span>
                  {ev.function_type}
                </div>
              </div>
              <div className="text-right">
                <div>
                  <span className="text-muted-foreground">Event Date: </span>
                  {fmtDate(ev.event_date)}
                </div>
                <div>
                  <span className="text-muted-foreground">Hall: </span>
                  {ev.halls?.name ?? "—"}
                </div>
                <div>
                  <span className="text-muted-foreground">Host: </span>
                  {ev.guests?.name ?? "—"}
                </div>
                <div>
                  <span className="text-muted-foreground">Pax: </span>
                  {ev.pax}
                </div>
              </div>
            </div>

            <div className="border-t pt-2">
              <div className="text-xs text-muted-foreground mb-1">
                Room-wise Food &amp; Extra Charges
              </div>
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-2 py-1.5">Room</th>
                    <th className="text-left px-2 py-1.5">Category</th>
                    <th className="text-left px-2 py-1.5">Food Bill Ref</th>
                    <th className="text-right px-2 py-1.5">Food &amp; Extras</th>
                    <th className="text-right px-2 py-1.5">GST</th>
                    <th className="text-right px-2 py-1.5">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-t">
                      <td className="px-2 py-1.5 font-semibold">{it.room_number}</td>
                      <td className="px-2 py-1.5">{it.room_category ?? "—"}</td>
                      <td className="px-2 py-1.5 text-xs">{it.food_bill_number ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{inr(it.food_amount)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{inr(it.gst_amount)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold">
                        {inr(Number(it.food_amount) + Number(it.gst_amount))}
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-4 text-muted-foreground">
                        No line items yet
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="border-t-2 font-semibold">
                  <tr>
                    <td colSpan={3} className="px-2 py-2 text-right">
                      Totals
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{inr(mb.food_subtotal)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{inr(mb.gst_amount)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{inr(mb.total_amount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="border-t pt-3 flex justify-end">
              <div className="text-right space-y-1">
                <div className="text-sm">
                  <span className="text-muted-foreground mr-3">Food &amp; Extras Subtotal</span>
                  {inr(mb.food_subtotal)}
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground mr-3">GST</span>
                  {inr(mb.gst_amount)}
                </div>
                <div className="text-lg font-bold border-t pt-1">
                  <span className="mr-3">Grand Total</span>
                  {inr(mb.total_amount)}
                </div>
              </div>
            </div>

            <div className="text-xs text-muted-foreground border-t pt-2">
              Note: This Master Bill consolidates food &amp; extra charges only. Individual room /
              accommodation charges are billed separately on each room's own Tax Invoice.
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
