import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckoutDialog } from "@/components/CheckoutDialog";
import { LogOut } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/front-desk/in-house")({
  head: () => ({ meta: [{ title: "In-house — HotelPilot" }] }),
  component: InHousePage,
});

interface InHouseRow {
  id: string;
  booking_number: string;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  balance_amount: number;
  guests: { name: string; mobile: string | null } | null;
  booking_rooms: { id: string; rate: number; rooms: { room_number: string } | null }[];
}

function InHousePage() {
  const { current, loading: propLoading } = useCurrentProperty();
  const [rows, setRows] = useState<InHouseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkoutId, setCheckoutId] = useState<string | null>(null);

  async function load() {
    if (!current) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("bookings")
      .select("id,booking_number,check_in,check_out,adults,children,balance_amount,guests(name,mobile),booking_rooms(id,rate,rooms(room_number))")
      .eq("property_id", current.id)
      .eq("status", "checked_in")
      .order("check_out", { ascending: true });
    if (error) toast.error(error.message);
    setRows((data ?? []) as unknown as InHouseRow[]);
    setLoading(false);
  }

  useEffect(() => {
    if (current) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const today = new Date().toISOString().slice(0, 10);

  if (propLoading) return <AppShell title="In-house"><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (!current) return <AppShell title="In-house"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="In-house Guests">
      <div className="max-w-7xl space-y-4">
        <Card>
          <CardContent className="pt-6">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No guests currently in-house.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Booking</TableHead>
                    <TableHead>Guest</TableHead>
                    <TableHead>Room(s)</TableHead>
                    <TableHead>Pax</TableHead>
                    <TableHead>Check-out</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const dueToday = r.check_out <= today;
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Link to="/front-desk/booking/$id" params={{ id: r.id }} className="text-primary font-medium hover:underline">
                            {r.booking_number}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <div>{r.guests?.name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{r.guests?.mobile ?? ""}</div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.booking_rooms.map((br) => br.rooms?.room_number).filter(Boolean).join(", ") || "—"}
                        </TableCell>
                        <TableCell className="text-xs">{r.adults}A {r.children > 0 ? `${r.children}C` : ""}</TableCell>
                        <TableCell className="text-xs">
                          {r.check_out}
                          {dueToday && <Badge className="ml-2" variant="outline">Due</Badge>}
                        </TableCell>
                        <TableCell className={r.balance_amount > 0 ? "text-amber-700 dark:text-amber-300 font-medium" : ""}>
                          ₹{Number(r.balance_amount).toLocaleString("en-IN")}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={() => setCheckoutId(r.id)}>
                            <LogOut className="h-4 w-4 mr-1" /> Checkout
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
      <CheckoutDialog
        bookingId={checkoutId}
        open={!!checkoutId}
        onOpenChange={(o) => { if (!o) setCheckoutId(null); }}
        onDone={() => { setCheckoutId(null); load(); }}
      />
    </AppShell>
  );
}