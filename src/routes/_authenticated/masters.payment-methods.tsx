import { createFileRoute } from "@tanstack/react-router";
import { CrudPage, type FieldDef, type ColumnDef } from "@/components/master/CrudPage";
import { Badge } from "@/components/ui/badge";
import { RequirePermission } from "@/components/RequirePermission";
import { formatPaymentMethodLabel } from "@/hooks/use-payment-methods";

export const Route = createFileRoute("/_authenticated/masters/payment-methods")({
  head: () => ({ meta: [{ title: "Payment Methods — HotelPilot" }] }),
  component: () => (
    <RequirePermission module="master_data">
      <PaymentMethodsPage />
    </RequirePermission>
  ),
});

interface PaymentMethod {
  id: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
  display_order: number;
}

const columns: ColumnDef<PaymentMethod>[] = [
  {
    header: "Name",
    render: (r) => (
      <span className="font-medium">{formatPaymentMethodLabel(r.name)}</span>
    ),
  },
  {
    header: "Default",
    render: (r) => (r.is_default ? <Badge>Default</Badge> : <span className="text-muted-foreground">—</span>),
  },
  {
    header: "Active",
    render: (r) =>
      r.is_active ? (
        <Badge variant="secondary">Active</Badge>
      ) : (
        <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
      ),
  },
  {
    header: "Order",
    render: (r) => <span className="tabular-nums text-sm">{r.display_order ?? 0}</span>,
  },
];

const fields: FieldDef[] = [
  { name: "name", label: "Name", type: "text", required: true, colSpan: 2 },
  { name: "display_order", label: "Display order", type: "number", defaultValue: 10 },
  { name: "is_active", label: "Active", type: "switch", defaultValue: true },
];

function PaymentMethodsPage() {
  return (
    <CrudPage<PaymentMethod>
      title="Payment Methods"
      subtitle="Custom payment methods available in booking, folio and banquet payment dropdowns. Default methods (Cash / Card / UPI) can be renamed or deactivated, but not deleted."
      table="payment_methods"
      fields={fields}
      columns={columns}
      orderBy={{ column: "display_order", ascending: true }}
      validate={(payload, rows) => {
        const raw = String(payload.name ?? "").trim();
        if (!raw) return "Name is required";
        const norm = raw.toLowerCase();
        const clash = rows.find(
          (r) => r.id !== payload.id && r.name.trim().toLowerCase() === norm,
        );
        if (clash) return `A payment method named "${raw}" already exists.`;
        return null;
      }}
    />
  );
}
