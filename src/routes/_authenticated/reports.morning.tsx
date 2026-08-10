import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { ReportShell } from "@/components/ReportShell";
import { ReportDataTable } from "@/components/ReportDataTable";
import { RequirePermission } from "@/components/RequirePermission";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { istToday, istDaysAgo, istMonthStart } from "@/lib/date";
import { resolveLogoUrl } from "@/lib/invoiceTemplates";
import {
  exportExcelSections, exportSectionsPdf, type ExportSection, type ReportBrand,
} from "@/lib/reportExports";
import {
  loadDailyReport, buildSections, SECTION_TITLES,
  type DailyReportData, type SectionKey,
} from "@/lib/dailyReport";

const SECTIONS: SectionKey[] = ["rooms", "food", "restaurant", "banquet", "payments"];

function isSection(v: unknown): v is SectionKey {
  return typeof v === "string" && (SECTIONS as string[]).includes(v);
}

export const Route = createFileRoute("/_authenticated/reports/morning")({
  validateSearch: (search: Record<string, unknown>) => ({
    section: isSection(search.section) ? search.section : ("all" as SectionKey | "all"),
    from: typeof search.from === "string" ? search.from : undefined,
    to: typeof search.to === "string" ? search.to : undefined,
  }),
  head: () => ({ meta: [{ title: "Daily Morning Report — HotelPilot" }] }),
  component: () => (<RequirePermission module="reports"><Page /></RequirePermission>),
});

function Page() {
  const { current } = useCurrentProperty();
  const propertyId = current?.id ?? null;
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const yesterday = istDaysAgo(1);
  const from = search.from ?? yesterday;
  const to = search.to ?? from;
  const only = search.section === "all" ? undefined : (search.section as SectionKey);

  const [data, setData] = useState<DailyReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [brand, setBrand] = useState<ReportBrand | null>(null);

  const setRange = (next: { from?: string; to?: string }) =>
    navigate({ search: { section: search.section, from: next.from ?? from, to: next.to ?? to } });

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      setData(await loadDailyReport(propertyId, from, to));
    } finally {
      setLoading(false);
    }
  }, [propertyId, from, to]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!propertyId) return;
    let cancel = false;
    (async () => {
      const { data: p } = await supabase.from("properties")
        .select("name,gstin,address_line1,address_line2,city,state,pin_code,phone,logo_url")
        .eq("id", propertyId).maybeSingle();
      if (!p || cancel) return;
      const logo = await resolveLogoUrl(p.logo_url);
      if (cancel) return;
      setBrand({
        name: p.name,
        gstin: p.gstin,
        phone: p.phone,
        address: [p.address_line1, p.address_line2, [p.city, p.pin_code].filter(Boolean).join(" "), p.state]
          .filter(Boolean).join(", "),
        logoDataUrl: logo,
      });
    })();
    return () => { cancel = true; };
  }, [propertyId]);

  const sections = useMemo(() => (data ? buildSections(data, only) : []), [data, only]);

  const reportName = only ? SECTION_TITLES[only] : "Daily Morning Report";
  const meta = { reportName, propertyName: current?.name ?? "", from, to };

  const exportSections: ExportSection[] = sections.map((s) => ({
    title: s.title, columns: s.columns, rows: s.rows, summary: s.summary, emptyText: s.emptyText,
  }));

  if (!propertyId) return <AppShell title="Daily Morning Report"><EmptyPropertyState /></AppShell>;

  return (
    <ReportShell
      title={reportName}
      description={
        only
          ? "Standalone section of the Daily Morning Report — same data and totals as the combined report."
          : "Multi-page morning report: rooms, food/KOT, direct restaurant, banquet and payment summary. Defaults to yesterday."
      }
      disabled={loading || !data}
      onExcel={() => data && exportExcelSections(exportSections, meta)}
      onPdf={() => data && brand && exportSectionsPdf(exportSections, meta, brand)}
      filters={
        <>
          <div>
            <Label htmlFor="from">From</Label>
            <Input id="from" type="date" className="w-44" value={from}
              onChange={(e) => setRange({ from: e.target.value, to: e.target.value > to ? e.target.value : to })} />
          </div>
          <div>
            <Label htmlFor="to">To</Label>
            <Input id="to" type="date" className="w-44" value={to}
              onChange={(e) => setRange({ to: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setRange({ from: yesterday, to: yesterday })}>Yesterday</Button>
            <Button size="sm" variant="secondary" onClick={() => setRange({ from: istToday(), to: istToday() })}>Today</Button>
            <Button size="sm" variant="secondary" onClick={() => setRange({ from: istMonthStart(), to: istToday() })}>This month</Button>
          </div>
        </>
      }
    >
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {sections.map((s, i) => (
        <Card key={s.key} className="print:break-before-page">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{only ? s.title : `${i + 1}. ${s.title}`}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ReportDataTable rows={s.rows} columns={s.columns} emptyText={s.emptyText}
              rowKey={(r: { _id?: string }, idx) => r._id ?? String(idx)} />
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3 text-sm">
              {s.summary.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 rounded-md border px-3 py-1.5">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-medium">{v}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </ReportShell>
  );
}
