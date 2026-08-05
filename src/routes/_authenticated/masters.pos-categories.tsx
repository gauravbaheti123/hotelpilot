import { createFileRoute } from "@tanstack/react-router";
import { CrudPage, FieldDef, ColumnDef } from "@/components/master/CrudPage";
import { Badge } from "@/components/ui/badge";
import { BulkCsvButtons } from "@/components/master/BulkCsvButtons";
import { useCurrentProperty } from "@/hooks/use-property";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/masters/pos-categories")({
  head: () => ({ meta: [{ title: "POS Categories — HotelPilot" }] }),
  component: () => (<RequirePermission module="master_data"><PosCategoriesPage /></RequirePermission>),
});

interface Cat { id: string; name: string; is_active: boolean }

const fields: FieldDef[] = [
  { name: "name", label: "Category name", type: "text", required: true, colSpan: 2 },
  { name: "is_active", label: "Active", type: "switch", defaultValue: true },
];

const columns: ColumnDef<Cat>[] = [
  { header: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
  {
    header: "Status",
    render: (r) => <Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "Active" : "Inactive"}</Badge>,
  },
];

function PosCategoriesPage() {
  const { current } = useCurrentProperty();
  return (
    <CrudPage<Cat>
      title="POS Categories"
      subtitle="Categories used when posting custom POS / sundry expenses (Laundry, Mini Bar, Damage, etc.)"
      table="sundry_categories"
      fields={fields}
      columns={columns}
      orderBy={{ column: "name", ascending: true }}
      headerActions={
        current ? (
          <BulkCsvButtons
            table="sundry_categories"
            propertyId={current.id}
            module="pos-categories"
            hotelName={current.name}
            extraDefaults={{ property_id: current.id }}
            columns={[
              { header: "name", field: "name", required: true },
              { header: "is_active", field: "is_active",
                parse: (v) => v.toLowerCase() !== "false" && v !== "0" && v !== "",
                format: (v) => (v ? "true" : "false") },
            ]}
          />
        ) : null
      }
    />
  );
}