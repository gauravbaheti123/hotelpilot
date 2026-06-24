import { createFileRoute } from "@tanstack/react-router";
import { CrudPage, type FieldDef, type ColumnDef } from "@/components/master/CrudPage";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/masters/printers")({
  head: () => ({ meta: [{ title: "Printers — HotelPilot" }] }),
  component: PrintersPage,
});

interface Printer {
  id: string;
  name: string;
  type: string;
  printer_role: string;
  location: string | null;
  ip_address: string | null;
  port: number | null;
  is_default: boolean;
  is_active: boolean;
}

const fields: FieldDef[] = [
  { name: "name", label: "Printer name", type: "text", required: true },
  {
    name: "type",
    label: "Type",
    type: "select",
    options: [
      { value: "kot", label: "KOT" },
      { value: "bill", label: "Bill" },
      { value: "both", label: "Both" },
    ],
    defaultValue: "bill",
  },
  {
    name: "printer_role",
    label: "Role",
    type: "select",
    options: [
      { value: "hotel_kitchen", label: "Hotel Kitchen" },
      { value: "restaurant_kitchen", label: "Restaurant Kitchen" },
      { value: "banquet_kitchen", label: "Banquet Kitchen" },
      { value: "bar", label: "Bar" },
      { value: "reception_bill", label: "Reception (Bill)" },
      { value: "housekeeping", label: "Housekeeping" },
    ],
    defaultValue: "hotel_kitchen",
  },
  { name: "location", label: "Location", type: "text" },
  { name: "ip_address", label: "IP address", type: "text" },
  { name: "port", label: "Port", type: "number", defaultValue: 9100 },
  { name: "is_default", label: "Default", type: "switch", defaultValue: false },
  { name: "is_active", label: "Active", type: "switch", defaultValue: true },
];

const columns: ColumnDef<Printer>[] = [
  { header: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
  { header: "Type", render: (r) => <Badge variant="outline">{r.type}</Badge> },
  { header: "Role", render: (r) => <Badge variant="secondary">{r.printer_role}</Badge> },
  { header: "Location", render: (r) => r.location ?? "—" },
  {
    header: "Address",
    render: (r) => (r.ip_address ? `${r.ip_address}:${r.port ?? 9100}` : "—"),
  },
  { header: "Default", render: (r) => (r.is_default ? <Badge>Default</Badge> : "—") },
];

function PrintersPage() {
  return (
    <CrudPage<Printer>
      title="Printers"
      subtitle="Receipt and KOT printers connected at this property."
      table="printers"
      fields={fields}
      columns={columns}
      orderBy={{ column: "name" }}
    />
  );
}