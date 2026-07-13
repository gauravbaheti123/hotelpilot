// Helpers that adapt DOM-based print flows (folio bill, banquet bill, GRC)
// to QZ Tray silent printing, with a graceful fallback to the existing
// browser window.print() path.
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { isQZConnected, connectQZ, printToPrinter } from "./qzPrint";
import { getPrintStyles } from "./printStyles";

function collectStyles(): string {
  const parts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = (sheet as CSSStyleSheet).cssRules;
      if (!rules) continue;
      for (const r of Array.from(rules)) parts.push(r.cssText);
    } catch {
      // Cross-origin sheet — include as <link> ref instead.
      const href = (sheet as CSSStyleSheet).href;
      if (href) parts.push(`@import url("${href}");`);
    }
  }
  return parts.join("\n");
}

export function buildStandalonePrintHtml(
  elementId: string,
  paperSize: string,
  title = "Print",
): string | null {
  const el = document.getElementById(elementId);
  if (!el) return null;
  const inlineCss = collectStyles();
  const pageCss = getPrintStyles(paperSize);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>${pageCss}
html,body{margin:0;padding:0;background:#fff;}
${inlineCss}
</style></head><body>${el.outerHTML}</body></html>`;
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