import { createFileRoute } from "@tanstack/react-router";
import { CrudPage, type FieldDef, type ColumnDef } from "@/components/master/CrudPage";
import { Badge } from "@/components/ui/badge";
import { CHANNELS, TEMPLATE_VARIABLES } from "@/lib/comms";
import { TRIGGER_LABELS } from "@/lib/whatsapp";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/masters/message-templates")({
  head: () => ({ meta: [{ title: "Message Templates — HotelPilot" }] }),
  component: () => (<RequirePermission module="master_data"><TemplatesPage /></RequirePermission>),
});

interface Tpl {
  id: string;
  name: string;
  channel: string;
  subject: string | null;
  body: string;
  is_active: boolean;
  trigger_event: string | null;
  aisensy_campaign_name: string | null;
}

const fields: FieldDef[] = [
  { name: "name", label: "Template name", type: "text", required: true, colSpan: 2 },
  {
    name: "channel",
    label: "Channel",
    type: "select",
    options: CHANNELS.map((c) => ({ value: c.value, label: c.label })),
    defaultValue: "whatsapp",
  },
  {
    name: "trigger_event",
    label: "Trigger event (auto-send)",
    type: "select",
    options: [
      { value: "", label: "— Manual only —" },
      ...Object.entries(TRIGGER_LABELS).map(([v, l]) => ({ value: v, label: l })),
    ],
  },
  { name: "aisensy_campaign_name", label: "AiSensy campaign name", type: "text" },
  { name: "subject", label: "Subject (email only)", type: "text" },
  { name: "body", label: "Body — supports {guest_name} {room_no} {checkin_date} {checkout_date} {amount} {hotel_name} {wifi_password} {property_phone} {booking_number}", type: "textarea", required: true, colSpan: 2 },
  { name: "is_active", label: "Active", type: "switch", defaultValue: true },
];

const columns: ColumnDef<Tpl>[] = [
  { header: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
  {
    header: "Trigger",
    render: (r) => r.trigger_event
      ? <Badge>{TRIGGER_LABELS[r.trigger_event as keyof typeof TRIGGER_LABELS] ?? r.trigger_event}</Badge>
      : <span className="text-xs text-muted-foreground">Manual</span>,
  },
  { header: "Channel", render: (r) => <Badge variant="outline">{CHANNELS.find((c) => c.value === r.channel)?.label ?? r.channel}</Badge> },
  { header: "Campaign", render: (r) => r.aisensy_campaign_name ?? "—" },
  {
    header: "Body preview",
    render: (r) => (
      <span className="text-xs text-muted-foreground line-clamp-2 max-w-md inline-block">{r.body}</span>
    ),
  },
  {
    header: "Status",
    render: (r) => <Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "Active" : "Inactive"}</Badge>,
  },
];

function TemplatesPage() {
  return (
    <CrudPage<Tpl>
      title="Message Templates"
      subtitle={`Auto-triggered or manual messages. Variables: ${TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(" ")}`}
      table="message_templates"
      fields={fields}
      columns={columns}
      orderBy={{ column: "name", ascending: true }}
    />
  );
}