import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { BANQUET_STATUS_TONE } from "@/lib/banquet";
import { PlusCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/banquet/bookings")({
  head: () => ({ meta: [{ title: "Banquet Events — HotelPilot" }] }),
  component: BanquetBookingsPage,
});

interface Row {
  id: string; banquet_number: string; function_type: string;
  event_date: string; start_time: string; end_time: string;
  pax: number; total_amount: number; balance_amount: number; status: string;
  halls: { name: string } | null;
  guests: { name: string; mobile: string | null } | null;
}

function BanquetBookingsPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!propertyId) return;
    (async () => {
      const { data } = await supabase.from("banquet_bookings")
        .select("id,banquet_number,function_type,event_date,start_time,end_time,pax,total_amount,balance_amount,status,halls(name),guests(name,mobile)")
        .eq("property_id", propertyId)
        .order("event_date", { ascending: false })
        .limit(200);
      setRows((data ?? []) as unknown as Row[]);
    })();
  }, [propertyId]);

  if (!propertyId) return <AppShell title="Banquet Events"><EmptyPropertyState /></AppShell>;

  const filtered = rows.filter((r) =>
    !q ||
    r.banquet_number.toLowerCase().includes(q.toLowerCase()) ||
    (r.guests?.name ?? "").toLowerCase().includes(q.toLowerCase()) ||
    (r.halls?.name ?? "").toLowerCase().includes(q.toLowerCase()));

  return (
    <AppShell title="Banquet Events">
      <div className="flex items-center gap-2 mb-4">
        <Input placeholder="Search event / hall / guest…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <div className="flex-1" />
        <Link to="/banquet/new"><Button size="sm"><PlusCircle className="h-4 w-4 mr-1" /> New event</Button></Link>
      </div>
      <Card>
        <CardContent className="p-0 divide-y">
          {filtered.length === 0 && <p className="p-4 text-sm text-muted-foreground">No events.</p>}
          {filtered.map((r) => (
            <Link key={r.id} to="/banquet/event/$id" params={{ id: r.id }}
              className="flex items-center gap-3 px-4 py-3 hover:bg-accent">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium text-sm">{r.banquet_number}</div>
                  <Badge variant="outline" className={BANQUET_STATUS_TONE[r.status]}>{r.status}</Badge>
                  <span className="text-xs text-muted-foreground">{r.function_type}</span>
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {r.halls?.name ?? "—"} · {r.event_date} · {r.start_time?.slice(0,5)}–{r.end_time?.slice(0,5)} · {r.pax} pax · {r.guests?.name ?? "—"}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium">₹{Number(r.total_amount).toLocaleString("en-IN")}</div>
                <div className="text-xs text-muted-foreground">Bal ₹{Number(r.balance_amount).toLocaleString("en-IN")}</div>
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>
    </AppShell>
  );
}