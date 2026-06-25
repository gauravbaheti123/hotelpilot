import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentProperty } from "@/hooks/use-property";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BedDouble, LogIn, LogOut, IndianRupee, Building2, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — HotelPilot" }] }),
  component: DashboardPage,
});

type Room = {
  id: string;
  room_number: string;
  status: "vacant" | "occupied" | "blocked" | "maintenance";
  housekeeping_status: "clean" | "dirty" | "inspected" | "out_of_order";
};

type ScheduleRow = {
  id: string;
  booking_number: string;
  balance_amount: number;
  guest_name: string | null;
  room_numbers: string;
};

function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function DashboardPage() {
  const { user, roles } = useAuth();
  const isSuperadmin = roles.includes("superadmin");
  const { current, currentId } = useCurrentProperty();

  if (isSuperadmin && !currentId) {
    return <SuperadminDashboard email={user?.email ?? ""} />;
  }
  return (
    <OwnerDashboard
      propertyId={currentId}
      propertyName={current?.name ?? ""}
      propertyCity={current?.city ?? ""}
      email={user?.email ?? ""}
      userId={user?.id ?? ""}
      isSuperadmin={isSuperadmin}
    />
  );
}

function SuperadminDashboard({ email }: { email: string }) {
  const [counts, setCounts] = useState({ properties: 0, rooms: 0, staff: 0, revenue: 0 });
  useEffect(() => {
    (async () => {
      const today = todayISO();
      const [p, r, s, pay] = await Promise.all([
        supabase.from("properties").select("id", { count: "exact", head: true }),
        supabase.from("rooms").select("id", { count: "exact", head: true }),
        supabase.from("user_roles").select("user_id", { count: "exact", head: true }).neq("role", "superadmin"),
        supabase.from("payments").select("amount").gte("paid_at", `${today}T00:00:00`).lte("paid_at", `${today}T23:59:59`),
      ]);
      const revenue = (pay.data ?? []).reduce((a, x: any) => a + Number(x.amount || 0), 0);
      setCounts({ properties: p.count ?? 0, rooms: r.count ?? 0, staff: s.count ?? 0, revenue });
    })();
  }, []);
  const name = email ? email.split("@")[0] : "growth";
  return (
    <AppShell title="Dashboard">
      <div className="max-w-6xl space-y-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Welcome, {name}</h2>
          <p className="text-sm text-muted-foreground">HotelPilot Super Admin</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Total Properties" value={counts.properties} icon={Building2} />
          <Kpi label="Total Rooms" value={counts.rooms} icon={BedDouble} />
          <Kpi label="Total Staff" value={counts.staff} icon={Users} />
          <Kpi label="Today's Revenue" value={`₹${counts.revenue.toLocaleString("en-IN")}`} icon={IndianRupee} />
        </div>
      </div>
    </AppShell>
  );
}

function OwnerDashboard({
  propertyId,
  propertyName,
  propertyCity,
  email,
  userId,
  isSuperadmin,
}: {
  propertyId: string | null;
  propertyName: string;
  propertyCity: string;
  email: string;
  userId: string;
  isSuperadmin: boolean;
}) {
  const [name, setName] = useState<string>(email ? email.split("@")[0] : "");
  const [kpi, setKpi] = useState({ occupied: 0, arrivals: 0, departures: 0, revenue: 0 });
  const [rooms, setRooms] = useState<Room[]>([]);
  const [arrivals, setArrivals] = useState<ScheduleRow[]>([]);
  const [departures, setDepartures] = useState<ScheduleRow[]>([]);

  useEffect(() => {
    if (!userId) return;
    supabase.from("profiles").select("name").eq("id", userId).maybeSingle()
      .then(({ data }) => { if (data?.name) setName(data.name); });
  }, [userId]);

  useEffect(() => {
    if (!propertyId) return;
    const today = todayISO();
    (async () => {
      const [occ, arr, dep, pay, rms] = await Promise.all([
        supabase.from("bookings").select("id", { count: "exact", head: true })
          .eq("property_id", propertyId).eq("status", "checked_in"),
        supabase.from("bookings").select("id, booking_number, balance_amount, guest_id, guests:guest_id(name), booking_rooms(rooms(room_number))")
          .eq("property_id", propertyId).eq("status", "reserved").eq("check_in", today),
        supabase.from("bookings").select("id, booking_number, balance_amount, guest_id, guests:guest_id(name), booking_rooms(rooms(room_number))")
          .eq("property_id", propertyId).eq("status", "checked_in").eq("check_out", today),
        supabase.from("payments").select("amount").eq("property_id", propertyId)
          .gte("paid_at", `${today}T00:00:00`).lte("paid_at", `${today}T23:59:59`),
        supabase.from("rooms").select("id, room_number, status, housekeeping_status")
          .eq("property_id", propertyId).eq("is_active", true).order("room_number"),
      ]);
      const revenue = (pay.data ?? []).reduce((a, x: any) => a + Number(x.amount || 0), 0);
      setKpi({
        occupied: occ.count ?? 0,
        arrivals: arr.data?.length ?? 0,
        departures: dep.data?.length ?? 0,
        revenue,
      });
      const mapRow = (b: any): ScheduleRow => ({
        id: b.id,
        booking_number: b.booking_number,
        balance_amount: Number(b.balance_amount || 0),
        guest_name: b.guests?.name ?? null,
        room_numbers: (b.booking_rooms ?? []).map((br: any) => br.rooms?.room_number).filter(Boolean).join(", ") || "—",
      });
      setArrivals((arr.data ?? []).map(mapRow));
      setDepartures((dep.data ?? []).map(mapRow));
      setRooms((rms.data ?? []) as Room[]);
    })();
  }, [propertyId]);

  const subtitle = propertyName
    ? `${propertyName}${propertyCity ? ` · ${propertyCity}` : ""}`
    : isSuperadmin ? "HotelPilot Super Admin" : "";

  return (
    <AppShell title="Dashboard">
      <div className="max-w-7xl space-y-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Welcome, {name}</h2>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Occupied Rooms" value={kpi.occupied} icon={BedDouble} />
          <Kpi label="Expected Arrivals" value={kpi.arrivals} icon={LogIn} />
          <Kpi label="Expected Departures" value={kpi.departures} icon={LogOut} />
          <Kpi label="Today's Revenue" value={`₹${kpi.revenue.toLocaleString("en-IN")}`} icon={IndianRupee} />
        </div>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Room Status</CardTitle></CardHeader>
          <CardContent>
            {rooms.length === 0 ? (
              <div className="text-sm text-muted-foreground">No rooms configured.</div>
            ) : (
              <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(80px,1fr))]">
                {rooms.map((r) => {
                  const { bg, label } = roomTileStyle(r);
                  return (
                    <Link
                      key={r.id}
                      to="/rooms/$roomNumber"
                      params={{ roomNumber: r.room_number }}
                      className={`rounded-md px-2 py-3 text-center text-white transition hover:opacity-90 hover:ring-2 hover:ring-offset-1 ${bg}`}
                    >
                      <div className="text-sm font-semibold">{r.room_number}</div>
                      <div className="text-[10px] uppercase tracking-wide opacity-90">{label}</div>
                    </Link>
                  );
                })}
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <LegendDot className="bg-emerald-600" label="Vacant" />
              <LegendDot className="bg-rose-600" label="Occupied" />
              <LegendDot className="bg-amber-500" label="Dirty" />
              <LegendDot className="bg-slate-500" label="Maintenance" />
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <ScheduleCard
            title="Today's Arrivals"
            rows={arrivals}
            actionLabel="Check-in"
            emptyText="No arrivals scheduled for today."
            showBalance={false}
          />
          <ScheduleCard
            title="Today's Departures"
            rows={departures}
            actionLabel="Checkout"
            emptyText="No departures scheduled for today."
            showBalance
          />
        </div>
      </div>
    </AppShell>
  );
}

function Kpi({ label, value, icon: Icon }: { label: string; value: number | string; icon: any }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent><div className="text-2xl font-semibold">{value}</div></CardContent>
    </Card>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${className}`} />
      {label}
    </span>
  );
}

function roomTileStyle(r: Room): { bg: string; label: string } {
  if (r.status === "maintenance" || r.housekeeping_status === "out_of_order")
    return { bg: "bg-slate-500", label: "Maintenance" };
  if (r.status === "occupied") return { bg: "bg-rose-600", label: "Occupied" };
  if (r.housekeeping_status === "dirty") return { bg: "bg-amber-500", label: "Dirty" };
  if (r.status === "blocked") return { bg: "bg-slate-500", label: "Blocked" };
  return { bg: "bg-emerald-600", label: "Vacant" };
}

function ScheduleCard({
  title, rows, actionLabel, emptyText, showBalance,
}: {
  title: string;
  rows: ScheduleRow[];
  actionLabel: string;
  emptyText: string;
  showBalance: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">{emptyText}</div>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{r.guest_name ?? "Guest"}</div>
                  <div className="text-xs text-muted-foreground">
                    Room {r.room_numbers} · {r.booking_number}
                    {showBalance && (
                      <> · Balance ₹{r.balance_amount.toLocaleString("en-IN")}</>
                    )}
                  </div>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to="/front-desk/booking/$id" params={{ id: r.id }}>{actionLabel}</Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}