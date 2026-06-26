/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { useAuth, hasRole } from "@/hooks/use-auth";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { inr } from "@/lib/billing";
import { toast } from "sonner";
import { logActivity, userDisplayName } from "@/lib/activityLog";
import { Lock, Trash2, AlertTriangle, Pencil, Download } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/billing/mis")({
  head: () => ({ meta: [{ title: "MIS Account — HotelPilot" }] }),
  component: MISPage,
});

interface Row {
  id: string;
  source_bill_number: string | null;
  source_room_number: string | null;
  source_guest_name: string | null;
  amount: number;
  line_items: { name: string; amount: number; charge_type?: string }[] | null;
  shifted_by_name: string | null;
  shifted_at: string;
  description: string | null;
}

function MISPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const { user, roles } = useAuth();
  const isOwner = hasRole(roles, "owner") || hasRole(roles, "superadmin");

  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // delete flow
  const [delRow, setDelRow] = useState<Row | null>(null);
  const [delStep, setDelStep] = useState<1 | 2>(1);
  const [delTyped, setDelTyped] = useState("");
  const [delBusy, setDelBusy] = useState(false);

  // edit flow
  const isManager = hasRole(roles, "manager") || hasRole(roles, "owner") || hasRole(roles, "superadmin");
  const [editRow, setEditRow] = useState<Row | null>(null);
  const [editGuest, setEditGuest] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  function openEdit(r: Row) {
    setEditRow(r);
    setEditGuest(r.source_guest_name ?? "");
    setEditDesc(r.description ?? "");
    setEditAmount(String(r.amount));
    setEditNotes("");
  }

  async function saveEdit() {
    if (!editRow || !propertyId) return;
    setEditBusy(true);
    const { error } = await supabase.from("mis_ledger" as any).update({
      source_guest_name: editGuest || null,
      description: editDesc || null,
      amount: Number(editAmount),
    } as any).eq("id", editRow.id);
    setEditBusy(false);
    if (error) return toast.error(error.message);
    logActivity({
      property_id: propertyId, user_id: user?.id ?? "",
      user_name: userDisplayName(user as any),
      action_type: "MIS_EDITED", module: "MIS",
      reference_id: editRow.id,
      reference_label: `${editRow.source_bill_number ?? "—"} · ${editGuest}`,
      details: { notes: editNotes, before: editRow, after: { editGuest, editDesc, editAmount } },
    });
    toast.success("MIS entry updated");
    setEditRow(null);
    load();
  }

  function exportCsv() {
    const header = ["Date", "Bill", "Room", "Guest", "Items", "Amount", "By"];
    const lines = [header.join(",")];
    for (const r of filtered) {
      const items = (r.line_items ?? []).map((i) => `${i.name} ${i.amount}`).join("; ");
      const row = [
        new Date(r.shifted_at).toLocaleString("en-IN"),
        r.source_bill_number ?? "",
        r.source_room_number ?? "",
        r.source_guest_name ?? "",
        items,
        String(r.amount),
        r.shifted_by_name ?? "",
      ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",");
      lines.push(row);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `MIS-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    let qb = supabase.from("mis_ledger" as any)
      .select("id,source_bill_number,source_room_number,source_guest_name,amount,line_items,shifted_by_name,shifted_at,description")
      .eq("property_id", propertyId)
      .eq("is_deleted", false)
      .order("shifted_at", { ascending: false })
      .limit(500);
    if (from) qb = qb.gte("shifted_at", from);
    if (to) qb = qb.lte("shifted_at", `${to}T23:59:59`);
    const { data, error } = await qb;
    if (error) toast.error(error.message);
    setRows(((data ?? []) as unknown) as Row[]);
    setLoading(false);
  }, [propertyId, from, to]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const s = q.toLowerCase();
    return rows.filter((r) =>
      (r.source_bill_number ?? "").toLowerCase().includes(s) ||
      (r.source_room_number ?? "").toLowerCase().includes(s) ||
      (r.source_guest_name ?? "").toLowerCase().includes(s),
    );
  }, [rows, q]);

  const total = filtered.reduce((s, r) => s + Number(r.amount), 0);

  function openDelete(r: Row) {
    setDelRow(r); setDelStep(1); setDelTyped("");
  }

  async function permanentlyDelete() {
    if (!delRow || !propertyId) return;
    setDelBusy(true);
    const { error } = await supabase.from("mis_ledger" as any)
      .delete().eq("id", delRow.id);
    setDelBusy(false);
    if (error) return toast.error(error.message);
    logActivity({
      property_id: propertyId,
      user_id: user?.id ?? "",
      user_name: userDisplayName(user as any),
      action_type: "MIS_DELETED",
      module: "MIS",
      reference_id: delRow.id,
      reference_label: `${delRow.source_bill_number ?? "—"} · ${delRow.source_guest_name ?? "—"}`,
      details: {
        bill_number: delRow.source_bill_number,
        guest_name: delRow.source_guest_name,
        amount: delRow.amount,
      },
    });
    toast.success("Entry permanently deleted");
    setDelRow(null);
    load();
  }

  if (!propertyId) return <AppShell title="MIS Account"><EmptyPropertyState /></AppShell>;
  if (!isOwner) {
    return (
      <AppShell title="MIS Account">
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          <Lock className="h-6 w-6 mx-auto mb-2" />
          MIS Account is visible to property owners only.
        </CardContent></Card>
      </AppShell>
    );
  }

  return (
    <AppShell title="MIS Account">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
          </div>
          <div className="flex-1 min-w-[220px]">
            <Label className="text-xs">Search</Label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Guest / Room / Bill no" className="h-9" />
          </div>
          <Badge variant="outline" className="text-sm px-3 py-1.5">
            Total in MIS: <span className="ml-1 font-bold">{inr(total)}</span>
          </Badge>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="h-4 w-4 mr-1" /> Export CSV
          </Button>
        </div>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-xs uppercase tracking-wider">
                  <th className="px-3 py-2 text-left">Shifted</th>
                  <th className="px-3 py-2 text-left">Bill</th>
                  <th className="px-3 py-2 text-left">Room</th>
                  <th className="px-3 py-2 text-left">Guest</th>
                  <th className="px-3 py-2 text-left">Items</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">By</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No MIS entries.</td></tr>
                ) : filtered.map((r) => (
                  <tr key={r.id} className="border-b hover:bg-accent/40">
                    <td className="px-3 py-2 whitespace-nowrap text-xs">{new Date(r.shifted_at).toLocaleString("en-IN")}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.source_bill_number ?? "—"}</td>
                    <td className="px-3 py-2">{r.source_room_number ?? "—"}</td>
                    <td className="px-3 py-2">{r.source_guest_name ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-[280px]">
                      {(r.line_items ?? []).map((i) => `${i.name} ${inr(i.amount)}`).join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{inr(r.amount)}</td>
                    <td className="px-3 py-2 text-xs">{r.shifted_by_name ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        {isManager && (
                          <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {isOwner && (
                          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                            onClick={() => openDelete(r)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              {filtered.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 font-semibold">
                    <td colSpan={5} className="px-3 py-2 text-right">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums">{inr(total)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!editRow} onOpenChange={(o) => !o && setEditRow(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit MIS Entry</DialogTitle></DialogHeader>
          {editRow && (
            <div className="space-y-3 text-sm">
              <div className="text-xs text-muted-foreground">Bill {editRow.source_bill_number}</div>
              <div className="space-y-1">
                <Label className="text-xs">Guest name</Label>
                <Input value={editGuest} onChange={(e) => setEditGuest(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Items / Description</Label>
                <Textarea rows={3} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Amount</Label>
                <Input type="number" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notes (audit trail)</Label>
                <Textarea rows={2} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={editBusy || !editAmount}>
              {editBusy ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!delRow} onOpenChange={(o) => !o && setDelRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {delStep === 1 ? "Permanently delete MIS entry?" : "Final confirmation"}
            </DialogTitle>
          </DialogHeader>
          {delRow && delStep === 1 && (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                This will permanently delete this MIS entry. This cannot be undone.
              </p>
              <div className="rounded border p-3 bg-muted/30 text-xs space-y-1">
                <div><span className="text-muted-foreground">Bill:</span> {delRow.source_bill_number}</div>
                <div><span className="text-muted-foreground">Guest:</span> {delRow.source_guest_name}</div>
                <div><span className="text-muted-foreground">Amount:</span> {inr(delRow.amount)}</div>
              </div>
            </div>
          )}
          {delRow && delStep === 2 && (
            <div className="space-y-3 text-sm">
              <div className="rounded border p-3 bg-destructive/5 text-xs space-y-1">
                <div>Bill <b>{delRow.source_bill_number}</b> · {delRow.source_guest_name} · {inr(delRow.amount)}</div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Type <code className="px-1 bg-muted">DELETE</code> to confirm</Label>
                <Input value={delTyped} onChange={(e) => setDelTyped(e.target.value)} placeholder="DELETE" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelRow(null)}>Cancel</Button>
            {delStep === 1 ? (
              <Button variant="destructive" onClick={() => setDelStep(2)}>Proceed to Confirm</Button>
            ) : (
              <Button variant="destructive" disabled={delTyped !== "DELETE" || delBusy}
                onClick={permanentlyDelete}>
                {delBusy ? "Deleting…" : "Permanently Delete"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
