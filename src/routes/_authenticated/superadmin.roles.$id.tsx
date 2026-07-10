import { Input } from "@/components/ui/input";
import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { invalidatePermissions } from "@/hooks/use-permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ShieldAlert, ArrowLeft, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { upsertRolePermissions } from "@/lib/staff-users.functions";

export const Route = createFileRoute("/_authenticated/superadmin/roles/$id")({
  head: () => ({ meta: [{ title: "Edit Permissions — HotelPilot" }] }),
  component: EditRolePage,
});

const SECTIONS: { title: string; modules: { key: string; label: string; singleAction?: string }[] }[] = [
  { title: "Front Desk", modules: [
    { key: "dashboard", label: "Dashboard" },
    { key: "bookings", label: "Bookings" },
    { key: "calendar", label: "Calendar" },
    { key: "inhouse", label: "In-house" },
  ]},
  { title: "Food & KOT", modules: [
    { key: "food_dashboard", label: "Food Dashboard" },
    { key: "all_kots", label: "All KOTs" },
    { key: "new_kot", label: "New KOT" },
    { key: "pending_bills", label: "Pending Bills" },
  ]},
  { title: "Billing", modules: [
    { key: "pos", label: "POS" },
    { key: "restaurant_billing", label: "Restaurant Billing" },
    { key: "invoices", label: "Invoices" },
    { key: "mis_ac", label: "MIS A/c" },
    { key: "billing", label: "Split Bill", singleAction: "split_bill" },
    { key: "billing", label: "Shift to MIS", singleAction: "mis_shift" },
  ]},
  { title: "Reports", modules: [
    { key: "reports", label: "Reports" },
    { key: "day_close", label: "Day Close" },
  ]},
  { title: "Housekeeping", modules: [
    { key: "room_board", label: "Room Board" },
    { key: "tasks", label: "Tasks" },
  ]},
  { title: "Guest CRM", modules: [{ key: "guest_crm", label: "Guest CRM" }] },
  { title: "Inventory", modules: [{ key: "inventory", label: "Inventory" }] },
  { title: "Expenses", modules: [{ key: "expenses", label: "Expenses" }] },
  { title: "Staff HR", modules: [{ key: "staff_hr", label: "Staff HR" }] },
  { title: "Banquet", modules: [{ key: "banquet", label: "Banquet/Events" }] },
  { title: "Master Data", modules: [{ key: "master_data", label: "Master Data" }] },
  { title: "Label Printing", modules: [{ key: "label_printing", label: "Label Printing" }] },
  { title: "Settings & Admin", modules: [
    { key: "settings_business", label: "Settings - Business" },
    { key: "settings_whatsapp", label: "Settings - WhatsApp" },
    { key: "settings_invoice", label: "Settings - Invoice" },
    { key: "roles_permissions", label: "Roles & Permissions" },
    { key: "user_management", label: "User Management" },
    { key: "security_wipe", label: "Security / Wipe" },
  ]},
];

const ACTIONS = ["view", "create", "edit", "delete"] as const;
const ALL_MODULES = SECTIONS.flatMap((s) => s.modules.map((m) => m.key));
type Action = (typeof ACTIONS)[number];

interface Perm { id: string; module: string; action: Action }

// System default permission sets keyed by role name (lowercased).
const DEFAULTS: Record<string, Partial<Record<string, Action[]>>> = {
  manager: Object.fromEntries(ALL_MODULES.map((m) => [m, [...ACTIONS]])),
  receptionist: {
    dashboard: ["view"], bookings: ["view","create","edit"], calendar: ["view"], inhouse: ["view","edit"],
    food_dashboard: ["view"], all_kots: ["view"], new_kot: ["view","create","edit"], pending_bills: ["view"],
    pos: ["view","create","edit"], restaurant_billing: ["view"], invoices: ["view","create"],
    room_board: ["view"], tasks: ["view","edit"], guest_crm: ["view","create","edit"],
  },
};

function EditRolePage() {
  const { id } = useParams({ from: "/_authenticated/superadmin/roles/$id" });
  const { roles: appRoles, loading } = useAuth();
  const isSuperadmin = appRoles.includes("superadmin");
  const isOwner = appRoles.includes("owner");
  const canAccess = isSuperadmin || isOwner;
  const navigate = useNavigate();
  const upsertPermsFn = useServerFn(upsertRolePermissions);

  const [role, setRole] = useState<{ id: string; name: string; description: string | null; is_system?: boolean; max_discount_pct?: number | null } | null>(null);
  const [perms, setPerms] = useState<Perm[]>([]);
  const [savedAllowed, setSavedAllowed] = useState<Record<string, boolean>>({});
  const [allowed, setAllowed] = useState<Record<string, boolean>>({});
  const [maxDiscount, setMaxDiscount] = useState<string>("0");
  const [savedMaxDiscount, setSavedMaxDiscount] = useState<string>("0");
  const [saving, setSaving] = useState(false);

  // Owner's own effective permissions — used to gate what they can grant.
  const [ownerCan, setOwnerCan] = useState<Record<string, Record<Action, boolean>>>({});

  useEffect(() => {
    if (!loading && !canAccess) {
      toast.error("Access denied");
      navigate({ to: "/dashboard", replace: true });
    }
  }, [loading, canAccess, navigate]);

  async function loadAll() {
    const [{ data: r }, { data: ps }, { data: rps }] = await Promise.all([
      supabase.from("roles").select("id,name,description,is_system,max_discount_pct").eq("id", id).maybeSingle(),
      supabase.from("permissions").select("id,module,action"),
      supabase.from("role_permissions").select("permission_id,allowed").eq("role_id", id),
    ]);
    const roleRow = (r as any) ?? null;
    if (roleRow && !isSuperadmin && /^(owner|superadmin)$/i.test(roleRow.name)) {
      toast.error("Access denied");
      navigate({ to: "/superadmin/roles", replace: true });
      return;
    }
    setRole(roleRow);
    const md = String((r as any)?.max_discount_pct ?? 0);
    setMaxDiscount(md); setSavedMaxDiscount(md);
    setPerms((ps ?? []) as Perm[]);
    const next: Record<string, boolean> = {};
    for (const rp of rps ?? []) next[rp.permission_id as string] = !!rp.allowed;
    setAllowed(next);
    setSavedAllowed(next);
  }

  useEffect(() => { if (canAccess) loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id, canAccess]);

  useEffect(() => {
    if (isSuperadmin || !isOwner) return;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return;
      const { data: ur } = await supabase.from("user_roles").select("role_id").eq("user_id", uid).not("role_id", "is", null);
      const roleIds = (ur ?? []).map((x: any) => x.role_id).filter(Boolean);
      if (roleIds.length === 0) { setOwnerCan({}); return; }
      const { data: rps } = await supabase
        .from("role_permissions").select("allowed, permissions(module,action)")
        .in("role_id", roleIds).eq("allowed", true);
      const m: Record<string, Record<Action, boolean>> = {};
      for (const row of (rps ?? []) as any[]) {
        const p = row.permissions; if (!p) continue;
        if (!m[p.module]) m[p.module] = { view: false, create: false, edit: false, delete: false };
        m[p.module][p.action as Action] = true;
      }
      setOwnerCan(m);
    })();
  }, [isOwner, isSuperadmin]);

  const readOnly = !isSuperadmin && !!role && /^(owner|superadmin)$/i.test(role.name);

  const byKey = useMemo(() => {
    const m: Record<string, Perm> = {};
    for (const p of perms) m[`${p.module}:${p.action}`] = p;
    return m;
  }, [perms]);

  function canOwnerToggle(module: string, action: Action) {
    if (isSuperadmin) return true;
    if (appRoles.includes("owner")) return true;
    return !!ownerCan[module]?.[action];
  }

  function toggle(permId: string, value: boolean) {
    setAllowed((s) => ({ ...s, [permId]: value }));
  }

  function toggleRow(module: string, value: boolean) {
    setAllowed((s) => {
      const next = { ...s };
      for (const a of ACTIONS) {
        const p = byKey[`${module}:${a}`];
        if (p && canOwnerToggle(module, a)) next[p.id] = value;
      }
      return next;
    });
  }

  function toggleSection(modules: string[], value: boolean) {
    setAllowed((s) => {
      const next = { ...s };
      for (const m of modules) for (const a of ACTIONS) {
        const p = byKey[`${m}:${a}`];
        if (p && canOwnerToggle(m, a)) next[p.id] = value;
      }
      return next;
    });
  }

  function toggleColumn(action: Action, value: boolean) {
    setAllowed((s) => {
      const next = { ...s };
      for (const m of ALL_MODULES) {
        const p = byKey[`${m}:${action}`];
        if (p && canOwnerToggle(m, action)) next[p.id] = value;
      }
      return next;
    });
  }

  const columnAll = (action: Action) =>
    ALL_MODULES.every((m) => {
      const p = byKey[`${m}:${action}`];
      return p ? !!allowed[p.id] : true;
    });

  const sectionAll = (modules: string[]) =>
    modules.every((m) => ACTIONS.every((a) => {
      const p = byKey[`${m}:${a}`];
      return p ? !!allowed[p.id] : true;
    }));

  const isDirty = (permId: string) => !!allowed[permId] !== !!savedAllowed[permId];
  const hasUnsaved = useMemo(
    () => perms.some((p) => isDirty(p.id)) || maxDiscount !== savedMaxDiscount,
    [perms, allowed, savedAllowed, maxDiscount, savedMaxDiscount],
  );

  function resetToDefaults() {
    const key = (role?.name ?? "").toLowerCase();
    const def = DEFAULTS[key];
    if (!def) {
      // Fall back to "revert unsaved changes"
      setAllowed(savedAllowed);
      setMaxDiscount(savedMaxDiscount);
      toast.success("Reverted unsaved changes");
      return;
    }
    const next: Record<string, boolean> = {};
    for (const p of perms) {
      const actions = def[p.module] ?? [];
      next[p.id] = actions.includes(p.action);
    }
    setAllowed(next);
    toast.success("Reset to system defaults — click Save to apply");
  }

  async function save() {
    if (readOnly) { toast.error("This role is read only"); return; }
    setSaving(true);
    try {
      const rows = perms.map((p) => ({ permission_id: p.id, allowed: !!allowed[p.id] }));
      const pct = /owner/i.test(role?.name ?? "")
        ? undefined
        : Math.max(0, Math.min(100, Number(maxDiscount) || 0));
      await upsertPermsFn({ data: { role_id: id, rows, max_discount_pct: pct } });
      invalidatePermissions();
      setSavedAllowed({ ...allowed });
      setSavedMaxDiscount(maxDiscount);
      toast.success("Permissions saved");
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setSaving(false); }
  }

  if (loading) return <AppShell title="Edit Permissions"><div className="text-muted-foreground">Loading…</div></AppShell>;
  if (!canAccess) {
    return (
      <AppShell title="Edit Permissions">
        <Card className="max-w-md">
          <CardHeader><div className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" /><CardTitle>Access denied</CardTitle></div></CardHeader>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell title="Edit Permissions">
      <TooltipProvider>
        <div className="max-w-6xl space-y-4">
          <Button asChild variant="ghost" size="sm">
            <Link to="/superadmin/roles"><ArrowLeft className="h-4 w-4 mr-1" /> Back to roles</Link>
          </Button>

          <div className="sticky top-0 z-20 -mx-4 px-4 py-3 bg-background/95 backdrop-blur border-b flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Edit Permissions — {role?.name ?? "Role"}</h2>
              {role?.description ? <p className="text-sm text-muted-foreground">{role.description}</p> : null}
              {hasUnsaved && !readOnly && (
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">You have unsaved changes</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!readOnly && (
                <Button variant="outline" size="sm" onClick={resetToDefaults}>
                  <RotateCcw className="h-4 w-4 mr-1" /> Reset to Default
                </Button>
              )}
              {!readOnly ? (
                <Button onClick={save} disabled={saving || !hasUnsaved}>
                  {saving ? "Saving…" : "Save Permissions"}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">Read only — protected role</span>
              )}
            </div>
          </div>

          {!readOnly && !/owner/i.test(role?.name ?? "") && (
            <Card>
              <CardContent className="py-3 flex items-center gap-3">
                <span className="text-sm">Max discount %</span>
                <Input
                  type="number" min={0} max={100}
                  value={maxDiscount}
                  onChange={(e) => setMaxDiscount(e.target.value)}
                  className={`w-24 ${maxDiscount !== savedMaxDiscount ? "bg-amber-100 dark:bg-amber-950/40" : ""}`}
                />
                <span className="text-xs text-muted-foreground">Cap applied when users with this role apply discounts.</span>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-0">
              <Table style={{ tableLayout: "fixed" }} className="w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead style={{ width: "32%" }}>Module</TableHead>
                    {ACTIONS.map((a) => (
                      <TableHead key={a} style={{ width: "13%" }} className="text-center capitalize">
                        <div className="flex flex-col items-center justify-center gap-1">
                          <span>{a}</span>
                          <Checkbox checked={columnAll(a)} onCheckedChange={(v) => toggleColumn(a, !!v)} disabled={readOnly} aria-label={`Select all ${a}`} />
                        </div>
                      </TableHead>
                    ))}
                    <TableHead style={{ width: "16%" }} className="text-center">All</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {SECTIONS.map((sec) => {
                    const modKeys = sec.modules.map((m) => m.key);
                    const allOn = sectionAll(modKeys);
                    return (
                      <Fragment key={sec.title}>
                        <TableRow className="bg-muted/50">
                          <TableCell colSpan={5} className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                            {sec.title}
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-2">
                              <span className="text-[10px] text-muted-foreground">Section</span>
                              <Checkbox checked={allOn} onCheckedChange={(v) => toggleSection(modKeys, !!v)} disabled={readOnly} />
                            </div>
                          </TableCell>
                        </TableRow>
                        {sec.modules.map((m) => {
                          if (m.singleAction) {
                            const p = byKey[`${m.key}:${m.singleAction}`];
                            const enabled = canOwnerToggle(m.key, m.singleAction as Action);
                            const dirty = p ? isDirty(p.id) : false;
                            const checked = p ? !!allowed[p.id] : false;
                            const cell = (
                              <TableCell
                                colSpan={ACTIONS.length}
                                className={`text-center ${dirty ? "bg-amber-100 dark:bg-amber-950/40" : ""} ${!enabled ? "opacity-50" : ""}`}
                              >
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(v) => p && toggle(p.id, !!v)}
                                  disabled={readOnly || !p || !enabled}
                                />
                              </TableCell>
                            );
                            return (
                              <TableRow key={`${m.key}:${m.singleAction}`}>
                                <TableCell>{m.label}</TableCell>
                                {enabled ? cell : (
                                  <Tooltip>
                                    <TooltipTrigger asChild><div className="contents">{cell}</div></TooltipTrigger>
                                    <TooltipContent>You don&apos;t have this permission</TooltipContent>
                                  </Tooltip>
                                )}
                                <TableCell className="text-center">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(v) => p && toggle(p.id, !!v)}
                                    disabled={readOnly || !p || !enabled}
                                  />
                                </TableCell>
                              </TableRow>
                            );
                          }
                          const rowAll = ACTIONS.every((a) => {
                            const p = byKey[`${m.key}:${a}`];
                            return p ? !!allowed[p.id] : true;
                          });
                          return (
                            <TableRow key={m.key}>
                              <TableCell>{m.label}</TableCell>
                              {ACTIONS.map((a) => {
                                const p = byKey[`${m.key}:${a}`];
                                const enabled = canOwnerToggle(m.key, a);
                                const dirty = p ? isDirty(p.id) : false;
                                const cell = (
                                  <TableCell
                                    key={a}
                                    className={`text-center ${dirty ? "bg-amber-100 dark:bg-amber-950/40" : ""} ${!enabled ? "opacity-50" : ""}`}
                                  >
                                    <Checkbox
                                      checked={p ? !!allowed[p.id] : false}
                                      onCheckedChange={(v) => p && toggle(p.id, !!v)}
                                      disabled={readOnly || !p || !enabled}
                                    />
                                  </TableCell>
                                );
                                if (!enabled) {
                                  return (
                                    <Tooltip key={a}>
                                      <TooltipTrigger asChild><div className="contents">{cell}</div></TooltipTrigger>
                                      <TooltipContent>You don&apos;t have this permission</TooltipContent>
                                    </Tooltip>
                                  );
                                }
                                return cell;
                              })}
                              <TableCell className="text-center">
                                <Checkbox checked={rowAll} onCheckedChange={(v) => toggleRow(m.key, !!v)} disabled={readOnly} />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </TooltipProvider>
    </AppShell>
  );
}