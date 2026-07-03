import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CrudPage, type FieldDef, type ColumnDef } from "@/components/master/CrudPage";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { SEASON_TYPES } from "@/lib/yield";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/masters/rate-seasons")({
  head: () => ({ meta: [{ title: "Rate Seasons — HotelPilot" }] }),
  component: () => (<RequirePermission module="master_data"><RateSeasonsPage /></RequirePermission>),
});

interface Season {
  id: string;
  name: string;
  season_type: string;
  start_date: string;
  end_date: string;
  multiplier: number;
  priority: number;
  color: string;
  applies_to_category_id: string | null;
  is_active: boolean;
}

function RateSeasonsPage() {
  const { current } = useCurrentProperty();
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!current) return;
    supabase
      .from("room_categories")
      .select("id,name")
      .eq("property_id", current.id)
      .order("name")
      .then(({ data }) => setCats((data ?? []) as { id: string; name: string }[]));
  }, [current?.id]);

  const fields: FieldDef[] = [
    { name: "name", label: "Season name", type: "text", required: true, colSpan: 2 },
    {
      name: "season_type",
      label: "Type",
      type: "select",
      options: SEASON_TYPES.map((s) => ({ value: s.value, label: s.label })),
      defaultValue: "normal",
    },
    {
      name: "applies_to_category_id",
      label: "Applies to category",
      type: "select",
      options: [{ value: "", label: "All categories" }, ...cats.map((c) => ({ value: c.id, label: c.name }))],
    },
    { name: "start_date", label: "Start date", type: "date", required: true },
    { name: "end_date", label: "End date", type: "date", required: true },
    { name: "multiplier", label: "Rate multiplier (e.g. 1.30 = +30%)", type: "number", required: true, defaultValue: 1.0 },
    { name: "priority", label: "Priority (higher wins on overlap)", type: "number", defaultValue: 0 },
    { name: "color", label: "Color (hex)", type: "text", defaultValue: "#3b82f6" },
    { name: "is_active", label: "Active", type: "switch", defaultValue: true },
  ];

  const columns: ColumnDef<Season>[] = [
    {
      header: "Name",
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded" style={{ background: r.color }} />
          <span className="font-medium">{r.name}</span>
        </div>
      ),
    },
    { header: "Type", render: (r) => <Badge variant="outline">{r.season_type}</Badge> },
    { header: "Dates", render: (r) => `${r.start_date} → ${r.end_date}` },
    {
      header: "Multiplier",
      render: (r) => {
        const pct = Math.round((Number(r.multiplier) - 1) * 100);
        return (
          <span className={pct >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}>
            ×{Number(r.multiplier).toFixed(2)} {pct !== 0 ? `(${pct > 0 ? "+" : ""}${pct}%)` : ""}
          </span>
        );
      },
    },
    { header: "Priority", render: (r) => r.priority },
    {
      header: "Category",
      render: (r) => cats.find((c) => c.id === r.applies_to_category_id)?.name ?? "All",
    },
    {
      header: "Status",
      render: (r) => <Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "Active" : "Inactive"}</Badge>,
    },
  ];

  return (
    <CrudPage<Season>
      title="Rate Seasons"
      subtitle="Seasonal pricing rules. Multipliers apply to base tariff for the selected dates."
      table="rate_seasons"
      fields={fields}
      columns={columns}
      orderBy={{ column: "start_date", ascending: true }}
    />
  );
}