import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CrudPage, type FieldDef, type ColumnDef } from "@/components/master/CrudPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { SUNDRY_UNITS } from "@/lib/sundry";
import { RequirePermission } from "@/components/RequirePermission";
import { BulkCsvButtons } from "@/components/master/BulkCsvButtons";
import { useCurrentProperty } from "@/hooks/use-property";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Trash2, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/masters/sundry-items")({
  head: () => ({ meta: [{ title: "Sundry Items — HotelPilot" }] }),
  component: SundryItemsPage,
});

interface Item {
  id: string;
  name: string;
  category: string;
  rate: number;
  gst_rate: number;
  unit: string;
  short_code: string | null;
  sku: string | null;
  is_active: boolean;
}

function makeFields(categoryOptions: { value: string; label: string }[]): FieldDef[] {
  return [
    { name: "name", label: "Item name", type: "text", required: true, colSpan: 2 },
    { name: "short_code", label: "Short Code (optional)", type: "text" },
    {
      name: "category",
      label: "Category",
      type: "select",
      options: categoryOptions,
      defaultValue: categoryOptions[0]?.value ?? "",
    },
    { name: "rate", label: "Rate (₹)", type: "number", required: true, defaultValue: 0 },
    { name: "gst_rate", label: "GST %", type: "number", defaultValue: 5 },
    {
      name: "unit",
      label: "Unit",
      type: "select",
      options: SUNDRY_UNITS.map((u) => ({ value: u.value, label: u.label })),
      defaultValue: "pcs",
    },
    { name: "sku", label: "SKU (optional)", type: "text" },
    { name: "is_active", label: "Active", type: "switch", defaultValue: true },
  ];
}

const makeColumns = (labelFor: (v: string) => string): ColumnDef<Item>[] => [
  {
    header: "Item",
    render: (r) => (
      <div className="flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary/60" />
        <span className="font-medium">{r.name}</span>
      </div>
    ),
  },
  {
    header: "Short Code",
    render: (r) =>
      r.short_code
        ? <Badge variant="outline" className="text-[10px] uppercase font-mono">{r.short_code}</Badge>
        : <span className="text-xs text-muted-foreground">—</span>,
  },
  { header: "Category", render: (r) => <Badge variant="outline">{labelFor(r.category)}</Badge> },
  { header: "Rate", render: (r) => `₹${Number(r.rate).toLocaleString("en-IN")}` },
  { header: "GST", render: (r) => `${r.gst_rate}%` },
  { header: "Unit", render: (r) => r.unit },
  { header: "SKU", render: (r) => r.sku ?? "—" },
  {
    header: "Status",
    render: (r) => <Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "Active" : "Inactive"}</Badge>,
  },
];

function SundryItemsPage() {
  const { current } = useCurrentProperty();
  const [reloadKey, setReloadKey] = useState(0);
  const [cats, setCats] = useState<Array<{ id: string; name: string; is_active: boolean }>>([]);
  const [catLoading, setCatLoading] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [savingCat, setSavingCat] = useState(false);

  async function loadCats() {
    if (!current) return;
    setCatLoading(true);
    const { data, error } = await supabase
      .from("pos_categories")
      .select("id,name,is_active")
      .eq("property_id", current.id)
      .order("name", { ascending: true });
    if (error) toast.error(error.message);
    setCats((data ?? []) as any);
    setCatLoading(false);
  }

  useEffect(() => {
    loadCats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  async function addCat() {
    if (!current || !newCat.trim()) return;
    setSavingCat(true);
    const { error } = await supabase
      .from("pos_categories")
      .insert({ property_id: current.id, name: newCat.trim(), is_active: true } as any);
    setSavingCat(false);
    if (error) return toast.error(error.message);
    setNewCat("");
    toast.success("Category added");
    await loadCats();
    setReloadKey((k) => k + 1);
  }
  async function toggleCat(id: string, next: boolean) {
    const { error } = await supabase.from("pos_categories").update({ is_active: next } as any).eq("id", id);
    if (error) return toast.error(error.message);
    await loadCats();
    setReloadKey((k) => k + 1);
  }
  async function removeCat(id: string) {
    if (!confirm("Delete this category? Items assigned to it will keep the name but lose the link.")) return;
    const { error } = await supabase.from("pos_categories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    await loadCats();
    setReloadKey((k) => k + 1);
  }

  const activeCats = useMemo(() => cats.filter((c) => c.is_active), [cats]);
  const categoryOptions = useMemo(
    () => activeCats.map((c) => ({ value: c.name, label: c.name })),
    [activeCats],
  );
  const labelFor = (v: string) => cats.find((c) => c.name === v)?.name ?? v;
  const fields = useMemo(() => makeFields(categoryOptions), [categoryOptions]);
  const columns = useMemo(() => makeColumns(labelFor), [cats]);

  return (
    <RequirePermission module="master_data">
    <div className="max-w-6xl space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">POS Categories</h2>
              <p className="text-xs text-muted-foreground">
                These categories drive the Sundry Items category dropdown below. Add here to see them appear instantly.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input
              placeholder="New category name…"
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCat(); } }}
              className="max-w-xs"
            />
            <Button size="sm" onClick={addCat} disabled={savingCat || !newCat.trim()}>
              {savingCat ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
              Add
            </Button>
          </div>
          {catLoading ? (
            <div className="text-xs text-muted-foreground">Loading…</div>
          ) : cats.length === 0 ? (
            <div className="text-xs text-muted-foreground">No categories yet.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {cats.map((c) => (
                <div key={c.id} className={`flex items-center gap-2 rounded-md border px-2 py-1 text-xs ${c.is_active ? "" : "opacity-60"}`}>
                  <span className="font-medium">{c.name}</span>
                  <Switch checked={c.is_active} onCheckedChange={(v) => toggleCat(c.id, v)} />
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => removeCat(c.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    <CrudPage<Item>
      key={`items-${reloadKey}`}
      title="Sundry / POS Items"
      subtitle="Mini-bar, laundry, spa and other extras posted from the POS module."
      table="sundry_items"
      fields={fields}
      columns={columns}
      orderBy={{ column: "name", ascending: true }}
      headerActions={current ? (
        <BulkCsvButtons
          table="sundry_items"
          propertyId={current.id}
          module="sundry-items"
          hotelName={current.name}
          extraDefaults={{ property_id: current.id }}
          columns={[
            { header: "name", field: "name", required: true },
            { header: "short_code", field: "short_code" },
            { header: "category", field: "category" },
            { header: "rate", field: "rate",
              parse: (v) => Number(v || 0),
              format: (v) => (v == null ? "" : String(v)) },
            { header: "gst_rate", field: "gst_rate",
              parse: (v) => Number(v || 0),
              format: (v) => (v == null ? "" : String(v)) },
            { header: "unit", field: "unit" },
            { header: "sku", field: "sku" },
            { header: "is_active", field: "is_active",
              parse: (v) => v.toLowerCase() !== "false" && v !== "0" && v !== "",
              format: (v) => (v ? "true" : "false") },
          ]}
          onImported={() => setReloadKey((k) => k + 1)}
        />
      ) : null}
    />
    </RequirePermission>
  );
}