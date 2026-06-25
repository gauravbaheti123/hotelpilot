import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CrudPage, type FieldDef, type ColumnDef } from "@/components/master/CrudPage";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { BulkCsvButtons } from "@/components/master/BulkCsvButtons";

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
      headerActions={
        current ? (
          <BulkCsvButtons
            table="tariff_plans"
            propertyId={current.id}
            module="tariff"
            hotelName={current.name}
            extraDefaults={{ property_id: current.id }}
            columns={[
              { header: "name", field: "name", required: true },
              { header: "category_name", required: true,
                format: (_v, row) =>
                  cats.find((c) => c.id === (row as { category_id?: string }).category_id)?.name ?? "" },
              { header: "meal_plan", field: "meal_plan" },
              { header: "rate", field: "rate",
                parse: (v) => Number(v || 0),
                format: (v) => (v == null ? "" : String(v)) },
              { header: "extra_adult_rate", field: "extra_adult_rate",
                parse: (v) => Number(v || 0),
                format: (v) => (v == null ? "" : String(v)) },
              { header: "extra_child_rate", field: "extra_child_rate",
                parse: (v) => Number(v || 0),
                format: (v) => (v == null ? "" : String(v)) },
              { header: "valid_from", field: "valid_from" },
              { header: "valid_to", field: "valid_to" },
              { header: "is_default", field: "is_default",
                parse: (v) => v.toLowerCase() === "true" || v === "1",
                format: (v) => (v ? "true" : "false") },
              { header: "is_active", field: "is_active",
                parse: (v) => v.toLowerCase() !== "false" && v !== "0" && v !== "",
                format: (v) => (v ? "true" : "false") },
            ]}
            transformRow={(row) => {
              const name = String(row["category_name"] ?? "").trim().toLowerCase();
              if (name) {
                const match = cats.find((c) => c.name.toLowerCase() === name);
                if (!match) throw new Error(`Unknown category: ${row["category_name"]}`);
                (row as Record<string, unknown>).category_id = match.id;
              }
              delete (row as Record<string, unknown>)["category_name"];
              return row;
            }}
          />
        ) : null
      }
    />
  );
}