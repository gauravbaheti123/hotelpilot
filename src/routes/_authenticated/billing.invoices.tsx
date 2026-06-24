import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { FOLIO_STATUS_TONE, inr } from "@/lib/billing";

export const Route = createFileRoute("/_authenticated/billing/invoices")({
  head: () => ({ meta: [{ title: "Invoices — HotelPilot" }] }),
  component: InvoicesPage,
});

interface Row {
  id: string; invoice_number: string; gst_mode: string; status: string;
  total_amount: number; paid_amount: number; balance_amount: number;
  created_at: string;
  booking_id: string;
  bookings: { booking_number: string; guests: { name: string } | null } | null;
}

function InvoicesPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!propertyId) return;
    (async () => {
      const { data } = await supabase.from("folios")
        .select("id,invoice_number,gst_mode,status,total_amount,paid_amount,balance_amount,created_at,booking_id,bookings(booking_number,guests(name))")
        .eq("property_id", propertyId)
        .order("created_at", { ascending: false })
        .limit(300);
      setRows((data ?? []) as unknown as Row[]);
    })();
  }, [propertyId]);

  if (!propertyId) return <AppShell title="Invoices"><EmptyPropertyState /></AppShell>;

  const filtered = rows.filter((r) =>
    !q || r.invoice_number.toLowerCase().includes(q.toLowerCase()) ||
    (r.bookings?.booking_number ?? "").toLowerCase().includes(q.toLowerCase()) ||
    (r.bookings?.guests?.name ?? "").toLowerCase().includes(q.toLowerCase()));

  return (
    <AppShell title="Invoices">
      <div className="flex items-center gap-2 mb-4">
        <Input placeholder="Search invoice / booking / guest…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
      </div>
      <Card>
        <CardContent className="p-0 divide-y">
          {filtered.length === 0 && <p className="p-4 text-sm text-muted-foreground">No invoices.</p>}
          {filtered.map((r) => (
            <Link key={r.id} to="/billing/folio/$bookingId" params={{ bookingId: r.booking_id }}
              className="flex items-center gap-3 px-4 py-3 hover:bg-accent">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium text-sm">{r.invoice_number}</div>
                  <Badge variant="outline" className={FOLIO_STATUS_TONE[r.status]}>{r.status.toUpperCase()}</Badge>
                  <Badge variant="outline" className="text-[10px] uppercase">{r.gst_mode}</Badge>
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {r.bookings?.booking_number} · {r.bookings?.guests?.name ?? "—"}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium">{inr(r.total_amount)}</div>
                <div className="text-xs text-muted-foreground">Bal {inr(r.balance_amount)}</div>
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>
    </AppShell>
  );
}