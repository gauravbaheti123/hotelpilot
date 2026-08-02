import { createFileRoute } from "@tanstack/react-router";
import { CrudPage, FieldDef, ColumnDef } from "@/components/master/CrudPage";
import { Badge } from "@/components/ui/badge";
import { RequirePermission } from "@/components/RequirePermission";
import { isValidOrEmptyGSTIN } from "@/lib/gstin";
import { INDIAN_STATES } from "@/lib/indiaGeo";
import { BulkCsvButtons } from "@/components/master/BulkCsvButtons";
import { useCurrentProperty } from "@/hooks/use-property";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/billing/companies")({
  head: () => ({ meta: [{ title: "Billing Companies — HotelPilot" }] }),
  component: () => (
    <RequirePermission module="invoices"><BillingCompaniesPage /></RequirePermission>
  ),
});

/**
 * Phase 66.2 — flags obviously bad company names created by the Phase 56
 * guest.company backfill (rate codes, phone numbers, stray symbols).
 * Advisory only: rows are highlighted for Owner review, never auto-deleted.
 */
function suspiciousName(name: string): string | null {
  const n = (name ?? "").trim();
  if (!n) return "Empty";
  if (!/[A-Za-z]/.test(n)) return "No letters";
  if (/^[^A-Za-z0-9]/.test(n)) return "Bad start";
  if (/[{}@#$%^*<>\\|~`]/.test(n)) return "Odd symbols";
  if (n.replace(/[^A-Za-z]/g, "").length < 3) return "Too short";
  if (/\d{6,}/.test(n)) return "Looks like a number";
  if (/[(\-]\s*\d{6,}/.test(n)) return "Phone in name";
  return null;
}

interface Co {
  id: string;
  name: string;
  gstin: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  nation: string | null;
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
  { name: "address", label: "Address Line", type: "textarea", colSpan: 2 },
  { name: "city", label: "City", type: "text" },
  {
    name: "state",
    label: "State (decides CGST+SGST vs IGST)",
    type: "select",
    options: INDIAN_STATES.map((s) => ({ value: s, label: s })),
  },
  { name: "nation", label: "Nation", type: "text", defaultValue: "India" },
  { name: "is_active", label: "Active", type: "switch", defaultValue: true },
];

const columns: ColumnDef<Co>[] = [
  // (see suspiciousName below)
  {
    header: "Name",
    render: (r) => (
      <span className="font-medium">
        {r.name}
        {suspiciousName(r.name) && (
          <Badge variant="destructive" className="ml-2 align-middle text-[10px]">
            {suspiciousName(r.name)}
          </Badge>
        )}
      </span>
    ),
  },
  { header: "GSTIN", render: (r) => r.gstin ?? "—" },
  { header: "Contact", render: (r) => [r.contact_person, r.phone].filter(Boolean).join(" · ") || "—" },
  { header: "City / State", render: (r) => [r.city, r.state].filter(Boolean).join(", ") || "—" },
  {
    header: "Status",
    render: (r) => <Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "Active" : "Inactive"}</Badge>,
  },
];

function BillingCompaniesPage() {
  const { current } = useCurrentProperty();
  return (
    <CrudPage<Co>
      title="Billing Companies"
      subtitle="Companies that get billed for guest stays (Bill To → Company)"
      table="billing_companies"
      fields={fields}
      columns={columns}
      orderBy={{ column: "name", ascending: true }}
      headerActions={
        current ? (
          <BulkCsvButtons
            table="billing_companies"
            propertyId={current.id}
            module="billing-companies"
            hotelName={current.name}
            extraDefaults={{ property_id: current.id }}
            columns={[
              { header: "name", field: "name", required: true },
              { header: "gstin", field: "gstin", parse: (v) => (v.trim() ? v.trim().toUpperCase() : null) },
              { header: "address", field: "address" },
              { header: "city", field: "city" },
              { header: "state", field: "state" },
              { header: "nation", field: "nation", parse: (v) => (v.trim() ? v.trim() : "India") },
              { header: "contact_person", field: "contact_person" },
              { header: "phone", field: "phone" },
              { header: "email", field: "email" },
              {
                header: "is_active",
                field: "is_active",
                parse: (v) => v.toLowerCase() !== "false" && v !== "0",
                format: (v) => (v ? "true" : "false"),
              },
            ]}
          />
        ) : null
      }
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