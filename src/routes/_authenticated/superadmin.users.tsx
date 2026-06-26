import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
import { ShieldAlert, UserPlus, KeyRound, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createStaffUser, resetStaffPassword, deleteStaffUser } from "@/lib/staff-users.functions";

export const Route = createFileRoute("/_authenticated/superadmin/users")({
  head: () => ({ meta: [{ title: "User Management — HotelPilot" }] }),
  component: UsersPage,
});

interface Property { id: string; name: string }
interface RoleOption { id: string; name: string }
interface AssignRow {
  ur_id: string;
  user_id: string;
  email: string;
  name: string;
  property_id: string | null;
  property_name: string;
  role_id: string | null;
  role: string;
}

const ASSIGNABLE_ROLES = ["manager", "receptionist", "housekeeping", "kitchen"] as const;

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
  const [rows, setRows] = useState<AssignRow[]>([]);

  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: randomPassword(), role: "receptionist" as (typeof ASSIGNABLE_ROLES)[number], role_id: "" });
  const [busy, setBusy] = useState(false);

  const [resetTarget, setResetTarget] = useState<AssignRow | null>(null);
  const [resetPw, setResetPw] = useState("");

  const createFn = useServerFn(createStaffUser);
  const resetFn = useServerFn(resetStaffPassword);
  const deleteFn = useServerFn(deleteStaffUser);

  useEffect(() => {
    if (!loading && !canAccess) {
      toast.error("Access denied");
      navigate({ to: "/dashboard", replace: true });
    }
  }, [loading, canAccess, navigate]);

  async function load() {
    const [{ data: props }, { data: rs }, { data: urs }] = await Promise.all([
      supabase.from("properties").select("id,name").order("name"),
      supabase.from("roles").select("id,name").order("name"),
      supabase.from("user_roles").select("id,user_id,role_id,property_id,role"),
    ]);
    setProperties((props ?? []) as Property[]);
    setRoleOptions((rs ?? []) as RoleOption[]);

    const userIds = Array.from(new Set((urs ?? []).map((u: any) => u.user_id)));
    const emails: Record<string, string> = {};
    const names: Record<string, string> = {};
    if (userIds.length) {
      const { data: profs } = await supabase.from("profiles").select("id,email,name").in("id", userIds);
      for (const p of profs ?? []) { emails[p.id] = p.email ?? ""; names[p.id] = (p as any).name ?? ""; }
    }
    const propsMap: Record<string, string> = {};
    for (const p of props ?? []) propsMap[p.id] = p.name;

    setRows(
      (urs ?? []).map((u: any) => ({
        ur_id: u.id,
        user_id: u.user_id,
        email: emails[u.user_id] ?? u.user_id,
        name: names[u.user_id] ?? "",
        property_id: u.property_id,
        property_name: u.property_id ? (propsMap[u.property_id] ?? "—") : "All (global)",
        role_id: u.role_id,
        role: u.role ?? "",
      })),
    );
  }

  useEffect(() => { if (canAccess) load(); }, [canAccess]);

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
    const { error } = await supabase.from("user_roles").update({ role_id: role_id || null }).eq("id", ur_id);
    if (error) return toast.error(error.message);
    toast.success("Role assigned");
    load();
  }

  async function onCreate() {
    if (!form.email || !form.password) return toast.error("Email and password required");
    const property_id = isSuperadmin ? (currentPropertyId ?? properties[0]?.id) : currentPropertyId;
    if (!property_id) return toast.error("Select a property first");
    setBusy(true);
    try {
      await createFn({ data: {
        name: form.name, email: form.email, password: form.password,
        role: form.role, property_id, role_id: form.role_id || null,
      } });
      toast.success("Staff user created");
      setShowNew(false);
      setForm({ name: "", email: "", password: randomPassword(), role: "receptionist", role_id: "" });
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
                  <TableHead>Property</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No users yet.</TableCell></TableRow>
                )}
                {visibleRows.map((r) => {
                  const editable = canManage(r);
                  return (
                  <TableRow key={r.ur_id}>
                    <TableCell className="font-medium">{r.name || "—"}</TableCell>
                    <TableCell>{r.email}</TableCell>
                    <TableCell>{r.property_name}</TableCell>
                    <TableCell className="capitalize">{r.role}</TableCell>
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
                      <Button size="sm" variant="outline" disabled={!editable}
                        onClick={() => { setResetTarget(r); setResetPw(randomPassword()); }}>
                        <KeyRound className="h-3.5 w-3.5 mr-1" /> Reset
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
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Permission template (optional)</Label>
              <Select value={form.role_id} onValueChange={(v) => setForm({ ...form, role_id: v })}>
                <SelectTrigger><SelectValue placeholder="Use role defaults…" /></SelectTrigger>
                <SelectContent>
                  {roleOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
    </AppShell>
  );
}