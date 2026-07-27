import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CrudPage, type FieldDef, type ColumnDef } from "@/components/master/CrudPage";
import { Badge } from "@/components/ui/badge";
import { SUNDRY_CATEGORIES, SUNDRY_UNITS, categoryColor, categoryLabel } from "@/lib/sundry";
import { RequirePermission } from "@/components/RequirePermission";
import { BulkCsvButtons } from "@/components/master/BulkCsvButtons";
import { useCurrentProperty } from "@/hooks/use-property";

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
  short_code: string | null;
  sku: string | null;
  is_active: boolean;
}

const fields: FieldDef[] = [
  { name: "name", label: "Item name", type: "text", required: true, colSpan: 2 },
  { name: "short_code", label: "Short Code (optional)", type: "text" },
  {
    name: "category",
    label: "Category",
    type: "select",
    options: SUNDRY_CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
    defaultValue: "mini_bar",
  },
  { name: "rate", label: "Rate (₹)", type: "number", required: true, defaultValue: 0 },
  { name: "gst_rate", label: "GST %", type: "number", defaultValue: 5 },
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
  {
    header: "Short Code",
    render: (r) =>
      r.short_code
        ? <Badge variant="outline" className="text-[10px] uppercase font-mono">{r.short_code}</Badge>
        : <span className="text-xs text-muted-foreground">—</span>,
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
  const { current } = useCurrentProperty();
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <RequirePermission module="master_data">
    <CrudPage<Item>
      key={reloadKey}
      title="Sundry / POS Items"
      subtitle="Mini-bar, laundry, spa and other extras posted from the POS module."
      table="sundry_items"
      fields={fields}
      columns={columns}
      orderBy={{ column: "name", ascending: true }}
      headerActions={current ? (
        <BulkCsvButtons
          table="sundry_items"
          propertyId={current.id}
          module="sundry-items"
          hotelName={current.name}
          extraDefaults={{ property_id: current.id }}
          columns={[
            { header: "name", field: "name", required: true },
            { header: "short_code", field: "short_code" },
            { header: "category", field: "category" },
            { header: "rate", field: "rate",
              parse: (v) => Number(v || 0),
              format: (v) => (v == null ? "" : String(v)) },
            { header: "gst_rate", field: "gst_rate",
              parse: (v) => Number(v || 0),
              format: (v) => (v == null ? "" : String(v)) },
            { header: "unit", field: "unit" },
            { header: "sku", field: "sku" },
            { header: "is_active", field: "is_active",
              parse: (v) => v.toLowerCase() !== "false" && v !== "0" && v !== "",
              format: (v) => (v ? "true" : "false") },
          ]}
          onImported={() => setReloadKey((k) => k + 1)}
        />
      ) : null}
    />
    </RequirePermission>
  );
}