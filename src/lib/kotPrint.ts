import {
  getPrintStyles,
  getPrintContainerStyle,
  getPrintSafetyCss,
  getThermalFeedCss,
  THERMAL_FEED_HTML,
} from "./printStyles";
import { isQZConnected, connectQZ, printToPrinter } from "./qzPrint";
import { toast } from "sonner";

export type PrinterInfo = {
  id: string;
  name: string;
  paper_size: string | null;
  printer_role?: string | null;
};

export type KotItemForPrint = {
  item_name: string;
  qty: number;
  rate: number;
  notes?: string | null;
  printer_id: string | null;
};

export type KotHeader = {
  kot_number: string;
  kot_type: string;
  table_no?: string | null;
  room_number?: string | null;
  guest_name?: string | null;
  notes?: string | null;
  created_at?: string;
};

export type PrintJob = {
  printer: PrinterInfo;
  items: KotItemForPrint[];
  badge: string;
};

export type PrintMode = "kitchen+counter" | "kitchen" | "counter";

function esc(s: unknown) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderKotHtml(
  header: KotHeader,
  items: KotItemForPrint[],
  paperSize: string,
  badge: string,
  printerName: string,
): string {
  const total = items.reduce((s, i) => s + i.qty * i.rate, 0);
  const pageCss = getPrintStyles(paperSize);
  const containerCss = getPrintContainerStyle(paperSize);
  const safetyCss = getPrintSafetyCss(".print-container");
  const isCounter = badge === "COUNTER COPY";
  const showPrice = isCounter;
  const stationName = (printerName || "").toUpperCase();
  const when = header.created_at ? new Date(header.created_at) : new Date();
  const dateStr = when.toLocaleDateString();
  const timeStr = when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const tableLabel =
    header.kot_type === "room"
      ? `Room ${esc(header.room_number ?? "—")}`
      : esc(header.table_no ?? "—");

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(header.kot_number)}</title>
<style>
${pageCss}
@media print {
  html, body { width: ${paperSize}; min-height: 0 !important; height: auto !important; }
}
html,body{margin:0;padding:0;height:auto;min-height:0;width:${paperSize};color:#000}
body{font-family: 'Arial Black', Arial, Helvetica, sans-serif; font-size:15px; font-weight:700; padding:0; box-sizing:border-box; line-height:1.35}
.print-container{${containerCss}padding:2mm 0;}
${safetyCss}
.badge{display:block;text-align:center;border:2px solid #000;padding:4px 6px;font-weight:800;font-size:15px;letter-spacing:1px;margin-bottom:6px}
.station{text-align:center;font-size:20px;font-weight:800;letter-spacing:1px;margin:2px 0 4px}
.divider{border:none;border-top:2px dashed #000;margin:6px 0}
.info{font-size:15px;font-weight:700;margin:2px 0;display:flex}
.info .lbl{min-width:70px;font-weight:800}
.item{display:flex;justify-content:space-between;align-items:flex-start;font-size:17px;font-weight:800;margin:5px 0;gap:8px}
.item .n{flex:1;word-break:break-word}
.item .p{white-space:nowrap}
.itemnote{font-size:13px;font-weight:800;border:2px solid #000;padding:2px 5px;margin:0 0 6px 10px;text-transform:uppercase;word-break:break-word}
.itemnote .lbl{font-size:11px;letter-spacing:1px;margin-right:4px}
.total{display:flex;justify-content:space-between;font-size:18px;font-weight:800;margin-top:4px}
.ordernote{font-size:15px;font-weight:800;margin-top:8px;border:2px solid #000;padding:4px 6px;text-transform:uppercase;word-break:break-word}
.ordernote .lbl{display:block;font-size:12px;letter-spacing:1px}
${getThermalFeedCss()}
</style></head><body>
<div class="print-container">
${isCounter ? `<div class="badge">COUNTER COPY</div>` : ""}
<div class="station">${esc(stationName)}</div>
<hr class="divider"/>
<div class="info"><span class="lbl">Table:</span><span>${tableLabel}</span></div>
<div class="info"><span class="lbl">KOT No:</span><span>${esc(header.kot_number)}</span></div>
<div class="info"><span class="lbl">Date/Time:</span><span>${esc(dateStr)} ${esc(timeStr)}</span></div>
${header.guest_name ? `<div class="info"><span class="lbl">Guest:</span><span>${esc(header.guest_name)}</span></div>` : ""}
<hr class="divider"/>
${items
  .map(
    (i) =>
      `<div class="item"><span class="n">${i.qty} x ${esc(i.item_name)}</span>${
        showPrice ? `<span class="p">₹${(i.qty * i.rate).toFixed(0)}</span>` : ""
      }</div>${i.notes ? `<div class="itemnote"><span class="lbl">**</span>${esc(i.notes)}</div>` : ""}`,
  )
  .join("")}
${showPrice ? `<hr class="divider"/><div class="total"><span>TOTAL</span><span>₹${total.toFixed(2)}</span></div>` : ""}
${header.notes ? `<div class="ordernote"><span class="lbl">** INSTRUCTIONS **</span>${esc(header.notes)}</div>` : ""}
${THERMAL_FEED_HTML}
</div>
</body></html>`;
}

export function buildKotPrintPlan(
  items: KotItemForPrint[],
  printers: PrinterInfo[],
  counterPrinter: PrinterInfo | null,
  mode: PrintMode = "kitchen+counter",
): { jobs: PrintJob[]; warnings: string[] } {
  const jobs: PrintJob[] = [];
  const warnings: string[] = [];

  if (mode !== "counter") {
    const byPrinter = new Map<string, KotItemForPrint[]>();
    let unresolved = 0;
    for (const it of items) {
      if (!it.printer_id) {
        unresolved++;
        continue;
      }
      const arr = byPrinter.get(it.printer_id) ?? [];
      arr.push(it);
      byPrinter.set(it.printer_id, arr);
    }
    if (unresolved > 0) {
      warnings.push(
        `No kitchen printer configured for ${unresolved} item(s). Set up in Master Data → Printers.`,
      );
    }
    for (const [pid, its] of byPrinter) {
      const p = printers.find((x) => x.id === pid);
      if (!p) {
        warnings.push(`Kitchen printer not found for ${its.length} item(s).`);
        continue;
      }
      jobs.push({ printer: p, items: its, badge: "KITCHEN COPY" });
    }
  }

  if (mode !== "kitchen") {
    if (!counterPrinter) {
      warnings.push("No Counter Copy printer configured. Set up in Master Data → Printers.");
    } else if (items.length > 0) {
      jobs.push({ printer: counterPrinter, items, badge: "COUNTER COPY" });
    }
  }

  return { jobs, warnings };
}

/**
 * Fallback path: render HTML in an isolated hidden iframe and call print().
 * Used only when QZ Tray isn't reachable — QZ is the default for thermal.
 */
export async function printHtmlViaIframe(html: string): Promise<void> {
  // Remove any leftover parent-doc print stylesheet (e.g. hp-dynamic-print
  // from A4 flows) so it can't cascade onto the print dialog.
  document.getElementById("hp-dynamic-print")?.remove();
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  // Give iframe a real (but off-screen) size — a 0×0 iframe can make some
  // browsers skip layout entirely and fall back to the parent's page size.
  iframe.style.width = "80mm";
  iframe.style.height = "200mm";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  // srcdoc gives the iframe its own isolated document with our @page rules.
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    iframe.addEventListener("load", done, { once: true });
    setTimeout(done, 800);
  });
  await new Promise((r) => setTimeout(r, 100));
  const win = iframe.contentWindow;
  if (!win) {
    iframe.remove();
    return;
  }
  try {
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      try {
        win.addEventListener("afterprint", finish, { once: true });
      } catch {
        /* ignore */
      }
      setTimeout(finish, 1500);
      try {
        win.focus();
        win.print();
      } catch (err) {
        console.error("[print] print() failed", err);
        finish();
      }
    });
  } finally {
    setTimeout(() => iframe.remove(), 200);
  }
  await new Promise((r) => setTimeout(r, 300));
}

/**
 * Silently send a thermal document to a named printer via QZ Tray.
 * Surfaces a clear error toast (and falls back to the browser dialog) when
 * QZ isn't connected or the printer name can't be resolved.
 */
export async function printThermalHtml(args: {
  printerName: string | null;
  html: string;
  paperSize?: string | null;
  label?: string;
}): Promise<void> {
  const paperSize = args.paperSize ?? "80mm";
  const what = args.label ?? "Print";
  if (!args.printerName) {
    toast.warning(`${what}: no printer assigned. Set one in Master Data → Printers.`);
    await printHtmlViaIframe(args.html);
    return;
  }
  let qzOk = isQZConnected();
  if (!qzOk) {
    const st = await connectQZ();
    qzOk = st.connected;
  }
  if (qzOk) {
    try {
      await printToPrinter(args.printerName, args.html, paperSize);
      return;
    } catch (err: any) {
      console.error("[print/qz] failed", err);
      toast.error(`Printer "${args.printerName}" unreachable: ${err?.message ?? err}`);
    }
  } else {
    toast.warning("Printer service (QZ Tray) not connected — using browser print dialog.");
  }
  await printHtmlViaIframe(args.html);
}

export async function runKotPrintJobs(header: KotHeader, jobs: PrintJob[]): Promise<void> {
  // Preferred path: silent print via QZ Tray. Falls back to hidden-iframe
  // window.print() if the agent isn't running or a job fails.
  let qzOk = isQZConnected();
  if (!qzOk) {
    const st = await connectQZ();
    qzOk = st.connected;
    if (!qzOk) {
      toast.info("Printer service (QZ Tray) not connected. Falling back to browser print dialog.");
    }
  }
  if (qzOk) {
    let anyFailed = false;
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const paperSize = job.printer.paper_size ?? "80mm";
      const html = renderKotHtml(header, job.items, paperSize, job.badge, job.printer.name);
      try {
        console.log(`[kotPrint/qz] ${i + 1}/${jobs.length} → ${job.printer.name} (${job.badge})`);
        await printToPrinter(job.printer.name, html, paperSize);
      } catch (err: any) {
        console.error("[kotPrint/qz] failed", err);
        toast.error(`QZ print failed for ${job.printer.name}: ${err?.message ?? err}`);
        anyFailed = true;
        break;
      }
    }
    if (!anyFailed) return;
    toast.info("Falling back to browser print dialog for remaining jobs.");
  }

  // Use hidden iframes rather than window.open(): popup blockers silently kill
  // window.open calls that follow an awaited async operation (e.g. Supabase
  // insert), and browsers typically allow only one popup per user gesture, so
  // sequential popups collapse into a single dialog. Iframes bypass both.
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    console.log(`[kotPrint] job ${i + 1}/${jobs.length} → ${job.printer.name} (${job.badge})`, {
      items: job.items.length,
      paper_size: job.printer.paper_size,
    });
    const html = renderKotHtml(
      header,
      job.items,
      job.printer.paper_size ?? "80mm",
      job.badge,
      job.printer.name,
    );
    await printHtmlViaIframe(html);
  }
}