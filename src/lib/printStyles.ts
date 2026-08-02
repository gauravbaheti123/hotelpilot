import { supabase } from "@/integrations/supabase/client";

export type PaperSize = "58mm" | "80mm" | "A4";

export function getPrintStyles(paperSize: string | null | undefined): string {
  const size = (paperSize ?? "80mm") as PaperSize;
  if (size === "A4") {
    return `@page { size: A4; margin: 10mm; }`;
  }
  if (size === ("8x7cm" as any) || size === ("8x6cm" as any)) {
    return `@page { size: 8cm 7cm; margin: 0; }
            body { width: 8cm; font-size: 6pt; }`;
  }
  // Thermal roll: page height MUST be `auto` so the driver cuts right after
  // content. Also reset html/body layout — any inherited min-height/height
  // from the app shell would stretch the printable area to a full page.
  // Body width = printable width (roll width minus the 2mm page margins) so
  // the document lays out 1:1 without the margins clipping the right edge.
  const printable = getPrintContainerWidth(size);
  return `@page { size: ${size} auto; margin: 2mm; }
          html, body { width: ${printable}; min-height: 0 !important; height: auto !important; margin: 0; padding: 0; }
          body { font-size: 11px; }`;
}

/**
 * Print-safe outer container dimensions for each paper size. Values are
 * intentionally smaller than the physical page so nothing sits on the
 * printable edge regardless of driver / QZ Tray scaling.
 *
 *   A4     210mm page → 190mm container (10mm margin each side)
 *   80mm   thermal    → 76mm container (2mm margin each side)
 *   58mm   thermal    → 54mm container (2mm margin each side)
 */
export function getPrintContainerWidth(paperSize: string | null | undefined): string {
  const size = String(paperSize ?? "80mm").toUpperCase();
  if (size === "A4") return "190mm";
  if (size === "58MM") return "54mm";
  return "76mm";
}

export function getPrintContainerStyle(paperSize: string | null | undefined): string {
  const w = getPrintContainerWidth(paperSize);
  return `width:${w};max-width:${w};min-width:0;margin:0 auto;box-sizing:border-box;`;
}

/**
 * Thermal prints must never end flush with the last line of content — the
 * tear-off / auto-cutter sits a few millimetres past the print head, so the
 * final rows get sliced. Every thermal document (KOT tickets, counter copies,
 * Food/Laundry bills) ends with this blank feed block: ~3 blank lines.
 */
export const THERMAL_FEED_HTML = `<div class="print-feed">&nbsp;<br/>&nbsp;<br/>&nbsp;</div>`;

export function getThermalFeedCss(): string {
  return `.print-feed{height:14mm;min-height:14mm;line-height:4.5mm;font-size:10px;visibility:hidden;}`;
}

export function isThermal(paperSize: string | null | undefined): boolean {
  const s = String(paperSize ?? "80mm").toUpperCase();
  return s === "80MM" || s === "58MM";
}

/**
 * The active bill printer for a property (type 'bill' or 'both'), used to
 * silently route Food/Laundry bills without a print dialog.
 */
export async function fetchBillPrinter(
  propertyId: string | null | undefined,
): Promise<{ name: string; paper_size: string } | null> {
  if (!propertyId) return null;
  const { data } = await supabase
    .from("printers")
    .select("name,paper_size,type,is_default")
    .eq("property_id", propertyId)
    .eq("is_active", true)
    .in("type", ["bill", "both"])
    .order("is_default", { ascending: false })
    .limit(1);
  const row = data?.[0] as { name?: string; paper_size?: string | null } | undefined;
  if (!row?.name) return null;
  return { name: row.name, paper_size: (row.paper_size as string) ?? "80mm" };
}

/**
 * CSS rules that harden a print document against right-edge cutoff:
 * scoped to a container class so it can't leak into the app UI.
 */
export function getPrintSafetyCss(containerSelector: string): string {
  return `
    html,body{margin:0;padding:0;background:#fff;color:#000;}
    ${containerSelector},${containerSelector} *{box-sizing:border-box;}
    ${containerSelector} *{max-width:100% !important;}
    ${containerSelector} table{table-layout:fixed !important;width:100% !important;border-collapse:collapse;}
    ${containerSelector} th,${containerSelector} td{word-break:break-word;overflow-wrap:anywhere;}
    ${containerSelector} img{max-width:100%;height:auto;}
  `;
}

/**
 * Fetch the paper size for the first active printer matching the given
 * usage at the current property. Falls back to '80mm'.
 * usage: 'kot' or 'bill' — matches printers.type in (usage, 'both').
 */
export async function fetchPrinterPaperSize(
  propertyId: string | null | undefined,
  usage: "kot" | "bill",
): Promise<string> {
  if (!propertyId) return "80mm";
  const { data } = await supabase
    .from("printers")
    .select("paper_size,type,is_default")
    .eq("property_id", propertyId)
    .eq("is_active", true)
    .in("type", [usage, "both"])
    .order("is_default", { ascending: false })
    .limit(1);
  return (data?.[0]?.paper_size as string | null) ?? "80mm";
}

/**
 * Inject a temporary <style id="hp-dynamic-print"> tag with the @page rules
 * for the given paper size, run the callback (typically window.print()),
 * then remove the tag.
 */
export function withPrintStyles(paperSize: string | null | undefined, fn: () => void) {
  const css = getPrintStyles(paperSize);
  const existing = document.getElementById("hp-dynamic-print");
  if (existing) existing.remove();
  const style = document.createElement("style");
  style.id = "hp-dynamic-print";
  style.media = "print";
  style.appendChild(document.createTextNode(css));
  document.head.appendChild(style);
  try {
    fn();
  } finally {
    setTimeout(() => {
      document.getElementById("hp-dynamic-print")?.remove();
    }, 1000);
  }
}

/**
 * Multi-page safe print isolation.
 *
 * The old pattern (`body * { visibility: hidden }` + `position: fixed` on the
 * print area) can only ever produce ONE page: a fixed/absolutely positioned
 * element is taken out of flow, so the browser clips it to the first page and
 * silently drops everything below the page boundary. Long invoices therefore
 * printed page 1 only.
 *
 * This helper clones the target element into a plain, in-flow wrapper appended
 * to <body>, hides every other body child with `display:none` (so no phantom
 * whitespace remains), prints, then restores the DOM. Content flows naturally
 * across as many @page instances as needed.
 */
export function printIsolated(
  el: HTMLElement,
  opts?: { paperSize?: string | null; extraCss?: string; onAfter?: () => void },
): void {
  const ROOT_ID = "hp-print-root";
  const STYLE_ID = "hp-print-isolate";
  document.getElementById(ROOT_ID)?.remove();
  document.getElementById(STYLE_ID)?.remove();

  const clone = el.cloneNode(true) as HTMLElement;
  // Drop interactive / screen-only bits from the clone.
  clone.querySelectorAll(".no-print,[data-no-print],button,input,select,textarea")
    .forEach((n) => n.remove());

  const origId = el.id;
  if (origId) el.removeAttribute("id"); // keep id-scoped CSS pointing at the clone

  const wrapper = document.createElement("div");
  wrapper.id = ROOT_ID;
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.media = "print";
  style.appendChild(document.createTextNode(`
    ${opts?.paperSize ? getPrintStyles(opts.paperSize) : "@page { size: A4 portrait; margin: 10mm; }"}
    html, body {
      height: auto !important; min-height: 0 !important;
      max-height: none !important; overflow: visible !important;
      margin: 0 !important; padding: 0 !important; background: #fff !important;
    }
    body > *:not(#${ROOT_ID}) { display: none !important; }
    #${ROOT_ID} {
      display: block !important; position: static !important;
      width: 100% !important; max-width: none !important;
      margin: 0 !important; padding: 0 !important;
      overflow: visible !important;
    }
    #${ROOT_ID} > * {
      position: static !important; width: 100% !important; max-width: none !important;
      margin: 0 !important; box-shadow: none !important; border: none !important;
      overflow: visible !important;
    }
    /* Natural multi-page flow with clean breaks */
    #${ROOT_ID} table { page-break-inside: auto; break-inside: auto; }
    #${ROOT_ID} thead { display: table-header-group; }
    #${ROOT_ID} tfoot { display: table-footer-group; }
    #${ROOT_ID} tr, #${ROOT_ID} td, #${ROOT_ID} th {
      page-break-inside: avoid; break-inside: avoid;
    }
    #${ROOT_ID} .avoid-break, #${ROOT_ID} .totals-box,
    #${ROOT_ID} .payments-block, #${ROOT_ID} .signature-block {
      page-break-inside: avoid; break-inside: avoid;
    }
    #${ROOT_ID} * {
      -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;
    }
    ${opts?.extraCss ?? ""}
  `));
  document.head.appendChild(style);

  const cleanup = () => {
    window.removeEventListener("afterprint", cleanup);
    document.getElementById(ROOT_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    if (origId) el.id = origId;
    opts?.onAfter?.();
  };
  window.addEventListener("afterprint", cleanup);

  try {
    window.print();
  } finally {
    // Safari/Firefox may not fire afterprint reliably.
    setTimeout(cleanup, 2000);
  }
}