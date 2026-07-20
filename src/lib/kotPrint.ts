import { getPrintStyles, getPrintContainerStyle, getPrintSafetyCss } from "./printStyles";
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

function renderKotHtml(
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
.itemnote{font-size:12px;font-weight:600;padding-left:10px;margin-top:-2px;margin-bottom:4px}
.total{display:flex;justify-content:space-between;font-size:18px;font-weight:800;margin-top:4px}
.ordernote{font-size:12px;font-weight:600;margin-top:6px}
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
      }</div>${i.notes ? `<div class="itemnote">- ${esc(i.notes)}</div>` : ""}`,
  )
  .join("")}
${showPrice ? `<hr class="divider"/><div class="total"><span>TOTAL</span><span>₹${total.toFixed(2)}</span></div>` : ""}
${header.notes ? `<div class="ordernote">Note: ${esc(header.notes)}</div>` : ""}
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
    // Remove any leftover parent-doc print stylesheet (e.g. hp-dynamic-print
    // from A4 flows) so it can't cascade onto the print dialog if the browser
    // falls back to the top-level document's page rules.
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
    // Use srcdoc so the iframe has its own isolated document with our @page
    // rules — document.write() into an about:blank iframe can inherit quirks
    // and, in some browsers, the parent's print page settings.
    iframe.srcdoc = html;
    document.body.appendChild(iframe);
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      iframe.addEventListener("load", done, { once: true });
      setTimeout(done, 800);
    });
    // Extra beat for layout after load.
    await new Promise((r) => setTimeout(r, 100));
    const win = iframe.contentWindow;
    if (!win) {
      iframe.remove();
      continue;
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
        // Fallback timeout in case afterprint never fires (some drivers/browsers).
        setTimeout(finish, 1500);
        try {
          win.focus();
          win.print();
        } catch (err) {
          console.error("[kotPrint] print() failed", err);
          finish();
        }
      });
    } finally {
      setTimeout(() => iframe.remove(), 200);
    }
    // Small gap between successive dialogs.
    await new Promise((r) => setTimeout(r, 300));
  }
}