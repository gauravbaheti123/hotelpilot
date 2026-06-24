import { createFileRoute } from "@tanstack/react-router";
import { CrudPage, FieldDef, ColumnDef } from "@/components/master/CrudPage";
import { Badge } from "@/components/ui/badge";
import { ITEM_CATEGORIES, UNITS } from "@/lib/inventory";

export const Route = createFileRoute("/_authenticated/inventory/items")({
  head: () => ({ meta: [{ title: "Item Master — HotelPilot" }] }),
  component: ItemsPage,
});

interface Item {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  unit: string;
  reorder_level: number;
  current_stock: number;
  last_rate: number;
  is_active: boolean;
}

const fields: FieldDef[] = [
  { name: "name", label: "Item name", type: "text", required: true, colSpan: 2 },
  { name: "sku", label: "SKU / Code", type: "text" },
  {
    name: "category",
    label: "Category",
    type: "select",
    defaultValue: "general",
    options: ITEM_CATEGORIES.map((c) => ({ value: c, label: c })),
  },
  {
    name: "unit",
    label: "Unit",
    type: "select",
    defaultValue: "pcs",
    options: UNITS.map((u) => ({ value: u, label: u })),
  },
  { name: "reorder_level", label: "Reorder level", type: "number", defaultValue: 0 },
  { name: "is_active", label: "Active", type: "switch", defaultValue: true },
];

const columns: ColumnDef<Item>[] = [
  {
    header: "Item",
    render: (r) => (
      <div>
        <div className="font-medium">{r.name}</div>
        {r.sku && <div className="text-xs text-muted-foreground">{r.sku}</div>}
      </div>
    ),
  },
  { header: "Category", render: (r) => <Badge variant="outline">{r.category}</Badge> },
  { header: "Unit", render: (r) => r.unit },
  {
    header: "Stock",
    render: (r) => {
      const low = Number(r.current_stock) <= Number(r.reorder_level);
      return (
        <span className={low ? "text-destructive font-semibold" : "font-medium"}>
          {Number(r.current_stock).toFixed(2)}
        </span>
      );
    },
  },
  { header: "Reorder", render: (r) => Number(r.reorder_level).toFixed(2) },
  { header: "Last rate", render: (r) => `₹${Number(r.last_rate).toFixed(2)}` },
  {
    header: "Status",
    render: (r) => (
      <Badge variant={r.is_active ? "default" : "secondary"}>
        {r.is_active ? "Active" : "Inactive"}
      </Badge>
    ),
  },
];

function ItemsPage() {
  return (
    <CrudPage<Item>
      title="Inventory Items"
      subtitle="Item master — stock balances update automatically from movements"
      table="inventory_items"
      fields={fields}
      columns={columns}
      orderBy={{ column: "name", ascending: true }}
    />
  );
}