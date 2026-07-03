import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { fetchAnalytics, isoDaysAgo, type AnalyticsRange } from "@/lib/analytics";
import { todayIso } from "@/lib/reports";
import { inr } from "@/lib/billing";
import { RequirePermission } from "@/components/RequirePermission";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";

export const Route = createFileRoute("/_authenticated/reports/analytics")({
  head: () => ({ meta: [{ title: "Analytics — HotelPilot" }] }),
  component: () => (<RequirePermission module="reports"><AnalyticsPage /></RequirePermission>),
});

function AnalyticsPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const [from, setFrom] = useState<string>(isoDaysAgo(29));
  const [to, setTo] = useState<string>(todayIso());
  const [data, setData] = useState<AnalyticsRange | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!propertyId) return;
    let cancel = false;
    setLoading(true);
    fetchAnalytics(propertyId, from, to)
      .then((d) => { if (!cancel) setData(d); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [propertyId, from, to]);

  if (!propertyId) return <AppShell title="Analytics"><EmptyPropertyState /></AppShell>;

  const chartData = (data?.days ?? []).map((d) => ({
    date: d.date.slice(5),
    Occupancy: d.occupancy_pct,
    ADR: d.adr,
    RevPAR: d.revpar,
    Revenue: d.room_revenue,
  }));

  const t = data?.totals;

  return (
    <AppShell title="Analytics">
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <Label htmlFor="from">From</Label>
          <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" />
        </div>
        <div>
          <Label htmlFor="to">To</Label>
          <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { setFrom(isoDaysAgo(6)); setTo(todayIso()); }}>7d</Button>
          <Button variant="outline" size="sm" onClick={() => { setFrom(isoDaysAgo(29)); setTo(todayIso()); }}>30d</Button>
          <Button variant="outline" size="sm" onClick={() => { setFrom(isoDaysAgo(89)); setTo(todayIso()); }}>90d</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Kpi title="Occupancy" value={t ? `${t.occupancy_pct}%` : "—"} hint={t ? `${t.rooms_sold}/${t.rooms_available} room-nights` : ""} />
        <Kpi title="ADR" value={t ? inr(t.adr) : "—"} hint="Avg daily rate" />
        <Kpi title="RevPAR" value={t ? inr(t.revpar) : "—"} hint="Revenue / available room" />
        <Kpi title="Room Revenue" value={t ? inr(t.room_revenue) : "—"} hint={`${data?.days.length ?? 0} days`} />
      </div>

      <Card className="mt-4">
        <CardHeader><CardTitle className="text-base">Occupancy %</CardTitle></CardHeader>
        <CardContent style={{ height: 260 }}>
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} unit="%" />
              <Tooltip />
              <Line type="monotone" dataKey="Occupancy" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader><CardTitle className="text-base">ADR & RevPAR</CardTitle></CardHeader>
        <CardContent style={{ height: 260 }}>
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="ADR" stroke="#2563eb" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="RevPAR" stroke="#10b981" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader><CardTitle className="text-base">Daily Room Revenue</CardTitle></CardHeader>
        <CardContent style={{ height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="Revenue" fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader><CardTitle className="text-base">Daily breakdown</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2 text-right">Sold</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Occ %</th>
                <th className="px-3 py-2 text-right">ADR</th>
                <th className="px-3 py-2 text-right">RevPAR</th>
                <th className="px-3 py-2 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {(data?.days ?? []).map((d) => (
                <tr key={d.date} className="border-t">
                  <td className="px-3 py-2">{d.date}</td>
                  <td className="px-3 py-2 text-right">{d.rooms_sold}</td>
                  <td className="px-3 py-2 text-right">{d.rooms_total}</td>
                  <td className="px-3 py-2 text-right">{d.occupancy_pct}%</td>
                  <td className="px-3 py-2 text-right">{inr(d.adr)}</td>
                  <td className="px-3 py-2 text-right">{inr(d.revpar)}</td>
                  <td className="px-3 py-2 text-right">{inr(d.room_revenue)}</td>
                </tr>
              ))}
              {!loading && (data?.days.length ?? 0) === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No data</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </AppShell>
  );
}

function Kpi({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{title}</CardTitle></CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}