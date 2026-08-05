import { ReactNode, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Filter as FilterIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ResponsiveTable } from "@/components/ResponsiveTable";
import { useIsMobile } from "@/hooks/use-mobile";
import { ReportColumn, fmtINR } from "@/lib/reportExports";

type FilterValue =
  | { kind: "text"; text: string }
  | { kind: "number"; min: string; max: string }
  | { kind: "date"; from: string; to: string }
  | { kind: "enum"; selected: string[] };

type SortState = { key: string; dir: "asc" | "desc" } | null;

interface Props<T> {
  rows: T[];
  columns: ReportColumn<T>[];
  onDerivedRowsChange?: (rows: T[]) => void;
  /** Custom row renderer (defaults to standard cell mapping). */
  renderRow?: (row: T, index: number) => ReactNode;
  /** Extra key to force row remount / react key. Defaults to index. */
  rowKey?: (row: T, index: number) => string;
  totalsRow?: (derived: T[]) => ReactNode;
  emptyText?: string;
  /** Additional className on <table>. */
  className?: string;
  /** Stacked card layout on phones. "auto" (default) switches below 768px. */
  cardMode?: "auto" | "never";
}

function inferType<T>(c: ReportColumn<T>): NonNullable<ReportColumn<T>["type"]> {
  if (c.type) return c.type;
  if (c.currency || c.numeric) return "number";
  return "text";
}

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function compare(a: unknown, b: unknown): number {
  const aNil = a === null || a === undefined || a === "";
  const bNil = b === null || b === undefined || b === "";
  if (aNil && bNil) return 0;
  if (aNil) return 1;
  if (bNil) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  const na = Number(a), nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function ReportDataTable<T>({
  rows,
  columns,
  onDerivedRowsChange,
  renderRow,
  rowKey,
  totalsRow,
  emptyText = "No data",
  className,
  cardMode = "auto",
}: Props<T>) {
  const isMobile = useIsMobile();
  const mobileCards = cardMode === "auto" && isMobile;
  const [sort, setSort] = useState<SortState>(null);
  const [filters, setFilters] = useState<Record<string, FilterValue>>({});

  // Auto-derive enum options per column when not provided.
  const enumOptionsByKey = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const c of columns) {
      if (inferType(c) !== "enum") continue;
      if (c.enumOptions && c.enumOptions.length) { m[c.key] = c.enumOptions; continue; }
      const set = new Set<string>();
      for (const r of rows) {
        const v = c.get(r);
        const s = v == null ? "" : String(v);
        if (s) set.add(s);
      }
      m[c.key] = Array.from(set).sort();
    }
    return m;
  }, [columns, rows]);

  const derived = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => isFilterActive(v));
    let out = rows;
    if (active.length) {
      out = rows.filter((r) => active.every(([key, fv]) => {
        const col = columns.find((c) => c.key === key);
        if (!col) return true;
        return matchFilter(col, r, fv);
      }));
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        const dir = sort.dir === "asc" ? 1 : -1;
        const accessor = col.sortValue ?? col.get;
        out = [...out].sort((a, b) => dir * compare(accessor(a), accessor(b)));
      }
    }
    return out;
  }, [rows, filters, sort, columns]);

  useEffect(() => { onDerivedRowsChange?.(derived); }, [derived, onDerivedRowsChange]);

  const activeChips = useMemo(() => {
    const chips: Array<{ key: string; label: string }> = [];
    for (const [key, fv] of Object.entries(filters)) {
      if (!isFilterActive(fv)) continue;
      const col = columns.find((c) => c.key === key);
      if (!col) continue;
      chips.push({ key, label: `${col.header}: ${describeFilter(fv)}` });
    }
    return chips;
  }, [filters, columns]);

  function cycleSort(key: string) {
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: "asc" };
      if (s.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  function setFilter(key: string, val: FilterValue | null) {
    setFilters((prev) => {
      const next = { ...prev };
      if (!val || !isFilterActive(val)) delete next[key];
      else next[key] = val;
      return next;
    });
  }

  function clearAll() { setFilters({}); }

  return (
    <div className="space-y-2">
      {(activeChips.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 print:hidden">
          {activeChips.map((chip) => (
            <Badge key={chip.key} variant="secondary" className="gap-1 pl-2 pr-1 py-0.5">
              <span className="text-xs">{chip.label}</span>
              <button
                type="button"
                className="ml-1 rounded hover:bg-muted-foreground/10 p-0.5"
                onClick={() => setFilter(chip.key, null)}
                aria-label={`Clear ${chip.label}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={clearAll}>
            Clear all filters
          </Button>
        </div>
      )}
      {mobileCards && !renderRow ? (
        <div className="space-y-2 print:hidden">
          {derived.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
          )}
          {derived.map((r, i) => (
            <div key={rowKey ? rowKey(r, i) : i} className="rounded-lg border bg-card p-3 text-xs">
              {columns.map((c) => {
                const v = c.get(r);
                const shown = c.currency
                  ? (v === "" || v === null || v === undefined ? "" : fmtINR(v as number))
                  : v;
                return (
                  <div key={c.key} className="flex items-start justify-between gap-3 py-0.5">
                    <span className="text-muted-foreground">{c.header}</span>
                    <span className={cn("text-right font-medium", (c.currency || c.numeric) && "tabular-nums")}>
                      {shown}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
      <ResponsiveTable stickyFirstColumn>
        <table className={cn("w-full text-xs", className)}>
          <thead className="bg-muted/40">
            <tr>
              {columns.map((c) => {
                const t = inferType(c);
                const sortable = c.sortable !== false;
                const filterable = c.filterable !== false;
                const currentSort = sort && sort.key === c.key ? sort.dir : null;
                const filterVal = filters[c.key];
                const isFiltered = !!filterVal && isFilterActive(filterVal);
                return (
                  <th key={c.key} className={cn("px-2 py-2 whitespace-nowrap font-medium text-left", (c.currency || c.numeric) && "text-right")}>
                    <div className={cn("flex items-center gap-1 print:!gap-0", (c.currency || c.numeric) && "justify-end")}>
                      {sortable ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:text-foreground print:pointer-events-none"
                          onClick={() => cycleSort(c.key)}
                        >
                          <span>{c.header}</span>
                          {currentSort === "asc" && <ArrowUp className="h-3 w-3" />}
                          {currentSort === "desc" && <ArrowDown className="h-3 w-3" />}
                          {currentSort === null && <ArrowUpDown className="h-3 w-3 opacity-40" />}
                        </button>
                      ) : (
                        <span>{c.header}</span>
                      )}
                      {filterable && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className={cn(
                                "inline-flex items-center justify-center rounded p-0.5 print:hidden hover:bg-muted-foreground/10",
                                isFiltered ? "text-primary" : "text-muted-foreground/60"
                              )}
                              aria-label={`Filter ${c.header}`}
                            >
                              <FilterIcon className={cn("h-3 w-3", isFiltered && "fill-current")} />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-64 p-3" align="start">
                            <FilterEditor
                              type={t}
                              value={filterVal}
                              enumOptions={enumOptionsByKey[c.key] ?? []}
                              onChange={(v) => setFilter(c.key, v)}
                            />
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {derived.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="text-center py-6 text-muted-foreground">{emptyText}</td>
              </tr>
            )}
            {derived.map((r, i) => renderRow ? renderRow(r, i) : (
              <tr key={rowKey ? rowKey(r, i) : i} className="border-t">
                {columns.map((c) => {
                  const v = c.get(r);
                  return (
                    <td key={c.key} className={cn("px-2 py-1.5", (c.currency || c.numeric) && "text-right tabular-nums")}>
                      {c.currency ? (v === "" || v === null || v === undefined ? "" : fmtINR(v as number)) : v}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {totalsRow && derived.length > 0 && (
            <tfoot className="bg-emerald-50 font-semibold">{totalsRow(derived)}</tfoot>
          )}
        </table>
      </ResponsiveTable>
      )}
    </div>
  );
}

function isFilterActive(v: FilterValue): boolean {
  if (v.kind === "text") return v.text.trim() !== "";
  if (v.kind === "number") return v.min !== "" || v.max !== "";
  if (v.kind === "date") return v.from !== "" || v.to !== "";
  if (v.kind === "enum") return v.selected.length > 0;
  return false;
}

function describeFilter(v: FilterValue): string {
  if (v.kind === "text") return `"${v.text}"`;
  if (v.kind === "number") {
    if (v.min && v.max) return `${v.min}–${v.max}`;
    if (v.min) return `≥ ${v.min}`;
    if (v.max) return `≤ ${v.max}`;
    return "";
  }
  if (v.kind === "date") {
    if (v.from && v.to) return `${v.from} → ${v.to}`;
    if (v.from) return `from ${v.from}`;
    if (v.to) return `until ${v.to}`;
    return "";
  }
  if (v.kind === "enum") return v.selected.join(", ");
  return "";
}

function matchFilter<T>(col: ReportColumn<T>, row: T, v: FilterValue): boolean {
  const raw = col.get(row);
  if (v.kind === "text") {
    const needle = v.text.trim().toLowerCase();
    if (!needle) return true;
    return String(raw ?? "").toLowerCase().includes(needle);
  }
  if (v.kind === "number") {
    const n = toNumber(col.sortValue ? col.sortValue(row) : raw);
    if (n === null) return false;
    const min = v.min !== "" ? Number(v.min) : null;
    const max = v.max !== "" ? Number(v.max) : null;
    if (min !== null && n < min) return false;
    if (max !== null && n > max) return false;
    return true;
  }
  if (v.kind === "date") {
    const d = toDate(col.dateValue ? col.dateValue(row) : (col.sortValue ? col.sortValue(row) : raw));
    if (!d) return false;
    if (v.from) {
      const df = new Date(`${v.from}T00:00:00`);
      if (d < df) return false;
    }
    if (v.to) {
      const dt = new Date(`${v.to}T23:59:59`);
      if (d > dt) return false;
    }
    return true;
  }
  if (v.kind === "enum") {
    if (v.selected.length === 0) return true;
    return v.selected.includes(String(raw ?? ""));
  }
  return true;
}

function FilterEditor({
  type, value, enumOptions, onChange,
}: {
  type: NonNullable<ReportColumn<unknown>["type"]>;
  value: FilterValue | undefined;
  enumOptions: string[];
  onChange: (v: FilterValue | null) => void;
}) {
  if (type === "text") {
    const v = value?.kind === "text" ? value : { kind: "text" as const, text: "" };
    return (
      <div className="space-y-2">
        <div className="text-xs font-medium">Contains</div>
        <Input autoFocus value={v.text} onChange={(e) => onChange({ kind: "text", text: e.target.value })} placeholder="Search..." />
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Clear</Button>
        </div>
      </div>
    );
  }
  if (type === "number") {
    const v = value?.kind === "number" ? value : { kind: "number" as const, min: "", max: "" };
    return (
      <div className="space-y-2">
        <div className="text-xs font-medium">Range</div>
        <div className="flex items-center gap-2">
          <Input type="number" value={v.min} placeholder="Min" onChange={(e) => onChange({ kind: "number", min: e.target.value, max: v.max })} />
          <span className="text-muted-foreground text-xs">to</span>
          <Input type="number" value={v.max} placeholder="Max" onChange={(e) => onChange({ kind: "number", min: v.min, max: e.target.value })} />
        </div>
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Clear</Button>
        </div>
      </div>
    );
  }
  if (type === "date") {
    const v = value?.kind === "date" ? value : { kind: "date" as const, from: "", to: "" };
    return (
      <div className="space-y-2">
        <div className="text-xs font-medium">Date range</div>
        <div className="space-y-1.5">
          <Input type="date" value={v.from} onChange={(e) => onChange({ kind: "date", from: e.target.value, to: v.to })} />
          <Input type="date" value={v.to} onChange={(e) => onChange({ kind: "date", from: v.from, to: e.target.value })} />
        </div>
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Clear</Button>
        </div>
      </div>
    );
  }
  // enum
  const v = value?.kind === "enum" ? value : { kind: "enum" as const, selected: [] };
  function toggle(opt: string, checked: boolean) {
    const next = checked ? [...v.selected, opt] : v.selected.filter((s) => s !== opt);
    onChange({ kind: "enum", selected: next });
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium">Include</div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs"
            onClick={() => onChange({ kind: "enum", selected: [...enumOptions] })}>All</Button>
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={() => onChange(null)}>None</Button>
        </div>
      </div>
      <div className="max-h-56 overflow-y-auto space-y-1">
        {enumOptions.length === 0 && <div className="text-xs text-muted-foreground">No options</div>}
        {enumOptions.map((opt) => {
          const checked = v.selected.includes(opt);
          return (
            <label key={opt} className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox checked={checked} onCheckedChange={(c) => toggle(opt, !!c)} />
              <span className="truncate">{opt || "(empty)"}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}