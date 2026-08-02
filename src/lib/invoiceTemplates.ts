// Invoice template renderer — A4 print-ready HTML for 3 variants.
// All templates pull from property settings (logo, color, footer, toggles).

import { supabase } from "@/integrations/supabase/client";
import { inr } from "@/lib/billing";

export interface InvoiceProperty {
  name: string;
  legal_entity_name?: string | null;
  tagline?: string | null;
  gstin?: string | null;
  pan_number?: string | null;
  state?: string | null;
  state_code?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  pin_code?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  wa_number?: string | null;
  logo_url?: string | null;
  invoice_prefix?: string | null;
  invoice_footer?: string | null;
  invoice_primary_color?: string | null;
  invoice_template?: string | null;
  invoice_show_hsn?: boolean | null;
  invoice_show_gst_breakup?: boolean | null;
  invoice_show_signature?: boolean | null;
  invoice_show_powered_by?: boolean | null;
  default_checkin_time?: string | null;
  default_checkout_time?: string | null;
}

export interface InvoiceFolio {
  invoice_number: string;
  bill_type?: string | null;
  gst_mode?: string | null;
  sub_total: number;
  discount_amount: number;
  gst_amount: number;
  total_amount: number;
  paid_amount: number;
  balance_amount: number;
  guest_gstin?: string | null;
  guest_company?: string | null;
  notes?: string | null;
  status: string;
}

export interface InvoiceCharge {
  description: string;
  qty: number;
  rate: number;
  amount: number;
  gst_rate: number;
  gst_amount: number;
  charge_type: string;
  hsn_code?: string | null;
  segment_bill_ref?: string | null;
}

export interface InvoicePayment {
  id?: string | null;
  paid_at: string;
  mode: string;
  reference_no: string | null;
  amount: number;
  notes?: string | null;
}

export interface InvoiceBooking {
  booking_number: string;
  check_in: string;
  check_out: string;
  adults?: number | null;
  children?: number | null;
  source?: string | null;
  ota_partner_name?: string | null;
  ota_channels?: { name?: string | null } | null;
  guests?: {
    name: string;
    mobile?: string | null;
    address?: string | null;
    nationality?: string | null;
    id_proof_type?: string | null;
    id_proof_number?: string | null;
  } | null;
  booking_rooms?: {
    rooms?: { room_number: string } | null;
    room_categories?: { name: string } | null;
  }[];
}

export interface InvoiceContext {
  property: InvoiceProperty;
  folio: InvoiceFolio;
  booking: InvoiceBooking;
  charges: InvoiceCharge[];
  payments: InvoicePayment[];
  draft?: boolean;
  logoDataUrl?: string | null;
}

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Sign a private storage URL; returns a data-safe public URL or null. */
export async function resolveLogoUrl(logoPath: string | null | undefined): Promise<string | null> {
  if (!logoPath) return null;
  // already an absolute URL
  if (/^https?:\/\//i.test(logoPath)) return logoPath;
  try {
    const { data } = await supabase.storage.from("hotel-assets").createSignedUrl(logoPath, 3600);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

function isGstBill(folio: InvoiceFolio): boolean {
  return (folio.bill_type ?? folio.gst_mode) === "gst_invoice" || folio.gst_mode === "gst";
}

function defaultHsn(t: string): string {
  if (t === "room") return "996311";
  if (t === "food") return "996331";
  return "";
}

function fullAddress(p: InvoiceProperty): string {
  return [p.address_line1, p.address_line2, [p.city, p.pin_code].filter(Boolean).join(" "), p.state]
    .filter(Boolean).join(", ");
}

function nights(checkIn: string, checkOut: string): number {
  const a = new Date(checkIn).getTime();
  const b = new Date(checkOut).getTime();
  if (isNaN(a) || isNaN(b) || b <= a) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

function commonStyles(color: string, draft: boolean): string {
  return `
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    html, body { margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1f2937; font-size: 11.5px; line-height: 1.45; background: #fff; }
    .invoice { width: 100%; max-width: 182mm; margin: 0 auto; position: relative; }
    h1, h2, h3 { margin: 0; font-weight: 700; color: #111827; }
    table { width: 100%; border-collapse: collapse; }
    .right { text-align: right; }
    .center { text-align: center; }
    .small { font-size: 10px; color: #6b7280; }
    .accent { color: ${color}; }
    .bg-accent { background: ${color}; color: #fff; }
    .border-accent { border-color: ${color}; }
    .logo { max-height: 56px; max-width: 160px; object-fit: contain; }
    .stamp { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; }
    .draft-watermark {
      position: fixed; top: 50%; left: 50%;
      transform: translate(-50%,-50%) rotate(-32deg);
      font-size: 110px; font-weight: 800; color: ${color};
      opacity: 0.10; white-space: nowrap; pointer-events: none; z-index: 9999;
      letter-spacing: 8px;
    }
    .sig-row { display: flex; gap: 32px; margin-top: 36px; }
    .sig-row > div { flex: 1; border-top: 1px solid #111; padding-top: 4px; font-size: 10px; color: #4b5563; }
    .powered { text-align: center; font-size: 9px; color: #9ca3af; margin-top: 14px; letter-spacing: 0.4px; }
    @media print {
      body { font-size: 11px; }
      .no-print { display: none !important; }
      ${draft ? `.draft-watermark { opacity: 0.12; }` : ""}
    }
  `;
}

function headerBlock(ctx: InvoiceContext): string {
  const { property, logoDataUrl } = ctx;
  const logo = logoDataUrl ? `<img class="logo" src="${esc(logoDataUrl)}" alt="logo"/>` : "";
  const color = property.invoice_primary_color || "#1D9E75";
  const addressBits = [
    esc(fullAddress(property)),
    property.phone ? `Ph: ${esc(property.phone)}` : "",
    property.email ? `Email: ${esc(property.email)}` : "",
    property.gstin ? `GSTIN: ${esc(property.gstin)}` : "",
  ].filter(Boolean).join("  |  ");
  // Premium header — full-width colored band, name + address inside the band.
  return `
    <div style="background:${color};color:#fff;padding:20px 24px;display:flex;align-items:center;gap:18px">
      ${logoDataUrl ? `<div style="background:#fff;padding:6px;">${logo}</div>` : ""}
      <div style="flex:1;min-width:0">
        <h1 style="color:#fff;font-size:20px;letter-spacing:0.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0">${esc(property.name)}</h1>
        <div style="font-size:10px;opacity:.9;margin-top:4px;line-height:1.4">${addressBits}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:22px;font-weight:800;letter-spacing:3px">INVOICE</div>
        ${property.gstin ? `<div style="font-size:10px;opacity:.9">GSTIN: ${esc(property.gstin)}</div>` : ""}
      </div>
    </div>
  `;
}

function metaBlock(ctx: InvoiceContext): string {
  const { booking, folio, property, draft } = ctx;
  const isGst = isGstBill(folio);
  const docTitle = draft ? "DRAFT BILL" : isGst ? "TAX INVOICE" : "BILL OF SUPPLY";
  const rooms = (booking.booking_rooms ?? []).map((r) => r.rooms?.room_number).filter(Boolean).join(", ");
  const ns = nights(booking.check_in, booking.check_out);
  const billNo = draft
    ? `<span style="color:#9ca3af;letter-spacing:4px">- - - - -</span>`
    : esc(folio.invoice_number);

  // OTA / third-party channel name for "Company To" (priority: mapped OTA channel → manual partner name → generic "OTA")
  const otaName =
    booking.ota_channels?.name?.trim() ||
    booking.ota_partner_name?.trim() ||
    (booking.source === "ota" ? "OTA" : "");

  const guestName = booking.guests?.name ?? "";
  const hasCompany = !!folio.guest_company;
  const billToPrimary = hasCompany
    ? `${esc(folio.guest_company)} <span style="font-weight:500;color:#374151">(${esc(guestName)})</span>`
    : esc(guestName);

  return `
    <div style="display:flex;justify-content:space-between;gap:24px;margin-bottom:14px">
      <div style="flex:1">
        <div class="small" style="text-transform:uppercase;letter-spacing:1px">Bill To</div>
        <div style="font-weight:600;font-size:13px;margin-top:2px">${billToPrimary}</div>
        ${hasCompany && folio.guest_gstin ? `<div class="small">GSTIN: ${esc(folio.guest_gstin)}</div>` : ""}
        ${booking.guests?.address ? `<div class="small">${esc(booking.guests.address)}</div>` : ""}
        ${booking.guests?.mobile ? `<div class="small">${esc(booking.guests.mobile)}</div>` : ""}
        ${booking.guests?.nationality ? `<div class="small">Nationality: ${esc(booking.guests.nationality)}</div>` : ""}
        ${booking.guests?.id_proof_type && booking.guests?.id_proof_number
          ? `<div class="small">${esc(booking.guests.id_proof_type)}: ${esc(booking.guests.id_proof_number)}</div>` : ""}
        ${otaName ? `
          <div class="small" style="text-transform:uppercase;letter-spacing:1px;margin-top:8px">Company To</div>
          <div style="font-weight:600;font-size:12px;margin-top:2px">${esc(otaName)}</div>
        ` : ""}
      </div>
      <div style="text-align:right">
        <div class="stamp bg-accent">${docTitle}</div>
        <div style="margin-top:8px"><span class="small">No:</span> <strong>${billNo}</strong></div>
        <div class="small">Booking: ${esc(booking.booking_number)}</div>
        <div class="small">Date: ${new Date().toLocaleDateString("en-IN")}</div>
        ${rooms ? `<div class="small">Room: ${esc(rooms)}</div>` : ""}
        <div class="small">Check-in: ${esc(booking.check_in)} ${property.default_checkin_time ? esc(property.default_checkin_time.slice(0,5)) : ""}</div>
        <div class="small">Check-out: ${esc(booking.check_out)} ${property.default_checkout_time ? esc(property.default_checkout_time.slice(0,5)) : ""}</div>
        <div class="small">Nights: ${ns} · Pax: ${(booking.adults ?? 0)}A${booking.children ? `+${booking.children}C` : ""}</div>
      </div>
    </div>
  `;
}

function chargesTable(ctx: InvoiceContext): string {
  const { folio, charges, property } = ctx;
  const isGst = isGstBill(folio);
  const showHsn = isGst && (property.invoice_show_hsn ?? true);
  const showGstSplit = isGst && (property.invoice_show_gst_breakup ?? true);
  const color = property.invoice_primary_color || "#1D9E75";

  const thStyle = `style="background:${color};color:#fff;padding:8px 10px;text-align:left;font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px"`;
  const tdStyle = `style="padding:7px 10px;border-bottom:1px solid #e5e7eb;font-size:11px"`;

  const head = `
    <tr>
      <th ${thStyle}>#</th>
      <th ${thStyle}>Description</th>
      ${showHsn ? `<th ${thStyle}>HSN/SAC</th>` : ""}
      <th ${thStyle} class="right">Qty</th>
      <th ${thStyle} class="right">Rate</th>
      <th ${thStyle} class="right">Amount</th>
      ${showGstSplit ? `<th ${thStyle} class="right">CGST</th><th ${thStyle} class="right">SGST</th>` : ""}
      ${isGst && !showGstSplit ? `<th ${thStyle} class="right">GST</th>` : ""}
      <th ${thStyle} class="right">Total</th>
    </tr>
  `;

  const rows = charges.map((c, i) => {
    const lineTotal = Number(c.amount) + (isGst ? Number(c.gst_amount || 0) : 0);
    const gstHalf = Number(c.gst_amount || 0) / 2;
    return `
      <tr>
        <td ${tdStyle}>${i + 1}</td>
        <td ${tdStyle}>${esc(c.description)}${c.segment_bill_ref ? ` <span class="small" style="color:#666">(Ref: ${esc(c.segment_bill_ref)})</span>` : ""}</td>
        ${showHsn ? `<td ${tdStyle}>${esc(c.hsn_code ?? defaultHsn(c.charge_type))}</td>` : ""}
        <td ${tdStyle} class="right">${Number(c.qty).toLocaleString("en-IN")}</td>
        <td ${tdStyle} class="right">${inr(c.rate)}</td>
        <td ${tdStyle} class="right">${inr(c.amount)}</td>
        ${showGstSplit ? `<td ${tdStyle} class="right">${(Number(c.gst_rate) / 2).toFixed(1)}%<br/><span class="small">${inr(gstHalf)}</span></td>
          <td ${tdStyle} class="right">${(Number(c.gst_rate) / 2).toFixed(1)}%<br/><span class="small">${inr(gstHalf)}</span></td>` : ""}
        ${isGst && !showGstSplit ? `<td ${tdStyle} class="right">${Number(c.gst_rate).toFixed(1)}%<br/><span class="small">${inr(c.gst_amount)}</span></td>` : ""}
        <td ${tdStyle} class="right"><strong>${inr(lineTotal)}</strong></td>
      </tr>
    `;
  }).join("");

  return `<table style="margin-top:6px"><thead>${head}</thead><tbody>${rows || `<tr><td ${tdStyle} colspan="9" class="center small">No charges</td></tr>`}</tbody></table>`;
}

/** Entry-wise "Payment Received" log — one row per recorded payment transaction. */
function paymentsBlock(ctx: InvoiceContext): string {
  const { payments, property } = ctx;
  if (!payments.length) return "";
  const color = property.invoice_primary_color || "#1D9E75";
  const th = `style="background:${color};color:#fff;padding:6px 8px;text-align:left;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px"`;
  const td = `style="padding:5px 8px;border-bottom:1px solid #e5e7eb;font-size:10.5px"`;
  const receiptNo = (p: InvoicePayment, i: number) =>
    p.reference_no?.trim() || (p.id ? `RCP-${String(p.id).slice(0, 6).toUpperCase()}` : `RCP-${i + 1}`);
  const total = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  return `
    <div style="margin-top:14px;page-break-inside:auto">
      <div class="small" style="text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Payment Received</div>
      <table>
        <thead><tr>
          <th ${th}>Date</th>
          <th ${th}>Receipt No.</th>
          <th ${th}>Pay Mode</th>
          <th ${th} class="right">Amount</th>
          <th ${th}>Remark</th>
        </tr></thead>
        <tbody>
          ${payments.map((p, i) => `<tr style="page-break-inside:avoid">
            <td ${td}>${new Date(p.paid_at).toLocaleDateString("en-IN")}</td>
            <td ${td}>${esc(receiptNo(p, i))}</td>
            <td ${td}>${esc(String(p.mode || "").toUpperCase())}</td>
            <td ${td} class="right">${inr(p.amount)}</td>
            <td ${td}>${esc(p.notes ?? "—")}</td>
          </tr>`).join("")}
          <tr>
            <td ${td} colspan="3"><strong>Total Received</strong></td>
            <td ${td} class="right"><strong>${inr(total)}</strong></td>
            <td ${td}></td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

function totalsBlock(ctx: InvoiceContext): string {
  const { folio, property } = ctx;
  const isGst = isGstBill(folio);
  const color = property.invoice_primary_color || "#1D9E75";
  const showGstSplit = isGst && (property.invoice_show_gst_breakup ?? true);

  return `
    <div style="display:flex;gap:18px;margin-top:14px">
      <div style="flex:1">
      </div>
      <div style="width:46%">
        <table style="font-size:11.5px">
          <tr><td style="padding:3px 8px">Sub-total</td><td style="padding:3px 8px;text-align:right">${inr(folio.sub_total)}</td></tr>
          ${Number(folio.discount_amount) > 0 ? `<tr><td style="padding:3px 8px">Discount</td><td style="padding:3px 8px;text-align:right">- ${inr(folio.discount_amount)}</td></tr>` : ""}
          ${isGst && showGstSplit ? `
            <tr><td style="padding:3px 8px">CGST</td><td style="padding:3px 8px;text-align:right">${inr(Number(folio.gst_amount) / 2)}</td></tr>
            <tr><td style="padding:3px 8px">SGST</td><td style="padding:3px 8px;text-align:right">${inr(Number(folio.gst_amount) / 2)}</td></tr>
          ` : isGst ? `<tr><td style="padding:3px 8px">GST</td><td style="padding:3px 8px;text-align:right">${inr(folio.gst_amount)}</td></tr>` : ""}
          <tr style="border-top:2px solid ${color}"><td style="padding:6px 8px;font-weight:700;font-size:13px" class="accent">Grand Total</td><td style="padding:6px 8px;text-align:right;font-weight:700;font-size:13px" class="accent">${inr(folio.total_amount)}</td></tr>
          <tr><td style="padding:3px 8px">Paid</td><td style="padding:3px 8px;text-align:right">${inr(folio.paid_amount)}</td></tr>
          <tr style="background:${Number(folio.balance_amount) > 0 ? "#fef3c7" : "#dcfce7"}"><td style="padding:5px 8px;font-weight:600">Balance Due</td><td style="padding:5px 8px;text-align:right;font-weight:600">${inr(folio.balance_amount)}</td></tr>
        </table>
      </div>
    </div>
    ${!isGst ? `<p class="small" style="margin-top:6px"><em>Amount is inclusive of all applicable taxes.</em></p>` : ""}
  `;
}

function footerBlock(ctx: InvoiceContext): string {
  const { property } = ctx;
  const showSig = property.invoice_show_signature ?? true;
  const showPower = property.invoice_show_powered_by ?? true;
  const footer = property.invoice_footer ?? "Thank you for staying with us!";

  return `
    ${showSig ? `
      <div style="margin-top:28px;display:flex;justify-content:flex-start;gap:28px">
        <div style="width:180px">
          <div style="height:28px;border-bottom:1px solid #000"></div>
          <div style="padding-top:3px;font-size:10.5px;color:#374151">Guest Signature</div>
        </div>
        <div style="width:180px">
          <div style="height:28px;border-bottom:1px solid #000"></div>
          <div style="padding-top:3px;font-size:10.5px;color:#374151">Manager Signature</div>
        </div>
      </div>
    ` : ""}
    <p class="center small" style="margin-top:18px">${esc(footer)}</p>
    ${showPower ? `<div style="text-align:center;font-size:11px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:8px;margin-top:16px">Powered by HotelPilot.in</div>` : ""}
  `;
}

export function renderInvoiceHtml(ctx: InvoiceContext): string {
  const color = ctx.property.invoice_primary_color || "#1D9E75";
  const draft = !!ctx.draft;
  const watermark = draft
    ? `<div class="draft-watermark">DRAFT</div>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"/>
    <title>${esc(ctx.folio.invoice_number)}</title>
    <style>${commonStyles(color, draft)}</style>
    </head><body><div class="invoice">
      ${watermark}
      ${headerBlock(ctx)}
      ${metaBlock(ctx)}
      ${chargesTable(ctx)}
      ${totalsBlock(ctx)}
      ${paymentsBlock(ctx)}
      ${footerBlock(ctx)}
    </div>
    <script>window.addEventListener('load',function(){setTimeout(function(){window.focus();window.print();},250);});</script>
    </body></html>`;
}

export function openInvoiceWindow(html: string): void {
  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}