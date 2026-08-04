import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { AppShell } from "@/components/AppShell";
import { RequirePermission } from "@/components/RequirePermission";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { userDisplayName } from "@/lib/activityLog";
import { fmtDateTime, fmtINR } from "@/lib/reportExports";
import {
  PETTY_TYPE_LABEL, pettySign, type PettyCashEntry, type PettyCashType,
} from "@/lib/pettyCash";
import { ArrowDownLeft, ArrowUpRight, Trash2, Wallet } from "lucide-react";
import { toastError } from "@/lib/errorMessage";

export const Route = createFileRoute("/_authenticated/petty-cash")({
  head: () => ({
    meta: [
      { title: "Petty Cash — HotelPilot" },
      { name: "description", content: "Track petty cash float, top-ups and withdrawals, reconciled into each shift handover." },
      { property: "og:title", content: "Petty Cash — HotelPilot" },
      { property: "og:description", content: "Track petty cash float, top-ups and withdrawals, reconciled into each shift handover." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <RequirePermission module="shift_handover" action="view">
      <PettyCashPage />
    </RequirePermission>
  ),
});

function PettyCashPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const { user } = useAuth();
  const { can, isSuperadmin } = usePermissions();
  const canCreate = isSuperadmin || can("shift_handover", "create");
  const canDelete = isSuperadmin || can("shift_handover", "delete");

  const [rows, setRows] = useState<PettyCashEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasOpening, setHasOpening] = useState(false);
  const [dialogType, setDialogType] = useState<PettyCashType | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PettyCashEntry | null>(null);

  const load = useCallback(async () => {
    if (!propertyId) { setRows([]); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("petty_cash_entries")
      .select("id,property_id,entry_type,amount,reason,created_by_name,created_at,handover_id")
      .eq("property_id", propertyId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(200);
    setLoading(false);
    if (error) { toastError(error); return; }
    const mapped = ((data ?? []) as unknown[]).map((r) => {
      const e = r as Record<string, unknown>;
      return {
        id: String(e.id),
        property_id: String(e.property_id),
        entry_type: e.entry_type as PettyCashType,
        amount: Number(e.amount ?? 0),
        reason: (e.reason as string) ?? null,
        created_by_name: (e.created_by_name as string) ?? null,
        created_at: String(e.created_at),
        handover_id: (e.handover_id as string) ?? null,
      } satisfies PettyCashEntry;
    });
    setRows(mapped);
    setHasOpening(mapped.some((m) => m.entry_type === "opening"));
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);

  const pending = useMemo(() => rows.filter((r) => !r.handover_id), [rows]);
  const pendingNet = useMemo(
    () => pending.reduce((s, r) => s + pettySign(r.entry_type) * r.amount, 0),
    [pending],
  );

  function openDialog(t: PettyCashType) {
    setDialogType(t);
    setAmount("");
    setReason("");
  }

  async function save() {
    if (!propertyId || !dialogType || !user) return;
    const amt = Number(amount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    if (dialogType !== "opening" && !reason.trim()) return toast.error("A reason is required");
    setSaving(true);
    const { error } = await supabase.from("petty_cash_entries").insert({
      property_id: propertyId,
      entry_type: dialogType,
      amount: amt,
      reason: reason.trim() || null,
      created_by: user.id,
      created_by_name: userDisplayName(user as never),
    } as never);
    setSaving(false);
    if (error) return toastError(error);
    toast.success(`${PETTY_TYPE_LABEL[dialogType]} recorded`);
    setDialogType(null);
    load();
  }

  async function confirmDelete() {
    if (!deleteTarget || !user) return;
    const { error } = await supabase
      .from("petty_cash_entries")
      .update({ is_deleted: true, deleted_by: user.id, deleted_at: new Date().toISOString() } as never)
      .eq("id", deleteTarget.id);
    if (error) return toastError(error);
    toast.success("Entry removed");
    setDeleteTarget(null);
    load();
  }

  if (!propertyId) return <AppShell title="Petty Cash"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="Petty Cash">
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm uppercase tracking-wider">Drawer Movements</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {canCreate && (
                <>
                  <Button size="sm" onClick={() => openDialog("in")}>
                    <ArrowDownLeft className="h-4 w-4 mr-1" /> Cash In
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openDialog("out")}>
                    <ArrowUpRight className="h-4 w-4 mr-1" /> Cash Out
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openDialog("opening")}>
                    <Wallet className="h-4 w-4 mr-1" />
                    {hasOpening ? "Correct Opening Float" : "Set Opening Float"}
                  </Button>
                </>
              )}
              <div className="ml-auto text-sm">
                <span className="text-muted-foreground mr-2">Pending for next handover:</span>
                <span className="font-semibold tabular-nums">
                  {(pendingNet > 0 ? "+" : "") + fmtINR(pendingNet)}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Cash In (top-up from safe/owner) and Cash Out (withdrawal/deposit) feed straight into the
              Cash line of the next Shift Handover. Entries stay “pending” until that handover is submitted.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm uppercase tracking-wider">Recent Entries</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <p className="p-4 text-sm text-muted-foreground">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No petty cash entries yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-2 text-left">When</th>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2 text-left">Reason</th>
                      <th className="px-3 py-2 text-left">By</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                        <td className="px-3 py-2">{PETTY_TYPE_LABEL[r.entry_type]}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${r.entry_type === "out" ? "text-rose-700" : ""}`}>
                          {(pettySign(r.entry_type) > 0 ? "+" : "−") + fmtINR(r.amount)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{r.reason ?? "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.created_by_name ?? "—"}</td>
                        <td className="px-3 py-2">
                          {r.handover_id
                            ? <Badge variant="outline">Reconciled</Badge>
                            : <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300">Pending</Badge>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {canDelete && !r.handover_id && (
                            <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(r)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogType !== null} onOpenChange={(o) => !o && setDialogType(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{dialogType ? PETTY_TYPE_LABEL[dialogType] : ""}</DialogTitle>
            <DialogDescription>
              {dialogType === "opening"
                ? "The starting float in the drawer. Normally carried forward automatically from the previous shift."
                : "This amount is folded into the Cash line of the next shift handover."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Amount (₹) *</Label>
              <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Reason {dialogType === "opening" ? "(optional)" : "*"}</Label>
              <Textarea rows={2} value={reason} maxLength={300}
                onChange={(e) => setReason(e.target.value)}
                placeholder={dialogType === "out" ? "Deposited to bank / handed to owner…" : "Top-up from safe…"} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogType(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove entry?</DialogTitle>
            <DialogDescription>
              The entry is soft-deleted and excluded from future handover reconciliation.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
