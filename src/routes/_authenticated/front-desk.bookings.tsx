import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { BOOKING_STATUS_LABEL, BOOKING_STATUS_TONE } from "@/lib/front-desk";
import { PlusCircle } from "lucide-react";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/front-desk/bookings")({
  head: () => ({ meta: [{ title: "Bookings — HotelPilot" }] }),
  component: () => (<RequirePermission module="bookings"><BookingsPage /></RequirePermission>),
});

interface BookingRow {
  id: string;
  booking_number: string;
  status: string;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  total_amount: number;
  balance_amount: number;
  guests: { name: string; mobile: string | null } | null;
}

function BookingsPage() {
  const { current, loading: propLoading } = useCurrentProperty();
  const [rows, setRows] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");

  async function load() {
    if (!current) return;
    setLoading(true);
    let q = supabase
      .from("bookings")
      .select("id,booking_number,status,check_in,check_out,adults,children,total_amount,balance_amount,guests(name,mobile)")
      .eq("property_id", current.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (status !== "all") q = q.eq("status", status as any);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setRows((data ?? []) as unknown as BookingRow[]);
    setLoading(false);
  }

  useEffect(() => {
    if (current) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, status]);

  const filtered = rows.filter((r) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      r.booking_number.toLowerCase().includes(s) ||
      (r.guests?.name ?? "").toLowerCase().includes(s) ||
      (r.guests?.mobile ?? "").toLowerCase().includes(s)
    );
  });

  if (propLoading) return <AppShell title="Bookings"><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (!current) return <AppShell title="Bookings"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="Bookings">
      <div className="max-w-7xl space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search by booking #, guest name, mobile…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="reserved">Reserved</SelectItem>
              <SelectItem value="checked_in">Checked-in</SelectItem>
              <SelectItem value="checked_out">Checked-out</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="no_show">No-show</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex-1" />
          <Button asChild>
            <Link to="/front-desk/new" search={{}}><PlusCircle className="h-4 w-4 mr-1" /> New booking</Link>
          </Button>
        </div>

        <Card>
          <CardContent className="pt-6">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">No bookings.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Booking #</TableHead>
                    <TableHead>Guest</TableHead>
                    <TableHead>Stay</TableHead>
                    <TableHead>Pax</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer">
                      <TableCell className="font-medium">
                        <Link to="/front-desk/booking/$id" params={{ id: r.id }} className="text-primary hover:underline">
                          {r.booking_number}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div>{r.guests?.name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{r.guests?.mobile ?? ""}</div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.check_in} → {r.check_out}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.adults}A {r.children > 0 ? `${r.children}C` : ""}
                      </TableCell>
                      <TableCell>₹{Number(r.total_amount).toLocaleString("en-IN")}</TableCell>
                      <TableCell className={r.balance_amount > 0 ? "text-amber-700 dark:text-amber-300 font-medium" : ""}>
                        ₹{Number(r.balance_amount).toLocaleString("en-IN")}
                      </TableCell>
                      <TableCell>
                        {r.status === "checked_in" && r.check_out < new Date().toISOString().slice(0,10) ? (
                          <Badge className="bg-[#b45309] text-white border-transparent font-bold">OVERDUE</Badge>
                        ) : (
                          <Badge variant="outline" className={BOOKING_STATUS_TONE[r.status]}>
                            {BOOKING_STATUS_LABEL[r.status] ?? r.status}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}