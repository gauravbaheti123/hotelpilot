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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";

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
    if (error) toast.error(error.message);
    setRows(((data ?? []) as unknown) as T[]);
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
      payload[f.name] = v;
    });
    // preserve required text fields (e.g., name) — coerce null back
    fields.forEach((f) => {
      if (f.required && payload[f.name] == null) payload[f.name] = editing[f.name];
    });

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
      toast.error(error.message);
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
    if (error) return toast.error(error.message);
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
        <div className="flex items-center justify-between gap-3">
          {subtitle ? (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-2">
            {headerActions}
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

        <Card>
          <CardContent className="pt-6">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No records yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((c) => (
                      <TableHead key={c.header} className={c.className}>
                        {c.header}
                      </TableHead>
                    ))}
                    {canManage && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
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
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
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