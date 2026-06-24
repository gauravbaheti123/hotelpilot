import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/properties")({
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
  const canManage =
    roles.includes("superadmin") || roles.includes("owner") || roles.includes("manager");
  const [rows, setRows] = useState<PropertyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<PropertyRow> | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("properties")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) toast.error(error.message);
    setRows((data ?? []) as PropertyRow[]);
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">All properties</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No properties yet. Create your first one to begin.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead>GSTIN</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell>{r.city ?? "—"}</TableCell>
                      <TableCell>{r.gstin ?? "—"}</TableCell>
                      <TableCell>{r.phone ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={r.is_active ? "default" : "secondary"}>
                          {r.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {canManage && (
                          <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
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