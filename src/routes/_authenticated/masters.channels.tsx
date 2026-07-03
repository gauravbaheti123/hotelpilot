import { createFileRoute } from "@tanstack/react-router";
import { CrudPage, type FieldDef, type ColumnDef } from "@/components/master/CrudPage";
import { Badge } from "@/components/ui/badge";
import { CHANNEL_PRESETS } from "@/lib/channels";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/masters/channels")({
  head: () => ({ meta: [{ title: "OTA Channels — HotelPilot" }] }),
  component: () => (<RequirePermission module="master_data"><ChannelsPage /></RequirePermission>),
});

interface Channel {
  id: string;
  name: string;
  code: string;
  commission_pct: number;
  contact_email: string | null;
  notes: string | null;
  is_active: boolean;
}

const fields: FieldDef[] = [
  {
    name: "code",
    label: "Channel",
    type: "select",
    options: CHANNEL_PRESETS.map((c) => ({ value: c.code, label: c.name })),
    required: true,
  },
  { name: "name", label: "Display name", type: "text", required: true },
  { name: "commission_pct", label: "Commission %", type: "number", defaultValue: 15 },
  { name: "contact_email", label: "Contact email", type: "text" },
  { name: "notes", label: "Notes", type: "textarea", colSpan: 2 },
  { name: "is_active", label: "Active", type: "switch", defaultValue: true },
];

const columns: ColumnDef<Channel>[] = [
  { header: "Channel", render: (r) => <span className="font-medium">{r.name}</span> },
  { header: "Code", render: (r) => <Badge variant="outline">{r.code}</Badge> },
  { header: "Commission", render: (r) => `${Number(r.commission_pct).toFixed(2)}%` },
  { header: "Contact", render: (r) => r.contact_email ?? "—" },
  {
    header: "Status",
    render: (r) => <Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "Active" : "Inactive"}</Badge>,
  },
];

function ChannelsPage() {
  return (
    <CrudPage<Channel>
      title="OTA Channels"
      subtitle="Online travel agencies and direct booking sources used for distribution."
      table="ota_channels"
      fields={fields}
      columns={columns}
      orderBy={{ column: "name", ascending: true }}
    />
  );
}