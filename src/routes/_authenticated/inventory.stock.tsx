import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { AlertTriangle, Plus } from "lucide-react";

import { RequirePermission } from "@/components/RequirePermission";
import { reportQueryError } from "@/lib/queryError";
export const Route = createFileRoute("/_authenticated/inventory/stock")({
  head: () => ({ meta: [{ title: "Current Stock — HotelPilot" }] }),
  component: () => (<RequirePermission module="inventory"><StockPage /></RequirePermission>),
});

interface ItemRow {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  unit: string;
  current_stock: number;
  reorder_level: number;
  last_rate: number;
  is_active: boolean;
}

function StockPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const [rows, setRows] = useState<ItemRow[]>([]);
  const [q, setQ] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);

  const load = useCallback(async () => {
    if (!propertyId) return;
    const { data, error: __qe1 } = await supabase
      .from("inventory_items")
      .select("id,name,sku,category,unit,current_stock,reorder_level,last_rate,is_active")
      .eq("property_id", propertyId)
      .order("name", { ascending: true });
    if (__qe1) reportQueryError("inventory items", __qe1);
    setRows((data ?? []) as unknown as ItemRow[]);
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () => rows.filter((r) => {
      if (!r.is_active) return false;
      if (onlyLow && Number(r.current_stock) > Number(r.reorder_level)) return false;
      const needle = q.toLowerCase();
      if (!needle) return true;
      return r.name.toLowerCase().includes(needle) ||
        (r.sku ?? "").toLowerCase().includes(needle) ||
        r.category.toLowerCase().includes(needle);
    }),
    [rows, q, onlyLow],
  );

  const lowCount = rows.filter(
    (r) => r.is_active && Number(r.current_stock) <= Number(r.reorder_level),
  ).length;

  const totalValue = rows.reduce(
    (sum, r) => sum + Number(r.current_stock) * Number(r.last_rate),
    0,
  );

  if (!propertyId) return <AppShell title="Current Stock"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="Current Stock">
      <div className="space-y-4 max-w-6xl">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card><CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Active items</div>
            <div className="text-2xl font-semibold">{rows.filter((r) => r.is_active).length}</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Low stock</div>
            <div className="text-2xl font-semibold text-destructive">{lowCount}</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Inventory value</div>
            <div className="text-2xl font-semibold">₹{totalValue.toFixed(2)}</div>
          </CardContent></Card>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search items…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-xs"
          />
          <Button
            variant={onlyLow ? "default" : "outline"}
            size="sm"
            onClick={() => setOnlyLow((v) => !v)}
          >
            <AlertTriangle className="h-4 w-4 mr-1" /> Low stock only
          </Button>
          <div className="ml-auto flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/inventory/items"><Plus className="h-4 w-4 mr-1" />Manage items</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/inventory/movements"><Plus className="h-4 w-4 mr-1" />New movement</Link>
            </Button>
          </div>
        </div>

        <Card><CardContent className="pt-6">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No items found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Reorder</TableHead>
                  <TableHead className="text-right">Last rate</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const low = Number(r.current_stock) <= Number(r.reorder_level);
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="font-medium">{r.name}</div>
                        {r.sku && <div className="text-xs text-muted-foreground">{r.sku}</div>}
                      </TableCell>
                      <TableCell><Badge variant="outline">{r.category}</Badge></TableCell>
                      <TableCell>{r.unit}</TableCell>
                      <TableCell className={`text-right ${low ? "text-destructive font-semibold" : ""}`}>
                        {Number(r.current_stock).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">{Number(r.reorder_level).toFixed(2)}</TableCell>
                      <TableCell className="text-right">₹{Number(r.last_rate).toFixed(2)}</TableCell>
                      <TableCell className="text-right font-medium">
                        ₹{(Number(r.current_stock) * Number(r.last_rate)).toFixed(2)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent></Card>
      </div>
    </AppShell>
  );
}