import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { RequirePermission } from "@/components/RequirePermission";
import {
  MOVEMENT_TYPES, MOVEMENT_LABEL, MOVEMENT_TONE, DEPARTMENTS,
  type MovementType,
} from "@/lib/inventory";
import { istToday } from "@/lib/date";
import { toastError } from "@/lib/errorMessage";

export const Route = createFileRoute("/_authenticated/inventory/movements")({
  head: () => ({ meta: [{ title: "Stock Movements — HotelPilot" }] }),
  component: () => (<RequirePermission module="inventory"><MovementsPage /></RequirePermission>),
});

interface MovementRow {
  id: string;
  movement_type: MovementType;
  quantity: number;
  rate: number;
  amount: number;
  reference: string | null;
  reason: string | null;
  department: string | null;
  movement_date: string;
  inventory_items: { name: string; unit: string } | null;
  vendors: { name: string } | null;
}

interface ItemOpt { id: string; name: string; unit: string; last_rate: number }
interface VendorOpt { id: string; name: string }

function MovementsPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const [rows, setRows] = useState<MovementRow[]>([]);
  const [items, setItems] = useState<ItemOpt[]>([]);
  const [vendors, setVendors] = useState<VendorOpt[]>([]);
  const [filterType, setFilterType] = useState<"all" | MovementType>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const [form, setForm] = useState({
    item_id: "",
    vendor_id: "",
    movement_type: "in" as MovementType,
    quantity: "",
    rate: "",
    department: "",
    reference: "",
    reason: "",
    movement_date: istToday(),
  });

  const load = useCallback(async () => {
    if (!propertyId) return;
    let qy = supabase.from("stock_movements")
      .select("id,movement_type,quantity,rate,amount,reference,reason,department,movement_date,inventory_items(name,unit),vendors(name)")
      .eq("property_id", propertyId)
      .order("movement_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(300);
    if (filterType !== "all") qy = qy.eq("movement_type", filterType);
    const { data } = await qy;
    setRows((data ?? []) as unknown as MovementRow[]);
  }, [propertyId, filterType]);

  const loadRefs = useCallback(async () => {
    if (!propertyId) return;
    const [it, vd] = await Promise.all([
      supabase.from("inventory_items").select("id,name,unit,last_rate")
        .eq("property_id", propertyId).eq("is_active", true).order("name"),
      supabase.from("vendors").select("id,name")
        .eq("property_id", propertyId).eq("is_active", true).order("name"),
    ]);
    setItems((it.data ?? []) as unknown as ItemOpt[]);
    setVendors((vd.data ?? []) as unknown as VendorOpt[]);
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadRefs(); }, [loadRefs]);

  const filtered = useMemo(() => rows.filter((r) => {
    const n = q.toLowerCase();
    if (!n) return true;
    return (r.inventory_items?.name ?? "").toLowerCase().includes(n) ||
      (r.vendors?.name ?? "").toLowerCase().includes(n) ||
      (r.reference ?? "").toLowerCase().includes(n);
  }), [rows, q]);

  function selectItem(itemId: string) {
    const it = items.find((i) => i.id === itemId);
    setForm((f) => ({ ...f, item_id: itemId, rate: it && f.movement_type === "in" ? String(it.last_rate || "") : f.rate }));
  }

  async function save() {
    if (!propertyId) return;
    if (!form.item_id) return toast.error("Select an item");
    const qty = Number(form.quantity);
    if (!qty || Number.isNaN(qty)) return toast.error("Enter quantity");
    const rate = Number(form.rate || 0);
    const { data: u } = await supabase.auth.getUser();
    const payload = {
      property_id: propertyId,
      item_id: form.item_id,
      vendor_id: form.vendor_id || null,
      movement_type: form.movement_type,
      quantity: qty,
      rate,
      amount: qty * rate,
      reference: form.reference || null,
      reason: form.reason || null,
      department: form.department || null,
      movement_date: form.movement_date,
      created_by: u.user?.id ?? null,
    };
    const { error } = await supabase.from("stock_movements").insert(payload as never);
    if (error) return toastError(error);
    toast.success("Movement saved");
    setOpen(false);
    setForm((f) => ({ ...f, quantity: "", rate: "", reference: "", reason: "" }));
    load();
    loadRefs();
  }

  if (!propertyId) return <AppShell title="Stock Movements"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="Stock Movements">
      <div className="space-y-4 max-w-6xl">
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          <Select value={filterType} onValueChange={(v) => setFilterType(v as MovementType | "all")}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {MOVEMENT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{MOVEMENT_LABEL[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto">
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-1" />New movement</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader><DialogTitle>New stock movement</DialogTitle></DialogHeader>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 space-y-1.5">
                    <Label className="text-xs">Type</Label>
                    <Select value={form.movement_type} onValueChange={(v) => setForm((f) => ({ ...f, movement_type: v as MovementType }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MOVEMENT_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>{MOVEMENT_LABEL[t]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label className="text-xs">Item *</Label>
                    <Select value={form.item_id} onValueChange={selectItem}>
                      <SelectTrigger><SelectValue placeholder="Choose item…" /></SelectTrigger>
                      <SelectContent>
                        {items.map((i) => (
                          <SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Quantity *</Label>
                    <Input type="number" step="0.01" value={form.quantity}
                      onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Rate (₹)</Label>
                    <Input type="number" step="0.01" value={form.rate}
                      onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} />
                  </div>
                  {form.movement_type === "in" && (
                    <div className="col-span-2 space-y-1.5">
                      <Label className="text-xs">Vendor</Label>
                      <Select value={form.vendor_id} onValueChange={(v) => setForm((f) => ({ ...f, vendor_id: v }))}>
                        <SelectTrigger><SelectValue placeholder="Choose vendor…" /></SelectTrigger>
                        <SelectContent>
                          {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {form.movement_type === "out" && (
                    <div className="col-span-2 space-y-1.5">
                      <Label className="text-xs">Department</Label>
                      <Select value={form.department} onValueChange={(v) => setForm((f) => ({ ...f, department: v }))}>
                        <SelectTrigger><SelectValue placeholder="Choose department…" /></SelectTrigger>
                        <SelectContent>
                          {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d.replace("_", " ")}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Date</Label>
                    <Input type="date" value={form.movement_date}
                      onChange={(e) => setForm((f) => ({ ...f, movement_date: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Reference (Bill/PO #)</Label>
                    <Input value={form.reference}
                      onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label className="text-xs">Notes / Reason</Label>
                    <Textarea rows={2} value={form.reason}
                      onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button onClick={save}>Save</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Card><CardContent className="pt-6">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No movements yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Vendor / Dept</TableHead>
                  <TableHead>Ref</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{r.movement_date}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={MOVEMENT_TONE[r.movement_type]}>
                        {r.movement_type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{r.inventory_items?.name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{r.inventory_items?.unit ?? ""}</div>
                    </TableCell>
                    <TableCell className="text-right">{Number(r.quantity).toFixed(2)}</TableCell>
                    <TableCell className="text-right">₹{Number(r.rate).toFixed(2)}</TableCell>
                    <TableCell className="text-right font-medium">₹{Number(r.amount).toFixed(2)}</TableCell>
                    <TableCell className="text-xs">
                      {r.vendors?.name ?? r.department ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.reference ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent></Card>
      </div>
    </AppShell>
  );
}