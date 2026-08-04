import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ShieldAlert, Plus, Pencil, Trash2, Search, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { usePropertyId } from "@/hooks/use-property";
import {
  createCustomRole,
  updateRoleMeta,
  deleteCustomRole,
} from "@/lib/staff-users.functions";
import { reportQueryError } from "@/lib/queryError";

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
  const currentPropertyId = usePropertyId();
  const createRoleFn = useServerFn(createCustomRole);
  const updateRoleFn = useServerFn(updateRoleMeta);
  const deleteRoleFn = useServerFn(deleteCustomRole);

  const [rows, setRows] = useState<RoleRow[]>([]);
  const [tab, setTab] = useState<"all" | "system" | "custom">("all");
  const [search, setSearch] = useState("");

  // New role modal
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [cloneFrom, setCloneFrom] = useState<string>("");
  const [busy, setBusy] = useState(false);

  // Inline description editing
  const [editingDescId, setEditingDescId] = useState<string | null>(null);
  const [descDraft, setDescDraft] = useState("");

  // Inline rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null);

  useEffect(() => {
    if (!loading && !canAccess) {
      toast.error("Access denied");
      navigate({ to: "/dashboard", replace: true });
    }
  }, [loading, canAccess, navigate]);

  async function load() {
    const { data, error } = await supabase
      .from("roles")
      .select("id,name,description,is_system,property_id")
      .order("is_system", { ascending: false })
      .order("name");
    if (error) { toast.error(error.message); return; }
    const ids = (data ?? []).map((r) => r.id);
    const counts: Record<string, number> = {};
    if (ids.length) {
      const { data: urs, error: __qe1 } = await supabase.from("user_roles").select("role_id").in("role_id", ids);
      if (__qe1) reportQueryError("user roles", __qe1);
      for (const u of urs ?? []) if (u.role_id) counts[u.role_id] = (counts[u.role_id] ?? 0) + 1;
    }
    setRows((data ?? []).map((r) => ({ ...(r as any), user_count: counts[r.id] ?? 0 })));
  }

  useEffect(() => { if (canAccess) load(); }, [canAccess]);

  const visible = useMemo(() => {
    return rows.filter((r) => {
      // Hide privileged from owners
      if (!isSuperadmin && /^(owner|superadmin)$/i.test(r.name)) return false;
      if (tab === "system" && !r.is_system) return false;
      if (tab === "custom" && r.is_system) return false;
      if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [rows, tab, search, isSuperadmin]);

  async function createRole() {
    if (!name.trim()) return toast.error("Name required");
    setBusy(true);
    try {
      await createRoleFn({ data: {
        name: name.trim(),
        description: desc.trim() || null,
        property_id: isSuperadmin ? null : (currentPropertyId ?? null),
        clone_from_role_id: cloneFrom || null,
      }});
      toast.success("Role created");
      setName(""); setDesc(""); setCloneFrom(""); setShowNew(false);
      load();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  }

  async function saveDescription(id: string) {
    try {
      await updateRoleFn({ data: { role_id: id, description: descDraft || null } });
      setEditingDescId(null);
      load();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  async function saveName(id: string) {
    const trimmed = nameDraft.trim();
    if (!trimmed) { setRenamingId(null); return; }
    try {
      await updateRoleFn({ data: { role_id: id, name: trimmed } });
      setRenamingId(null);
      load();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  async function confirmDelete() {
    const r = deleteTarget; if (!r) return;
    if (r.is_system) { toast.error("System roles cannot be deleted"); setDeleteTarget(null); return; }
    if (r.user_count > 0) {
      toast.error(`Assign different role to ${r.user_count} user${r.user_count === 1 ? "" : "s"} first`);
      return;
    }
    try {
      await deleteRoleFn({ data: { role_id: r.id } });
      toast.success("Role deleted");
      setDeleteTarget(null);
      load();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
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

  const customCount = rows.filter((r) => !r.is_system && (isSuperadmin || !/^(owner|superadmin)$/i.test(r.name))).length;

  return (
    <AppShell title="Roles & Permissions">
      <div className="max-w-6xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Roles</h2>
            <p className="text-sm text-muted-foreground">Define role templates and the permissions they grant.</p>
          </div>
          <Button onClick={() => setShowNew(true)}><Plus className="h-4 w-4 mr-1" /> New Role</Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="system">System</TabsTrigger>
              <TabsTrigger value="custom">Custom</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search roles by name" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
          </div>
        </div>

        {tab === "custom" && customCount === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center space-y-3">
              <Settings2 className="h-8 w-8 mx-auto text-muted-foreground" />
              <div className="font-medium">No custom roles yet.</div>
              <p className="text-sm text-muted-foreground">Create roles like &quot;Night Auditor&quot;, &quot;F&amp;B Manager&quot;, etc.</p>
              <Button onClick={() => setShowNew(true)}><Plus className="h-4 w-4 mr-1" /> New Role</Button>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3">
          {visible.map((r) => {
            const isCustom = !r.is_system;
            return (
              <Card key={r.id} className="group">
                <CardContent className="py-4 flex flex-wrap items-start gap-4">
                  <div className="flex-1 min-w-[260px] space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {renamingId === r.id ? (
                        <Input
                          autoFocus
                          value={nameDraft}
                          onChange={(e) => setNameDraft(e.target.value)}
                          onBlur={() => saveName(r.id)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveName(r.id); if (e.key === "Escape") setRenamingId(null); }}
                          className="h-7 max-w-xs"
                        />
                      ) : (
                        <button
                          onClick={() => { if (isCustom) { setRenamingId(r.id); setNameDraft(r.name); } }}
                          className={`font-semibold text-base ${isCustom ? "hover:underline" : "cursor-default"}`}
                        >
                          {r.name}
                        </button>
                      )}
                      {r.is_system
                        ? <Badge variant="secondary">System</Badge>
                        : <Badge variant="outline">Custom</Badge>}
                      <span className="text-xs text-muted-foreground">{r.user_count} user{r.user_count === 1 ? "" : "s"} assigned</span>
                    </div>
                    {editingDescId === r.id ? (
                      <Input
                        autoFocus
                        value={descDraft}
                        onChange={(e) => setDescDraft(e.target.value)}
                        onBlur={() => saveDescription(r.id)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveDescription(r.id); if (e.key === "Escape") setEditingDescId(null); }}
                        placeholder="Describe this role…"
                      />
                    ) : (
                      <button
                        className="text-left text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 group/desc"
                        onClick={() => { setEditingDescId(r.id); setDescDraft(r.description ?? ""); }}
                        title="Click to edit description"
                      >
                        <span>{r.description ?? <span className="italic">Click to add description</span>}</span>
                        <Pencil className="h-3 w-3 opacity-0 group-hover/desc:opacity-60 transition-opacity" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link to="/superadmin/roles/$id" params={{ id: r.id }}>
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Edit Permissions
                      </Link>
                    </Button>
                    {isCustom && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => { setRenamingId(r.id); setNameDraft(r.name); }}>
                          Rename
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(r)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {visible.length === 0 && tab !== "custom" && (
            <div className="text-center text-sm text-muted-foreground py-6">No roles match your filter.</div>
          )}
        </div>
      </div>

      {/* New role modal */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create role</DialogTitle>
            <DialogDescription>Build a custom role for your property.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Role name (e.g. Night Auditor)" value={name} onChange={(e) => setName(e.target.value)} />
            <Textarea placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} />
            <div>
              <div className="text-sm text-muted-foreground mb-1">Clone permissions from (optional)</div>
              <Select value={cloneFrom} onValueChange={setCloneFrom}>
                <SelectTrigger><SelectValue placeholder="Start blank" /></SelectTrigger>
                <SelectContent>
                  {rows.map((r) => (<SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button onClick={createRole} disabled={busy}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete role {deleteTarget?.name}?</DialogTitle>
            <DialogDescription>
              {deleteTarget && deleteTarget.user_count > 0
                ? <>This role is assigned to <strong>{deleteTarget.user_count}</strong> user{deleteTarget.user_count === 1 ? "" : "s"}. Assign a different role to them first.</>
                : <>This action cannot be undone.</>}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={!!deleteTarget && deleteTarget.user_count > 0}
            >Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}