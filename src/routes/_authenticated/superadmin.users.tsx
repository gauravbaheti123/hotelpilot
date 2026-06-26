import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/superadmin/users")({
  head: () => ({ meta: [{ title: "User Role Assignments — HotelPilot" }] }),
  component: UsersPage,
});

interface Property { id: string; name: string }
interface RoleOption { id: string; name: string }
interface AssignRow {
  ur_id: string;
  user_id: string;
  email: string;
  property_id: string | null;
  property_name: string;
  role_id: string | null;
}

function UsersPage() {
  const { roles: appRoles, loading } = useAuth();
  const isSuperadmin = appRoles.includes("superadmin");
  const isOwner = appRoles.includes("owner");
  const canAccess = isSuperadmin || isOwner;
  const [properties, setProperties] = useState<Property[]>([]);
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);
  const [rows, setRows] = useState<AssignRow[]>([]);

  async function load() {
    const [{ data: props }, { data: rs }, { data: urs }] = await Promise.all([
      supabase.from("properties").select("id,name").order("name"),
      supabase.from("roles").select("id,name").order("name"),
      supabase.from("user_roles").select("id,user_id,role_id,property_id"),
    ]);
    setProperties((props ?? []) as Property[]);
    setRoleOptions((rs ?? []) as RoleOption[]);

    const userIds = Array.from(new Set((urs ?? []).map((u) => u.user_id)));
    let emails: Record<string, string> = {};
    if (userIds.length) {
      const { data: profs } = await supabase.from("profiles").select("id,email").in("id", userIds);
      for (const p of profs ?? []) emails[p.id] = p.email ?? "";
    }
    const propsMap: Record<string, string> = {};
    for (const p of props ?? []) propsMap[p.id] = p.name;

    setRows(
      (urs ?? []).map((u: any) => ({
        ur_id: u.id,
        user_id: u.user_id,
        email: emails[u.user_id] ?? u.user_id,
        property_id: u.property_id,
        property_name: u.property_id ? (propsMap[u.property_id] ?? "—") : "All (global)",
        role_id: u.role_id,
      })),
    );
  }

  useEffect(() => {
    if (canAccess) load();
  }, [canAccess]);

  async function assign(ur_id: string, role_id: string) {
    const { error } = await supabase
      .from("user_roles")
      .update({ role_id: role_id || null })
      .eq("id", ur_id);
    if (error) return toast.error(error.message);
    toast.success("Role assigned");
    load();
  }

  if (loading) return <AppShell title="User Roles"><div className="text-muted-foreground">Loading…</div></AppShell>;

  if (!canAccess) {
    return (
      <AppShell title="User Roles">
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
    <AppShell title="User Roles">
      <div className="max-w-5xl space-y-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">User Role Assignments</h2>
          <p className="text-sm text-muted-foreground">
            Assign a role template to each user / property pairing.
          </p>
        </div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">No user assignments yet.</TableCell></TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={r.ur_id}>
                    <TableCell className="font-medium">{r.email}</TableCell>
                    <TableCell>{r.property_name}</TableCell>
                    <TableCell>
                      <Select value={r.role_id ?? ""} onValueChange={(v) => assign(r.ur_id, v)}>
                        <SelectTrigger className="w-56"><SelectValue placeholder="Select role…" /></SelectTrigger>
                        <SelectContent>
                          {roleOptions.map((o) => (
                            <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
