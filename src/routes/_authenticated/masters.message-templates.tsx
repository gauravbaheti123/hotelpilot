import { createFileRoute } from "@tanstack/react-router";
import { CrudPage, type FieldDef, type ColumnDef } from "@/components/master/CrudPage";
import { Badge } from "@/components/ui/badge";
import { CHANNELS, TEMPLATE_VARIABLES } from "@/lib/comms";

export const Route = createFileRoute("/_authenticated/masters/message-templates")({
  head: () => ({ meta: [{ title: "Message Templates — HotelPilot" }] }),
  component: TemplatesPage,
});

interface Tpl {
  id: string;
  name: string;
  channel: string;
  subject: string | null;
  body: string;
  is_active: boolean;
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
  { name: "subject", label: "Subject (email only)", type: "text" },
  { name: "body", label: "Body — supports {{guest_name}} {{booking_number}} {{check_in}} etc.", type: "textarea", required: true, colSpan: 2 },
  { name: "is_active", label: "Active", type: "switch", defaultValue: true },
];

const columns: ColumnDef<Tpl>[] = [
  { header: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
  { header: "Channel", render: (r) => <Badge variant="outline">{CHANNELS.find((c) => c.value === r.channel)?.label ?? r.channel}</Badge> },
  { header: "Subject", render: (r) => r.subject ?? "—" },
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
      subtitle={`Reusable message bodies. Available variables: ${TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(" ")}`}
      table="message_templates"
      fields={fields}
      columns={columns}
      orderBy={{ column: "name", ascending: true }}
    />
  );
}