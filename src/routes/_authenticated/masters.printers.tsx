import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CrudPage, type FieldDef, type ColumnDef } from "@/components/master/CrudPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Settings2, Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { toast } from "sonner";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/masters/printers")({
  head: () => ({ meta: [{ title: "Printers — HotelPilot" }] }),
  component: () => (<RequirePermission module="master_data"><PrintersPage /></RequirePermission>),
});

interface Printer {
  id: string;
  name: string;
  type: string;
  printer_role: string;
  location: string | null;
  ip_address: string | null;
  port: number | null;
  paper_size: string | null;
  is_default: boolean;
  is_active: boolean;
}

interface PrinterRole {
  id: string;
  property_id: string;
  name: string;
  sort_order: number;
  active: boolean;
}

const columns: ColumnDef<Printer>[] = [
  { header: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
  {
    header: "Type",
    render: (r) => (
      <div className="flex items-center gap-1">
        <Badge variant="outline">{r.type}</Badge>
        <Badge variant="secondary">{r.paper_size ?? "80mm"}</Badge>
      </div>
    ),
  },
  { header: "Role", render: (r) => <Badge variant="secondary">{r.printer_role}</Badge> },
  { header: "Location", render: (r) => r.location ?? "—" },
  {
    header: "Address",
    render: (r) => (r.ip_address ? `${r.ip_address}:${r.port ?? 9100}` : "—"),
  },
  { header: "Default", render: (r) => (r.is_default ? <Badge>Default</Badge> : "—") },
];

function PrintersPage() {
  const { current } = useCurrentProperty();
  const [roles, setRoles] = useState<PrinterRole[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  async function loadRoles() {
    if (!current) return;
    const { data, error } = await supabase
      .from("printer_roles" as any)
      .select("*")
      .eq("property_id", current.id)
      .order("sort_order", { ascending: true });
    if (error) {
      toast.error(error.message);
      return;
    }
    setRoles((data ?? []) as unknown as PrinterRole[]);
  }

  useEffect(() => {
    loadRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, reloadKey]);

  const activeRoles = roles.filter((r) => r.active);
  const defaultRoleName = activeRoles[0]?.name ?? "";

  const fields: FieldDef[] = [
    { name: "name", label: "Printer name", type: "text", required: true },
    {
      name: "type",
      label: "Type",
      type: "select",
      options: [
        { value: "kot", label: "KOT" },
        { value: "bill", label: "Bill" },
        { value: "both", label: "Both" },
      ],
      defaultValue: "bill",
    },
    {
      name: "printer_role",
      label: "Role",
      type: "select",
      options: activeRoles.map((r) => ({ value: r.name, label: r.name })),
      defaultValue: defaultRoleName,
    },
    { name: "location", label: "Location", type: "text" },
    { name: "ip_address", label: "IP address", type: "text" },
    { name: "port", label: "Port", type: "number", defaultValue: 9100 },
    {
      name: "paper_size",
      label: "Paper Size",
      type: "select",
      options: [
        { value: "58mm", label: "58mm" },
        { value: "80mm", label: "80mm" },
        { value: "A4", label: "A4" },
      ],
      defaultValue: "80mm",
    },
    { name: "is_default", label: "Default", type: "switch", defaultValue: false },
    { name: "is_active", label: "Active", type: "switch", defaultValue: true },
  ];

  return (
    <CrudPage<Printer>
      title="Printers"
      subtitle="Receipt and KOT printers connected at this property."
      table="printers"
      fields={fields}
      columns={columns}
      orderBy={{ column: "name" }}
      headerActions={
        <ManageRolesDialog
          roles={roles}
          propertyId={current?.id ?? null}
          onChanged={() => setReloadKey((k) => k + 1)}
        />
      }
    />
  );
}

function ManageRolesDialog({
  roles,
  propertyId,
  onChanged,
}: {
  roles: PrinterRole[];
  propertyId: string | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  async function addRole() {
    if (!propertyId) return;
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    const maxSort = roles.reduce((m, r) => Math.max(m, r.sort_order), 0);
    const { error } = await supabase
      .from("printer_roles" as any)
      .insert({ property_id: propertyId, name, sort_order: maxSort + 1, active: true } as any);
    setSaving(false);
    if (error) return toast.error(error.message);
    setNewName("");
    onChanged();
  }

  async function renameRole(role: PrinterRole, name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === role.name) return;
    const { error } = await supabase
      .from("printer_roles" as any)
      .update({ name: trimmed } as any)
      .eq("id", role.id);
    if (error) return toast.error(error.message);
    onChanged();
  }

  async function toggleActive(role: PrinterRole, active: boolean) {
    const { error } = await supabase
      .from("printer_roles" as any)
      .update({ active } as any)
      .eq("id", role.id);
    if (error) return toast.error(error.message);
    onChanged();
  }

  async function move(role: PrinterRole, direction: -1 | 1) {
    const sorted = [...roles].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex((r) => r.id === role.id);
    const swap = sorted[idx + direction];
    if (!swap) return;
    const a = supabase
      .from("printer_roles" as any)
      .update({ sort_order: swap.sort_order } as any)
      .eq("id", role.id);
    const b = supabase
      .from("printer_roles" as any)
      .update({ sort_order: role.sort_order } as any)
      .eq("id", swap.id);
    const [r1, r2] = await Promise.all([a, b]);
    if (r1.error || r2.error) {
      toast.error(r1.error?.message ?? r2.error?.message ?? "Failed to reorder");
      return;
    }
    onChanged();
  }

  async function remove(role: PrinterRole) {
    if (!propertyId) return;
    const { count, error: ce } = await supabase
      .from("printers" as any)
      .select("id", { count: "exact", head: true })
      .eq("property_id", propertyId)
      .eq("printer_role", role.name);
    if (ce) return toast.error(ce.message);
    if ((count ?? 0) > 0) {
      toast.error(`Cannot delete — ${count} printer(s) still use this role.`);
      return;
    }
    if (!confirm(`Delete role "${role.name}"?`)) return;
    const { error } = await supabase.from("printer_roles" as any).delete().eq("id", role.id);
    if (error) return toast.error(error.message);
    onChanged();
  }

  const sorted = [...roles].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Settings2 className="h-4 w-4 mr-1" /> Manage Roles
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Printer Roles</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded border">
            <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground border-b">
              <div>Name</div>
              <div className="w-20 text-center">Order</div>
              <div className="w-16 text-center">Active</div>
              <div className="w-20 text-right">Actions</div>
            </div>
            {sorted.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No roles yet.</p>
            ) : (
              sorted.map((r, i) => (
                <div
                  key={r.id}
                  className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-3 py-2 border-b last:border-b-0"
                >
                  <Input
                    defaultValue={r.name}
                    onBlur={(e) => renameRole(r, e.target.value)}
                    className="h-8"
                  />
                  <div className="w-20 flex items-center justify-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={i === 0}
                      onClick={() => move(r, -1)}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={i === sorted.length - 1}
                      onClick={() => move(r, 1)}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="w-16 flex justify-center">
                    <Switch checked={r.active} onCheckedChange={(v) => toggleActive(r, v)} />
                  </div>
                  <div className="w-20 text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      onClick={() => remove(r)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">New role name</label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Rooftop Kitchen"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addRole();
                  }
                }}
              />
            </div>
            <Button onClick={addRole} disabled={saving || !newName.trim()}>
              <Plus className="h-4 w-4 mr-1" /> Add Role
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}