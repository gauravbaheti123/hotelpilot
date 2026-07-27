import { createFileRoute } from "@tanstack/react-router";
import { CrudPage, FieldDef, ColumnDef } from "@/components/master/CrudPage";
import { Badge } from "@/components/ui/badge";
import { RequirePermission } from "@/components/RequirePermission";
import { isValidOrEmptyGSTIN } from "@/lib/gstin";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/masters/billing-companies")({
  head: () => ({ meta: [{ title: "Billing Companies — HotelPilot" }] }),
  component: () => (
    <RequirePermission module="master_data"><BillingCompaniesPage /></RequirePermission>
  ),
});

interface Co {
  id: string;
  name: string;
  gstin: string | null;
  address: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean;
}

const fields: FieldDef[] = [
  { name: "name", label: "Company name", type: "text", required: true, colSpan: 2 },
  { name: "gstin", label: "GSTIN (15 chars, optional)", type: "text" },
  { name: "contact_person", label: "Contact person", type: "text" },
  { name: "phone", label: "Phone", type: "text" },
  { name: "email", label: "Email", type: "text" },
  { name: "address", label: "Address", type: "textarea", colSpan: 2 },
  { name: "is_active", label: "Active", type: "switch", defaultValue: true },
];

const columns: ColumnDef<Co>[] = [
  { header: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
  { header: "GSTIN", render: (r) => r.gstin ?? "—" },
  { header: "Contact", render: (r) => [r.contact_person, r.phone].filter(Boolean).join(" · ") || "—" },
  {
    header: "Status",
    render: (r) => <Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "Active" : "Inactive"}</Badge>,
  },
];

function BillingCompaniesPage() {
  return (
    <CrudPage<Co>
      title="Billing Companies"
      subtitle="Companies that get billed for guest stays (Bill To → Company)"
      table="billing_companies"
      fields={fields}
      columns={columns}
      orderBy={{ column: "name", ascending: true }}
      validate={(payload) => {
        // Warn-only on invalid GSTIN — do not block save (per spec).
        const g = (payload.gstin ?? "").trim();
        if (g && !isValidOrEmptyGSTIN(g)) {
          toast.warning("GSTIN format looks invalid — saving anyway. Please verify later.");
        }
        return null;
      }}
    />
  );
}