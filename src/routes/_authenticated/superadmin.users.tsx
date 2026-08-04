import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { usePropertyId } from "@/hooks/use-property";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, UserPlus, KeyRound, Trash2, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import {
  createStaffUser,
  resetStaffPassword,
  deleteStaffUser,
  assignRoleTemplate,
  setUserActive,
} from "@/lib/staff-users.functions";
import { Manage2FADialog } from "@/components/Manage2FADialog";
import { reportQueryError } from "@/lib/queryError";

export const Route = createFileRoute("/_authenticated/superadmin/users")({
  head: () => ({ meta: [{ title: "User Management — HotelPilot" }] }),
  component: UsersPage,
});

interface Property { id: string; name: string }
interface RoleOption { id: string; name: string; property_id: string | null }
interface AssignRow {
  ur_id: string;
  user_id: string;
  email: string;
  name: string;
  is_active: boolean;
  property_id: string | null;
  property_name: string;
  role_id: string | null;
  role: string;
  totp_enabled: boolean;
  totp_locked_until: string | null;
  totp_created_at: string | null;
}

const APP_ROLE_ENUM = ["manager", "receptionist", "housekeeping", "kitchen"] as const;
type AppRoleEnum = (typeof APP_ROLE_ENUM)[number];

function deriveAppRole(roleName: string): AppRoleEnum {
  const n = roleName.toLowerCase();
  if (n.includes("kitchen") || n.includes("chef") || n.includes("food")) return "kitchen";
  if (n.includes("housekeep")) return "housekeeping";
  if (n.includes("recept") || n.includes("front")) return "receptionist";
  return "manager";
}

function randomPassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s + "!";
}

function UsersPage() {
  const { roles: appRoles, loading } = useAuth();
  const isSuperadmin = appRoles.includes("superadmin");
  const isOwner = appRoles.includes("owner");
  const canAccess = isSuperadmin || isOwner;
  const navigate = useNavigate();
  const currentPropertyId = usePropertyId();

  const [properties, setProperties] = useState<Property[]>([]);
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);
  const [allRoles, setAllRoles] = useState<RoleOption[]>([]);
  const [rows, setRows] = useState<AssignRow[]>([]);

  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: randomPassword(), role_id: "" });
  const [busy, setBusy] = useState(false);

  const [resetTarget, setResetTarget] = useState<AssignRow | null>(null);
  const [resetPw, setResetPw] = useState("");
  const [tfaTarget, setTfaTarget] = useState<AssignRow | null>(null);

  const createFn = useServerFn(createStaffUser);
  const resetFn = useServerFn(resetStaffPassword);
  const deleteFn = useServerFn(deleteStaffUser);
  const assignFn = useServerFn(assignRoleTemplate);
  const setActiveFn = useServerFn(setUserActive);

  useEffect(() => {
    if (!loading && !canAccess) {
      toast.error("Access denied");
      navigate({ to: "/dashboard", replace: true });
    }
  }, [loading, canAccess, navigate]);

  async function load() {
    let urQuery = supabase.from("user_roles").select("id,user_id,role_id,property_id,role");
    if (!isSuperadmin && currentPropertyId) {
      urQuery = urQuery.eq("property_id", currentPropertyId);
    }
    let roleQuery = supabase.from("roles").select("id,name,property_id").order("name");
    if (currentPropertyId) {
      roleQuery = roleQuery.or(`property_id.is.null,property_id.eq.${currentPropertyId}`);
    }
    const [{ data: props }, { data: rs }, { data: urs }] = await Promise.all([
      supabase.from("properties").select("id,name").order("name"),
      roleQuery,
      urQuery,
    ]);
    setProperties((props ?? []) as Property[]);
    // Every role template visible to this admin (system + custom).
    setAllRoles(((rs ?? []) as RoleOption[]).filter(
      (r) => isSuperadmin || !/^superadmin$/i.test(r.name),
    ));
    // Exclude Owner/Superadmin templates from assignable list
    setRoleOptions(((rs ?? []) as RoleOption[]).filter(
      (r) => !/^(owner|superadmin)$/i.test(r.name)
    ));

    const userIds = Array.from(new Set((urs ?? []).map((u: any) => u.user_id)));
    const emails: Record<string, string> = {};
    const names: Record<string, string> = {};
    const actives: Record<string, boolean> = {};
    const totp: Record<string, { enabled: boolean; locked_until: string | null; created_at: string | null }> = {};
    if (userIds.length) {
      const { data: profs, error: __qe1 } = await supabase
        .from("profiles").select("id,email,name,is_active").in("id", userIds);
      if (__qe1) reportQueryError("profiles", __qe1);
      for (const p of profs ?? []) {
        emails[p.id] = (p as any).email ?? "";
        names[p.id] = (p as any).name ?? "";
        actives[p.id] = (p as any).is_active ?? true;
      }
      if (isSuperadmin) {
        const { data: totps, error: __qe2 } = await supabase
          .from("user_totp_secrets")
          .select("user_id,enabled,locked_until,created_at")
          .in("user_id", userIds);
        if (__qe2) reportQueryError("user totp secrets", __qe2);
        for (const t of totps ?? []) {
          totp[(t as any).user_id] = {
            enabled: !!(t as any).enabled,
            locked_until: (t as any).locked_until ?? null,
            created_at: (t as any).created_at ?? null,
          };
        }
      }
    }
    const propsMap: Record<string, string> = {};
    for (const p of props ?? []) propsMap[p.id] = p.name;

    setRows(
      (urs ?? []).map((u: any) => ({
        ur_id: u.id,
        user_id: u.user_id,
        email: emails[u.user_id] || "—",
        name: names[u.user_id] ?? "",
        is_active: actives[u.user_id] ?? true,
        property_id: u.property_id,
        property_name: u.property_id ? (propsMap[u.property_id] ?? "—") : "All (global)",
        role_id: u.role_id,
        role: u.role ?? "",
        totp_enabled: totp[u.user_id]?.enabled ?? false,
        totp_locked_until: totp[u.user_id]?.locked_until ?? null,
        totp_created_at: totp[u.user_id]?.created_at ?? null,
      })),
    );
  }

  useEffect(() => { if (canAccess) load(); }, [canAccess, currentPropertyId]);

  // Owners only see/manage assignments scoped to a property they belong to and below their level.
  const visibleRows = useMemo(() => {
    if (isSuperadmin) return rows;
    return rows.filter((r) => r.role !== "superadmin" && r.role !== "owner");
  }, [rows, isSuperadmin]);

  function canManage(r: AssignRow) {
    if (isSuperadmin) return true;
    return r.role !== "superadmin" && r.role !== "owner";
  }

  async function assign(ur_id: string, role_id: string) {
    try {
      await assignFn({ data: { ur_id, role_id: role_id || null } });
      const r = rows.find((x) => x.ur_id === ur_id);
      toast.success(`Role updated${r?.name ? ` for ${r.name}` : ""}`);
      load();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  async function toggleActive(r: AssignRow) {
    try {
      await setActiveFn({ data: { user_id: r.user_id, active: !r.is_active } });
      toast.success(!r.is_active ? "User activated" : "User deactivated");
      load();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  async function onCreate() {
    if (!form.email || !form.password) return toast.error("Email and password required");
    const property_id = isSuperadmin ? (currentPropertyId ?? properties[0]?.id) : currentPropertyId;
    if (!property_id) return toast.error("Select a property first");
    if (!form.role_id) return toast.error("Select a role");
    const chosen = roleOptions.find((r) => r.id === form.role_id);
    const appRole = deriveAppRole(chosen?.name ?? "");
    setBusy(true);
    try {
      await createFn({ data: {
        name: form.name, email: form.email, password: form.password,
        role: appRole, property_id, role_id: form.role_id,
      } });
      toast.success("Staff user created");
      setShowNew(false);
      setForm({ name: "", email: "", password: randomPassword(), role_id: "" });
      load();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  }

  async function onReset() {
    if (!resetTarget) return;
    if (resetPw.length < 8) return toast.error("Password must be 8+ chars");
    try {
      await resetFn({ data: { user_id: resetTarget.user_id, password: resetPw } });
      toast.success("Password reset");
      setResetTarget(null); setResetPw("");
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  async function onDelete(r: AssignRow) {
    if (!confirm(`Delete user ${r.email}? This removes their access and account.`)) return;
    try {
      await deleteFn({ data: { user_id: r.user_id } });
      toast.success("User deleted");
      load();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  if (loading) return <AppShell title="User Management"><div className="text-muted-foreground">Loading…</div></AppShell>;
  if (!canAccess) {
    return (
      <AppShell title="User Management">
        <Card className="max-w-md">
          <CardHeader><div className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" /><CardTitle>Access denied</CardTitle></div></CardHeader>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell title="User Management">
      <div className="max-w-6xl space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">User Management</h2>
            <p className="text-sm text-muted-foreground">Create staff logins and assign role templates for this property.</p>
          </div>
          <Button onClick={() => setShowNew(true)}><UserPlus className="h-4 w-4 mr-1" /> New User</Button>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>2FA</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No users yet.</TableCell></TableRow>
                )}
                {visibleRows.map((r) => {
                  const editable = canManage(r);
                  const locked = r.totp_locked_until && new Date(r.totp_locked_until).getTime() > Date.now();
                  return (
                  <TableRow key={r.ur_id}>
                    <TableCell className="font-medium">{r.name || "—"}</TableCell>
                    <TableCell>{r.email}</TableCell>
                    <TableCell className="capitalize">{r.role}</TableCell>
                    <TableCell>
                      {r.is_active
                        ? <Badge className="bg-green-600 hover:bg-green-600">Active</Badge>
                        : <Badge variant="secondary">Inactive</Badge>}
                    </TableCell>
                    <TableCell>
                      {locked
                        ? <Badge variant="destructive">Locked</Badge>
                        : r.totp_enabled
                          ? <Badge className="bg-green-600 hover:bg-green-600">Active</Badge>
                          : <Badge variant="secondary">Not enabled</Badge>}
                    </TableCell>
                    <TableCell>
                      <Select value={r.role_id ?? ""} onValueChange={(v) => assign(r.ur_id, v)} disabled={!editable}>
                        <SelectTrigger className="w-52"><SelectValue placeholder="Select template…" /></SelectTrigger>
                        <SelectContent>
                          {roleOptions.map((o) => (
                            <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      {isSuperadmin && (
                        <Button size="sm" variant="outline" onClick={() => setTfaTarget(r)}>
                          <ShieldCheck className="h-3.5 w-3.5 mr-1" /> 2FA
                        </Button>
                      )}
                      <Button size="sm" variant="outline" disabled={!editable}
                        onClick={() => { setResetTarget(r); setResetPw(randomPassword()); }}>
                        <KeyRound className="h-3.5 w-3.5 mr-1" /> Reset
                      </Button>
                      <Button size="sm" variant="outline" disabled={!editable} onClick={() => toggleActive(r)}>
                        {r.is_active ? "Deactivate" : "Activate"}
                      </Button>
                      <Button size="sm" variant="destructive" disabled={!editable} onClick={() => onDelete(r)}>
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Role Templates &amp; Permissions</CardTitle>
            <p className="text-sm text-muted-foreground">
              These are the templates shown in the <strong>Template</strong> column above. Editing a template&apos;s
              permission grid applies immediately to every user assigned to it.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Template</TableHead>
                  <TableHead>Users assigned</TableHead>
                  <TableHead className="text-right">Permissions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allRoles.length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">No role templates yet.</TableCell></TableRow>
                )}
                {allRoles.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {rows.filter((u) => u.role_id === r.id).length}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link to="/superadmin/roles/$id" params={{ id: r.id }}>
                          <SlidersHorizontal className="h-3.5 w-3.5 mr-1" /> Edit permission grid
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Staff User</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Full name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Email (login)</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div>
              <Label>Temporary password</Label>
              <div className="flex gap-2">
                <Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                <Button type="button" variant="outline" onClick={() => setForm({ ...form, password: randomPassword() })}>Regenerate</Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Share these credentials securely. Email invites require email setup.</p>
            </div>
            <div>
              <Label>Role</Label>
              <Select value={form.role_id} onValueChange={(v) => setForm({ ...form, role_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select role…" /></SelectTrigger>
                <SelectContent>
                  {roleOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                System roles and custom roles for this property. Manage them in Roles & Permissions.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button onClick={onCreate} disabled={busy}>{busy ? "Creating…" : "Create user"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetTarget} onOpenChange={(v) => { if (!v) { setResetTarget(null); setResetPw(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reset password — {resetTarget?.email}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>New password</Label>
            <div className="flex gap-2">
              <Input value={resetPw} onChange={(e) => setResetPw(e.target.value)} />
              <Button type="button" variant="outline" onClick={() => setResetPw(randomPassword())}>Regenerate</Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setResetTarget(null); setResetPw(""); }}>Cancel</Button>
            <Button onClick={onReset}>Reset password</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {tfaTarget && (
        <Manage2FADialog
          user={{
            userId: tfaTarget.user_id,
            email: tfaTarget.email,
            name: tfaTarget.name,
            enabled: tfaTarget.totp_enabled,
            lockedUntil: tfaTarget.totp_locked_until,
            createdAt: tfaTarget.totp_created_at,
          }}
          onClose={() => { setTfaTarget(null); load(); }}
        />
      )}
    </AppShell>
  );
}