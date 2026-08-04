import { createFileRoute } from "@tanstack/react-router";
import { CrudPage, FieldDef, ColumnDef } from "@/components/master/CrudPage";
import { Badge } from "@/components/ui/badge";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/inventory/vendors")({
  head: () => ({ meta: [{ title: "Vendors — HotelPilot" }] }),
  component: () => (<RequirePermission module="inventory"><VendorsPage /></RequirePermission>),
});

interface Vendor {
  id: string;
  name: string;
  contact_person: string | null;
  mobile: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  is_active: boolean;
}

const fields: FieldDef[] = [
  { name: "name", label: "Vendor name", type: "text", required: true, colSpan: 2, titleCase: true },
  { name: "contact_person", label: "Contact person", type: "text" },
  { name: "mobile", label: "Mobile", type: "text" },
  { name: "email", label: "Email", type: "text" },
  { name: "gstin", label: "GSTIN", type: "text" },
  { name: "address", label: "Address", type: "textarea", colSpan: 2 },
  { name: "is_active", label: "Active", type: "switch", defaultValue: true },
];

const columns: ColumnDef<Vendor>[] = [
  { header: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
  { header: "Contact", render: (r) => r.contact_person ?? "—" },
  { header: "Mobile", render: (r) => r.mobile ?? "—" },
  { header: "GSTIN", render: (r) => r.gstin ?? "—" },
  {
    header: "Status",
    render: (r) => (
      <Badge variant={r.is_active ? "default" : "secondary"}>
        {r.is_active ? "Active" : "Inactive"}
      </Badge>
    ),
  },
];

function VendorsPage() {
  return (
    <CrudPage<Vendor>
      title="Vendors"
      subtitle="Suppliers for purchases & stock"
      table="vendors"
      fields={fields}
      columns={columns}
      orderBy={{ column: "name", ascending: true }}
    />
  );
}