import { createFileRoute } from "@tanstack/react-router";
import { CrudPage, FieldDef, ColumnDef } from "@/components/master/CrudPage";
import { Badge } from "@/components/ui/badge";
import { RequirePermission } from "@/components/RequirePermission";

export const Route = createFileRoute("/_authenticated/masters/early-checkin-slabs")({
  head: () => ({
    meta: [
      { title: "Early Check-in Slabs — HotelPilot" },
      { name: "description", content: "Configure slab-wise early check-in charges by hours before standard check-in time." },
      { property: "og:title", content: "Early Check-in Slabs — HotelPilot" },
      { property: "og:description", content: "Slab-wise early check-in charges for your property." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <RequirePermission module="master_data"><EarlyCheckinSlabsPage /></RequirePermission>
  ),
});

interface Slab {
  id: string;
  from_hours: number;
  to_hours: number | null;
  charge_amount: number;
  is_active: boolean;
  effective_from: string;
}

const fields: FieldDef[] = [
  { name: "from_hours", label: "From (hours early)", type: "number", required: true, defaultValue: 0 },
  { name: "to_hours", label: "To (hours early, 0 = and above)", type: "number", defaultValue: 0 },
  { name: "charge_amount", label: "Charge amount (₹)", type: "number", required: true, defaultValue: 0 },
  { name: "effective_from", label: "Effective from", type: "date" },
  { name: "is_active", label: "Active", type: "switch", defaultValue: true },
];

function rangeLabel(r: Slab) {
  const to = Number(r.to_hours ?? 0);
  return to === 0
    ? `${Number(r.from_hours)} hrs and above`
    : `${Number(r.from_hours)} – ${to} hrs`;
}

const columns: ColumnDef<Slab>[] = [
  { header: "Hours early", render: (r) => <span className="font-medium">{rangeLabel(r)}</span> },
  { header: "Charge", render: (r) => `₹${Number(r.charge_amount).toLocaleString("en-IN")}` },
  { header: "Effective from", render: (r) => r.effective_from ?? "—" },
  {
    header: "Status",
    render: (r) => <Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "Active" : "Inactive"}</Badge>,
  },
];

function EarlyCheckinSlabsPage() {
  return (
    <CrudPage<Slab>
      title="Early Check-in Slabs"
      subtitle="Slab-wise charge applied when a guest arrives before the standard check-in time"
      table="early_checkin_slabs"
      fields={fields}
      columns={columns}
      orderBy={{ column: "from_hours", ascending: true }}
      validate={(payload) => {
        const from = Number(payload.from_hours) || 0;
        const to = Number(payload.to_hours) || 0;
        if (from < 0) return "From hours cannot be negative";
        if (to !== 0 && to <= from) return "To hours must be greater than From hours (or 0 for open-ended)";
        if ((Number(payload.charge_amount) || 0) < 0) return "Charge amount cannot be negative";
        return null;
      }}
    />
  );
}
