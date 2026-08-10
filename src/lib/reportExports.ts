import { istDateISO } from "@/lib/date";

export interface ReportColumn<T> {
  key: string;
  header: string;
  /** Render cell value for display / Excel; returns string or number */
  get: (row: T) => string | number;
  /** Numeric (right-aligned) / currency flag for Excel formatting */
  numeric?: boolean;
  currency?: boolean;
  /** Column data type for filter UI. Defaults: 'number' if currency/numeric, else 'text'. */
  type?: "text" | "number" | "date" | "enum";
  /** Enable per-column filter (default true if filterable UI wanted). */
  filterable?: boolean;
  /** Enable per-column sort (default true). */
  sortable?: boolean;
  /** Fixed enum options; if omitted with type='enum', options are derived from rows. */
  enumOptions?: string[];
  /** Value used for sort/filter comparisons; falls back to get(). */
  sortValue?: (row: T) => number | string | Date | null | undefined;
  /** Value used for date filters (ISO string / Date); falls back to sortValue/get. */
  dateValue?: (row: T) => string | Date | null | undefined;
}

export interface ReportExportMeta {
  reportName: string;
  propertyName: string;
  from?: string;
  to?: string;
  /** Footer rows: [label, value] pairs */
  totals?: Array<[string, string | number]>;
}

function safeName(s: string) {
  return (s ?? "").replace(/[^\w]+/g, "_").replace(/^_|_$/g, "");
}

export function buildFileName(meta: ReportExportMeta, ext: string) {
  const parts = [
    safeName(meta.reportName),
    safeName(meta.propertyName),
    meta.from ? meta.from : null,
    meta.to ? meta.to : null,
  ].filter(Boolean);
  return `${parts.join("_")}.${ext}`;
}

/** Excel export — Sheet 1 data, Sheet 2 summary. */
export async function exportExcel<T>(
  rows: T[],
  columns: ReportColumn<T>[],
  meta: ReportExportMeta,
) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  const header = columns.map((c) => c.header);
  const aoa: (string | number)[][] = [header];
  for (const r of rows) {
    aoa.push(columns.map((c) => c.get(r)));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths
  ws["!cols"] = columns.map((c) => ({ wch: Math.max(12, c.header.length + 2) }));

  // Number formats for numeric/currency cols
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  for (let R = 1; R <= range.e.r; R++) {
    for (let C = 0; C <= range.e.c; C++) {
      const col = columns[C];
      if (!col) continue;
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[addr];
      if (!cell) continue;
      if (col.currency) {
        cell.t = "n";
        cell.z = '"₹"#,##0.00';
      } else if (col.numeric) {
        cell.t = "n";
        cell.z = "#,##0.00";
      }
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, "Report");

  // Summary sheet
  const summary: (string | number)[][] = [
    ["Report", meta.reportName],
    ["Property", meta.propertyName],
    ["From", meta.from ?? ""],
    ["To", meta.to ?? ""],
    ["Generated", new Date().toLocaleString("en-IN")],
    ["Total rows", rows.length],
  ];
  if (meta.totals) {
    summary.push([]);
    summary.push(["Totals", ""]);
    for (const [k, v] of meta.totals) summary.push([k, v]);
  }
  const wsS = XLSX.utils.aoa_to_sheet(summary);
  wsS["!cols"] = [{ wch: 28 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, wsS, "Summary");

  XLSX.writeFile(wb, buildFileName(meta, "xlsx"));
}

/** PDF export via window.print() on a generated HTML document. */
export function exportPdf<T>(
  rows: T[],
  columns: ReportColumn<T>[],
  meta: ReportExportMeta,
  orientation: "portrait" | "landscape" = "landscape",
) {
  const esc = (v: unknown) =>
    String(v ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[m]!));

  const head = `<tr>${columns.map((c) => `<th${c.numeric || c.currency ? ' class="right"' : ""}>${esc(c.header)}</th>`).join("")}</tr>`;
  const body = rows.map((r, i) => (
    `<tr class="${i % 2 ? "alt" : ""}">${
      columns.map((c) => {
        const v = c.get(r);
        const cls = c.numeric || c.currency ? "right" : "";
        return `<td class="${cls}">${esc(v)}</td>`;
      }).join("")
    }</tr>`
  )).join("");

  const totalsHtml = (meta.totals ?? []).map(
    ([k, v]) => `<tr><td><strong>${esc(k)}</strong></td><td class="right"><strong>${esc(v)}</strong></td></tr>`,
  ).join("");

  const html = `<!doctype html><html><head>
    <title>${esc(meta.reportName)}</title>
    <style>
      @page { size: A4 ${orientation}; margin: 12mm; }
      body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 0; padding: 0; }
      h1 { font-size: 16px; margin: 0 0 4px; color: #0F6E56; }
      .meta { color: #444; margin-bottom: 8px; font-size: 11px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #ddd; padding: 4px 6px; font-size: 10px; }
      th { background: #0F6E56; color: #fff; text-align: left; }
      td.right, th.right { text-align: right; }
      tr.alt td { background: #F9F9F9; }
      .totals { margin-top: 10px; width: 40%; margin-left: auto; }
      .totals td { background: #ECFBF4; }
      .footer { position: fixed; bottom: 6mm; left: 0; right: 0; text-align: center; font-size: 9px; color: #666; }
    </style>
  </head><body>
    <h1>${esc(meta.reportName)} — ${esc(meta.propertyName)}</h1>
    <div class="meta">${meta.from ? `From <strong>${esc(meta.from)}</strong>` : ""}${meta.to ? ` to <strong>${esc(meta.to)}</strong>` : ""} · Generated ${new Date().toLocaleString("en-IN")}</div>
    <table>
      <thead>${head}</thead>
      <tbody>${body || `<tr><td colspan="${columns.length}" style="text-align:center;color:#666">No data</td></tr>`}</tbody>
    </table>
    ${totalsHtml ? `<table class="totals">${totalsHtml}</table>` : ""}
    <div class="footer">${esc(meta.propertyName)} — ${esc(meta.reportName)}</div>
  </body></html>`;

  const w = window.open("", "_blank", "width=1100,height=900");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}

/* -------------------- Tally Prime XML helpers -------------------- */

function tallyDate(iso: string) {
  if (!iso) return "";
  const d = iso.slice(0, 10).replace(/-/g, "");
  return d;
}
function esc(v: unknown) {
  return String(v ?? "").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]!));
}
function envelope(messages: string, importType: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC><REPORTNAME>${importType}</REPORTNAME></REQUESTDESC>
      <REQUESTDATA>
${messages}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

export interface TallySalesVoucher {
  date: string;            // ISO
  voucher_number: string;
  guest_name: string;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount?: number;
  total_amount: number;
}

export function buildTallySalesXml(vouchers: TallySalesVoucher[]) {
  const messages = vouchers.map((v) => `        <TALLYMESSAGE>
          <VOUCHER VCHTYPE="Sales" ACTION="Create">
            <DATE>${tallyDate(v.date)}</DATE>
            <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
            <VOUCHERNUMBER>${esc(v.voucher_number)}</VOUCHERNUMBER>
            <PARTYLEDGERNAME>${esc(v.guest_name || "Walk-In Guest")}</PARTYLEDGERNAME>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Sales Account</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>-${v.taxable_amount.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            ${v.cgst_amount > 0 ? `<ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>CGST</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>-${v.cgst_amount.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>` : ""}
            ${v.sgst_amount > 0 ? `<ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>SGST</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>-${v.sgst_amount.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>` : ""}
            ${(v.igst_amount ?? 0) > 0 ? `<ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>IGST</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>-${(v.igst_amount ?? 0).toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>` : ""}
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Sundry Debtors</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>${v.total_amount.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
          </VOUCHER>
        </TALLYMESSAGE>`).join("\n");
  return envelope(messages, "Vouchers");
}

export interface TallyPaymentVoucher {
  date: string;
  voucher_number: string;
  category: string;
  amount: number;
}

export function buildTallyPaymentXml(vouchers: TallyPaymentVoucher[]) {
  const messages = vouchers.map((v) => `        <TALLYMESSAGE>
          <VOUCHER VCHTYPE="Payment" ACTION="Create">
            <DATE>${tallyDate(v.date)}</DATE>
            <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
            <VOUCHERNUMBER>${esc(v.voucher_number)}</VOUCHERNUMBER>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${esc(v.category || "Indirect Expenses")}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>${v.amount.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Cash</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>-${v.amount.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
          </VOUCHER>
        </TALLYMESSAGE>`).join("\n");
  return envelope(messages, "Vouchers");
}

export function downloadXml(xml: string, fileName: string) {
  const blob = new Blob([xml], { type: "text/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

/** Format helpers */
export function fmtINR(n: number | string | null | undefined) {
  return `₹${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function firstOfMonthIso(): string {
  const d = new Date(); d.setDate(1);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return istDateISO(d);
}
/* ------------------------------------------------------------------ *
 * Multi-section (multi-page) exports — used by the Daily Morning Report
 * ------------------------------------------------------------------ */

export interface ExportSection {
  title: string;
  columns: ReportColumn<any>[];
  rows: any[];
  summary?: Array<[string, string | number]>;
  emptyText?: string;
}

export interface ReportBrand {
  name: string;
  gstin?: string | null;
  address?: string | null;
  phone?: string | null;
  logoDataUrl?: string | null;
}

/** Excel workbook with one sheet per section + a cover/summary sheet. */
export async function exportExcelSections(sections: ExportSection[], meta: ReportExportMeta) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  const cover: (string | number)[][] = [
    ["Report", meta.reportName],
    ["Property", meta.propertyName],
    ["From", meta.from ?? ""],
    ["To", meta.to ?? ""],
    ["Generated", new Date().toLocaleString("en-IN")],
    [],
  ];
  for (const s of sections) {
    cover.push([s.title, `${s.rows.length} row(s)`]);
    for (const [k, v] of s.summary ?? []) cover.push([`  ${k}`, v]);
    cover.push([]);
  }
  const wsC = XLSX.utils.aoa_to_sheet(cover);
  wsC["!cols"] = [{ wch: 42 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, wsC, "Summary");

  const used = new Set<string>();
  for (const s of sections) {
    const aoa: (string | number)[][] = [s.columns.map((c) => c.header)];
    for (const r of s.rows) aoa.push(s.columns.map((c) => c.get(r)));
    if (s.summary?.length) {
      aoa.push([]);
      for (const [k, v] of s.summary) aoa.push([k, v]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = s.columns.map((c) => ({ wch: Math.max(12, c.header.length + 2) }));
    for (let R = 1; R <= s.rows.length; R++) {
      for (let C = 0; C < s.columns.length; C++) {
        const col = s.columns[C];
        const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
        if (!cell) continue;
        if (col.currency) { cell.t = "n"; cell.z = '"₹"#,##0.00'; }
        else if (col.numeric) { cell.t = "n"; cell.z = "#,##0.00"; }
      }
    }
    let name = s.title.replace(/[\\/*?:[\]]/g, "").slice(0, 28) || "Sheet";
    let i = 2;
    while (used.has(name)) name = `${name.slice(0, 26)} ${i++}`;
    used.add(name);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  XLSX.writeFile(wb, buildFileName(meta, "xlsx"));
}

/** Branded, page-broken PDF (via print) with one page per section. */
export interface SectionsPdfOptions {
  orientation?: "portrait" | "landscape";
  /** Optional HTML block rendered on its own branded first page (KPIs/charts). */
  introHtml?: string;
  introTitle?: string;
}

export function exportSectionsPdf(
  sections: ExportSection[],
  meta: ReportExportMeta,
  brand: ReportBrand,
  options: SectionsPdfOptions | "portrait" | "landscape" = {},
) {
  const opts: SectionsPdfOptions = typeof options === "string" ? { orientation: options } : options;
  const orientation = opts.orientation ?? "landscape";
  const e = (v: unknown) =>
    String(v ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[m]!));

  const generated = new Date().toLocaleString("en-IN");
  const header = `
    <div class="brand">
      ${brand.logoDataUrl ? `<img class="logo" src="${e(brand.logoDataUrl)}" alt="" />` : ""}
      <div class="brand-text">
        <div class="brand-name">${e(brand.name)}</div>
        <div class="brand-sub">${[brand.address, brand.phone ? `Ph: ${brand.phone}` : "", brand.gstin ? `GSTIN: ${brand.gstin}` : ""].filter(Boolean).map(e).join(" · ")}</div>
      </div>
      <div class="brand-meta">
        <div>${e(meta.reportName)}</div>
        <div>${meta.from === meta.to ? e(meta.from ?? "") : `${e(meta.from ?? "")} → ${e(meta.to ?? "")}`}</div>
        <div>Generated ${e(generated)}</div>
      </div>
    </div>`;

  const introPage = opts.introHtml
    ? `<section class="page${sections.length === 0 ? " last" : ""}">
        ${header}
        <h2>${e(opts.introTitle ?? "Summary")}</h2>
        ${opts.introHtml}
        <div class="foot">${e(brand.name)} — ${e(meta.reportName)}</div>
      </section>`
    : "";

  const pages = introPage + sections.map((s, idx) => {
    const head = `<tr>${s.columns.map((c) => `<th${c.numeric || c.currency ? ' class="right"' : ""}>${e(c.header)}</th>`).join("")}</tr>`;
    const body = s.rows.length
      ? s.rows.map((r, i) => `<tr class="${i % 2 ? "alt" : ""}">${s.columns.map((c) => `<td class="${c.numeric || c.currency ? "right" : ""}">${e(c.get(r))}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="${s.columns.length}" class="empty">${e(s.emptyText ?? "No data")}</td></tr>`;
    const totals = (s.summary ?? []).map(([k, v]) => `<tr><td>${e(k)}</td><td class="right"><strong>${e(v)}</strong></td></tr>`).join("");
    return `<section class="page${idx === sections.length - 1 ? " last" : ""}">
      ${header}
      <h2>${idx + 1 + (opts.introHtml ? 1 : 0)}. ${e(s.title)}</h2>
      <table class="data"><thead>${head}</thead><tbody>${body}</tbody></table>
      ${totals ? `<table class="totals">${totals}</table>` : ""}
      <div class="foot">${e(brand.name)} — ${e(meta.reportName)} — page ${idx + 1 + (opts.introHtml ? 1 : 0)} of ${sections.length + (opts.introHtml ? 1 : 0)}</div>
    </section>`;
  }).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"/>
    <title>${e(meta.reportName)}</title>
    <style>
      @page { size: A4 ${orientation}; margin: 10mm; }
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; margin: 0; }
      section.page { page-break-after: always; }
      section.page.last { page-break-after: auto; }
      .brand { display: flex; align-items: center; gap: 10px; border-bottom: 2px solid #0F6E56; padding-bottom: 6px; margin-bottom: 8px; }
      .logo { max-height: 44px; max-width: 120px; object-fit: contain; }
      .brand-name { font-size: 15px; font-weight: 700; color: #0F6E56; }
      .brand-sub { font-size: 9px; color: #555; margin-top: 2px; }
      .brand-text { flex: 1; }
      .brand-meta { text-align: right; font-size: 9px; color: #444; line-height: 1.5; }
      h2 { font-size: 13px; margin: 4px 0 6px; color: #0F6E56; }
      table { border-collapse: collapse; width: 100%; }
      table.data th, table.data td { border: 1px solid #ddd; padding: 3px 5px; font-size: 9px; }
      table.data th { background: #0F6E56; color: #fff; text-align: left; }
      td.right, th.right { text-align: right; }
      tr.alt td { background: #F7F7F7; }
      td.empty { text-align: center; color: #777; padding: 12px; }
      .totals { margin-top: 8px; width: 48%; margin-left: auto; }
      .totals td { border: 1px solid #cfe9df; background: #ECFBF4; padding: 3px 6px; font-size: 10px; }
      .foot { margin-top: 8px; text-align: center; font-size: 8px; color: #777; }
    </style></head><body>${pages}</body></html>`;

  const w = window.open("", "_blank", "width=1200,height=900");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}

/* ---------------- KPI helpers (dashboard-style reports) ---------------- */

export interface KpiEntry { label: string; value: string | number; hint?: string }

export const kpiColumns: ReportColumn<KpiEntry>[] = [
  { key: "metric", header: "Metric", get: (r) => r.label },
  { key: "value", header: "Value", get: (r) => r.value },
  { key: "note", header: "Note", get: (r) => r.hint ?? "" },
];

/** A section holding label/value KPI rows — used for dashboard-style reports. */
export function kpiSection(title: string, kpis: KpiEntry[]): ExportSection {
  return { title, columns: kpiColumns as ReportColumn<any>[], rows: kpis, emptyText: "No figures" };
}

/**
 * Build the branded PDF "intro" block for a dashboard-style report:
 * KPI cards plus any live chart SVGs captured from the screen.
 */
export function buildKpiIntroHtml(kpis: KpiEntry[], chartsSvg: string[] = []): string {
  const e = (v: unknown) =>
    String(v ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[m]!));
  const cards = kpis.map((k) => `
    <div class="kpi">
      <div class="kpi-label">${e(k.label)}</div>
      <div class="kpi-value">${e(k.value)}</div>
      ${k.hint ? `<div class="kpi-hint">${e(k.hint)}</div>` : ""}
    </div>`).join("");
  const charts = chartsSvg.map((svg) => `<div class="chart">${svg}</div>`).join("");
  return `
    <style>
      .kpi-grid { display: flex; flex-wrap: wrap; gap: 6px; }
      .kpi { flex: 1 1 22%; min-width: 120px; border: 1px solid #cfe9df; background: #ECFBF4; border-radius: 4px; padding: 6px 8px; }
      .kpi-label { font-size: 8px; text-transform: uppercase; letter-spacing: .5px; color: #4b6b60; }
      .kpi-value { font-size: 14px; font-weight: 700; color: #0F6E56; margin-top: 2px; }
      .kpi-hint { font-size: 8px; color: #667; margin-top: 1px; }
      .chart { margin-top: 8px; page-break-inside: avoid; }
      .chart svg { width: 100%; height: auto; max-height: 190px; }
    </style>
    <div class="kpi-grid">${cards}</div>
    ${charts}`;
}
