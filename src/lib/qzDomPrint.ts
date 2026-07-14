// Helpers that adapt DOM-based print flows (folio bill, banquet bill, GRC)
// to QZ Tray silent printing, with a graceful fallback to the existing
// browser window.print() path.
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { isQZConnected, connectQZ, printToPrinter } from "./qzPrint";
import { getPrintStyles } from "./printStyles";

// Properties to copy from computedStyle onto each cloned node as inline styles.
// This snapshots the app's Tailwind/theme resolution into self-contained HTML
// that QZ Tray can render without access to the app's stylesheets.
const STYLE_PROPS: string[] = [
  "box-sizing",
  "display", "position", "top", "left", "right", "bottom", "z-index",
  "flex", "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis",
  "justify-content", "align-items", "align-self", "gap", "row-gap", "column-gap",
  "grid-template-columns", "grid-template-rows", "grid-column", "grid-row",
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border", "border-top", "border-right", "border-bottom", "border-left",
  "border-width", "border-style", "border-color", "border-radius",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "font-family", "font-size", "font-weight", "font-style", "line-height",
  "letter-spacing", "text-align", "text-decoration", "text-transform",
  "white-space", "vertical-align", "word-break", "overflow-wrap",
  "color", "background", "background-color", "background-image",
  "opacity", "visibility", "overflow", "object-fit",
  "table-layout", "border-collapse", "border-spacing",
  "list-style", "list-style-type",
];

function inlineComputedStyles(source: HTMLElement, target: HTMLElement) {
  const srcNodes = [source, ...Array.from(source.querySelectorAll<HTMLElement>("*"))];
  const tgtNodes = [target, ...Array.from(target.querySelectorAll<HTMLElement>("*"))];
  const len = Math.min(srcNodes.length, tgtNodes.length);
  for (let i = 0; i < len; i++) {
    const s = srcNodes[i];
    const t = tgtNodes[i];
    if (!s || !t) continue;
    const cs = window.getComputedStyle(s);
    let style = "";
    for (const prop of STYLE_PROPS) {
      const val = cs.getPropertyValue(prop);
      if (val && val !== "normal" && val !== "auto" && val !== "none") {
        style += `${prop}:${val};`;
      }
    }
    if (style) t.setAttribute("style", (t.getAttribute("style") ?? "") + style);
    t.removeAttribute("class");
  }
}

export function buildStandalonePrintHtml(
  elementId: string,
  paperSize: string,
  title = "Print",
): string | null {
  const el = document.getElementById(elementId);
  if (!el) return null;
  const clone = el.cloneNode(true) as HTMLElement;
  // Snapshot computed styles FIRST so source/clone trees still align.
  inlineComputedStyles(el, clone);
  // Then structurally remove any node intended to be excluded from print
  // (Tailwind `print:hidden`, legacy `no-print`, `data-no-print`, and any
  // interactive form controls). Media-query utilities do not apply inside
  // QZ's standalone print document, so these must be dropped from the DOM.
  clone.querySelectorAll("*").forEach((n) => {
    const cls = (n as HTMLElement).className;
    const classStr = typeof cls === "string" ? cls : (cls as any)?.baseVal ?? "";
    if (classStr.split(/\s+/).includes("print:hidden")) n.remove();
  });
  ["[data-no-print]", ".no-print", "button", "input", "textarea", "select"].forEach((sel) => {
    clone.querySelectorAll(sel).forEach((n) => n.remove());
  });
  const pageCss = getPrintStyles(paperSize);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>${pageCss}
html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif;}
img{max-width:100%;}
</style></head><body>${clone.outerHTML}</body></html>`;
}

/**
 * Fetch the property's bill printer (type='bill' or 'both'). Returns
 * { name, paper_size } or null if none configured.
 */
export async function fetchBillPrinter(
  propertyId: string | null | undefined,
): Promise<{ name: string; paper_size: string } | null> {
  if (!propertyId) return null;
  const { data } = await supabase
    .from("printers")
    .select("name,paper_size,type,is_default,is_active")
    .eq("property_id", propertyId)
    .eq("is_active", true)
    .in("type", ["bill", "both"])
    .order("is_default", { ascending: false })
    .limit(1);
  const row = (data as any[] | null)?.[0];
  if (!row) return null;
  return { name: row.name as string, paper_size: (row.paper_size as string) ?? "A4" };
}

/**
 * Try QZ Tray silent print for an on-page printable region. If QZ is not
 * connected or the print fails, run the provided fallback (typically the
 * existing withPrintStyles + window.print() call).
 *
 * Returns true if QZ handled the print, false if it fell back.
 */
export async function printDomViaQZ(opts: {
  elementId: string;
  propertyId: string | null | undefined;
  paperSizeOverride?: string;
  title?: string;
  fallback: () => void;
}): Promise<boolean> {
  const printer = await fetchBillPrinter(opts.propertyId);
  const paperSize = opts.paperSizeOverride ?? printer?.paper_size ?? "A4";

  if (!isQZConnected()) {
    const st = await connectQZ();
    if (!st.connected) {
      toast.info("Printer service (QZ Tray) not connected. Falling back to browser print dialog.");
      opts.fallback();
      return false;
    }
  }
  if (!printer) {
    toast.warning("No bill printer configured. Falling back to browser print dialog.");
    opts.fallback();
    return false;
  }
  const html = buildStandalonePrintHtml(opts.elementId, paperSize, opts.title);
  if (!html) {
    toast.warning("Print area not found on page. Falling back to browser print dialog.");
    opts.fallback();
    return false;
  }
  try {
    toast.info(`Printing to: ${printer.name}`);
    await printToPrinter(printer.name, html, paperSize);
    return true;
  } catch (err: any) {
    console.error("[qz] silent print failed, falling back", err);
    toast.error(`Silent print failed: ${err?.message ?? err}. Falling back to browser dialog.`);
    opts.fallback();
    return false;
  }
}