import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import { addDaysIso, todayIso } from "@/lib/front-desk";
import { pickSeason, effectiveRate, type RateSeason } from "@/lib/yield";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/front-desk/rate-calendar")({
  head: () => ({ meta: [{ title: "Rate Calendar — HotelPilot" }] }),
  component: RateCalendarPage,
});

const DAYS = 14;

interface Cat { id: string; name: string }
interface Tariff { id: string; category_id: string | null; rate: number; is_default: boolean; is_active: boolean }

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}
function dow(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { weekday: "short" });
}

function RateCalendarPage() {
  const { current, loading: propLoading } = useCurrentProperty();
  const [start, setStart] = useState<string>(todayIso());
  const [cats, setCats] = useState<Cat[]>([]);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [seasons, setSeasons] = useState<RateSeason[]>([]);
  const [loading, setLoading] = useState(true);

  const days = useMemo(
    () => Array.from({ length: DAYS }, (_, i) => addDaysIso(start, i)),
    [start],
  );
  const rangeEnd = useMemo(() => addDaysIso(start, DAYS - 1), [start]);

  async function load() {
    if (!current) return;
    setLoading(true);
    const [c, t, s] = await Promise.all([
      supabase.from("room_categories").select("id,name").eq("property_id", current.id).order("name"),
      supabase.from("tariff_plans").select("id,category_id,rate,is_default,is_active").eq("property_id", current.id).eq("is_active", true),
      supabase.from("rate_seasons").select("id,name,season_type,start_date,end_date,multiplier,priority,color,is_active,applies_to_category_id").eq("property_id", current.id).lte("start_date", rangeEnd).gte("end_date", start),
    ]);
    if (c.error) toast.error(c.error.message);
    if (t.error) toast.error(t.error.message);
    if (s.error) toast.error(s.error.message);
    setCats((c.data ?? []) as Cat[]);
    setTariffs((t.data ?? []) as Tariff[]);
    setSeasons((s.data ?? []) as RateSeason[]);
    setLoading(false);
  }

  useEffect(() => {
    if (current) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, start]);

  // base rate per category = default plan, else first active
  function baseRate(catId: string): number {
    const list = tariffs.filter((t) => t.category_id === catId);
    const def = list.find((t) => t.is_default) ?? list[0];
    return def ? Number(def.rate) : 0;
  }

  if (propLoading) return <AppShell title="Rate Calendar"><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (!current) return <AppShell title="Rate Calendar"><EmptyPropertyState /></AppShell>;

  const today = todayIso();

  return (
    <AppShell title="Rate Calendar">
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-6 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setStart(addDaysIso(start, -7))}>
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <Button size="sm" variant="outline" onClick={() => setStart(todayIso())}>Today</Button>
            <Button size="sm" variant="outline" onClick={() => setStart(addDaysIso(start, 7))}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
            <div className="text-sm text-muted-foreground ml-2">
              {fmtDay(start)} — {fmtDay(addDaysIso(start, DAYS - 1))}
            </div>
            <div className="ml-auto text-xs text-muted-foreground">
              Showing effective nightly rate = base tariff × applicable season multiplier
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 overflow-x-auto">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : cats.length === 0 ? (
              <p className="text-sm text-muted-foreground">No room categories configured.</p>
            ) : (
              <div className="inline-block min-w-full">
                <div
                  className="grid border-b sticky top-0 bg-background"
                  style={{ gridTemplateColumns: `180px repeat(${DAYS}, minmax(72px, 1fr))` }}
                >
                  <div className="p-2 text-xs font-medium text-muted-foreground">Category / Base</div>
                  {days.map((d) => (
                    <div key={d} className={`p-2 text-center text-xs border-l ${d === today ? "bg-primary/10 font-semibold" : ""}`}>
                      <div className="text-muted-foreground">{dow(d)}</div>
                      <div>{fmtDay(d)}</div>
                    </div>
                  ))}
                </div>
                {cats.map((c) => {
                  const base = baseRate(c.id);
                  return (
                    <div
                      key={c.id}
                      className="grid border-b"
                      style={{ gridTemplateColumns: `180px repeat(${DAYS}, minmax(72px, 1fr))` }}
                    >
                      <div className="p-2 text-sm">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-[11px] text-muted-foreground">Base ₹{base.toLocaleString("en-IN")}</div>
                      </div>
                      {days.map((d) => {
                        const season = pickSeason(seasons, d, c.id);
                        const rate = effectiveRate(base, season);
                        const delta = base > 0 ? Math.round(((rate - base) / base) * 100) : 0;
                        return (
                          <div
                            key={d}
                            className={`p-2 text-center text-xs border-l ${d === today ? "bg-primary/5" : ""}`}
                            style={season ? { borderTop: `3px solid ${season.color}` } : undefined}
                            title={season ? `${season.name} ×${Number(season.multiplier).toFixed(2)}` : "Base rate"}
                          >
                            <div className="font-semibold">₹{rate.toLocaleString("en-IN")}</div>
                            {delta !== 0 && (
                              <div className={delta > 0 ? "text-emerald-700 dark:text-emerald-300 text-[10px]" : "text-rose-700 dark:text-rose-300 text-[10px]"}>
                                {delta > 0 ? "+" : ""}{delta}%
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}

            {seasons.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2 text-xs">
                {seasons.map((s) => (
                  <div key={s.id} className="flex items-center gap-1 rounded-md border px-2 py-1">
                    <span className="inline-block h-3 w-3 rounded" style={{ background: s.color }} />
                    <span className="font-medium">{s.name}</span>
                    <span className="text-muted-foreground">×{Number(s.multiplier).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}