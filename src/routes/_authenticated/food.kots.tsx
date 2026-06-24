import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { KOT_STATUS_LABEL, KOT_STATUS_TONE } from "@/lib/food";
import { PlusCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/food/kots")({
  head: () => ({ meta: [{ title: "All KOTs — HotelPilot" }] }),
  component: AllKotsPage,
});

interface Row {
  id: string; kot_number: string; kot_type: string; table_no: string | null;
  guest_name: string | null; status: string; total_amount: number; created_at: string;
  rooms: { room_number: string } | null;
}

function AllKotsPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!propertyId) return;
    (async () => {
      const { data } = await supabase.from("kot_orders")
        .select("id,kot_number,kot_type,table_no,guest_name,status,total_amount,created_at,rooms(room_number)")
        .eq("property_id", propertyId)
        .order("created_at", { ascending: false })
        .limit(200);
      setRows((data ?? []) as unknown as Row[]);
    })();
  }, [propertyId]);

  if (!propertyId) return <AppShell title="All KOTs"><EmptyPropertyState /></AppShell>;

  const filtered = rows.filter((r) =>
    !q || r.kot_number.toLowerCase().includes(q.toLowerCase()) ||
    (r.table_no ?? "").toLowerCase().includes(q.toLowerCase()) ||
    (r.guest_name ?? "").toLowerCase().includes(q.toLowerCase()));

  return (
    <AppShell title="All KOTs">
      <div className="flex items-center gap-2 mb-4">
        <Input placeholder="Search KOT / table / guest…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <div className="flex-1" />
        <Link to="/food/new"><Button size="sm"><PlusCircle className="h-4 w-4 mr-1" /> New KOT</Button></Link>
      </div>
      <Card>
        <CardContent className="p-0 divide-y">
          {filtered.length === 0 && <p className="p-4 text-sm text-muted-foreground">No KOTs.</p>}
          {filtered.map((r) => (
            <Link key={r.id} to="/food/kot/$id" params={{ id: r.id }}
              className="flex items-center gap-3 px-4 py-3 hover:bg-accent">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium text-sm">{r.kot_number}</div>
                  <Badge variant="outline" className={KOT_STATUS_TONE[r.status]}>{KOT_STATUS_LABEL[r.status]}</Badge>
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {r.kot_type === "room"
                    ? `Room ${r.rooms?.room_number ?? "—"}${r.guest_name ? ` · ${r.guest_name}` : ""}`
                    : `Table ${r.table_no ?? "—"}`}
                </div>
              </div>
              <div className="text-sm font-medium">₹{Number(r.total_amount).toLocaleString("en-IN")}</div>
            </Link>
          ))}
        </CardContent>
      </Card>
    </AppShell>
  );
}