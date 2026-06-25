import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, Plus, Pencil } from "lucide-react";
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
  const [rows, setRows] = useState<RoleRow[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data: roleData, error } = await supabase
      .from("roles")
      .select("id,name,description,is_system,property_id")
      .order("is_system", { ascending: false })
      .order("name");
    if (error) {
      toast.error(error.message);
      return;
    }
    const ids = (roleData ?? []).map((r) => r.id);
    const counts: Record<string, number> = {};
    if (ids.length) {
      const { data: urs } = await supabase
        .from("user_roles")
        .select("role_id")
        .in("role_id", ids);
      for (const u of urs ?? []) {
        if (u.role_id) counts[u.role_id] = (counts[u.role_id] ?? 0) + 1;
      }
    }
    setRows(
      (roleData ?? []).map((r) => ({ ...(r as any), user_count: counts[r.id] ?? 0 })),
    );
  }

  useEffect(() => {
    if (isSuperadmin) load();
  }, [isSuperadmin]);

  async function createRole() {
    if (!name.trim()) return toast.error("Name required");
    setBusy(true);
    const { error } = await supabase
      .from("roles")
      .insert({ name: name.trim(), description: desc.trim() || null, is_system: false });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Role created");
    setName("");
    setDesc("");
    setShowNew(false);
    load();
  }

  if (loading) return <AppShell title="Roles & Permissions"><div className="text-muted-foreground">Loading…</div></AppShell>;

  if (!isSuperadmin) {
    return (
      <AppShell title="Roles & Permissions">
        <Card className="max-w-md">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              <CardTitle>Access denied</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Only superadmins can manage roles.
          </CardContent>
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
            <p className="text-sm text-muted-foreground">
              Define role templates and the permissions they grant.
            </p>
          </div>
          <Button onClick={() => setShowNew((v) => !v)}>
            <Plus className="h-4 w-4 mr-1" /> New Role
          </Button>
        </div>

        {showNew && (
          <Card>
            <CardHeader><CardTitle className="text-base">Create role</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Role name (e.g. Night Auditor)" value={name} onChange={(e) => setName(e.target.value)} />
              <Textarea placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} />
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
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      <Link
                        to="/superadmin/roles/$id"
                        params={{ id: r.id }}
                        className="hover:underline"
                      >
                        {r.name}
                      </Link>
                      {r.is_system && <Badge variant="secondary" className="ml-2">System</Badge>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.description ?? "—"}</TableCell>
                    <TableCell className="text-center">{r.user_count}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link to="/superadmin/roles/$id" params={{ id: r.id }}>
                          <Pencil className="h-3.5 w-3.5 mr-1" /> Edit Permissions
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
    </AppShell>
  );
}
