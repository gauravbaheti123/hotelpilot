import { createFileRoute } from "@tanstack/react-router";
import { CrudPage, ColumnDef, FieldDef } from "@/components/master/CrudPage";
import { Badge } from "@/components/ui/badge";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/masters/halls")({
  head: () => ({ meta: [{ title: "Halls — HotelPilot" }] }),
  component: () => (<RequirePermission module="master_data"><HallsPage /></RequirePermission>),
});

interface Hall {
  id: string; name: string; capacity: number;
  location: string | null;
  is_active: boolean; notes: string | null;
}

const fields: FieldDef[] = [
  { name: "name", label: "Hall name", type: "text", required: true, colSpan: 2 },
  { name: "capacity", label: "Capacity (pax)", type: "number" },
  { name: "location", label: "Location / floor", type: "text" },
  { name: "is_active", label: "Active", type: "switch", defaultValue: true },
  { name: "notes", label: "Notes", type: "textarea", colSpan: 2 },
];

const columns: ColumnDef<Hall>[] = [
  { header: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
  { header: "Capacity", render: (r) => r.capacity },
  { header: "Location", render: (r) => r.location ?? "—" },
  { header: "Status", render: (r) => <Badge variant={r.is_active ? "default" : "outline"}>{r.is_active ? "Active" : "Inactive"}</Badge> },
];

function HallsPage() {
  return (
    <CrudPage<Hall>
      title="Halls"
      subtitle="Banquet / conference halls available at this property."
      table="halls"
      fields={fields}
      columns={columns}
      orderBy={{ column: "name", ascending: true }}
    />
  );
}