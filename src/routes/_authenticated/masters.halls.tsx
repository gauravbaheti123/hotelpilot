import { createFileRoute } from "@tanstack/react-router";
import { CrudPage, ColumnDef, FieldDef } from "@/components/master/CrudPage";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/masters/halls")({
  head: () => ({ meta: [{ title: "Halls — HotelPilot" }] }),
  component: HallsPage,
});

interface Hall {
  id: string; name: string; capacity: number;
  hourly_rate: number; day_rate: number; location: string | null;
  is_active: boolean; notes: string | null;
}

const fields: FieldDef[] = [
  { name: "name", label: "Hall name", type: "text", required: true, colSpan: 2 },
  { name: "capacity", label: "Capacity (pax)", type: "number" },
  { name: "location", label: "Location", type: "text" },
  { name: "hourly_rate", label: "Hourly rate (₹)", type: "number" },
  { name: "day_rate", label: "Day rate (₹)", type: "number" },
  { name: "is_active", label: "Active", type: "switch", defaultValue: true },
  { name: "notes", label: "Notes", type: "textarea", colSpan: 2 },
];

const columns: ColumnDef<Hall>[] = [
  { header: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
  { header: "Capacity", render: (r) => r.capacity },
  { header: "Hourly", render: (r) => `₹${Number(r.hourly_rate).toLocaleString("en-IN")}` },
  { header: "Day", render: (r) => `₹${Number(r.day_rate).toLocaleString("en-IN")}` },
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