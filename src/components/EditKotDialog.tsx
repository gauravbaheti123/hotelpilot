import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { computeKotTotals } from "@/lib/food";
import { useAuth } from "@/hooks/use-auth";
import { ACTIVITY, logActivity, userDisplayName } from "@/lib/activityLog";
import { AlertTriangle, Plus, Minus, Trash2 } from "lucide-react";

interface MenuItem {
  id: string; name: string; price: number; gst_rate: number;
  kot_station: string; is_available: boolean; category_id: string | null;
}
interface EditLine {
  id?: string; // existing kot_items.id
  menu_item_id: string | null;
  item_name: string;
  qty: number;
  rate: number;
  gst_rate: number;
  kot_station: string;
  notes?: string | null;
}
interface KotSnapshot {
  id: string; kot_number: string; kot_type: string; table_no: string | null;
  booking_id: string | null; notes: string | null;
  status: string; printed_at: string | null;
  sub_total: number; gst_amount: number; total_amount: number;
  property_id: string;
  kot_items: {
    id: string; menu_item_id: string | null; item_name: string;
    qty: number; rate: number; gst_rate: number; kot_station: string; notes: string | null;
  }[];
}

export function EditKotDialog({
  kotId, open, onOpenChange, onSaved,
}: {
  kotId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [kot, setKot] = useState<KotSnapshot | null>(null);
  const [tableNo, setTableNo] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<EditLine[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [search, setSearch] = useState("");
  const [showReprint, setShowReprint] = useState(false);

  useEffect(() => {
    if (!open || !kotId) return;
    setShowReprint(false);
    setLoading(true);
    (async () => {
      const { data } = await supabase.from("kot_orders")
        .select(`id,kot_number,kot_type,table_no,booking_id,notes,status,printed_at,
          sub_total,gst_amount,total_amount,property_id,
          kot_items(id,menu_item_id,item_name,qty,rate,gst_rate,kot_station,notes)`)
        .eq("id", kotId).maybeSingle();
      const k = data as unknown as KotSnapshot | null;
      setKot(k);
      setTableNo(k?.table_no ?? "");
      setNotes(k?.notes ?? "");
      setLines((k?.kot_items ?? []).map((i) => ({ ...i })));
      if (k?.property_id) {
        const { data: mi } = await supabase.from("menu_items")
          .select("id,name,price,gst_rate,kot_station,is_available,category_id")
          .eq("property_id", k.property_id).eq("is_available", true).order("name");
        setItems((mi ?? []) as MenuItem[]);
      }
      setLoading(false);
    })();
  }, [open, kotId]);

  const totals = useMemo(() => computeKotTotals(lines), [lines]);
  const wasPrinted = !!kot?.printed_at;

  const filtered = useMemo(() =>
    items.filter((i) => !search || i.name.toLowerCase().includes(search.toLowerCase())).slice(0, 30),
    [items, search]);

  function addItem(it: MenuItem) {
    setLines((prev) => {
      const ex = prev.find((c) => c.menu_item_id === it.id);
      if (ex) return prev.map((c) => c === ex ? { ...c, qty: c.qty + 1 } : c);
      return [...prev, {
        menu_item_id: it.id, item_name: it.name, qty: 1,
        rate: Number(it.price), gst_rate: Number(it.gst_rate ?? 5),
        kot_station: it.kot_station || "kitchen",
      }];
    });
  }
  function bump(idx: number, d: number) {
    setLines((prev) => prev
      .map((c, i) => i === idx ? { ...c, qty: Math.max(0, c.qty + d) } : c)
      .filter((c) => c.qty > 0));
  }
  function remove(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  async function save() {
    if (!kot || !user) return;
    if (lines.length === 0) return toast.error("At least one item required");
    if (kot.kot_type === "restaurant" && !tableNo.trim()) return toast.error("Table required");
    setSaving(true);
    try {
      const t = computeKotTotals(lines);
      const previousTotal = Number(kot.total_amount);

      // Replace kot_items: delete all, re-insert current lines. This keeps the
      // logic simple and consistent with the existing KOT structure.
      const { error: delErr } = await supabase.from("kot_items").delete().eq("kot_id", kot.id);
      if (delErr) throw delErr;
      const insertLines = lines.map((c) => ({
        kot_id: kot.id,
        menu_item_id: c.menu_item_id,
        item_name: c.item_name,
        qty: c.qty,
        rate: c.rate,
        amount: c.qty * c.rate,
        gst_rate: c.gst_rate,
        kot_station: c.kot_station,
        notes: c.notes ?? null,
      }));
      const { error: insErr } = await supabase.from("kot_items").insert(insertLines);
      if (insErr) throw insErr;

      const patch = {
        table_no: kot.kot_type === "restaurant" ? tableNo.trim() : null,
        notes: notes || null,
        sub_total: t.sub_total,
        gst_amount: t.gst_amount,
        total_amount: t.total_amount,
        edited_at: new Date().toISOString(),
        edited_by: user.id,
      };
      const { error: uErr } = await supabase.from("kot_orders").update(patch as never).eq("id", kot.id);
      if (uErr) throw uErr;

      // Keep any linked folio_charge in sync so KOT total and bill never drift.
      const { data: fc } = await supabase.from("folio_charges")
        .select("id,gst_rate")
        .eq("source_table", "kot_orders").eq("source_id", kot.id).maybeSingle();
      if (fc) {
        await supabase.from("folio_charges").update({
          qty: 1, rate: t.sub_total, amount: t.sub_total,
          gst_amount: t.gst_amount,
          description: `Food — KOT ${kot.kot_number}`,
        }).eq("id", fc.id);
      }

      // Build diff summary
      const before = kot.kot_items.map((i) => `${i.qty}× ${i.item_name}`).sort();
      const after = lines.map((i) => `${i.qty}× ${i.item_name}`).sort();
      logActivity({
        property_id: kot.property_id,
        user_id: user.id,
        user_name: userDisplayName(user as any),
        ...ACTIVITY.KOT_EDITED,
        reference_id: kot.id,
        reference_label: `KOT ${kot.kot_number}`,
        details: {
          kot_number: kot.kot_number,
          table_no: tableNo || null,
          previous_total: previousTotal,
          new_total: t.total_amount,
          items_before: before,
          items_after: after,
        },
      });

      toast.success("KOT updated");
      if (wasPrinted) setShowReprint(true);
      onSaved();
      if (!wasPrinted) onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function reprint() {
    if (!kot) return;
    // Fetch fresh items and open print window
    const { data } = await supabase.from("kot_orders")
      .select("kot_number,kot_type,table_no,created_at,total_amount,notes,rooms(room_number),kot_items(item_name,qty,rate,notes)")
      .eq("id", kot.id).maybeSingle();
    const k = data as any;
    if (!k) return;
    const esc = (s: unknown) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const html = `<html><head><title>${esc(k.kot_number)} (Re-print)</title>
      <style>body{font:12px monospace;padding:8px}h2{margin:0;font-size:14px}hr{border:none;border-top:1px dashed #999;margin:6px 0}.row{display:flex;justify-content:space-between}</style>
      </head><body>
      <h2>KOT ${esc(k.kot_number)} (RE-PRINT)</h2>
      <div>${new Date().toLocaleString()}</div>
      <div>${k.kot_type === "room" ? `Room ${esc(k.rooms?.room_number ?? "—")}` : `Table ${esc(k.table_no ?? "—")}`}</div>
      <hr/>
      ${(k.kot_items ?? []).map((i: any) => `<div class="row"><span>${i.qty} × ${esc(i.item_name)}</span><span>₹${(i.qty*i.rate).toFixed(0)}</span></div>`).join("")}
      <hr/>
      <div class="row"><span>Total</span><span>₹${Number(k.total_amount).toFixed(2)}</span></div>
      </body></html>`;
    const w = window.open("", "_blank", "width=320,height=600");
    if (!w) return;
    w.document.write(html); w.document.close(); w.focus(); w.print();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit KOT {kot?.kot_number ?? ""}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !kot ? (
          <p className="text-sm text-muted-foreground">KOT not found.</p>
        ) : (
          <div className="space-y-3">
            {showReprint && (
              <div className="flex items-center gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <div className="flex-1">This KOT was already sent to the kitchen — consider re-printing after saving.</div>
                <Button size="sm" variant="outline" onClick={reprint}>Re-print KOT</Button>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {kot.kot_type === "restaurant" ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Table no</Label>
                  <Input value={tableNo} onChange={(e) => setTableNo(e.target.value)} />
                </div>
              ) : (
                <div className="text-xs text-muted-foreground self-end">Room order (booking linked)</div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">Notes</Label>
                <Textarea rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>

            <div className="rounded border">
              <div className="p-2 border-b bg-muted/40 text-xs font-medium">Items in this KOT</div>
              <div className="divide-y">
                {lines.length === 0 && <div className="p-3 text-xs text-muted-foreground">No items.</div>}
                {lines.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium">{c.item_name}</div>
                      <div className="text-xs text-muted-foreground">₹{c.rate} · {c.kot_station} · GST {c.gst_rate}%</div>
                    </div>
                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => bump(i, -1)}><Minus className="h-3 w-3" /></Button>
                    <div className="w-6 text-center">{c.qty}</div>
                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => bump(i, +1)}><Plus className="h-3 w-3" /></Button>
                    <div className="w-20 text-right text-sm">₹{(c.qty * c.rate).toFixed(0)}</div>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => remove(i)}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                ))}
              </div>
              <div className="border-t p-2 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Sub ₹{totals.sub_total} · GST ₹{totals.gst_amount}</span>
                <span className="font-semibold">Total ₹{totals.total_amount.toLocaleString("en-IN")}</span>
              </div>
            </div>

            <div className="rounded border">
              <div className="p-2 border-b bg-muted/40 text-xs font-medium">Add items</div>
              <div className="p-2 space-y-2">
                <Input placeholder="Search menu…" value={search} onChange={(e) => setSearch(e.target.value)} />
                <div className="grid gap-1 sm:grid-cols-2 max-h-56 overflow-y-auto">
                  {filtered.map((it) => (
                    <button key={it.id} onClick={() => addItem(it)}
                      className="text-left rounded border p-2 hover:bg-accent text-sm">
                      <div className="flex items-center justify-between">
                        <div className="font-medium truncate">{it.name}</div>
                        <Badge variant="outline" className="text-[10px]">{it.kot_station || "—"}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">₹{it.price}</div>
                    </button>
                  ))}
                  {filtered.length === 0 && <p className="col-span-full text-xs text-muted-foreground p-2">No matches.</p>}
                </div>
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={save} disabled={saving || loading}>{saving ? "Saving…" : "Save changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}