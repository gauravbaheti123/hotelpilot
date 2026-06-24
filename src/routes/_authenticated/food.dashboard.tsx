import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { KOT_STATUS_TONE, KOT_STATUS_LABEL } from "@/lib/food";
import { PlusCircle, RefreshCcw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/food/dashboard")({
  head: () => ({ meta: [{ title: "Food Dashboard — HotelPilot" }] }),
  component: FoodDashboardPage,
});

interface KotRow {
  id: string;
  kot_number: string;
  kot_type: string;
  table_no: string | null;
  guest_name: string | null;
  status: string;
  total_amount: number;
  created_at: string;
  booking_id: string | null;
  rooms: { room_number: string } | null;
}

function FoodDashboardPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const [rows, setRows] = useState<KotRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!propertyId) return;
    setLoading(true);
    const { data } = await supabase
      .from("kot_orders")
      .select("id,kot_number,kot_type,table_no,guest_name,status,total_amount,created_at,booking_id,rooms(room_number)")
      .eq("property_id", propertyId)
      .in("status", ["open", "printed", "served"])
      .order("created_at", { ascending: false });
    setRows((data ?? []) as unknown as KotRow[]);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [propertyId]);

  if (!propertyId) return <AppShell title="Food Dashboard"><EmptyPropertyState /></AppShell>;

  const byStatus = (s: string) => rows.filter((r) => r.status === s);

  return (
    <AppShell title="Food Dashboard">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">Live KOTs awaiting kitchen action.</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load}><RefreshCcw className="h-4 w-4 mr-1" /> Refresh</Button>
          <Link to="/food/new"><Button size="sm"><PlusCircle className="h-4 w-4 mr-1" /> New KOT</Button></Link>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {(["open", "printed", "served"] as const).map((st) => (
            <Card key={st}>
              <CardHeader>
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>{KOT_STATUS_LABEL[st]}</span>
                  <Badge variant="outline" className={KOT_STATUS_TONE[st]}>{byStatus(st).length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {byStatus(st).length === 0 && <p className="text-xs text-muted-foreground">Empty.</p>}
                {byStatus(st).map((r) => (
                  <Link
                    key={r.id}
                    to="/food/kot/$id"
                    params={{ id: r.id }}
                    className="block rounded border p-2 hover:bg-accent transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-sm">{r.kot_number}</div>
                      <div className="text-xs text-muted-foreground">
                        ₹{Number(r.total_amount).toLocaleString("en-IN")}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.kot_type === "room"
                        ? `Room ${r.rooms?.room_number ?? "—"}${r.guest_name ? ` · ${r.guest_name}` : ""}`
                        : `Table ${r.table_no ?? "—"}`}
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}