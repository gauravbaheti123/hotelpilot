import { useEffect, useState, ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import { toastError } from "@/lib/errorMessage";

export type FieldType =
  | "text"
  | "number"
  | "textarea"
  | "switch"
  | "select"
  | "date";

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: { value: string; label: string }[];
  defaultValue?: any;
  colSpan?: 1 | 2;
  /** Opt-in Title Casing on blur (name/address-type fields only). */
  titleCase?: boolean;
}

export interface ColumnDef<T> {
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

export interface CrudPageProps<T extends { id: string }> {
  title: string;
  subtitle?: string;
  table: string;
  fields: FieldDef[];
  columns: ColumnDef<T>[];
  orderBy?: { column: string; ascending?: boolean };
  initialNew?: Record<string, any>;
  filterEq?: Record<string, any>;
  headerActions?: ReactNode;
  /** Optional contained management/configuration section between the page header and data list. */
  contentAfterHeader?: ReactNode;
  /** Row fields searched by the toolbar search box (defaults to all string values). */
  searchFields?: string[];
  /** Optional data-quality flag: return a reason string to mark a row as suspicious. */
  flagRow?: (row: T) => string | null;
  /**
   * Optional pre-save hook. Return a string to abort with an error toast,
   * or null/undefined to proceed. `editing` includes an `id` when updating.
   */
  validate?: (payload: Record<string, any>, rows: T[]) => Promise<string | null | undefined> | string | null | undefined;
}

export function CrudPage<T extends { id: string }>({
  title,
  subtitle,
  table,
  fields,
  columns,
  orderBy,
  initialNew,
  filterEq,
  headerActions,
  contentAfterHeader,
  searchFields,
  flagRow,
  validate,
}: CrudPageProps<T>) {
  const { roles } = useAuth();
  const canManage =
    roles.includes("superadmin") ||
    roles.includes("owner") ||
    roles.includes("manager");
  const { current, loading: propLoading } = useCurrentProperty();
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, any> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  const flaggedCount = flagRow ? rows.filter((r) => flagRow(r)).length : 0;

  const visibleRows = rows.filter((r) => {
    if (flaggedOnly && flagRow && !flagRow(r)) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const src = searchFields
      ? searchFields.map((k) => (r as any)[k])
      : Object.values(r as any);
    return src.some((v) => typeof v === "string" && v.toLowerCase().includes(q));
  });

  const allSelected = visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.id));

  function toggleAll(v: boolean) {
    setSelected(v ? new Set(visibleRows.map((r) => r.id)) : new Set());
  }

  function toggleOne(id: string, v: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (v) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function confirmBulkDelete() {
    setBulkBusy(true);
    const ids = Array.from(selected);
    const { error } = await supabase.from(table as any).delete().in("id", ids);
    setBulkBusy(false);
    if (error) return toastError(error);
    toast.success(`Deleted ${ids.length} record${ids.length === 1 ? "" : "s"}`);
    setSelected(new Set());
    setBulkOpen(false);
    load();
  }

  async function load() {
    if (!current) return;
    setLoading(true);
    let q = supabase.from(table as any).select("*").eq("property_id", current.id);
    if (filterEq) {
      Object.entries(filterEq).forEach(([k, v]) => {
        q = q.eq(k, v);
      });
    }
    const order = orderBy ?? { column: "created_at", ascending: true };
    const { data, error } = await q.order(order.column, {
      ascending: order.ascending ?? true,
    });
    if (error) toastError(error);
    setRows(((data ?? []) as unknown) as T[]);
    setSelected(new Set());
    setLoading(false);
  }

  useEffect(() => {
    if (current) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  function openNew() {
    const base: Record<string, any> = {};
    fields.forEach((f) => {
      base[f.name] =
        f.defaultValue !== undefined
          ? f.defaultValue
          : f.type === "switch"
            ? true
            : f.type === "number"
              ? 0
              : "";
    });
    setEditing({ ...base, ...(initialNew ?? {}) });
    setOpen(true);
  }

  function openEdit(row: T) {
    setEditing({ ...(row as any) });
    setOpen(true);
  }

  async function save() {
    if (!editing || !current) return;
    for (const f of fields) {
      if (f.required && !editing[f.name] && editing[f.name] !== 0) {
        toast.error(`${f.label} is required`);
        return;
      }
    }
    const payload: Record<string, any> = { property_id: current.id };
    fields.forEach((f) => {
      let v = editing[f.name];
      if (f.type === "number") v = v === "" || v === null ? null : Number(v);
      if (f.type === "text" || f.type === "textarea") v = v === "" ? null : v;
      if (f.type === "date") v = v === "" ? null : v;
      // "All / None" dropdown option sends "" — nullable FK columns need NULL, not ""
      if (f.type === "select" && v === "") v = null;
      payload[f.name] = v;
    });
    // preserve required text fields (e.g., name) — coerce null back
    fields.forEach((f) => {
      if (f.required && payload[f.name] == null) payload[f.name] = editing[f.name];
    });

    if (validate) {
      const withId = editing.id ? { ...payload, id: editing.id } : payload;
      const err = await validate(withId, rows);
      if (err) {
        toast.error(err);
        return;
      }
    }

    let error;
    if (editing.id) {
      ({ error } = await supabase
        .from(table as any)
        .update(payload)
        .eq("id", editing.id));
    } else {
      ({ error } = await supabase.from(table as any).insert(payload as any));
    }
    if (error) {
      toastError(error);
      return;
    }
    toast.success("Saved");
    setOpen(false);
    setEditing(null);
    load();
  }

  async function remove(row: T) {
    if (!confirm("Delete this row?")) return;
    const { error } = await supabase.from(table as any).delete().eq("id", row.id);
    if (error) return toastError(error);
    toast.success("Deleted");
    load();
  }

  if (propLoading) {
    return (
      <AppShell title={title}>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AppShell>
    );
  }

  if (!current) {
    return (
      <AppShell title={title}>
        <EmptyPropertyState />
      </AppShell>
    );
  }

  return (
    <AppShell title={title}>
      <div className="max-w-6xl space-y-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:items-center sm:justify-between">
          {subtitle ? (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          ) : (
            <div />
          )}
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {headerActions}
            {canManage && selected.size > 0 && (
              <Button variant="destructive" onClick={() => setBulkOpen(true)}>
                <Trash2 className="h-4 w-4 mr-1" /> Delete Selected ({selected.size})
              </Button>
            )}
            {canManage && (
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button onClick={openNew}>
                    <Plus className="h-4 w-4 mr-1" /> New
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>
                      {editing?.id ? `Edit ${title}` : `New ${title}`}
                    </DialogTitle>
                  </DialogHeader>
                  {editing && (
                    <div className="grid grid-cols-2 gap-3">
                      {fields.map((f) => (
                        <div
                          key={f.name}
                          className={f.colSpan === 2 ? "col-span-2" : ""}
                        >
                          <div className="space-y-1.5">
                            <Label className="text-xs">
                              {f.label}
                              {f.required && " *"}
                            </Label>
                            {renderField(f, editing, setEditing)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={save}>Save</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        {contentAfterHeader}

        <Card>
          <CardContent className="pt-6">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="max-w-xs"
              />
              {flagRow && flaggedCount > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant={flaggedOnly ? "default" : "outline"}
                  onClick={() => setFlaggedOnly((v) => !v)}
                >
                  Needs review ({flaggedCount})
                </Button>
              )}
              <span className="text-xs text-muted-foreground">
                {visibleRows.length} of {rows.length}
              </span>
            </div>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : visibleRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No records yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {canManage && (
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={(v) => toggleAll(!!v)}
                          aria-label="Select all"
                        />
                      </TableHead>
                    )}
                    {columns.map((c) => (
                      <TableHead key={c.header} className={c.className}>
                        {c.header}
                      </TableHead>
                    ))}
                    {canManage && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((r) => {
                    const flag = flagRow ? flagRow(r) : null;
                    return (
                    <TableRow key={r.id} className={flag ? "bg-destructive/5" : undefined}>
                      {canManage && (
                        <TableCell className="w-10">
                          <Checkbox
                            checked={selected.has(r.id)}
                            onCheckedChange={(v) => toggleOne(r.id, !!v)}
                            aria-label="Select row"
                          />
                        </TableCell>
                      )}
                      {columns.map((c) => (
                        <TableCell key={c.header} className={c.className}>
                          {c.render(r)}
                        </TableCell>
                      ))}
                      {canManage && (
                        <TableCell className="text-right">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => openEdit(r)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive"
                            onClick={() => remove(r)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} selected record(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Records still linked to other data may fail to delete.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmBulkDelete} disabled={bulkBusy}>
              {bulkBusy ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function renderField(
  f: FieldDef,
  editing: Record<string, any>,
  setEditing: (v: Record<string, any>) => void,
) {
  const v = editing[f.name];
  const set = (val: any) => setEditing({ ...editing, [f.name]: val });

  if (f.type === "textarea") {
    return <Textarea rows={2} value={v ?? ""} onChange={(e) => set(e.target.value)} />;
  }
  if (f.type === "switch") {
    return <Switch checked={!!v} onCheckedChange={set} />;
  }
  if (f.type === "select") {
    return (
      <Select
        value={v ? String(v) : "__none__"}
        onValueChange={(val) => set(val === "__none__" ? "" : val)}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {(f.options ?? []).map((o) => (
            <SelectItem
              key={o.value === "" ? "__none__" : o.value}
              value={o.value === "" ? "__none__" : o.value}
            >
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (f.type === "number") {
    return (
      <Input
        type="number"
        value={v ?? ""}
        onChange={(e) => set(e.target.value === "" ? "" : Number(e.target.value))}
      />
    );
  }
  if (f.type === "date") {
    return <Input type="date" value={v ?? ""} onChange={(e) => set(e.target.value)} />;
  }
  return <Input value={v ?? ""} onChange={(e) => set(e.target.value)} />;
}