import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { BANQUET_STATUS_TONE } from "@/lib/banquet";
import { PlusCircle, Trash2, AlertTriangle } from "lucide-react";
import { useAuth, hasRole } from "@/hooks/use-auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/banquet/bookings")({
  head: () => ({ meta: [{ title: "Banquet Events — HotelPilot" }] }),
  component: BanquetBookingsPage,
});

interface Row {
  id: string; banquet_number: string; function_type: string;
  event_date: string; start_time: string; end_time: string;
  pax: number; total_amount: number; balance_amount: number; status: string;
  halls: { name: string } | null;
  guests: { name: string; mobile: string | null } | null;
}

function BanquetBookingsPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const { user, roles } = useAuth();
  const isOwner = hasRole(roles, "owner") || hasRole(roles, "superadmin");
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [delTarget, setDelTarget] = useState<Row | null>(null);
  const [delStep, setDelStep] = useState<1 | 2>(1);
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (!propertyId) return;
    (async () => {
      const { data } = await supabase.from("banquet_bookings")
        .select("id,banquet_number,function_type,event_date,start_time,end_time,pax,total_amount,balance_amount,status,halls(name),guests(name,mobile)")
        .eq("property_id", propertyId)
        .order("event_date", { ascending: false })
        .limit(200);
      setRows((data ?? []) as unknown as Row[]);
    })();
  };
  useEffect(load, [propertyId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!propertyId) return <AppShell title="Banquet Events"><EmptyPropertyState /></AppShell>;

  const filtered = rows.filter((r) =>
    !q ||
    r.banquet_number.toLowerCase().includes(q.toLowerCase()) ||
    (r.guests?.name ?? "").toLowerCase().includes(q.toLowerCase()) ||
    (r.halls?.name ?? "").toLowerCase().includes(q.toLowerCase()));

  const isEventBill = (n: string) => /^EVENT/i.test(n);

  async function permanentlyDelete() {
    if (!delTarget || !user?.email) return;
    setBusy(true);
    const { error: pErr } = await supabase.auth.signInWithPassword({
      email: user.email, password: pwd,
    });
    if (pErr) { setBusy(false); return toast.error("Password incorrect"); }
    const { error } = await supabase.from("banquet_bookings")
      .delete().eq("id", delTarget.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Event Bill ${delTarget.banquet_number} permanently deleted`);
    setDelTarget(null); setPwd(""); setDelStep(1);
    load();
  }

  return (
    <AppShell title="Banquet Events">
      <div className="flex items-center gap-2 mb-4">
        <Input placeholder="Search event / hall / guest…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <div className="flex-1" />
        <Link to="/banquet/new"><Button size="sm"><PlusCircle className="h-4 w-4 mr-1" /> New event</Button></Link>
      </div>
      <Card>
        <CardContent className="p-0 divide-y">
          {filtered.length === 0 && <p className="p-4 text-sm text-muted-foreground">No events.</p>}
          {filtered.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3 hover:bg-accent">
              <Link to="/banquet/event/$id" params={{ id: r.id }} className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium text-sm">{r.banquet_number}</div>
                  <Badge variant="outline" className={BANQUET_STATUS_TONE[r.status]}>{r.status}</Badge>
                  <span className="text-xs text-muted-foreground">{r.function_type}</span>
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {r.halls?.name ?? "—"} · {r.event_date} · {r.start_time?.slice(0,5)}–{r.end_time?.slice(0,5)} · {r.pax} pax · {r.guests?.name ?? "—"}
                </div>
              </Link>
              <div className="text-right">
                <div className="text-sm font-medium">₹{Number(r.total_amount).toLocaleString("en-IN")}</div>
                <div className="text-xs text-muted-foreground">Bal ₹{Number(r.balance_amount).toLocaleString("en-IN")}</div>
              </div>
              {isOwner && isEventBill(r.banquet_number) && (
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive ml-2"
                  onClick={(e) => { e.preventDefault(); setDelTarget(r); setDelStep(1); setPwd(""); }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {delStep === 1 ? `Delete Event Bill ${delTarget?.banquet_number}?` : "Confirm with password"}
            </DialogTitle>
          </DialogHeader>
          {delStep === 1 && (
            <p className="text-sm text-muted-foreground">
              Event bills are <b>permanently deleted</b> and cannot be recovered. No record will remain.
            </p>
          )}
          {delStep === 2 && (
            <div className="space-y-2">
              <Label className="text-xs">Enter your account password to confirm</Label>
              <Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoFocus />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelTarget(null)}>Cancel</Button>
            {delStep === 1 ? (
              <Button variant="destructive" onClick={() => setDelStep(2)}>Proceed</Button>
            ) : (
              <Button variant="destructive" disabled={!pwd || busy} onClick={permanentlyDelete}>
                {busy ? "Verifying…" : "Verify & Delete Permanently"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}