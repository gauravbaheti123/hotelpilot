import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { logActivity, userDisplayName } from "@/lib/activityLog";
import { toast } from "sonner";
import { Pencil, Trash2, FileSpreadsheet } from "lucide-react";

export const Route = createFileRoute("/_authenticated/billing/invoices")({
  head: () => ({ meta: [{ title: "Invoices — HotelPilot" }] }),
  component: InvoicesPage,
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
  const navigate = useNavigate();
  const canEditDelete = hasRole(roles, "manager") || hasRole(roles, "owner") || hasRole(roles, "superadmin");
  const isOwner = hasRole(roles, "owner") || hasRole(roles, "superadmin");

  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [audit, setAudit] = useState(false);
  const [delTarget, setDelTarget] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);

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
    } as any).eq("id", delTarget.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    logActivity({
      property_id: propertyId!,
      user_id: user?.id ?? "",
      user_name: userDisplayName(user as any),
      action_type: "BILL_DELETED",
      module: "Billing",
      reference_id: delTarget.id,
      reference_label: `${delTarget.invoice_number} — ${delTarget.bookings?.guests?.name ?? ""}`,
      details: { bill_number: delTarget.invoice_number, amount: delTarget.total_amount },
    });
    toast.success(`Bill ${delTarget.invoice_number} voided`);
    setDelTarget(null);
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
              <div key={r.id} className={`flex items-center gap-3 px-4 py-3 ${voided ? "bg-rose-50/30" : "hover:bg-accent"}`}>
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
                {canEditDelete && !voided && (
                  <div className="flex items-center gap-1 ml-2">
                    <Button size="sm" variant="ghost"
                      onClick={() => navigate({ to: "/billing/folio/$bookingId", params: { bookingId: r.booking_id } })}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                      onClick={() => setDelTarget(r)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete bill?</DialogTitle></DialogHeader>
          {delTarget && (
            <p className="text-sm text-muted-foreground">
              Delete bill <b>{delTarget.invoice_number}</b>? This bill will be voided but the bill number
              will be retained for audit continuity.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
              {busy ? "Deleting…" : "Delete Bill"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}