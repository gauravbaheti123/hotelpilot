import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { KOT_STATUS_LABEL, KOT_STATUS_TONE } from "@/lib/food";
import { PlusCircle, Pencil, Ban, Trash2, AlertTriangle } from "lucide-react";
import { useAuth, hasRole } from "@/hooks/use-auth";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { EditKotDialog } from "@/components/EditKotDialog";
import { ACTIVITY, logActivity, userDisplayName } from "@/lib/activityLog";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/food/kots")({
  head: () => ({ meta: [{ title: "All KOTs — HotelPilot" }] }),
  component: () => (<RequirePermission module="all_kots"><AllKotsPage /></RequirePermission>),
});

interface Row {
  id: string; kot_number: string; kot_type: string; table_no: string | null;
  guest_name: string | null; status: string; total_amount: number; created_at: string;
  rooms: { room_number: string } | null;
}

function AllKotsPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const { user, roles } = useAuth();
  const canManage = hasRole(roles, "owner") || hasRole(roles, "manager") || hasRole(roles, "superadmin");
  const canDelete = hasRole(roles, "owner") || hasRole(roles, "superadmin");
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<Row | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [delTarget, setDelTarget] = useState<Row | null>(null);
  const [delStep, setDelStep] = useState<1 | 2>(1);
  const [delReason, setDelReason] = useState("");
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (!propertyId) return;
    (async () => {
      const { data } = await supabase.from("kot_orders")
        .select("id,kot_number,kot_type,table_no,guest_name,status,total_amount,created_at,rooms(room_number)")
        .eq("property_id", propertyId)
        .neq("kot_copy", "restaurant_copy")
        .order("created_at", { ascending: false })
        .limit(200);
      setRows((data ?? []) as unknown as Row[]);
    })();
  };
  useEffect(load, [propertyId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!propertyId) return <AppShell title="All KOTs"><EmptyPropertyState /></AppShell>;

  const filtered = rows.filter((r) =>
    !q || r.kot_number.toLowerCase().includes(q.toLowerCase()) ||
    (r.table_no ?? "").toLowerCase().includes(q.toLowerCase()) ||
    (r.guest_name ?? "").toLowerCase().includes(q.toLowerCase()));

  const voidable = (s: string) => s !== "void" && s !== "billed";
  const editable = (s: string) => s === "open" || s === "printed";

  async function confirmVoid() {
    if (!voidTarget || !user || !propertyId) return;
    setBusy(true);
    try {
      const prev = voidTarget.status;
      const { error } = await supabase.from("kot_orders").update({
        status: "void", void_reason: voidReason || null,
        voided_at: new Date().toISOString(), voided_by: user.id,
      } as never).eq("id", voidTarget.id);
      if (error) throw error;
      logActivity({
        property_id: propertyId, user_id: user.id, user_name: userDisplayName(user as any),
        ...ACTIVITY.KOT_VOIDED, reference_id: voidTarget.id,
        reference_label: `KOT ${voidTarget.kot_number}`,
        details: { kot_number: voidTarget.kot_number, previous_status: prev, reason: voidReason || null, previous_total: Number(voidTarget.total_amount) },
      });
      toast.success(`KOT ${voidTarget.kot_number} voided`);
      setVoidTarget(null); setVoidReason("");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  }

  async function confirmDelete() {
    if (!delTarget || !user?.email || !propertyId) return;
    if (!delReason.trim()) return toast.error("Reason required");
    setBusy(true);
    try {
      // Re-authenticate with password
      const { error: pErr } = await supabase.auth.signInWithPassword({
        email: user.email, password: pwd,
      });
      if (pErr) { setBusy(false); return toast.error("Password incorrect"); }

      // Block if linked to folio_charges
      const { data: fc } = await supabase.from("folio_charges")
        .select("id").eq("source_table", "kot_orders").eq("source_id", delTarget.id).limit(1);
      if (fc && fc.length > 0) {
        setBusy(false);
        return toast.error("Cannot delete — this KOT is linked to an active bill. Void it instead, or remove the charge from the bill first.");
      }

      // Fetch full snapshot for audit log before delete
      const { data: snap } = await supabase.from("kot_orders")
        .select("*,kot_items(*)").eq("id", delTarget.id).maybeSingle();

      const { error } = await supabase.from("kot_orders").delete().eq("id", delTarget.id);
      if (error) throw error;

      logActivity({
        property_id: propertyId, user_id: user.id, user_name: userDisplayName(user as any),
        ...ACTIVITY.KOT_DELETED, reference_id: delTarget.id,
        reference_label: `KOT ${delTarget.kot_number}`,
        details: {
          kot_number: delTarget.kot_number,
          reason: delReason,
          previous_total: Number(delTarget.total_amount),
          snapshot: snap ?? null,
        },
      });
      toast.success(`KOT ${delTarget.kot_number} permanently deleted`);
      setDelTarget(null); setDelStep(1); setDelReason(""); setPwd("");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <AppShell title="All KOTs">
      <div className="flex items-center gap-2 mb-4">
        <Input placeholder="Search KOT / table / guest…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <div className="flex-1" />
        <Link to="/food/new"><Button size="sm"><PlusCircle className="h-4 w-4 mr-1" /> New KOT</Button></Link>
      </div>
      <Card>
        <CardContent className="p-0 divide-y">
          {filtered.length === 0 && <p className="p-4 text-sm text-muted-foreground">No KOTs.</p>}
          {filtered.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3 hover:bg-accent">
              <Link to="/food/kot/$id" params={{ id: r.id }} className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium text-sm">{r.kot_number}</div>
                  <Badge variant="outline" className={KOT_STATUS_TONE[r.status]}>{KOT_STATUS_LABEL[r.status]}</Badge>
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {r.kot_type === "room"
                    ? `Room ${r.rooms?.room_number ?? "—"}${r.guest_name ? ` · ${r.guest_name}` : ""}`
                    : `Table ${r.table_no ?? "—"}`}
                </div>
              </Link>
              <div className="text-sm font-medium">₹{Number(r.total_amount).toLocaleString("en-IN")}</div>
              {canManage && (
                <div className="flex items-center gap-1 ml-2">
                  {editable(r.status) && (
                    <Button size="icon" variant="ghost" className="h-8 w-8" title="Edit"
                      onClick={() => setEditId(r.id)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                  {voidable(r.status) && (
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-amber-700" title="Void"
                      onClick={() => { setVoidTarget(r); setVoidReason(""); }}>
                      <Ban className="h-4 w-4" />
                    </Button>
                  )}
                  {canDelete && (
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" title="Delete"
                      onClick={() => { setDelTarget(r); setDelStep(1); setPwd(""); setDelReason(""); }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <EditKotDialog kotId={editId} open={!!editId} onOpenChange={(o) => !o && setEditId(null)} onSaved={load} />

      <Dialog open={!!voidTarget} onOpenChange={(o) => !o && setVoidTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Void this KOT?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will cancel the order. Voided KOTs are excluded from kitchen views and revenue.
          </p>
          <div className="space-y-1.5">
            <Label className="text-xs">Reason (optional)</Label>
            <Textarea rows={2} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidTarget(null)}>Cancel</Button>
            <Button variant="destructive" disabled={busy} onClick={confirmVoid}>{busy ? "Voiding…" : "Void KOT"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {delStep === 1 ? `Delete KOT ${delTarget?.kot_number}?` : "Confirm with password"}
            </DialogTitle>
          </DialogHeader>
          {delStep === 1 ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                KOTs are <b>permanently deleted</b>. A full snapshot is recorded in the Activity Log for audit.
                If the KOT is linked to an active bill, deletion is blocked — void it instead.
              </p>
              <Label className="text-xs">Reason *</Label>
              <Textarea rows={2} value={delReason} onChange={(e) => setDelReason(e.target.value)} />
            </div>
          ) : (
            <div className="space-y-2">
              <Label className="text-xs">Enter your account password to confirm</Label>
              <Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoFocus />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelTarget(null)}>Cancel</Button>
            {delStep === 1 ? (
              <Button variant="destructive" disabled={!delReason.trim()} onClick={() => setDelStep(2)}>Proceed</Button>
            ) : (
              <Button variant="destructive" disabled={!pwd || busy} onClick={confirmDelete}>
                {busy ? "Verifying…" : "Verify & Delete Permanently"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}