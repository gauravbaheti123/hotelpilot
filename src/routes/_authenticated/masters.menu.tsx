import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Plus, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/masters/menu")({
  head: () => ({ meta: [{ title: "Menu — HotelPilot" }] }),
  component: MenuPage,
});

interface MenuCategory {
  id: string;
  name: string;
  kot_type: string;
  sort_order: number;
  is_active: boolean;
}
interface MenuItem {
  id: string;
  category_id: string | null;
  name: string;
  code: string | null;
  price: number;
  gst_rate: number;
  hsn_code: string | null;
  is_veg: boolean;
  is_available: boolean;
  kitchen_type: string;
}

function MenuPage() {
  const { roles } = useAuth();
  const canManage =
    roles.includes("superadmin") || roles.includes("owner") || roles.includes("manager");
  const { current, loading: propLoading } = useCurrentProperty();
  const [cats, setCats] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [catOpen, setCatOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<Partial<MenuCategory> | null>(null);
  const [itemOpen, setItemOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Partial<MenuItem> | null>(null);

  async function load() {
    if (!current) return;
    setLoading(true);
    const [c, i] = await Promise.all([
      supabase.from("menu_categories").select("*").eq("property_id", current.id).order("sort_order"),
      supabase.from("menu_items").select("*").eq("property_id", current.id).order("name"),
    ]);
    if (c.error) toast.error(c.error.message);
    if (i.error) toast.error(i.error.message);
    setCats((c.data ?? []) as MenuCategory[]);
    setItems((i.data ?? []) as MenuItem[]);
    setLoading(false);
  }

  useEffect(() => {
    if (current) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  async function saveCat() {
    if (!editingCat?.name || !current) return toast.error("Name required");
    const payload: any = {
      property_id: current.id,
      name: editingCat.name,
      kot_type: editingCat.kot_type ?? "kitchen",
      sort_order: Number(editingCat.sort_order ?? 0),
      is_active: editingCat.is_active ?? true,
    };
    const { error } = editingCat.id
      ? await supabase.from("menu_categories").update(payload).eq("id", editingCat.id)
      : await supabase.from("menu_categories").insert(payload);
    if (error) return toast.error(error.message);
    setCatOpen(false);
    setEditingCat(null);
    toast.success("Saved");
    load();
  }

  async function saveItem() {
    if (!editingItem?.name || !current) return toast.error("Name required");
    const payload: any = {
      property_id: current.id,
      category_id: editingItem.category_id ?? null,
      name: editingItem.name,
      code: editingItem.code ?? null,
      price: Number(editingItem.price ?? 0),
      gst_rate: Number(editingItem.gst_rate ?? 5),
      hsn_code: editingItem.hsn_code ?? null,
      is_veg: editingItem.is_veg ?? true,
      is_available: editingItem.is_available ?? true,
      kitchen_type: editingItem.kitchen_type ?? "hotel",
    };
    const { error } = editingItem.id
      ? await supabase.from("menu_items").update(payload).eq("id", editingItem.id)
      : await supabase.from("menu_items").insert(payload);
    if (error) return toast.error(error.message);
    setItemOpen(false);
    setEditingItem(null);
    toast.success("Saved");
    load();
  }

  async function removeCat(c: MenuCategory) {
    if (!confirm(`Delete "${c.name}"?`)) return;
    const { error } = await supabase.from("menu_categories").delete().eq("id", c.id);
    if (error) return toast.error(error.message);
    load();
  }
  async function removeItem(i: MenuItem) {
    if (!confirm(`Delete "${i.name}"?`)) return;
    const { error } = await supabase.from("menu_items").delete().eq("id", i.id);
    if (error) return toast.error(error.message);
    load();
  }

  if (propLoading) {
    return (
      <AppShell title="Menu">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AppShell>
    );
  }
  if (!current) {
    return (
      <AppShell title="Menu">
        <EmptyPropertyState />
      </AppShell>
    );
  }

  return (
    <AppShell title="Menu">
      <div className="max-w-6xl space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Menu categories</CardTitle>
            {canManage && (
              <Dialog open={catOpen} onOpenChange={setCatOpen}>
                <DialogTrigger asChild>
                  <Button
                    size="sm"
                    onClick={() =>
                      setEditingCat({
                        name: "",
                        kot_type: "kitchen",
                        sort_order: 0,
                        is_active: true,
                      })
                    }
                  >
                    <Plus className="h-4 w-4 mr-1" /> Category
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{editingCat?.id ? "Edit category" : "New category"}</DialogTitle>
                  </DialogHeader>
                  {editingCat && (
                    <div className="space-y-3">
                      <Field label="Name">
                        <Input
                          value={editingCat.name ?? ""}
                          onChange={(e) => setEditingCat({ ...editingCat, name: e.target.value })}
                        />
                      </Field>
                      <Field label="KOT printer">
                        <Select
                          value={editingCat.kot_type ?? "kitchen"}
                          onValueChange={(v) => setEditingCat({ ...editingCat, kot_type: v })}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="kitchen">Kitchen</SelectItem>
                            <SelectItem value="bar">Bar</SelectItem>
                            <SelectItem value="both">Both</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Sort order">
                        <Input
                          type="number"
                          value={editingCat.sort_order ?? 0}
                          onChange={(e) =>
                            setEditingCat({ ...editingCat, sort_order: Number(e.target.value) })
                          }
                        />
                      </Field>
                    </div>
                  )}
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setCatOpen(false)}>Cancel</Button>
                    <Button onClick={saveCat}>Save</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </CardHeader>
          <CardContent>
            {cats.length === 0 ? (
              <p className="text-sm text-muted-foreground">No categories yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>KOT</TableHead>
                    <TableHead>Sort</TableHead>
                    {canManage && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cats.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell><Badge variant="outline">{c.kot_type}</Badge></TableCell>
                      <TableCell>{c.sort_order}</TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          <Button size="icon" variant="ghost" className="h-7 w-7"
                            onClick={() => { setEditingCat(c); setCatOpen(true); }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                            onClick={() => removeCat(c)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Menu items</CardTitle>
            {canManage && (
              <Dialog open={itemOpen} onOpenChange={setItemOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" disabled={cats.length === 0}
                    onClick={() =>
                      setEditingItem({
                        category_id: cats[0]?.id,
                        name: "",
                        price: 0,
                        gst_rate: 5,
                        is_veg: true,
                        is_available: true,
                      })
                    }>
                    <Plus className="h-4 w-4 mr-1" /> Item
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{editingItem?.id ? "Edit item" : "New item"}</DialogTitle>
                  </DialogHeader>
                  {editingItem && (
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Name">
                        <Input value={editingItem.name ?? ""}
                          onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })} />
                      </Field>
                      <Field label="Code">
                        <Input value={editingItem.code ?? ""}
                          onChange={(e) => setEditingItem({ ...editingItem, code: e.target.value })} />
                      </Field>
                      <Field label="Category">
                        <Select value={editingItem.category_id ?? ""}
                          onValueChange={(v) => setEditingItem({ ...editingItem, category_id: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {cats.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="HSN code">
                        <Input value={editingItem.hsn_code ?? ""}
                          onChange={(e) => setEditingItem({ ...editingItem, hsn_code: e.target.value })} />
                      </Field>
                      <Field label="Price (₹)">
                        <Input type="number" value={editingItem.price ?? 0}
                          onChange={(e) => setEditingItem({ ...editingItem, price: Number(e.target.value) })} />
                      </Field>
                      <Field label="GST %">
                        <Input type="number" value={editingItem.gst_rate ?? 5}
                          onChange={(e) => setEditingItem({ ...editingItem, gst_rate: Number(e.target.value) })} />
                      </Field>
                      <Field label="Veg">
                        <Switch checked={editingItem.is_veg ?? true}
                          onCheckedChange={(v) => setEditingItem({ ...editingItem, is_veg: v })} />
                      </Field>
                      <Field label="Available">
                        <Switch checked={editingItem.is_available ?? true}
                          onCheckedChange={(v) => setEditingItem({ ...editingItem, is_available: v })} />
                      </Field>
                      <Field label="Kitchen">
                        <Select value={editingItem.kitchen_type ?? "hotel"}
                          onValueChange={(v) => setEditingItem({ ...editingItem, kitchen_type: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="hotel">Hotel Kitchen</SelectItem>
                            <SelectItem value="restaurant">Restaurant Kitchen</SelectItem>
                            <SelectItem value="bar">Bar</SelectItem>
                            <SelectItem value="banquet">Banquet Kitchen</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                  )}
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setItemOpen(false)}>Cancel</Button>
                    <Button onClick={saveItem}>Save</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {cats.length === 0 ? "Add a category first, then create items." : "No items yet."}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead></TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>GST</TableHead>
                    <TableHead>Kitchen</TableHead>
                    <TableHead>Available</TableHead>
                    {canManage && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>
                        <span className={`inline-block h-3 w-3 rounded-sm border ${
                          i.is_veg ? "border-emerald-600 bg-emerald-500/30" : "border-rose-600 bg-rose-500/30"
                        }`} />
                      </TableCell>
                      <TableCell className="font-medium">{i.name}</TableCell>
                      <TableCell>{cats.find((c) => c.id === i.category_id)?.name ?? "—"}</TableCell>
                      <TableCell>₹{i.price}</TableCell>
                      <TableCell>{i.gst_rate}%</TableCell>
                      <TableCell><Badge variant="outline">{i.kitchen_type}</Badge></TableCell>
                      <TableCell>
                        <Badge variant={i.is_available ? "default" : "secondary"}>
                          {i.is_available ? "Yes" : "No"}
                        </Badge>
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          <Button size="icon" variant="ghost" className="h-7 w-7"
                            onClick={() => { setEditingItem(i); setItemOpen(true); }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                            onClick={() => removeItem(i)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      )}
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