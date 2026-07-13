import { getPrintStyles } from "./printStyles";

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
  return `<html><head><title>${esc(header.kot_number)}</title>
<style>${getPrintStyles(paperSize)}
body{font:12px monospace;padding:8px}
h2{margin:0 0 4px;font-size:14px}
.badge{display:inline-block;padding:2px 6px;border:1px solid #000;font-weight:bold;margin-bottom:4px;font-size:11px;letter-spacing:0.5px}
hr{border:none;border-top:1px dashed #999;margin:6px 0}
.row{display:flex;justify-content:space-between}
.dest{font-size:10px;color:#555;margin-bottom:2px}
</style></head><body>
<div class="badge">${esc(badge)}</div>
<h2>KOT ${esc(header.kot_number)}</h2>
<div class="dest">→ ${esc(printerName)}</div>
<div>${esc(header.created_at ? new Date(header.created_at).toLocaleString() : new Date().toLocaleString())}</div>
<div>${header.kot_type === "room" ? `Room ${esc(header.room_number ?? "—")}` : `Table ${esc(header.table_no ?? "—")}`}</div>
${header.guest_name ? `<div>Guest: ${esc(header.guest_name)}</div>` : ""}
<hr/>
${items
  .map(
    (i) =>
      `<div class="row"><span>${i.qty} × ${esc(i.item_name)}</span><span>₹${(i.qty * i.rate).toFixed(0)}</span></div>${
        i.notes ? `<div style="padding-left:8px;color:#555">- ${esc(i.notes)}</div>` : ""
      }`,
  )
  .join("")}
<hr/>
<div class="row"><span>Total</span><span>₹${total.toFixed(2)}</span></div>
${header.notes ? `<div><em>${esc(header.notes)}</em></div>` : ""}
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
  for (const job of jobs) {
    const html = renderKotHtml(
      header,
      job.items,
      job.printer.paper_size ?? "80mm",
      job.badge,
      job.printer.name,
    );
    const w = window.open("", "_blank", "width=380,height=640");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    await new Promise((r) => setTimeout(r, 250));
    try {
      w.print();
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }, 800);
    await new Promise((r) => setTimeout(r, 400));
  }
}