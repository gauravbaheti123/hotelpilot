import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/superadmin/roles/")({
  head: () => ({ meta: [{ title: "Roles & Permissions — HotelPilot" }] }),
  component: RolesPage,
});

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  property_id: string | null;
  user_count: number;
}

function RolesPage() {
  const { roles: appRoles, loading } = useAuth();
  const isSuperadmin = appRoles.includes("superadmin");
  const isOwner = appRoles.includes("owner");
  const canAccess = isSuperadmin || isOwner;
  const navigate = useNavigate();
  const [rows, setRows] = useState<RoleRow[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [cloneFrom, setCloneFrom] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [editingDescId, setEditingDescId] = useState<string | null>(null);
  const [descDraft, setDescDraft] = useState("");

  useEffect(() => {
    if (!loading && !canAccess) {
      toast.error("Access denied");
      navigate({ to: "/dashboard", replace: true });
    }
  }, [loading, canAccess, navigate]);

  async function load() {
    const { data: roleData, error } = await supabase
      .from("roles")
      .select("id,name,description,is_system,property_id")
      .order("is_system", { ascending: false })
      .order("name");
    if (error) { toast.error(error.message); return; }
    const ids = (roleData ?? []).map((r) => r.id);
    const counts: Record<string, number> = {};
    if (ids.length) {
      const { data: urs } = await supabase.from("user_roles").select("role_id").in("role_id", ids);
      for (const u of urs ?? []) if (u.role_id) counts[u.role_id] = (counts[u.role_id] ?? 0) + 1;
    }
    setRows((roleData ?? []).map((r) => ({ ...(r as any), user_count: counts[r.id] ?? 0 })));
  }

  useEffect(() => { if (canAccess) load(); }, [canAccess]);

  async function createRole() {
    if (!name.trim()) return toast.error("Name required");
    setBusy(true);
    const { data: created, error } = await supabase
      .from("roles")
      .insert({ name: name.trim(), description: desc.trim() || null, is_system: false })
      .select("id").single();
    if (error) { setBusy(false); return toast.error(error.message); }
    // Optional: clone permissions from another role
    if (cloneFrom && created?.id) {
      const { data: src } = await supabase
        .from("role_permissions").select("permission_id,allowed").eq("role_id", cloneFrom);
      if (src?.length) {
        await supabase.from("role_permissions").upsert(
          src.map((r: any) => ({ role_id: created.id, permission_id: r.permission_id, allowed: r.allowed })),
          { onConflict: "role_id,permission_id" },
        );
      }
    }
    setBusy(false);
    toast.success("Role created");
    setName(""); setDesc(""); setCloneFrom(""); setShowNew(false);
    load();
  }

  async function saveDescription(id: string) {
    const { error } = await supabase.from("roles").update({ description: descDraft || null }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    setEditingDescId(null);
    load();
  }

  async function deleteRole(r: RoleRow) {
    if (r.is_system) return toast.error("System roles cannot be deleted");
    if (!confirm(`Delete role "${r.name}"?`)) return;
    const { error } = await supabase.from("roles").delete().eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success("Role deleted");
    load();
  }

  if (loading) return <AppShell title="Roles & Permissions"><div className="text-muted-foreground">Loading…</div></AppShell>;
  if (!canAccess) {
    return (
      <AppShell title="Roles & Permissions">
        <Card className="max-w-md">
          <CardHeader><div className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" /><CardTitle>Access denied</CardTitle></div></CardHeader>
          <CardContent className="text-sm text-muted-foreground">Only superadmins and owners can manage roles.</CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell title="Roles & Permissions">
      <div className="max-w-5xl space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Roles</h2>
            <p className="text-sm text-muted-foreground">Define role templates and the permissions they grant.</p>
          </div>
          <Button onClick={() => setShowNew((v) => !v)}><Plus className="h-4 w-4 mr-1" /> New Role</Button>
        </div>

        {showNew && (
          <Card>
            <CardHeader><CardTitle className="text-base">Create role</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Role name (e.g. Night Auditor)" value={name} onChange={(e) => setName(e.target.value)} />
              <Textarea placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} />
              <div>
                <div className="text-sm text-muted-foreground mb-1">Clone permissions from (optional)</div>
                <Select value={cloneFrom} onValueChange={setCloneFrom}>
                  <SelectTrigger><SelectValue placeholder="Start blank" /></SelectTrigger>
                  <SelectContent>
                    {rows.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button onClick={createRole} disabled={busy}>Create</Button>
                <Button variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-center">Users</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No roles yet.</TableCell></TableRow>
                )}
                {rows.map((r) => {
                  const isPrivileged = /^(owner|superadmin)$/i.test(r.name);
                  const lockedForOwner = !isSuperadmin && isPrivileged;
                  if (lockedForOwner) return null;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        <Link to="/superadmin/roles/$id" params={{ id: r.id }} className="hover:underline">{r.name}</Link>
                        {r.is_system && <Badge variant="secondary" className="ml-2">System</Badge>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {editingDescId === r.id ? (
                          <Input
                            autoFocus
                            value={descDraft}
                            onChange={(e) => setDescDraft(e.target.value)}
                            onBlur={() => saveDescription(r.id)}
                            onKeyDown={(e) => { if (e.key === "Enter") saveDescription(r.id); if (e.key === "Escape") setEditingDescId(null); }}
                          />
                        ) : (
                          <button
                            className="text-left w-full hover:text-foreground"
                            onClick={() => { setEditingDescId(r.id); setDescDraft(r.description ?? ""); }}
                          >
                            {r.description ?? <span className="italic">Click to add description</span>}
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="text-center">{r.user_count}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button asChild size="sm" variant="outline">
                          <Link to="/superadmin/roles/$id" params={{ id: r.id }}>
                            <Pencil className="h-3.5 w-3.5 mr-1" /> Edit Permissions
                          </Link>
                        </Button>
                        {!r.is_system && (
                          <Button size="sm" variant="destructive" onClick={() => deleteRole(r)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}