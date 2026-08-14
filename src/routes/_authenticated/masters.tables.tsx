import { createFileRoute } from "@tanstack/react-router";
import { CrudPage, type ColumnDef, type FieldDef } from "@/components/master/CrudPage";
import { Badge } from "@/components/ui/badge";
import { RequirePermission } from "@/components/RequirePermission";

export const Route = createFileRoute("/_authenticated/masters/tables")({
  head: () => ({
    meta: [
      { title: "Restaurant Tables — HotelPilot" },
      { name: "description", content: "Manage restaurant tables, seating capacity and areas used for dine-in orders." },
      { property: "og:title", content: "Restaurant Tables — HotelPilot" },
      { property: "og:description", content: "Manage restaurant tables, seating capacity and areas used for dine-in orders." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <RequirePermission module="master_data">
      <TablesPage />
    </RequirePermission>
  ),
});

interface RestaurantTable {
  id: string;
  name: string;
  capacity: number | null;
  area: string | null;
  sort_order: number;
  is_active: boolean;
}

const fields: FieldDef[] = [
  { name: "name", label: "Table name / number", type: "text", required: true, colSpan: 2 },
  { name: "capacity", label: "Capacity (seats)", type: "number" },
  { name: "area", label: "Area / Section", type: "text", titleCase: true },
  { name: "sort_order", label: "Sort order", type: "number", defaultValue: 0 },
  { name: "is_active", label: "Active", type: "switch", defaultValue: true },
];

const columns: ColumnDef<RestaurantTable>[] = [
  { header: "Order", render: (r) => r.sort_order },
  { header: "Table", render: (r) => <span className="font-medium">{r.name}</span> },
  { header: "Seats", render: (r) => r.capacity ?? "—" },
  { header: "Area", render: (r) => r.area || "—" },
  {
    header: "Status",
    render: (r) => (
      <Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "Active" : "Inactive"}</Badge>
    ),
  },
];

function TablesPage() {
  return (
    <CrudPage<RestaurantTable>
      title="Restaurant Tables"
      subtitle="Dine-in tables shown on the Food dashboard. Area groups tables the way Floor groups rooms."
      table="restaurant_tables"
      fields={fields}
      columns={columns}
      orderBy={{ column: "sort_order", ascending: true }}
      searchFields={["name", "area"]}
    />
  );
}