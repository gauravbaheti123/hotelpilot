import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, MapPin, Phone, KeyRound, Mail, Calendar, BedDouble, LogIn, Settings, Pause, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { createOwnerLogin } from "@/lib/admin-users.functions";
import { useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/properties")({
  ssr: false,
  // Owner + superadmin only — this route is standalone (not under /superadmin/*).
  beforeLoad: async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/login" });
    const { data: allowed } = await supabase.rpc("is_owner_or_super", { _user_id: u.user.id });
    if (!allowed) throw redirect({ to: "/dashboard" });
  },
  head: () => ({ meta: [{ title: "Properties — HotelPilot" }] }),
  component: PropertiesPage,
});

interface PropertyRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  pincode: string | null;
  is_active: boolean;
  status?: "active" | "paused";
  created_at?: string;
}

const blank: Partial<PropertyRow> = {
  name: "",
  city: "",
  state: "",
  phone: "",
  email: "",
  gstin: "",
  address: "",
  pincode: "",
  is_active: true,
};

function PropertiesPage() {
  const { roles } = useAuth();
  const isSuperadmin = roles.includes("superadmin");
  const canManage =
    isSuperadmin || roles.includes("owner") || roles.includes("manager");
  const [rows, setRows] = useState<PropertyRow[]>([]);
  const [ownersByProp, setOwnersByProp] = useState<Record<string, string>>({});
  const [roomsByProp, setRoomsByProp] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<PropertyRow> | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginProp, setLoginProp] = useState<PropertyRow | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginRole, setLoginRole] = useState<"owner" | "manager" | "receptionist">("owner");
  const [creatingLogin, setCreatingLogin] = useState(false);
  const createLoginFn = useServerFn(createOwnerLogin);
  const navigate = useNavigate();

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("properties")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) toast.error(error.message);
    const list = (data ?? []) as PropertyRow[];
    setRows(list);

    const ids = list.map((p) => p.id);
    if (ids.length) {
      // owner emails via user_roles -> profiles
      const { data: ownerRoles } = await supabase
        .from("user_roles")
        .select("property_id, user_id")
        .eq("role", "owner")
        .in("property_id", ids);
      const userIds = Array.from(new Set((ownerRoles ?? []).map((r: any) => r.user_id)));
      const emailByUser: Record<string, string> = {};
      if (userIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, email")
          .in("id", userIds);
        for (const p of profs ?? []) emailByUser[(p as any).id] = (p as any).email;
      }
      const ownerMap: Record<string, string> = {};
      for (const r of ownerRoles ?? []) {
        const e = emailByUser[(r as any).user_id];
        if (e && !ownerMap[(r as any).property_id]) ownerMap[(r as any).property_id] = e;
      }
      setOwnersByProp(ownerMap);

      // rooms count per property
      const { data: rms } = await supabase
        .from("rooms")
        .select("property_id")
        .in("property_id", ids);
      const rcount: Record<string, number> = {};
      for (const r of rms ?? []) {
        const pid = (r as any).property_id;
        rcount[pid] = (rcount[pid] ?? 0) + 1;
      }
      setRoomsByProp(rcount);
    } else {
      setOwnersByProp({});
      setRoomsByProp({});
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function openNew() {
    setEditing({ ...blank });
    setOpen(true);
  }
  function openEdit(row: PropertyRow) {
    setEditing(row);
    setOpen(true);
  }

  async function save() {
    if (!editing?.name?.trim()) {
      toast.error("Property name is required");
      return;
    }
    const payload = { ...editing, name: editing.name.trim() };
    let error;
    if ((editing as PropertyRow).id) {
      ({ error } = await supabase
        .from("properties")
        .update(payload)
        .eq("id", (editing as PropertyRow).id));
    } else {
      ({ error } = await supabase.from("properties").insert(payload as any));
    }
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Saved");
    setOpen(false);
    setEditing(null);
    load();
  }

  function openCreateLogin(p: PropertyRow) {
    setLoginProp(p);
    setLoginEmail("");
    setLoginPassword("");
    setLoginRole("owner");
    setLoginOpen(true);
  }

  function loginAsOwner(p: PropertyRow) {
    localStorage.setItem("hp.currentPropertyId", p.id);
    window.dispatchEvent(new Event("hp:property-changed"));
    toast.success(`Switched to ${p.name}`);
    navigate({ to: "/dashboard" });
  }

  async function submitCreateLogin() {
    if (!loginProp) return;
    if (!loginEmail.trim() || loginPassword.length < 8) {
      toast.error("Email required and password must be 8+ characters");
      return;
    }
    setCreatingLogin(true);
    try {
      await createLoginFn({
        data: {
          email: loginEmail.trim(),
          password: loginPassword,
          role: loginRole,
          property_id: loginProp.id,
        },
      });
      toast.success(`Login created for ${loginProp.name}`);
      setLoginOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create login");
    } finally {
      setCreatingLogin(false);
    }
  }

  async function togglePause(p: PropertyRow) {
    const next = p.status === "paused" ? "active" : "paused";
    const verb = next === "paused" ? "pause" : "resume";
    if (!confirm(`Are you sure you want to ${verb} ${p.name}?`)) return;
    const { error } = await supabase
      .from("properties")
      .update({ status: next })
      .eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success(next === "paused" ? `${p.name} paused` : `${p.name} resumed`);
    load();
  }

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteProp, setDeleteProp] = useState<PropertyRow | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deletingProp, setDeletingProp] = useState(false);

  function openDelete(p: PropertyRow) {
    setDeleteProp(p);
    setDeleteConfirm("");
    setDeleteOpen(true);
  }

  async function submitDelete() {
    if (!deleteProp) return;
    if (deleteConfirm !== deleteProp.name) {
      toast.error("Type the exact hotel name to confirm");
      return;
    }
    setDeletingProp(true);
    try {
      const { deleteProperty } = await import("@/lib/admin-properties.functions");
      const fn = deleteProperty;
      await fn({ data: { property_id: deleteProp.id, confirm_name: deleteConfirm } });
      toast.success(`${deleteProp.name} deleted`);
      setDeleteOpen(false);
      setDeleteProp(null);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to delete property");
    } finally {
      setDeletingProp(false);
    }
  }

  return (
    <AppShell title="Properties">
      <div className="max-w-6xl space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Hotels and outlets you manage. Switch the active property from the header dropdown.
          </p>
          {canManage && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button onClick={openNew}>
                  <Plus className="h-4 w-4 mr-1" /> New property
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>
                    {(editing as PropertyRow)?.id ? "Edit property" : "New property"}
                  </DialogTitle>
                </DialogHeader>
                {editing && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Name *">
                      <Input
                        value={editing.name ?? ""}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      />
                    </Field>
                    <Field label="Phone">
                      <Input
                        value={editing.phone ?? ""}
                        onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                      />
                    </Field>
                    <Field label="Email">
                      <Input
                        value={editing.email ?? ""}
                        onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                      />
                    </Field>
                    <Field label="GSTIN">
                      <Input
                        value={editing.gstin ?? ""}
                        onChange={(e) => setEditing({ ...editing, gstin: e.target.value })}
                      />
                    </Field>
                    <Field label="City">
                      <Input
                        value={editing.city ?? ""}
                        onChange={(e) => setEditing({ ...editing, city: e.target.value })}
                      />
                    </Field>
                    <Field label="State">
                      <Input
                        value={editing.state ?? ""}
                        onChange={(e) => setEditing({ ...editing, state: e.target.value })}
                      />
                    </Field>
                    <Field label="Pincode">
                      <Input
                        value={editing.pincode ?? ""}
                        onChange={(e) => setEditing({ ...editing, pincode: e.target.value })}
                      />
                    </Field>
                    <div />
                    <div className="col-span-2">
                      <Field label="Address">
                        <Textarea
                          rows={2}
                          value={editing.address ?? ""}
                          onChange={(e) =>
                            setEditing({ ...editing, address: e.target.value })
                          }
                        />
                      </Field>
                    </div>
                  </div>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={save}>Save</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No properties yet. Create your first one to begin.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => (
              <Card key={r.id} className="flex flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{r.name}</CardTitle>
                    {r.status === "paused" ? (
                      <Badge className="bg-rose-600 hover:bg-rose-600 text-white">Paused</Badge>
                    ) : (
                      <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">Active</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-2 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" />
                    <span>{r.city ?? "—"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-3.5 w-3.5" />
                    <span>{r.phone ?? "—"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="h-3.5 w-3.5" />
                    <span className="truncate">{ownersByProp[r.id] ?? "No owner linked"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <BedDouble className="h-3.5 w-3.5" />
                    <span>{roomsByProp[r.id] ?? 0} rooms</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>
                      {r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}
                    </span>
                  </div>
                  {canManage && (
                    <div className="mt-auto grid grid-cols-2 gap-2 pt-3">
                      <Button size="sm" variant="default" onClick={() => loginAsOwner(r)}>
                        <Settings className="mr-1 h-3.5 w-3.5" /> Manage
                      </Button>
                      {isSuperadmin && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => loginAsOwner(r)}
                        >
                          <LogIn className="mr-1 h-3.5 w-3.5" /> Login as Owner
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
                        <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openCreateLogin(r)}
                      >
                        <KeyRound className="mr-1 h-3.5 w-3.5" /> Create Login
                      </Button>
                      {isSuperadmin && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => togglePause(r)}
                          >
                            {r.status === "paused" ? (
                              <><Play className="mr-1 h-3.5 w-3.5" /> Resume</>
                            ) : (
                              <><Pause className="mr-1 h-3.5 w-3.5" /> Pause</>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => openDelete(r)}
                          >
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Delete {deleteProp?.name}?</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                This will permanently delete <strong>{deleteProp?.name}</strong> and ALL its
                data (bookings, rooms, staff, bills, etc.). This cannot be undone.
              </p>
              <Field label={`Type "${deleteProp?.name}" to confirm`}>
                <Input
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder={deleteProp?.name ?? ""}
                />
              </Field>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={submitDelete}
                disabled={deletingProp || deleteConfirm !== deleteProp?.name}
              >
                {deletingProp ? "Deleting…" : "Delete permanently"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                Create login{loginProp ? ` — ${loginProp.name}` : ""}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Field label="Email">
                <Input
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="owner@example.com"
                />
              </Field>
              <Field label="Password (min 8 chars)">
                <Input
                  type="text"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                />
              </Field>
              <Field label="Role">
                <Select
                  value={loginRole}
                  onValueChange={(v) => setLoginRole(v as typeof loginRole)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="receptionist">Receptionist</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setLoginOpen(false)}>
                Cancel
              </Button>
              <Button onClick={submitCreateLogin} disabled={creatingLogin}>
                {creatingLogin ? "Creating…" : "Create & Link"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}