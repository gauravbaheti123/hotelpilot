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
import {
  useBulkSelect,
  BulkSelectHead,
  BulkSelectCell,
  BulkDeleteButton,
  BulkDeleteDialog,
} from "@/components/master/useBulkSelect";
import { BulkCsvButtons } from "@/components/master/BulkCsvButtons";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/masters/menu")({
  head: () => ({ meta: [{ title: "Menu — HotelPilot" }] }),
  component: () => (<RequirePermission module="master_data"><MenuPage /></RequirePermission>),
});

interface MenuCategory {
  id: string;
  name: string;
  kot_type: string;
  sort_order: number;
  is_active: boolean;
  kot_printer_id: string | null;
}
interface MenuItem {
  id: string;
  category_id: string | null;
  name: string;
  code: string | null;
  short_code: string | null;
  price: number;
  gst_rate: number;
  hsn_code: string | null;
  is_veg: boolean;
  is_available: boolean;
  kitchen_type: string;
  kitchen_printer_id: string | null;
}
interface PrinterOption {
  id: string;
  name: string;
  location: string | null;
  type: string;
}

function MenuPage() {
  const { roles } = useAuth();
  const canManage =
    roles.includes("superadmin") || roles.includes("owner") || roles.includes("manager");
  const { current, loading: propLoading } = useCurrentProperty();
  const [cats, setCats] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [printers, setPrinters] = useState<PrinterOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [catOpen, setCatOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<Partial<MenuCategory> | null>(null);
  const [itemOpen, setItemOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Partial<MenuItem> | null>(null);
  const itemBulk = useBulkSelect(items, "menu_items", () => load());

  async function load() {
    if (!current) return;
    setLoading(true);
    const [c, i, p] = await Promise.all([
      supabase.from("menu_categories").select("*").eq("property_id", current.id).order("sort_order"),
      supabase.from("menu_items").select("*").eq("property_id", current.id).order("name"),
      supabase.from("printers")
        .select("id,name,location,type")
        .eq("property_id", current.id)
        .eq("is_active", true)
        .in("type", ["kot", "both"])
        .order("name"),
    ]);
    if (c.error) toast.error(c.error.message);
    if (i.error) toast.error(i.error.message);
    setCats((c.data ?? []) as MenuCategory[]);
    setItems((i.data ?? []) as MenuItem[]);
    setPrinters((p.data ?? []) as PrinterOption[]);
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
      kot_printer_id: editingCat.kot_printer_id ?? null,
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
    const sc = (editingItem.short_code ?? "").trim();
    // Duplicate short codes are allowed — when the same code matches multiple
    // items, the New KOT screen prompts the user to pick one.
    const payload: any = {
      property_id: current.id,
      category_id: editingItem.category_id ?? null,
      name: editingItem.name,
      code: editingItem.code ?? null,
      short_code: sc || null,
      price: Number(editingItem.price ?? 0),
      gst_rate: Number(editingItem.gst_rate ?? 5),
      hsn_code: editingItem.hsn_code ?? null,
      is_veg: editingItem.is_veg ?? true,
      is_available: editingItem.is_available ?? true,
      kitchen_type: editingItem.kitchen_type ?? "hotel",
      kitchen_printer_id: editingItem.kitchen_printer_id ?? null,
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
                        {printers.length === 0 ? (
                          <p className="text-xs text-muted-foreground border rounded px-2 py-2">
                            No KOT printers configured. Add printers in Master Data → Printers.
                          </p>
                        ) : (
                          <Select
                            value={editingCat.kot_printer_id ?? "none"}
                            onValueChange={(v) =>
                              setEditingCat({ ...editingCat, kot_printer_id: v === "none" ? null : v })
                            }
                          >
                            <SelectTrigger><SelectValue placeholder="Select printer" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">— Unassigned —</SelectItem>
                              {printers.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name}{p.location ? ` · ${p.location}` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
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
                    <TableHead>KOT printer</TableHead>
                    <TableHead>Sort</TableHead>
                    {canManage && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cats.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>
                        {(() => {
                          const pr = printers.find((p) => p.id === c.kot_printer_id);
                          return pr ? (
                            <Badge variant="outline">{pr.name}</Badge>
                          ) : (
                            <Badge variant="destructive">Not assigned</Badge>
                          );
                        })()}
                      </TableCell>
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
              <div className="flex items-center gap-2 flex-wrap">
                {current && (
                  <BulkCsvButtons
                    table="menu_items"
                    propertyId={current.id}
                    module="menu-items"
                    hotelName={current.name}
                    extraDefaults={{ property_id: current.id }}
                    columns={[
                      { header: "name", field: "name", required: true },
                    { header: "short_code", field: "short_code" },
                      { header: "category_name", required: true,
                        format: (_v, row) =>
                          cats.find((c) => c.id === (row as { category_id?: string }).category_id)?.name ?? "" },
                      { header: "price", field: "price",
                        parse: (v) => Number(v || 0),
                        format: (v) => (v == null ? "" : String(v)) },
                      { header: "gst_rate", field: "gst_rate",
                        parse: (v) => Number(v || 0),
                        format: (v) => (v == null ? "" : String(v)) },
                      { header: "is_veg", field: "is_veg",
                        parse: (v) => v.toLowerCase() !== "false" && v !== "0" && v !== "",
                        format: (v) => (v ? "true" : "false") },
                      { header: "is_available", field: "is_available",
                        parse: (v) => v.toLowerCase() !== "false" && v !== "0" && v !== "",
                        format: (v) => (v ? "true" : "false") },
                      { header: "kitchen_type", field: "kitchen_type" },
                    ]}
                    transformRow={(row) => {
                      const name = String(row["category_name"] ?? "").trim().toLowerCase();
                      if (!name) throw new Error("category_name required");
                      const match = cats.find((c) => c.name.toLowerCase() === name);
                      if (!match) throw new Error(`Unknown category: ${row["category_name"]}`);
                      (row as Record<string, unknown>).category_id = match.id;
                      delete (row as Record<string, unknown>)["category_name"];
                      return row;
                    }}
                    onImported={load}
                  />
                )}
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
                      <Field label="Short Code">
                        <Input
                          value={editingItem.short_code ?? ""}
                          onChange={(e) => setEditingItem({ ...editingItem, short_code: e.target.value })}
                          placeholder="e.g. MC"
                        />
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Optional — lets staff search this item quickly using a short code instead of the full name
                        </p>
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
                      <Field label="Kitchen printer">
                        {printers.length === 0 ? (
                          <p className="text-xs text-muted-foreground border rounded px-2 py-2">
                            No KOT printers configured. Add printers in Master Data → Printers.
                          </p>
                        ) : (
                          <Select
                            value={editingItem.kitchen_printer_id ?? "none"}
                            onValueChange={(v) =>
                              setEditingItem({ ...editingItem, kitchen_printer_id: v === "none" ? null : v })
                            }
                          >
                            <SelectTrigger><SelectValue placeholder="Inherit from category" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">— Inherit from category —</SelectItem>
                              {printers.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name}{p.location ? ` · ${p.location}` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </Field>
                    </div>
                  )}
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setItemOpen(false)}>Cancel</Button>
                    <Button onClick={saveItem}>Save</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              </div>
            )}
          </CardHeader>
          {canManage && itemBulk.selected.size > 0 && (
            <div className="px-6 pb-2">
              <BulkDeleteButton bulk={itemBulk as never} />
            </div>
          )}
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
                    {canManage && <BulkSelectHead bulk={itemBulk as never} />}
                    <TableHead></TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Short Code</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>GST</TableHead>
                    <TableHead>Kitchen printer</TableHead>
                    <TableHead>Available</TableHead>
                    {canManage && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((i) => (
                    <TableRow key={i.id}>
                      {canManage && <BulkSelectCell bulk={itemBulk as never} id={i.id} />}
                      <TableCell>
                        <span className={`inline-block h-3 w-3 rounded-sm border ${
                          i.is_veg ? "border-emerald-600 bg-emerald-500/30" : "border-rose-600 bg-rose-500/30"
                        }`} />
                      </TableCell>
                      <TableCell className="font-medium">
                        {i.name}
                      </TableCell>
                      <TableCell>
                        {i.short_code ? (
                          <Badge variant="outline" className="text-[10px] uppercase font-mono">
                            {i.short_code}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>{cats.find((c) => c.id === i.category_id)?.name ?? "—"}</TableCell>
                      <TableCell>₹{i.price}</TableCell>
                      <TableCell>{i.gst_rate}%</TableCell>
                       <TableCell>
                        {(() => {
                          const override = i.kitchen_printer_id ?? null;
                          const pid = override ?? cats.find((c) => c.id === i.category_id)?.kot_printer_id;
                          const pr = printers.find((p) => p.id === pid);
                          if (!pr) {
                            return (
                              <Badge variant="destructive">No printer — won't print</Badge>
                            );
                          }
                          return (
                            <div className="flex flex-col gap-0.5">
                              <Badge variant="outline">{pr.name}</Badge>
                              <span className="text-[10px] text-muted-foreground">
                                {override ? "item override" : "from category"}
                              </span>
                            </div>
                          );
                        })()}
                      </TableCell>
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
      <BulkDeleteDialog bulk={itemBulk as never} />
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