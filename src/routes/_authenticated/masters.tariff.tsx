import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CrudPage, type FieldDef, type ColumnDef } from "@/components/master/CrudPage";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";

export const Route = createFileRoute("/_authenticated/masters/tariff")({
  head: () => ({ meta: [{ title: "Tariff Plans — HotelPilot" }] }),
  component: TariffPage,
});

interface Tariff {
  id: string;
  name: string;
  category_id: string | null;
  meal_plan: string;
  rate: number;
  extra_adult_rate: number;
  extra_child_rate: number;
  valid_from: string | null;
  valid_to: string | null;
  is_default: boolean;
  is_active: boolean;
}

function TariffPage() {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const fields: FieldDef[] = [
    { name: "name", label: "Plan name", type: "text", required: true },
    {
      name: "category_id",
      label: "Room category",
      type: "select",
      options: cats.map((c) => ({ value: c.id, label: c.name })),
    },
    {
      name: "meal_plan",
      label: "Meal plan",
      type: "select",
      options: [
        { value: "EP", label: "EP — Room only" },
        { value: "CP", label: "CP — Breakfast" },
        { value: "MAP", label: "MAP — Breakfast + 1 meal" },
        { value: "AP", label: "AP — All meals" },
      ],
      defaultValue: "EP",
    },
    { name: "rate", label: "Rate (₹)", type: "number", required: true, defaultValue: 0 },
    { name: "extra_adult_rate", label: "Extra adult (₹)", type: "number", defaultValue: 0 },
    { name: "extra_child_rate", label: "Extra child (₹)", type: "number", defaultValue: 0 },
    { name: "valid_from", label: "Valid from", type: "date" },
    { name: "valid_to", label: "Valid to", type: "date" },
    { name: "is_default", label: "Default plan", type: "switch", defaultValue: false },
    { name: "is_active", label: "Active", type: "switch", defaultValue: true },
  ];

  const columns: ColumnDef<Tariff>[] = [
    { header: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
    {
      header: "Category",
      render: (r) => cats.find((c) => c.id === r.category_id)?.name ?? "—",
    },
    { header: "Plan", render: (r) => <Badge variant="outline">{r.meal_plan}</Badge> },
    { header: "Rate", render: (r) => `₹${r.rate}` },
    { header: "Extra adult", render: (r) => `₹${r.extra_adult_rate}` },
    {
      header: "Validity",
      render: (r) =>
        r.valid_from || r.valid_to
          ? `${r.valid_from ?? "…"} → ${r.valid_to ?? "…"}`
          : "Always",
    },
    {
      header: "Default",
      render: (r) => (r.is_default ? <Badge>Default</Badge> : "—"),
    },
  ];

  return (
    <CrudPage<Tariff>
      title="Tariff Plans"
      subtitle="Pricing rules per category and meal plan."
      table="tariff_plans"
      fields={fields}
      columns={columns}
      orderBy={{ column: "name" }}
    />
  );
}