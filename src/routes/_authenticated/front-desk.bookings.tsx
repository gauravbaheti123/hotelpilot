import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { fetchBanquetScope, isBanquetRecord } from "@/lib/banquetScope";
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
import { BOOKING_STATUS_LABEL, BOOKING_STATUS_TONE } from "@/lib/front-desk";
import { PlusCircle, FileText } from "lucide-react";

import { RequirePermission } from "@/components/RequirePermission";
import { useRegisterRefresh } from "@/components/PullToRefresh";
import { istDateISO } from "@/lib/date";
import { toastError } from "@/lib/errorMessage";
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

const BOOKING_SELECT =
  "id,booking_number,status,check_in,check_out,adults,children,total_amount,balance_amount,guests(name,mobile)";

function applyStatus(q: any, status: string) {
  return status !== "all" ? q.eq("status", status as any) : q;
}

async function fetchBanquetFiltered(
  propertyId: string,
  rows: any[],
): Promise<BookingRow[]> {
  const scope = await fetchBanquetScope(propertyId);
  return rows.filter(
    (b) => !isBanquetRecord(scope, { booking_id: b.id }),
  ) as unknown as BookingRow[];
}

function BookingsPage() {
  const { current, loading: propLoading } = useCurrentProperty();
  const [rows, setRows] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");

  // Debounced search term so server-side search only fires once typing pauses.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  async function load() {
    if (!current) return;
    setLoading(true);
    const term = debouncedSearch;
    try {
      if (term) {
        // Active search: no date/created_at window — find the booking anywhere
        // in the property's history. Match by booking number OR by guest
        // name/mobile (resolved through the guests table), then union client-side.
        const byNumber = applyStatus(
          supabase
            .from("bookings")
            .select(BOOKING_SELECT)
            .eq("property_id", current.id)
            .ilike("booking_number", `%${term}%`)
            .order("created_at", { ascending: false })
            .limit(200),
          status,
        );

        // Guest name/mobile matches: resolve guest ids, then fetch their bookings.
        const { data: guestRows } = await supabase
          .from("guests")
          .select("id")
          .or(`name.ilike.%${term}%,mobile.ilike.%${term}%`)
          .limit(200);
        const guestIds = (guestRows ?? []).map((g: any) => g.id);

        const { data: numData, error: numErr } = await byNumber;
        if (numErr) toastError(numErr);

        let nameData: any[] = [];
        if (guestIds.length) {
          const { data, error } = await applyStatus(
            supabase
              .from("bookings")
              .select(BOOKING_SELECT)
              .eq("property_id", current.id)
              .in("guest_id", guestIds)
              .order("created_at", { ascending: false })
              .limit(200),
            status,
          );
          if (error) toastError(error);
          nameData = (data ?? []) as any[];
        }

        const seen = new Set<string>();
        const merged = [...(numData ?? []), ...nameData].filter((b: any) => {
          if (seen.has(b.id)) return false;
          seen.add(b.id);
          return true;
        }) as any[];

        setRows(await fetchBanquetFiltered(current.id, merged));
      } else {
        // Browse view (no search text): keep the capped recent-window fetch.
        const q = applyStatus(
          supabase
            .from("bookings")
            .select(BOOKING_SELECT)
            .eq("property_id", current.id)
            .order("created_at", { ascending: false })
            .limit(200),
          status,
        );
        const { data, error } = await q;
        if (error) toastError(error);
        setRows(await fetchBanquetFiltered(current.id, (data ?? []) as any[]));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (current) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, status, debouncedSearch]);

  // Pull-to-refresh (native shell only).
  useRegisterRefresh(load);

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
            <SelectTrigger className="w-full sm:w-[180px]"><SelectValue /></SelectTrigger>
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
            <Link to="/front-desk/new" search={{ roomId: undefined, categoryId: undefined, eventId: undefined, blockId: undefined, eventName: undefined, checkIn: undefined, checkOut: undefined }}><PlusCircle className="h-4 w-4 mr-1" /> New booking</Link>
          </Button>
        </div>

        <Card>
          <CardContent className="pt-6">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : rows.length === 0 ? (
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
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
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
                        {r.status === "checked_in" && r.check_out < istDateISO(new Date()) ? (
                          <Badge className="bg-[#b45309] text-white border-transparent font-bold">OVERDUE</Badge>
                        ) : (
                          <Badge variant="outline" className={BOOKING_STATUS_TONE[r.status]}>
                            {BOOKING_STATUS_LABEL[r.status] ?? r.status}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link to="/bookings/$bookingId/grc" params={{ bookingId: r.id }}>
                          <Button size="sm" variant="ghost" title="Guest Registration Card">
                            <FileText className="h-4 w-4" />
                          </Button>
                        </Link>
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
