import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { invalidatePermissions } from "@/hooks/use-permissions";
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

const MODULE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  bookings: "Bookings",
  calendar: "Calendar",
  inhouse: "In-house",
  food_kot: "Food & KOT",
  pos_sundry: "POS / Sundry",
  invoices: "Invoices",
  restaurant_billing: "Restaurant Billing",
  reports_daily: "Reports — Daily",
  reports_analytics: "Reports — Analytics",
  reports_sales: "Reports — Sales",
  reports_gst: "Reports — GST",
  night_audit: "Night Audit",
  room_board: "Room Board",
  housekeeping_tasks: "Housekeeping Tasks",
  guest_crm: "Guest CRM",
  communications: "Communications",
  whatsapp_inbox: "WhatsApp Inbox",
  inventory: "Inventory",
  masters_rooms: "Masters — Rooms",
  masters_tariff: "Masters — Tariff",
  masters_menu: "Masters — Menu",
  masters_halls: "Masters — Halls",
  masters_staff: "Masters — Staff",
  masters_printers: "Masters — Printers",
  masters_expense_categories: "Masters — Expenses",
  masters_ota_channels: "Masters — OTA Channels",
  masters_sundry_items: "Masters — Sundry Items",
  channel_manager: "Channel Manager",
  properties: "Properties",
  staff_hr: "Staff HR",
  payroll: "Payroll",
  security_wipe: "Security",
  settings_whatsapp: "Settings — WhatsApp",
  superadmin_panel: "Superadmin Panel",
};

const SECTIONS: { title: string; modules: string[] }[] = [
  { title: "Front Desk", modules: ["dashboard", "bookings", "calendar", "inhouse"] },
  { title: "Food & KOT", modules: ["food_kot", "pos_sundry"] },
  { title: "Billing", modules: ["invoices", "restaurant_billing"] },
  { title: "Reports", modules: ["reports_daily", "reports_analytics", "reports_sales", "reports_gst", "night_audit"] },
  { title: "Housekeeping", modules: ["room_board", "housekeeping_tasks"] },
  { title: "Guests", modules: ["guest_crm", "communications", "whatsapp_inbox"] },
  { title: "Inventory", modules: ["inventory"] },
  { title: "Masters", modules: ["masters_rooms", "masters_tariff", "masters_menu", "masters_halls", "masters_staff", "masters_printers", "masters_expense_categories", "masters_ota_channels", "masters_sundry_items"] },
  { title: "Admin", modules: ["channel_manager", "properties", "staff_hr", "payroll", "security_wipe", "settings_whatsapp", "superadmin_panel"] },
];

const ACTIONS = ["view", "create", "edit", "delete"] as const;
const ALL_MODULES = SECTIONS.flatMap((s) => s.modules);
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
  const [role, setRole] = useState<{ id: string; name: string; description: string | null; max_discount_pct?: number | null } | null>(null);
  const [perms, setPerms] = useState<Perm[]>([]);
  const [allowed, setAllowed] = useState<Record<string, boolean>>({});
  const [maxDiscount, setMaxDiscount] = useState<string>("0");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isSuperadmin) return;
    (async () => {
      const [{ data: r }, { data: ps }, { data: rps }] = await Promise.all([
        supabase.from("roles").select("id,name,description,max_discount_pct").eq("id", id).maybeSingle(),
        supabase.from("permissions").select("id,module,action"),
        supabase.from("role_permissions").select("permission_id,allowed").eq("role_id", id),
      ]);
      setRole((r as any) ?? null);
      setMaxDiscount(String((r as any)?.max_discount_pct ?? 0));
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

  function toggleColumn(action: Action, value: boolean) {
    setAllowed((s) => {
      const next = { ...s };
      for (const m of ALL_MODULES) {
        const p = byKey[`${m}:${action}`];
        if (p) next[p.id] = value;
      }
      return next;
    });
  }

  const columnAll = (action: Action) =>
    ALL_MODULES.every((m) => {
      const p = byKey[`${m}:${action}`];
      return p ? !!allowed[p.id] : true;
    });

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
    if (error) { setSaving(false); return toast.error(error.message); }
    // Persist max discount % (skip for Owner — unlimited)
    const isOwner = /owner/i.test(role?.name ?? "");
    if (!isOwner) {
      const pct = Math.max(0, Math.min(100, Number(maxDiscount) || 0));
      const { error: rErr } = await supabase
        .from("roles")
        .update({ max_discount_pct: pct } as any)
        .eq("id", id);
      if (rErr) { setSaving(false); return toast.error(rErr.message); }
    }
    setSaving(false);
    invalidatePermissions();
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
    <AppShell title="Edit Permissions">
      <div className="max-w-6xl space-y-4">
        <Button asChild variant="ghost" size="sm">
          <Link to="/superadmin/roles"><ArrowLeft className="h-4 w-4 mr-1" /> Back to roles</Link>
        </Button>
        <div className="sticky top-0 z-20 -mx-4 px-4 py-3 bg-background/95 backdrop-blur border-b flex items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              Edit Permissions — {role?.name ?? "Role"}
            </h2>
            {role?.description ? (
              <p className="text-sm text-muted-foreground">{role.description}</p>
            ) : null}
          </div>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save Permissions"}
          </Button>
        </div>
        <Card>
          <CardContent className="p-0">
            <Table style={{ tableLayout: "fixed" }} className="w-full">
              <TableHeader>
                <TableRow>
                  <TableHead style={{ width: "35%" }}>Module</TableHead>
                  {ACTIONS.map((a) => (
                    <TableHead key={a} style={{ width: "13%" }} className="text-center capitalize">
                      <div className="flex flex-col items-center justify-center gap-1">
                        <span>{a}</span>
                        <Checkbox
                          checked={columnAll(a)}
                          onCheckedChange={(v) => toggleColumn(a, !!v)}
                          aria-label={`Select all ${a}`}
                        />
                      </div>
                    </TableHead>
                  ))}
                  <TableHead style={{ width: "13%" }} className="text-center">All</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {SECTIONS.map((section) => (
                  <Fragment key={section.title}>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={ACTIONS.length + 2} className="font-semibold text-xs uppercase tracking-wider text-muted-foreground py-2">
                        {section.title}
                      </TableCell>
                    </TableRow>
                    {section.modules.map((mKey) => {
                      const rowAll = ACTIONS.every((a) => {
                        const p = byKey[`${mKey}:${a}`];
                        return p ? !!allowed[p.id] : true;
                      });
                      return (
                        <TableRow key={mKey}>
                          <TableCell className="font-medium">{MODULE_LABELS[mKey] ?? mKey}</TableCell>
                          {ACTIONS.map((a) => {
                            const p = byKey[`${mKey}:${a}`];
                            return (
                              <TableCell key={a} className="text-center">
                                <div className="flex justify-center">
                                  {p ? (
                                    <Checkbox
                                      checked={!!allowed[p.id]}
                                      onCheckedChange={(v) => toggle(p.id, !!v)}
                                    />
                                  ) : null}
                                </div>
                              </TableCell>
                            );
                          })}
                          <TableCell className="text-center">
                            <div className="flex justify-center">
                              <Checkbox
                                checked={rowAll}
                                onCheckedChange={(v) => toggleRow(mKey, !!v)}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
