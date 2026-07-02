import { createFileRoute } from "@tanstack/react-router";
import { CrudPage, type FieldDef, type ColumnDef } from "@/components/master/CrudPage";
import { Badge } from "@/components/ui/badge";
import { SUNDRY_CATEGORIES, SUNDRY_UNITS, categoryColor, categoryLabel } from "@/lib/sundry";
import { RequirePermission } from "@/components/RequirePermission";

export const Route = createFileRoute("/_authenticated/masters/sundry-items")({
  head: () => ({ meta: [{ title: "Sundry Items — HotelPilot" }] }),
  component: SundryItemsPage,
});

interface Item {
  id: string;
  name: string;
  category: string;
  rate: number;
  gst_rate: number;
  unit: string;
  sku: string | null;
  is_active: boolean;
}

const fields: FieldDef[] = [
  { name: "name", label: "Item name", type: "text", required: true, colSpan: 2 },
  {
    name: "category",
    label: "Category",
    type: "select",
    options: SUNDRY_CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
    defaultValue: "mini_bar",
  },
  { name: "rate", label: "Rate (₹)", type: "number", required: true, defaultValue: 0 },
  { name: "gst_rate", label: "GST %", type: "number", defaultValue: 18 },
  {
    name: "unit",
    label: "Unit",
    type: "select",
    options: SUNDRY_UNITS.map((u) => ({ value: u.value, label: u.label })),
    defaultValue: "pcs",
  },
  { name: "sku", label: "SKU (optional)", type: "text" },
  { name: "is_active", label: "Active", type: "switch", defaultValue: true },
];

const columns: ColumnDef<Item>[] = [
  {
    header: "Item",
    render: (r) => (
      <div className="flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: categoryColor(r.category) }} />
        <span className="font-medium">{r.name}</span>
      </div>
    ),
  },
  { header: "Category", render: (r) => <Badge variant="outline">{categoryLabel(r.category)}</Badge> },
  { header: "Rate", render: (r) => `₹${Number(r.rate).toLocaleString("en-IN")}` },
  { header: "GST", render: (r) => `${r.gst_rate}%` },
  { header: "Unit", render: (r) => r.unit },
  { header: "SKU", render: (r) => r.sku ?? "—" },
  {
    header: "Status",
    render: (r) => <Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "Active" : "Inactive"}</Badge>,
  },
];

function SundryItemsPage() {
  return (
    <RequirePermission module="master_data">
    <CrudPage<Item>
      title="Sundry / POS Items"
      subtitle="Mini-bar, laundry, spa and other extras posted from the POS module."
      table="sundry_items"
      fields={fields}
      columns={columns}
      orderBy={{ column: "name", ascending: true }}
    />
    </RequirePermission>
  );
}