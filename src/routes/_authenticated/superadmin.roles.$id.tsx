import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShieldAlert, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/superadmin/roles/$id")({
  head: () => ({ meta: [{ title: "Edit Role — HotelPilot" }] }),
  component: EditRolePage,
});

const MODULES: { key: string; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "bookings", label: "Bookings" },
  { key: "calendar", label: "Calendar" },
  { key: "inhouse", label: "In-house" },
  { key: "food_kot", label: "Food / KOT" },
  { key: "pos_sundry", label: "POS / Sundry" },
  { key: "invoices", label: "Invoices" },
  { key: "restaurant_billing", label: "Restaurant Billing" },
  { key: "reports_daily", label: "Reports — Daily" },
  { key: "reports_analytics", label: "Reports — Analytics" },
  { key: "reports_sales", label: "Reports — Sales" },
  { key: "reports_gst", label: "Reports — GST" },
  { key: "night_audit", label: "Night Audit" },
  { key: "room_board", label: "Room Board" },
  { key: "housekeeping_tasks", label: "Housekeeping Tasks" },
  { key: "guest_crm", label: "Guest CRM" },
  { key: "communications", label: "Communications" },
  { key: "whatsapp_inbox", label: "WhatsApp Inbox" },
  { key: "inventory", label: "Inventory" },
  { key: "masters_rooms", label: "Masters — Rooms" },
  { key: "masters_tariff", label: "Masters — Tariff" },
  { key: "masters_menu", label: "Masters — Menu" },
  { key: "masters_halls", label: "Masters — Halls" },
  { key: "masters_staff", label: "Masters — Staff" },
  { key: "masters_printers", label: "Masters — Printers" },
  { key: "masters_expense_categories", label: "Masters — Expense Categories" },
  { key: "masters_ota_channels", label: "Masters — OTA Channels" },
  { key: "channel_manager", label: "Channel Manager" },
  { key: "properties", label: "Properties" },
  { key: "staff_hr", label: "Staff HR" },
  { key: "payroll", label: "Payroll" },
  { key: "security_wipe", label: "Security / Wipe" },
  { key: "superadmin_panel", label: "Superadmin Panel" },
];
const ACTIONS = ["view", "create", "edit", "delete"] as const;
type Action = (typeof ACTIONS)[number];

interface Perm {
  id: string;
  module: string;
  action: Action;
}

function EditRolePage() {
  const { id } = useParams({ from: "/_authenticated/superadmin/roles/$id" });
  const { roles: appRoles, loading } = useAuth();
  const isSuperadmin = appRoles.includes("superadmin");
  const [role, setRole] = useState<{ id: string; name: string; description: string | null } | null>(null);
  const [perms, setPerms] = useState<Perm[]>([]);
  const [allowed, setAllowed] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isSuperadmin) return;
    (async () => {
      const [{ data: r }, { data: ps }, { data: rps }] = await Promise.all([
        supabase.from("roles").select("id,name,description").eq("id", id).maybeSingle(),
        supabase.from("permissions").select("id,module,action"),
        supabase.from("role_permissions").select("permission_id,allowed").eq("role_id", id),
      ]);
      setRole((r as any) ?? null);
      setPerms((ps ?? []) as Perm[]);
      const next: Record<string, boolean> = {};
      for (const rp of rps ?? []) next[rp.permission_id as string] = !!rp.allowed;
      setAllowed(next);
    })();
  }, [id, isSuperadmin]);

  const byKey = useMemo(() => {
    const m: Record<string, Perm> = {};
    for (const p of perms) m[`${p.module}:${p.action}`] = p;
    return m;
  }, [perms]);

  function toggle(permId: string, value: boolean) {
    setAllowed((s) => ({ ...s, [permId]: value }));
  }

  function toggleRow(module: string, value: boolean) {
    setAllowed((s) => {
      const next = { ...s };
      for (const a of ACTIONS) {
        const p = byKey[`${module}:${a}`];
        if (p) next[p.id] = value;
      }
      return next;
    });
  }

  async function save() {
    setSaving(true);
    // upsert each permission row
    const rows = perms.map((p) => ({
      role_id: id,
      permission_id: p.id,
      allowed: !!allowed[p.id],
    }));
    const { error } = await supabase
      .from("role_permissions")
      .upsert(rows, { onConflict: "role_id,permission_id" });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Permissions saved");
  }

  if (loading) return <AppShell title="Edit Role"><div className="text-muted-foreground">Loading…</div></AppShell>;

  if (!isSuperadmin) {
    return (
      <AppShell title="Edit Role">
        <Card className="max-w-md">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              <CardTitle>Access denied</CardTitle>
            </div>
          </CardHeader>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell title="Edit Role">
      <div className="max-w-5xl space-y-4">
        <Button asChild variant="ghost" size="sm">
          <Link to="/superadmin/roles"><ArrowLeft className="h-4 w-4 mr-1" /> Back to roles</Link>
        </Button>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{role?.name ?? "Role"}</h2>
          <p className="text-sm text-muted-foreground">{role?.description ?? "Toggle per-module permissions and save."}</p>
        </div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Module</TableHead>
                  {ACTIONS.map((a) => (
                    <TableHead key={a} className="text-center capitalize">{a}</TableHead>
                  ))}
                  <TableHead className="text-right">All</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {MODULES.map((m) => {
                  const rowAll = ACTIONS.every((a) => allowed[byKey[`${m.key}:${a}`]?.id]);
                  return (
                    <TableRow key={m.key}>
                      <TableCell className="font-medium">{m.label}</TableCell>
                      {ACTIONS.map((a) => {
                        const p = byKey[`${m.key}:${a}`];
                        return (
                          <TableCell key={a} className="text-center">
                            {p ? (
                              <Checkbox
                                checked={!!allowed[p.id]}
                                onCheckedChange={(v) => toggle(p.id, !!v)}
                              />
                            ) : null}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right">
                        <Checkbox
                          checked={rowAll}
                          onCheckedChange={(v) => toggleRow(m.key, !!v)}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save Permissions"}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
