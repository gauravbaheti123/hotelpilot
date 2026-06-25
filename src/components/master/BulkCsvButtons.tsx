import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, Upload, FileSpreadsheet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface CsvColumn {
  /** CSV header name (case-insensitive on import) */
  header: string;
  /** Database column name (omit if it's a virtual lookup column resolved by transformRow) */
  field?: string;
  required?: boolean;
  /** Convert raw string to typed value. Default: trim string. */
  parse?: (raw: string) => unknown;
  /** Convert DB value back to CSV-safe string for export */
  format?: (val: unknown, row: Record<string, unknown>) => string;
}

export interface BulkCsvButtonsProps {
  table: string;
  propertyId: string;
  /** Used to build filename: <module>-<hotel>-<date>.csv */
  module: string;
  hotelName: string;
  columns: CsvColumn[];
  /** Extra fields to set on every imported row (e.g. property_id) */
  extraDefaults?: Record<string, unknown>;
  /** Optional hook to map virtual columns (e.g. category_name -> category_id). Throw to reject the row. */
  transformRow?: (row: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
  /** Optional extra filters for the export query. */
  exportFilter?: Record<string, unknown>;
  onImported?: () => void;
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = false;
      } else cur += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cur);
        if (row.some((cell) => cell.trim() !== "")) rows.push(row);
        row = [];
        cur = "";
      } else cur += c;
    }
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  }
  return rows;
}

function downloadFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function BulkCsvButtons(props: BulkCsvButtonsProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [rowErrors, setRowErrors] = useState<(string | null)[]>([]);
  const [importing, setImporting] = useState(false);

  const dateStr = new Date().toISOString().slice(0, 10);
  const baseName = `${slug(props.module)}-${slug(props.hotelName)}-${dateStr}`;

  function downloadSample() {
    const header = props.columns.map((c) => csvEscape(c.header)).join(",");
    const sample = props.columns.map(() => "").join(",");
    downloadFile(`${baseName}-sample.csv`, `${header}\n${sample}\n`);
  }

  async function doExport() {
    let q = supabase.from(props.table as any).select("*").eq("property_id", props.propertyId);
    if (props.exportFilter) {
      for (const [k, v] of Object.entries(props.exportFilter)) q = q.eq(k, v);
    }
    const { data, error } = await q;
    if (error) return toast.error(error.message);
    const lines = [props.columns.map((c) => csvEscape(c.header)).join(",")];
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const cells = props.columns.map((c) => {
        const raw = c.field ? row[c.field] : "";
        const formatted = c.format ? c.format(raw, row) : raw == null ? "" : String(raw);
        return csvEscape(formatted);
      });
      lines.push(cells.join(","));
    }
    downloadFile(`${baseName}.csv`, lines.join("\n") + "\n");
    toast.success(`Exported ${(data ?? []).length} rows`);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    if (fileRef.current) fileRef.current.value = "";
    const rows = parseCsv(text);
    if (rows.length < 2) return toast.error("CSV must have a header row and at least one data row");
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const colIndex = new Map<string, number>();
    for (const col of props.columns) {
      const idx = header.indexOf(col.header.toLowerCase());
      if (idx >= 0) colIndex.set(col.header, idx);
      else if (col.required) return toast.error(`Missing required column: ${col.header}`);
    }
    const parsed: Record<string, string>[] = [];
    const errors: (string | null)[] = [];
    for (let r = 1; r < rows.length; r++) {
      const obj: Record<string, string> = {};
      let rowErr: string | null = null;
      for (const col of props.columns) {
        const idx = colIndex.get(col.header);
        const raw = idx == null ? "" : (rows[r][idx] ?? "").trim();
        obj[col.header] = raw;
        if (col.required && !raw) rowErr = `Missing ${col.header}`;
      }
      parsed.push(obj);
      errors.push(rowErr);
    }
    setParsedRows(parsed);
    setRowErrors(errors);
    setPreviewOpen(true);
  }

  async function doImport() {
    setImporting(true);
    let okCount = 0;
    let failCount = 0;
    const failures: string[] = [];
    for (let i = 0; i < parsedRows.length; i++) {
      if (rowErrors[i]) { failCount++; failures.push(`Row ${i + 2}: ${rowErrors[i]}`); continue; }
      try {
        const raw = parsedRows[i];
        const payload: Record<string, unknown> = { ...(props.extraDefaults ?? {}) };
        for (const col of props.columns) {
          if (!col.field) continue;
          const v = raw[col.header];
          payload[col.field] = col.parse ? col.parse(v) : (v === "" ? null : v);
        }
        // Carry virtual columns into transformRow as well
        const merged: Record<string, unknown> = { ...payload, __raw: raw };
        for (const k of Object.keys(raw)) {
          if (!props.columns.find((c) => c.header === k && c.field)) merged[k] = raw[k];
        }
        const finalPayload = props.transformRow
          ? await props.transformRow(merged)
          : payload;
        delete (finalPayload as Record<string, unknown>).__raw;
        const { error } = await supabase.from(props.table as any).insert(finalPayload as any);
        if (error) throw error;
        okCount++;
      } catch (e: any) {
        failCount++;
        failures.push(`Row ${i + 2}: ${e?.message ?? "insert failed"}`);
      }
    }
    setImporting(false);
    setPreviewOpen(false);
    setParsedRows([]);
    setRowErrors([]);
    if (failCount === 0) toast.success(`${okCount} records imported`);
    else toast.error(`${okCount} imported, ${failCount} failed. ${failures.slice(0, 3).join(" · ")}`);
    props.onImported?.();
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={onFile}
      />
      <Button size="sm" variant="outline" onClick={downloadSample}>
        <FileSpreadsheet className="h-3.5 w-3.5 mr-1" /> Sample CSV
      </Button>
      <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
        <Upload className="h-3.5 w-3.5 mr-1" /> Import
      </Button>
      <Button size="sm" variant="outline" onClick={doExport}>
        <Download className="h-3.5 w-3.5 mr-1" /> Export
      </Button>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Preview import — {parsedRows.length} rows</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto border rounded">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  {props.columns.map((c) => (
                    <TableHead key={c.header}>{c.header}</TableHead>
                  ))}
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsedRows.map((row, i) => (
                  <TableRow key={i} className={rowErrors[i] ? "bg-rose-500/10" : ""}>
                    <TableCell className="text-xs text-muted-foreground">{i + 2}</TableCell>
                    {props.columns.map((c) => (
                      <TableCell key={c.header} className="text-xs">{row[c.header]}</TableCell>
                    ))}
                    <TableCell className="text-xs">
                      {rowErrors[i]
                        ? <span className="text-rose-700 dark:text-rose-300">{rowErrors[i]}</span>
                        : <span className="text-emerald-700 dark:text-emerald-300">OK</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>Cancel</Button>
            <Button onClick={doImport} disabled={importing}>
              {importing ? "Importing…" : `Import ${parsedRows.filter((_, i) => !rowErrors[i]).length} rows`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}