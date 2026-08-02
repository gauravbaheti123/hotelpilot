import { createFileRoute } from "@tanstack/react-router";
import { CrudPage, type ColumnDef, type FieldDef } from "@/components/master/CrudPage";
import { Badge } from "@/components/ui/badge";
import { RequirePermission } from "@/components/RequirePermission";

export const Route = createFileRoute("/_authenticated/masters/restaurant-outlets")({
  head: () => ({
    meta: [
      { title: "Restaurant Outlets — HotelPilot" },
      { name: "description", content: "Manage restaurant outlets used when posting direct restaurant charges." },
    ],
  }),
  component: () => (
    <RequirePermission module="master_data">
      <OutletsPage />
    </RequirePermission>
  ),
});

interface Outlet {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

const fields: FieldDef[] = [
  { name: "name", label: "Outlet name", type: "text", required: true, colSpan: 2 },
  { name: "sort_order", label: "Sort order", type: "number", defaultValue: 0 },
  { name: "is_active", label: "Active", type: "switch", defaultValue: true },
];

const columns: ColumnDef<Outlet>[] = [
  { header: "Order", render: (r) => r.sort_order },
  { header: "Outlet", render: (r) => <span className="font-medium">{r.name}</span> },
  {
    header: "Status",
    render: (r) => (
      <Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "Active" : "Inactive"}</Badge>
    ),
  },
];

function OutletsPage() {
  return (
    <CrudPage<Outlet>
      title="Restaurant Outlets"
      subtitle="Outlets shown in the Post Restaurant Charge dialog. Lower sort order appears first."
      table="restaurant_outlets"
      fields={fields}
      columns={columns}
      orderBy={{ column: "sort_order", ascending: true }}
      searchFields={["name"]}
    />
  );
}
