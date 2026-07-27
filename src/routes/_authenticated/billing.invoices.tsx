import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { FOLIO_STATUS_TONE, inr } from "@/lib/billing";
import { useAuth, hasRole } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { logActivity, userDisplayName } from "@/lib/activityLog";
import { toast } from "sonner";
import { Pencil, Trash2, FileSpreadsheet, Hash, AlertTriangle, Wallet } from "lucide-react";
import { ChangePaymentModeDialog, type ChangePaymentModeFolio } from "@/components/ChangePaymentModeDialog";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/billing/invoices")({
  head: () => ({ meta: [{ title: "Invoices — HotelPilot" }] }),
  component: () => (<RequirePermission module="invoices"><InvoicesPage /></RequirePermission>),
});

interface Row {
  id: string; invoice_number: string; gst_mode: string; status: string;
  total_amount: number; paid_amount: number; balance_amount: number;
  created_at: string;
  booking_id: string;
  is_deleted?: boolean;
  deleted_at?: string | null;
  deleted_by?: string | null;
  bookings: { booking_number: string; guests: { name: string } | null } | null;
}

function InvoicesPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const { user, roles } = useAuth();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const canEdit = can("invoices", "edit");
  const canDelete = can("invoices", "delete");
  const canEditPaymentMode = hasRole(roles, "owner") || hasRole(roles, "superadmin") || hasRole(roles, "manager");
  // Bill renumbering is intentionally owner-only — no dedicated permission key
  // exists for renumbering, so keep the hardcoded role gate.
  const isOwner = hasRole(roles, "owner") || hasRole(roles, "superadmin");

  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [audit, setAudit] = useState(false);
  const [delTarget, setDelTarget] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  // Hard-delete of a voided bill (owner-only, password re-entry)
  const [hardDelTarget, setHardDelTarget] = useState<Row | null>(null);
  const [hardDelStep, setHardDelStep] = useState<1 | 2>(1);
  const [hardDelPwd, setHardDelPwd] = useState("");
  const [hardDelReason, setHardDelReason] = useState("");
  // Edit bill number (owner-only)
  const [numTarget, setNumTarget] = useState<Row | null>(null);
  const [numNew, setNumNew] = useState("");
  const [numReason, setNumReason] = useState("");
  // Change Payment Mode dialog (list-view quick action)
  const [payModeTarget, setPayModeTarget] = useState<ChangePaymentModeFolio | null>(null);
  // Audit rows for BILL_DELETED / BILL_NUMBER_EDITED
  const [auditRows, setAuditRows] = useState<Array<{
    id: string; created_at: string; user_name: string | null;
    action_type: string; reference_label: string | null;
    details: Record<string, unknown> | null;
  }>>([]);

  const load = () => {
    if (!propertyId) return;
    (async () => {
      let qb = supabase.from("folios")
        .select("id,invoice_number,gst_mode,status,total_amount,paid_amount,balance_amount,created_at,booking_id,is_deleted,deleted_at,deleted_by,bookings(booking_number,guests(name))" as any)
        .eq("property_id", propertyId);
      if (!audit) qb = qb.eq("is_deleted" as any, false);
      const { data } = await qb.order("created_at", { ascending: false })
        .limit(300);
      setRows((data ?? []) as unknown as Row[]);
    })();
  };
  useEffect(load, [propertyId, audit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!propertyId || !audit) { setAuditRows([]); return; }
    (async () => {
      const { data } = await supabase
        .from("activity_log" as any)
        .select("id,created_at,user_name,action_type,reference_label,details")
        .eq("property_id", propertyId)
        .in("action_type", ["BILL_DELETED", "BILL_NUMBER_EDITED"])
        .order("created_at", { ascending: false })
        .limit(300);
      setAuditRows((data ?? []) as any);
    })();
  }, [propertyId, audit, busy]);

  if (!propertyId) return <AppShell title="Invoices"><EmptyPropertyState /></AppShell>;

  const filtered = rows.filter((r) =>
    !q || r.invoice_number.toLowerCase().includes(q.toLowerCase()) ||
    (r.bookings?.booking_number ?? "").toLowerCase().includes(q.toLowerCase()) ||
    (r.bookings?.guests?.name ?? "").toLowerCase().includes(q.toLowerCase()));

  async function confirmDelete() {
    if (!delTarget) return;
    setBusy(true);
    const { error } = await supabase.from("folios").update({
      is_deleted: true,
      deleted_by: user?.id ?? null,
      deleted_at: new Date().toISOString(),
      status: "void",
      voided_at: new Date().toISOString(),
    } as any).eq("id", delTarget.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    logActivity({
      property_id: propertyId!,
      user_id: user?.id ?? "",
      user_name: userDisplayName(user as any),
      action_type: "BILL_VOIDED",
      module: "Billing",
      reference_id: delTarget.id,
      reference_label: `${delTarget.invoice_number} — ${delTarget.bookings?.guests?.name ?? ""}`,
      details: { bill_number: delTarget.invoice_number, amount: delTarget.total_amount },
    });
    toast.success(`Bill ${delTarget.invoice_number} voided`);
    setDelTarget(null);
    load();
  }

  async function confirmHardDelete() {
    if (!hardDelTarget || !user?.email) return;
    setBusy(true);
    try {
      // 1. Check date lock via RPC (uses folio created date)
      const chargedOn = hardDelTarget.created_at.slice(0, 10);
      const { data: locked } = await supabase.rpc("is_day_locked" as any, {
        _property_id: propertyId, _d: chargedOn,
      } as any);
      if (locked === true) {
        setBusy(false);
        return toast.error("Cannot delete — this date has been locked by night audit.");
      }
      // 2. Verify password
      const { error: pErr } = await supabase.auth.signInWithPassword({
        email: user.email, password: hardDelPwd,
      });
      if (pErr) { setBusy(false); return toast.error("Password incorrect"); }
      // 3. Snapshot bill (charges + payments + folio row)
      const { data: folioRow } = await supabase.from("folios").select("*").eq("id", hardDelTarget.id).maybeSingle();
      const { data: charges } = await supabase.from("folio_charges").select("*").eq("folio_id", hardDelTarget.id);
      const { data: payments } = await supabase.from("payments").select("*").eq("folio_id", hardDelTarget.id);
      // 4. Log to activity_log
      await logActivity({
        property_id: propertyId!,
        user_id: user.id,
        user_name: userDisplayName(user as any),
        action_type: "BILL_DELETED",
        module: "Billing",
        reference_id: hardDelTarget.id,
        reference_label: `${hardDelTarget.invoice_number} — ${hardDelTarget.bookings?.guests?.name ?? ""}`,
        details: {
          bill_number: hardDelTarget.invoice_number,
          amount: hardDelTarget.total_amount,
          reason: hardDelReason || null,
          original_void_reason: (folioRow as any)?.void_reason ?? null,
          folio: folioRow ?? null,
          charges: charges ?? [],
          payments: payments ?? [],
          guest: hardDelTarget.bookings?.guests?.name ?? null,
          booking_number: hardDelTarget.bookings?.booking_number ?? null,
        },
      });
      // 5. Hard delete (folio_charges & payments cascade)
      const { error: dErr } = await supabase.from("folios").delete().eq("id", hardDelTarget.id);
      if (dErr) { setBusy(false); return toast.error(dErr.message); }
      toast.success(`Bill ${hardDelTarget.invoice_number} permanently deleted`);
      setHardDelTarget(null); setHardDelPwd(""); setHardDelReason(""); setHardDelStep(1);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function confirmEditNumber() {
    if (!numTarget || !propertyId) return;
    const trimmed = numNew.trim();
    if (!trimmed) return toast.error("Bill number is required");
    if (trimmed === numTarget.invoice_number) return toast.error("Enter a different number");
    // Same-series uniqueness (regex prefix comparison)
    const oldPrefix = (numTarget.invoice_number.match(/^[A-Za-z]+/) ?? [""])[0];
    const newPrefix = (trimmed.match(/^[A-Za-z]+/) ?? [""])[0];
    if (oldPrefix && newPrefix && oldPrefix !== newPrefix) {
      return toast.error(`Series mismatch — must start with "${oldPrefix}"`);
    }
    setBusy(true);
    const { data: dup } = await supabase
      .from("folios")
      .select("id")
      .eq("property_id", propertyId)
      .eq("invoice_number", trimmed)
      .eq("is_deleted" as any, false)
      .neq("status", "void")
      .neq("id", numTarget.id)
      .limit(1);
    if (dup && dup.length > 0) {
      setBusy(false);
      return toast.error(`Bill number ${trimmed} is already in use`);
    }
    const { error } = await supabase
      .from("folios")
      .update({ invoice_number: trimmed } as any)
      .eq("id", numTarget.id);
    if (error) { setBusy(false); return toast.error(error.message); }
    await logActivity({
      property_id: propertyId,
      user_id: user?.id ?? "",
      user_name: userDisplayName(user as any),
      action_type: "BILL_NUMBER_EDITED",
      module: "Billing",
      reference_id: numTarget.id,
      reference_label: `${numTarget.invoice_number} → ${trimmed}`,
      details: {
        old_number: numTarget.invoice_number,
        new_number: trimmed,
        reason: numReason || null,
      },
    });
    toast.success(`Renumbered ${numTarget.invoice_number} → ${trimmed}`);
    setNumTarget(null); setNumNew(""); setNumReason("");
    setBusy(false);
    load();
  }

  async function exportAudit() {
    const XLSX = await import("xlsx");
    const data = filtered.map((r) => ({
      Invoice: r.invoice_number,
      Booking: r.bookings?.booking_number ?? "",
      Guest: r.bookings?.guests?.name ?? "",
      Status: r.is_deleted ? "VOIDED" : r.status.toUpperCase(),
      Mode: r.gst_mode,
      Total: Number(r.total_amount),
      Paid: Number(r.paid_amount),
      Balance: Number(r.balance_amount),
      Created: new Date(r.created_at).toLocaleString("en-IN"),
      Voided_At: r.deleted_at ? new Date(r.deleted_at).toLocaleString("en-IN") : "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Invoices");
    const auditData = auditRows.map((a) => ({
      When: new Date(a.created_at).toLocaleString("en-IN"),
      Action: a.action_type,
      By: a.user_name ?? "",
      Reference: a.reference_label ?? "",
      Old: (a.details as any)?.old_number ?? "",
      New: (a.details as any)?.new_number ?? "",
      Reason: (a.details as any)?.reason ?? "",
    }));
    const ws2 = XLSX.utils.json_to_sheet(auditData);
    XLSX.utils.book_append_sheet(wb, ws2, "Audit Trail");
    XLSX.writeFile(wb, `invoices-audit-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <AppShell title="Invoices">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Input placeholder="Search invoice / booking / guest…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        {isOwner && (
          <div className="flex gap-1 rounded-md border p-1 bg-muted/30 ml-2">
            <button onClick={() => setAudit(false)}
              className={`px-3 py-1 text-xs rounded ${!audit ? "bg-background shadow font-medium" : "text-muted-foreground"}`}>
              Show Active
            </button>
            <button onClick={() => setAudit(true)}
              className={`px-3 py-1 text-xs rounded ${audit ? "bg-background shadow font-medium" : "text-muted-foreground"}`}>
              Show Audit Trail
            </button>
          </div>
        )}
        {isOwner && audit && (
          <Button size="sm" variant="outline" onClick={exportAudit}>
            <FileSpreadsheet className="h-4 w-4 mr-1" /> Export (Excel)
          </Button>
        )}
      </div>
      <Card>
        <CardContent className="p-0 divide-y">
          {filtered.length === 0 && <p className="p-4 text-sm text-muted-foreground">No invoices.</p>}
          {filtered.map((r) => {
            const voided = !!r.is_deleted;
            return (
              <div key={r.id} className={`flex items-center gap-3 px-4 py-3 cursor-pointer ${voided ? "bg-rose-50/30" : "hover:bg-muted/50"}`}>
                <Link to="/billing/folio/$bookingId" params={{ bookingId: r.booking_id }} className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className={`font-medium text-sm ${voided ? "line-through text-destructive" : ""}`}>{r.invoice_number}</div>
                    {voided ? (
                      <Badge variant="outline" className="bg-rose-100 text-rose-800 border-rose-300">VOIDED</Badge>
                    ) : (
                      <Badge variant="outline" className={FOLIO_STATUS_TONE[r.status]}>{r.status.toUpperCase()}</Badge>
                    )}
                    <Badge variant="outline" className="text-[10px] uppercase">{r.gst_mode}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {r.bookings?.booking_number} · {r.bookings?.guests?.name ?? "—"}
                    {voided && r.deleted_at && (
                      <span className="ml-2 text-rose-600">Voided on {new Date(r.deleted_at).toLocaleDateString("en-IN")}</span>
                    )}
                  </div>
                </Link>
                <div className="text-right">
                  <div className={`text-sm font-medium ${voided ? "line-through text-muted-foreground" : ""}`}>{inr(r.total_amount)}</div>
                  <div className="text-xs text-muted-foreground">Bal {inr(r.balance_amount)}</div>
                </div>
                {(canEdit || canDelete) && !voided && (
                  <div className="flex items-center gap-1 ml-2">
                    {isOwner && (
                      <Button size="sm" variant="ghost" title="Edit bill number"
                        onClick={(e) => { e.preventDefault(); setNumTarget(r); setNumNew(r.invoice_number); setNumReason(""); }}>
                        <Hash className="h-4 w-4" />
                      </Button>
                    )}
                    {canEditPaymentMode && (
                      <Button size="sm" variant="ghost" title="Change payment mode"
                        onClick={(e) => { e.preventDefault(); setPayModeTarget({
                          id: r.id, invoice_number: r.invoice_number, property_id: propertyId!,
                          booking_id: r.booking_id, status: r.status, is_deleted: r.is_deleted,
                        }); }}>
                        <Wallet className="h-4 w-4" />
                      </Button>
                    )}
                    {canEdit && (
                      <Button size="sm" variant="ghost"
                        onClick={() => navigate({ to: "/billing/folio/$bookingId", params: { bookingId: r.booking_id } })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button size="sm" variant="ghost" title="Void bill"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDelTarget(r)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )}
                {voided && (
                  <div className="flex items-center gap-1 ml-2">
                    {canEditPaymentMode && (
                      <Button size="sm" variant="ghost" title="Change payment mode (owner override)"
                        onClick={(e) => { e.preventDefault(); setPayModeTarget({
                          id: r.id, invoice_number: r.invoice_number, property_id: propertyId!,
                          booking_id: r.booking_id, status: r.status, is_deleted: r.is_deleted,
                        }); }}>
                        <Wallet className="h-4 w-4" />
                      </Button>
                    )}
                    {isOwner && (
                      <Button size="sm" variant="ghost" title="Permanently delete voided bill"
                        className="text-destructive hover:text-destructive"
                        onClick={(e) => { e.preventDefault(); setHardDelTarget(r); setHardDelStep(1); setHardDelPwd(""); setHardDelReason(""); }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <ChangePaymentModeDialog
        folio={payModeTarget}
        open={!!payModeTarget}
        onOpenChange={(o) => { if (!o) setPayModeTarget(null); }}
        onSaved={() => { setPayModeTarget(null); load(); }}
      />

      {isOwner && audit && auditRows.length > 0 && (
        <Card className="mt-4">
          <CardContent className="p-0">
            <div className="px-4 py-2 border-b bg-muted/30 text-xs font-medium uppercase tracking-wider">
              Bill Audit Trail (Deletes &amp; Renumbering)
            </div>
            <div className="divide-y">
              {auditRows.map((a) => (
                <div key={a.id} className="px-4 py-2 text-xs flex flex-wrap gap-x-4 gap-y-1">
                  <span className="text-muted-foreground w-40">{new Date(a.created_at).toLocaleString("en-IN")}</span>
                  <Badge variant="outline" className="text-[10px]">{a.action_type}</Badge>
                  <span className="font-medium">{a.reference_label ?? ""}</span>
                  {a.action_type === "BILL_NUMBER_EDITED" && (
                    <span className="text-muted-foreground">
                      {String((a.details as any)?.old_number ?? "")} → {String((a.details as any)?.new_number ?? "")}
                    </span>
                  )}
                  <span className="text-muted-foreground">by {a.user_name ?? "—"}</span>
                  {(a.details as any)?.reason && (
                    <span className="text-muted-foreground italic">"{String((a.details as any).reason)}"</span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Void bill?</DialogTitle></DialogHeader>
          {delTarget && (
            <p className="text-sm text-muted-foreground">
              Void bill <b>{delTarget.invoice_number}</b>? This bill will be voided but the bill number
              will be retained for audit continuity.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
              {busy ? "Voiding…" : "Void Bill"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hard-delete voided bill */}
      <Dialog open={!!hardDelTarget} onOpenChange={(o) => !o && setHardDelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {hardDelStep === 1
                ? `Permanently delete ${hardDelTarget?.invoice_number}?`
                : "Confirm with your password"}
            </DialogTitle>
          </DialogHeader>
          {hardDelStep === 1 && (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                This voided bill will be <b>permanently deleted</b>, including all its
                line items and payments. A full snapshot is retained in the audit log,
                but the bill row itself cannot be recovered.
              </p>
              <div className="pt-2">
                <Label className="text-xs">Reason (optional)</Label>
                <Input value={hardDelReason} onChange={(e) => setHardDelReason(e.target.value)} placeholder="e.g. cleaning up duplicate voids" />
              </div>
            </div>
          )}
          {hardDelStep === 2 && (
            <div className="space-y-2">
              <Label className="text-xs">Enter your account password to confirm</Label>
              <Input type="password" value={hardDelPwd} onChange={(e) => setHardDelPwd(e.target.value)} autoFocus />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setHardDelTarget(null)}>Cancel</Button>
            {hardDelStep === 1 ? (
              <Button variant="destructive" onClick={() => setHardDelStep(2)}>Proceed</Button>
            ) : (
              <Button variant="destructive" disabled={!hardDelPwd || busy} onClick={confirmHardDelete}>
                {busy ? "Verifying…" : "Verify & Delete Permanently"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit bill number */}
      <Dialog open={!!numTarget} onOpenChange={(o) => !o && setNumTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit bill number</DialogTitle></DialogHeader>
          {numTarget && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Current</Label>
                <div className="font-mono text-sm">{numTarget.invoice_number}</div>
              </div>
              <div>
                <Label className="text-xs">New bill number</Label>
                <Input value={numNew} onChange={(e) => setNumNew(e.target.value)} autoFocus />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Must be unique among active bills in the same series (prefix must match).
                </p>
              </div>
              <div>
                <Label className="text-xs">Reason (optional)</Label>
                <Input value={numReason} onChange={(e) => setNumReason(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNumTarget(null)}>Cancel</Button>
            <Button onClick={confirmEditNumber} disabled={busy || !numNew.trim()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}