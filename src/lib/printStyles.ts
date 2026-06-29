import { supabase } from "@/integrations/supabase/client";

export type PaperSize = "58mm" | "80mm" | "A4";

export function getPrintStyles(paperSize: string | null | undefined): string {
  const size = (paperSize ?? "80mm") as PaperSize;
  if (size === "A4") {
    return `@page { size: A4; margin: 10mm; }`;
  }
  return `@page { size: ${size} auto; margin: 3mm; }
          body { width: ${size}; font-size: 11px; }`;
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