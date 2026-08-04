import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { ReportShell } from "@/components/ReportShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { fetchBanquetVisibility, type BanquetVisibilityRow } from "@/lib/banquetScope";
import { listEventBookings } from "@/lib/banquetEvent";
import { fmtDate, fmtDateTime, fmtINR, firstOfMonthIso } from "@/lib/reportExports";
import { istToday } from "@/lib/date";
import { reportQueryError } from "@/lib/queryError";

export const Route = createFileRoute("/_authenticated/reports/banquet-billing")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Banquet Billing (Owner) — HotelPilot" },
      { name: "description", content: "Owner-only archive of banquet event folios, food bills and master bills." },
      { property: "og:title", content: "Banquet Billing (Owner) — HotelPilot" },
      { property: "og:description", content: "Owner-only archive of banquet event folios, food bills and master bills." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // Server-verified gate: even a crafted navigation cannot reach this screen
  // without the owner/superadmin role.
  beforeLoad: async () => {
    const { data: u, error } = await supabase.auth.getUser();
    if (error || !u.user) throw redirect({ to: "/login" });
    const { data: allowed, error: __qe1 } = await supabase.rpc("is_owner_or_super", { _user_id: u.user.id });
    if (__qe1) reportQueryError("is owner or super", __qe1);
    if (!allowed) {
      if (typeof window !== "undefined") { try { toast.error("Access denied"); } catch { /* ignore */ } }
      throw redirect({ to: "/reports" });
    }
  },
  component: Page,
});

interface ChargeRow {
  id: string; description: string | null; qty: number; rate: number;
  amount: number; gst_rate: number | null; gst_amount: number | null; charged_on: string | null;
}
interface FolioRow {
  id: string; booking_id: string; invoice_number: string | null; created_at: string;
  status: string; guest_company: string | null; guest_gstin: string | null; notes: string | null;
  total_amount: number; paid_amount: number; room_number: string; guest: string;
  charges: ChargeRow[];
}
interface BillRow {
  id: string; bill_number: string | null; created_at: string; segment: string;
  status: string; total_amount: number; paid_amount: number; items: ChargeRow[];
}
interface MasterRow {
  id: string; bill_number: string | null; created_at: string; status: string; total_amount: number;
}
interface EventGroup {
  key: string; event_id: string | null; title: string; event_date: string | null;
  expired: boolean; expires_at: string | null; last_checkout_at: string | null;
  folios: FolioRow[]; bills: BillRow[]; masters: MasterRow[];
}

type EditTarget =
  | { kind: "charge"; id: string; label: string; description: string; qty: number; rate: number; gst_rate: number }
  | { kind: "item"; id: string; label: string; description: string; qty: number; rate: number; gst_rate: number }
  | { kind: "header"; id: string; label: string; guest_company: string; guest_gstin: string; notes: string };

type DeleteTarget = { kind: "folio" | "segment_bill" | "master_bill"; id: string; label: string; blocked: boolean };

function Page() {
  const { current } = useCurrentProperty();
  const propertyId = current?.id ?? null;

  const today = istToday();
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(today);
  const [groups, setGroups] = useState<EventGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [del, setDel] = useState<DeleteTarget | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      const fromIso = `${from}T00:00:00`;
      const toIso = `${to}T23:59:59`;

      const vis: BanquetVisibilityRow[] = await fetchBanquetVisibility(propertyId);
      const bookingIds = vis.map((v) => v.booking_id);
      if (bookingIds.length === 0) { setGroups([]); return; }
      const visByBooking = new Map(vis.map((v) => [v.booking_id, v]));

      const [{ data: bks, error: __qp1 }, events] = await Promise.all([
        supabase.from("bookings")
          .select("id,booking_number,guests(name),booking_rooms!booking_rooms_booking_id_fkey(rooms!booking_rooms_room_id_fkey(room_number))")
          .in("id", bookingIds),
        listEventBookings(propertyId),
      ]);
      if (__qp1) reportQueryError("bks", __qp1);
      const meta = new Map<string, { room: string; guest: string }>();
      for (const b of (bks ?? []) as any[]) {
        meta.set(b.id, {
          room: (b.booking_rooms ?? []).map((br: any) => br.rooms?.room_number).filter(Boolean).join(", "),
          guest: b.guests?.name ?? "",
        });
      }
      // Event headers come from the unified model; keys cover BOTH id spaces
      // because banquet_visibility / master bills still reference legacy ids.
      const eventMeta = new Map<string, { title: string; date: string | null }>();
      for (const e of events) {
        const m = {
          title: `${e.banquet_number ?? "Event"}${e.event_name ? ` · ${e.event_name}` : ""}`,
          date: e.event_date ?? null,
        };
        eventMeta.set(e.booking_id, m);
        if (e.legacy_id) eventMeta.set(e.legacy_id, m);
      }

      const [{ data: folios, error: __qp2 }, { data: segs, error: __qp3 }, { data: masters, error: __qp4 }] = await Promise.all([
        supabase.from("folios")
          .select("id,booking_id,invoice_number,created_at,status,guest_company,guest_gstin,notes,total_amount,paid_amount")
          .in("booking_id", bookingIds)
          .gte("created_at", fromIso).lte("created_at", toIso)
          .order("created_at", { ascending: false }),
        supabase.from("segment_bills")
          .select("id,booking_id,bill_number,segment,created_at,status,total_amount,paid_amount")
          .in("booking_id", bookingIds)
          .gte("created_at", fromIso).lte("created_at", toIso)
          .order("created_at", { ascending: false }),
        supabase.from("banquet_master_bills")
          .select("id,banquet_booking_id,bill_number,created_at,status,total_amount")
          .eq("property_id", propertyId)
          .gte("created_at", fromIso).lte("created_at", toIso),
      ]);
      if (__qp2) reportQueryError("folios", __qp2);
      if (__qp3) reportQueryError("segs", __qp3);
      if (__qp4) reportQueryError("masters", __qp4);

      const folioIds = ((folios ?? []) as any[]).map((f) => f.id as string);
      const billIds = ((segs ?? []) as any[]).map((s) => s.id as string);
      const [{ data: charges, error: __qp5 }, { data: items, error: __qp6 }] = await Promise.all([
        folioIds.length
          ? supabase.from("folio_charges")
              .select("id,folio_id,description,qty,rate,amount,gst_rate,gst_amount,charged_on")
              .in("folio_id", folioIds)
          : Promise.resolve({ data: [] as any[] } as any),
        billIds.length
          ? supabase.from("segment_bill_items")
              .select("id,segment_bill_id,description,qty,rate,amount,gst_rate,gst_amount")
              .in("segment_bill_id", billIds)
          : Promise.resolve({ data: [] as any[] } as any),
      ]);
      if (__qp5) reportQueryError("charges", __qp5);
      if (__qp6) reportQueryError("items", __qp6);
      const chargesByFolio = new Map<string, ChargeRow[]>();
      for (const c of (charges ?? []) as any[]) {
        const list = chargesByFolio.get(c.folio_id) ?? [];
        list.push(c as ChargeRow);
        chargesByFolio.set(c.folio_id, list);
      }
      const itemsByBill = new Map<string, ChargeRow[]>();
      for (const i of (items ?? []) as any[]) {
        const list = itemsByBill.get(i.segment_bill_id) ?? [];
        list.push({ ...i, charged_on: null } as ChargeRow);
        itemsByBill.set(i.segment_bill_id, list);
      }

      const byKey = new Map<string, EventGroup>();
      const groupFor = (bookingId: string): EventGroup => {
        const v = visByBooking.get(bookingId);
        const key = v?.event_id ?? bookingId;
        let g = byKey.get(key);
        if (!g) {
          const em = v?.event_id ? eventMeta.get(v.event_id) : undefined;
          g = {
            key, event_id: v?.event_id ?? null,
            title: em?.title ?? "Unlinked event block",
            event_date: em?.date ?? null,
            expired: v?.expired ?? false,
            expires_at: v?.expires_at ?? null,
            last_checkout_at: v?.last_checkout_at ?? null,
            folios: [], bills: [], masters: [],
          };
          byKey.set(key, g);
        }
        return g;
      };

      for (const f of (folios ?? []) as any[]) {
        const info = meta.get(f.booking_id) ?? { room: "", guest: "" };
        groupFor(f.booking_id).folios.push({
          ...f,
          total_amount: Number(f.total_amount ?? 0),
          paid_amount: Number(f.paid_amount ?? 0),
          room_number: info.room, guest: info.guest,
          charges: chargesByFolio.get(f.id) ?? [],
        });
      }
      for (const s of (segs ?? []) as any[]) {
        groupFor(s.booking_id).bills.push({
          id: s.id, bill_number: s.bill_number, created_at: s.created_at,
          segment: s.segment ?? "food", status: s.status ?? "open",
          total_amount: Number(s.total_amount ?? 0), paid_amount: Number(s.paid_amount ?? 0),
          items: itemsByBill.get(s.id) ?? [],
        });
      }
      for (const m of (masters ?? []) as any[]) {
        const g = byKey.get(m.banquet_booking_id);
        if (!g) continue;
        g.masters.push({
          id: m.id, bill_number: m.bill_number, created_at: m.created_at,
          status: m.status ?? "open", total_amount: Number(m.total_amount ?? 0),
        });
      }

      setGroups(Array.from(byKey.values()).sort((a, b) => (a.event_date ?? "") < (b.event_date ?? "") ? 1 : -1));
    } finally {
      setLoading(false);
    }
  }, [propertyId, from, to]);

  useEffect(() => { load(); }, [load]);

  const grand = useMemo(
    () => groups.reduce((s, g) => s + g.folios.reduce((x, f) => x + f.total_amount, 0)
      + g.bills.reduce((x, b) => x + b.total_amount, 0), 0),
    [groups],
  );

  async function saveEdit() {
    if (!edit) return;
    if (reason.trim().length < 3) { toast.error("A reason is required"); return; }
    setBusy(true);
    try {
      if (edit.kind === "charge") {
        const { error } = await supabase.rpc("owner_update_folio_charge", {
          _charge_id: edit.id, _description: edit.description, _qty: edit.qty,
          _rate: edit.rate, _gst_rate: edit.gst_rate, _reason: reason,
        });
        if (error) throw error;
      } else if (edit.kind === "item") {
        const { error } = await supabase.rpc("owner_update_bill_item", {
          _item_id: edit.id, _description: edit.description, _qty: edit.qty,
          _rate: edit.rate, _gst_rate: edit.gst_rate, _reason: reason,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("owner_update_folio_header", {
          _folio_id: edit.id, _guest_company: edit.guest_company,
          _guest_gstin: edit.guest_gstin, _notes: edit.notes, _reason: reason,
        });
        if (error) throw error;
      }
      toast.success("Saved and logged");
      setEdit(null); setReason("");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Update failed");
    } finally { setBusy(false); }
  }

  async function confirmDelete() {
    if (!del) return;
    if (reason.trim().length < 3) { toast.error("A reason is required"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.rpc("owner_void_banquet_document", {
        _kind: del.kind, _id: del.id, _reason: reason,
      });
      if (error) throw error;
      toast.success("Deleted and logged");
      setDel(null); setReason("");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    } finally { setBusy(false); }
  }

  return (
    <ReportShell
      title="Banquet Billing (Owner)"
      filters={<>
        <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
        <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
      </>}
      disabled={loading || groups.length === 0}
    >
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Every banquet event-block document. These stay visible on normal screens for
          48 hours after the event's last room checks out; afterwards they appear only here.
          Grand total across listed events: <span className="font-medium text-foreground">{fmtINR(grand)}</span>
        </p>

        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && groups.length === 0 && (
          <p className="text-sm text-muted-foreground">No banquet-linked bills found.</p>
        )}

        {groups.map((g) => (
          <Card key={g.key}>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">{g.title}</CardTitle>
                {g.event_date && <span className="text-xs text-muted-foreground">{fmtDate(g.event_date)}</span>}
                {g.expired
                  ? <Badge variant="secondary">Archived</Badge>
                  : g.expires_at
                    ? <Badge variant="outline">Visible until {fmtDateTime(g.expires_at)}</Badge>
                    : <Badge variant="outline">In progress</Badge>}
              </div>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <Section title="Room folios">
                {g.folios.length === 0 && <Empty />}
                {g.folios.map((f) => (
                  <div key={f.id} className="rounded border p-2 space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-medium">{f.invoice_number ?? f.id.slice(0, 8)}</span>{" "}
                        <span className="text-muted-foreground">
                          Room {f.room_number || "—"} · {f.guest || "—"} · {fmtDate(f.created_at)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{f.status}</Badge>
                        <span className="tabular-nums">{fmtINR(f.total_amount)}</span>
                        <Button size="sm" variant="outline" onClick={() => {
                          setReason("");
                          setEdit({
                            kind: "header", id: f.id, label: `Header · ${f.invoice_number ?? ""}`,
                            guest_company: f.guest_company ?? "", guest_gstin: f.guest_gstin ?? "", notes: f.notes ?? "",
                          });
                        }}><Pencil className="h-3.5 w-3.5" /> Header</Button>
                        <Button size="sm" variant="outline" onClick={() => {
                          setReason("");
                          setDel({ kind: "folio", id: f.id, label: f.invoice_number ?? f.id, blocked: f.paid_amount > 0 });
                        }}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                    <LineTable
                      lines={f.charges}
                      onEdit={(c) => {
                        setReason("");
                        setEdit({
                          kind: "charge", id: c.id, label: c.description ?? "Charge",
                          description: c.description ?? "", qty: Number(c.qty ?? 1),
                          rate: Number(c.rate ?? 0), gst_rate: Number(c.gst_rate ?? 0),
                        });
                      }}
                    />
                  </div>
                ))}
              </Section>

              <Section title="Food bills">
                {g.bills.length === 0 && <Empty />}
                {g.bills.map((b) => (
                  <div key={b.id} className="rounded border p-2 space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-medium">{b.bill_number ?? b.id.slice(0, 8)}</span>{" "}
                        <span className="text-muted-foreground">{b.segment} · {fmtDate(b.created_at)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{b.status}</Badge>
                        <span className="tabular-nums">{fmtINR(b.total_amount)}</span>
                        <Button size="sm" variant="outline" onClick={() => {
                          setReason("");
                          setDel({ kind: "segment_bill", id: b.id, label: b.bill_number ?? b.id, blocked: b.paid_amount > 0 });
                        }}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                    <LineTable
                      lines={b.items}
                      onEdit={(c) => {
                        setReason("");
                        setEdit({
                          kind: "item", id: c.id, label: c.description ?? "Item",
                          description: c.description ?? "", qty: Number(c.qty ?? 1),
                          rate: Number(c.rate ?? 0), gst_rate: Number(c.gst_rate ?? 0),
                        });
                      }}
                    />
                  </div>
                ))}
              </Section>

              <Section title="Master bill">
                {g.masters.length === 0 && <Empty />}
                {g.masters.map((m) => (
                  <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
                    <div>
                      <span className="font-medium">{m.bill_number ?? m.id.slice(0, 8)}</span>{" "}
                      <span className="text-muted-foreground">{fmtDate(m.created_at)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{m.status}</Badge>
                      <span className="tabular-nums">{fmtINR(m.total_amount)}</span>
                      <Button size="sm" variant="outline" onClick={() => {
                        setReason("");
                        setDel({ kind: "master_bill", id: m.id, label: m.bill_number ?? m.id, blocked: false });
                      }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground">
                  Master bill totals are never hand-edited — correct the underlying folio
                  charges or food-bill lines and the totals recompute automatically.
                </p>
              </Section>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!edit} onOpenChange={(o) => { if (!o) { setEdit(null); setReason(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit · {edit?.label}</DialogTitle></DialogHeader>
          {edit?.kind === "header" ? (
            <div className="space-y-3">
              <div><Label>Company</Label><Input value={edit.guest_company} onChange={(e) => setEdit({ ...edit, guest_company: e.target.value })} /></div>
              <div><Label>GSTIN</Label><Input value={edit.guest_gstin} onChange={(e) => setEdit({ ...edit, guest_gstin: e.target.value })} /></div>
              <div><Label>Notes</Label><Textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></div>
            </div>
          ) : edit ? (
            <div className="space-y-3">
              <div><Label>Description</Label><Input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
              <div className="grid grid-cols-3 gap-2">
                <div><Label>Qty</Label><Input type="number" value={edit.qty} onChange={(e) => setEdit({ ...edit, qty: Number(e.target.value) })} /></div>
                <div><Label>Rate</Label><Input type="number" value={edit.rate} onChange={(e) => setEdit({ ...edit, rate: Number(e.target.value) })} /></div>
                <div><Label>GST %</Label><Input type="number" value={edit.gst_rate} onChange={(e) => setEdit({ ...edit, gst_rate: Number(e.target.value) })} /></div>
              </div>
            </div>
          ) : null}
          <div><Label>Reason (required)</Label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being changed?" /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEdit(null); setReason(""); }}>Cancel</Button>
            <Button onClick={saveEdit} disabled={busy}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!del} onOpenChange={(o) => { if (!o) { setDel(null); setReason(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete · {del?.label}</DialogTitle></DialogHeader>
          {del?.blocked ? (
            <p className="text-sm text-destructive">
              This document has payments attached and cannot be deleted. Reverse the
              payment first.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                The document is voided (never hard-deleted) so bill numbering stays intact.
                A full snapshot is recorded in the owner override log.
              </p>
              <div><Label>Reason (required)</Label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></div>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDel(null); setReason(""); }}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={busy || !!del?.blocked}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ReportShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function Empty() {
  return <p className="text-xs text-muted-foreground">None.</p>;
}

function LineTable({ lines, onEdit }: { lines: ChargeRow[]; onEdit: (c: ChargeRow) => void }) {
  if (lines.length === 0) return null;
  return (
    <table className="w-full text-xs">
      <tbody>
        {lines.map((c) => (
          <tr key={c.id} className="border-t">
            <td className="py-1">{c.description ?? "—"}</td>
            <td className="py-1 text-right tabular-nums w-16">{Number(c.qty ?? 1)}</td>
            <td className="py-1 text-right tabular-nums w-24">{fmtINR(Number(c.rate ?? 0))}</td>
            <td className="py-1 text-right tabular-nums w-24">{fmtINR(Number(c.amount ?? 0))}</td>
            <td className="py-1 text-right w-16">
              <Button size="sm" variant="ghost" onClick={() => onEdit(c)}><Pencil className="h-3.5 w-3.5" /></Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
