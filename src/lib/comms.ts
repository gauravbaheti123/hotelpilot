export const CHANNELS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "call", label: "Phone Call" },
  { value: "in_app", label: "In-App" },
];

export const DIRECTIONS = [
  { value: "outbound", label: "Outbound" },
  { value: "inbound", label: "Inbound" },
];

export const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "queued", label: "Queued" },
  { value: "sent", label: "Sent" },
  { value: "delivered", label: "Delivered" },
  { value: "read", label: "Read" },
  { value: "received", label: "Received" },
  { value: "failed", label: "Failed" },
];

export const STATUS_TONE: Record<string, string> = {
  draft: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
  queued: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  sent: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  delivered: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  read: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  received: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  failed: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

export const CHANNEL_TONE: Record<string, string> = {
  whatsapp: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  sms: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  email: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  call: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  in_app: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
};

export interface MergeContext {
  guest_name?: string | null;
  booking_number?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  room_number?: string | null;
  property_name?: string | null;
  balance?: number | null;
}

/** Replace {{var}} placeholders with values from `ctx`. */
export function renderTemplate(body: string, ctx: MergeContext): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = (ctx as Record<string, unknown>)[k];
    return v == null || v === "" ? "" : String(v);
  });
}

export const TEMPLATE_VARIABLES = [
  "guest_name",
  "booking_number",
  "check_in",
  "check_out",
  "room_number",
  "property_name",
  "balance",
];

/** Build a whatsapp deep-link `https://wa.me/<digits>?text=...` */
export function whatsappLink(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** Build a mailto: link with subject/body */
export function mailtoLink(email: string, subject: string, body: string): string {
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);
  return `mailto:${email}?${params.toString()}`;
}

/** Build an sms: link */
export function smsLink(phone: string, text: string): string {
  return `sms:${phone.replace(/\s/g, "")}?body=${encodeURIComponent(text)}`;
}