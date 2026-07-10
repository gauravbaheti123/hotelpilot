import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { format, addDays, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentProperty } from "@/hooks/use-property";
import { usePermissions } from "@/hooks/use-permissions";
import { RequirePermission } from "@/components/RequirePermission";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  Printer as PrinterIcon,
  Search,
  Facebook,
  Instagram,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/label-printing/")({
  head: () => ({ meta: [{ title: "Label Printing — HotelPilot" }] }),
  component: () => (
    <RequirePermission module="label_printing">
      <LabelPrintingPage />
    </RequirePermission>
  ),
});

// ---- Nutrition schema ----
type NutrientKey =
  | "energy_kcal"
  | "total_fat_g"
  | "saturated_fat_g"
  | "trans_fat_g"
  | "cholesterol_mg"
  | "monounsaturated_fat_g"
  | "polyunsaturated_fat_g"
  | "sodium_mg"
  | "carbohydrate_g"
  | "total_sugars_g"
  | "protein_g";

interface NutrientCell {
  value: number;
  show_rda: boolean;
}
type NutritionInfo = Partial<Record<NutrientKey, NutrientCell>>;

const NUTRIENTS: { key: NutrientKey; label: string; defaultShow: boolean }[] = [
  { key: "energy_kcal", label: "Energy (kcal)", defaultShow: false },
  { key: "total_fat_g", label: "Total Fat (g)", defaultShow: true },
  { key: "saturated_fat_g", label: "Saturated Fat (g)", defaultShow: true },
  { key: "trans_fat_g", label: "Trans Fat (g)", defaultShow: false },
  { key: "cholesterol_mg", label: "Cholesterol (mg)", defaultShow: true },
  { key: "monounsaturated_fat_g", label: "Monounsaturated Fatty Acids (g)", defaultShow: true },
  { key: "polyunsaturated_fat_g", label: "Polyunsaturated Fatty Acids (g)", defaultShow: true },
  { key: "sodium_mg", label: "Sodium (mg)", defaultShow: true },
  { key: "carbohydrate_g", label: "Carbohydrate (g)", defaultShow: true },
  { key: "total_sugars_g", label: "Total Sugars (g)", defaultShow: false },
  { key: "protein_g", label: "Protein (g)", defaultShow: false },
];

const RDA_REFERENCE: Record<NutrientKey, number> = {
  energy_kcal: 2000,
  total_fat_g: 67,
  saturated_fat_g: 22,
  trans_fat_g: 2.2,
  cholesterol_mg: 300,
  monounsaturated_fat_g: 20,
  polyunsaturated_fat_g: 20,
  sodium_mg: 2000,
  carbohydrate_g: 300,
  total_sugars_g: 50,
  protein_g: 50,
};

function normalizeNutrition(raw: any): NutritionInfo {
  const out: NutritionInfo = {};
  const src = (raw ?? {}) as Record<string, any>;
  // Legacy flat mapping
  const legacyMap: Record<string, NutrientKey> = {
    energy_kcal: "energy_kcal",
    protein_g: "protein_g",
    fat_g: "total_fat_g",
    carbs_g: "carbohydrate_g",
    sugar_g: "total_sugars_g",
  };
  for (const n of NUTRIENTS) {
    const v = src[n.key];
    if (v && typeof v === "object" && "value" in v) {
      out[n.key] = {
        value: Number(v.value) || 0,
        show_rda: v.show_rda ?? n.defaultShow,
      };
    } else {
      out[n.key] = { value: 0, show_rda: n.defaultShow };
    }
  }
  // Backfill from legacy flat fields when new structure absent/zero.
  for (const [legacy, key] of Object.entries(legacyMap)) {
    const legacyVal = src[legacy];
    if (typeof legacyVal === "number" && !out[key]?.value) {
      out[key] = { value: legacyVal, show_rda: out[key]?.show_rda ?? true };
    }
  }
  return out;
}

function computeRda(perHundred: number, servingSize: number | null | undefined, key: NutrientKey): string {
  if (!servingSize || !perHundred) return "..";
  const pct = ((perHundred * servingSize) / 100 / RDA_REFERENCE[key]) * 100;
  return pct.toFixed(2);
}

interface CompanySettings {
  property_id: string;
  company_name: string | null;
  address: string | null;
  email: string | null;
  customer_care_number: string | null;
  fssai_lic_no: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
}

interface LabelProduct {
  id: string;
  property_id: string;
  name: string;
  mrp: number | null;
  batch_no: string | null;
  ingredients: string | null;
  fssai_no: string | null;
  shelf_life_days: number;
  storage_instructions: string | null;
  allergen_info: string | null;
  net_weight: string | null;
  is_active: boolean;
  nutrition_info?: any;
  serving_size_g?: number | null;
  servings_per_package?: number | null;
  default_label_template?: string | null;
  company_name_override?: string | null;
  address_override?: string | null;
  email_override?: string | null;
  customer_care_override?: string | null;
  fssai_lic_override?: string | null;
}

interface LabelBatch {
  id: string;
  product_id: string;
  quantity: number;
  packed_on: string;
  expiry_on: string;
  batch_no: string | null;
  mrp: number | null;
  notes: string | null;
  created_at: string;
  template_used?: string | null;
  label_products?: { name: string } | null;
}

function LabelPrintingPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Label Printing</h1>
        <p className="text-sm text-muted-foreground">
          Manage packaged products and print thermal labels with barcode.
        </p>
      </div>
      <Tabs defaultValue="print">
        <TabsList>
          <TabsTrigger value="print">Print Label</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="history">Print History</TabsTrigger>
          <TabsTrigger value="settings">Company Details</TabsTrigger>
        </TabsList>
        <TabsContent value="print" className="mt-4">
          <PrintLabelTab />
        </TabsContent>
        <TabsContent value="products" className="mt-4">
          <ProductsTab />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <HistoryTab />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <CompanySettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------- Products Tab ----------
function ProductsTab() {
  const { current } = useCurrentProperty();
  const { can } = usePermissions();
  const [rows, setRows] = useState<LabelProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<LabelProduct | null>(null);
  const [open, setOpen] = useState(false);

  async function load() {
    if (!current) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("label_products" as any)
      .select("*")
      .eq("property_id", current.id)
      .order("name");
    setLoading(false);
    if (error) return toast.error(error.message);
    setRows((data ?? []) as any);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  async function remove(id: string) {
    if (!confirm("Delete this product?")) return;
    const { error } = await supabase.from("label_products" as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    load();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Products</CardTitle>
        {can("label_printing", "create") && (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1" /> New Product
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No products yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">MRP</th>
                  <th className="py-2 pr-3">Shelf (days)</th>
                  <th className="py-2 pr-3">FSSAI</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-b-0">
                    <td className="py-2 pr-3 font-medium">{r.name}</td>
                    <td className="py-2 pr-3">{r.mrp != null ? `₹${r.mrp}` : "—"}</td>
                    <td className="py-2 pr-3">{r.shelf_life_days}</td>
                    <td className="py-2 pr-3">{r.fssai_no ?? "—"}</td>
                    <td className="py-2 pr-3">
                      {r.is_active ? (
                        <Badge>Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right space-x-1">
                      {can("label_printing", "edit") && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => {
                            setEditing(r);
                            setOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {can("label_printing", "delete") && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive"
                          onClick={() => remove(r.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      {open && (
        <ProductDialog
          open={open}
          onOpenChange={setOpen}
          initial={editing}
          onSaved={() => {
            setOpen(false);
            load();
          }}
        />
      )}
    </Card>
  );
}

// ---------- Premium Label ----------
function PremiumLabel({
  product,
  company,
  packedOn,
  expiryOn,
  batchNo,
  mrp,
}: {
  product: LabelProduct;
  company: CompanySettings | null;
  packedOn: string;
  expiryOn: string;
  batchNo: string;
  mrp: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const nutrition = useMemo(() => normalizeNutrition(product.nutrition_info), [product]);
  const barcodeValue = useMemo(() => {
    const bn = batchNo || product.batch_no || product.id.slice(0, 8);
    return `${bn}-${packedOn.replace(/-/g, "")}`;
  }, [batchNo, product, packedOn]);

  useEffect(() => {
    if (!svgRef.current) return;
    try {
      JsBarcode(svgRef.current, barcodeValue, {
        format: "CODE128",
        displayValue: true,
        fontSize: 9,
        height: 30,
        margin: 0,
      });
    } catch {}
  }, [barcodeValue]);

  const companyName = product.company_name_override || company?.company_name || "Brij Sweets";
  const address = product.address_override || company?.address || "";
  const email = product.email_override || company?.email || "";
  const care = product.customer_care_override || company?.customer_care_number || "";
  const fssai = product.fssai_lic_override || product.fssai_no || company?.fssai_lic_no || "";
  const servingSize = product.serving_size_g ?? null;

  const rows = NUTRIENTS.filter((n) => (nutrition[n.key]?.value ?? 0) > 0 || nutrition[n.key]?.show_rda);

  return (
    <div className="premium-label">
      <div className="p-head">
        <div className="p-brand">{companyName}</div>
        <div className="p-name">{product.name}</div>
        {product.net_weight && <div className="p-net">Net Wt: {product.net_weight}</div>}
      </div>
      <div className="cards">
        <div className="card">
          <h4>Nutrition Facts</h4>
          <div style={{ fontSize: "7.5pt", color: "#444" }}>
            Serving Size: {servingSize ? `${servingSize} g` : "—"}
            {product.servings_per_package ? ` · Servings/Pack: ${product.servings_per_package}` : ""}
          </div>
          <table className="nf-table">
            <thead>
              <tr>
                <td></td>
                <td className="right" style={{ fontWeight: 700 }}>Per 100g</td>
                <td className="right" style={{ fontWeight: 700 }}>%RDA*</td>
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => {
                const cell = nutrition[n.key]!;
                return (
                  <tr key={n.key}>
                    <td>{n.label}</td>
                    <td className="right">{cell.value}</td>
                    <td className="right">{cell.show_rda ? computeRda(cell.value, servingSize, n.key) : ".."}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ fontSize: "6.5pt", marginTop: "1mm", color: "#555" }}>
            *%RDA based on 2000 kcal reference diet per serving.
          </div>
        </div>
        <div className="card">
          <h4>Ingredients</h4>
          <div>{product.ingredients || "—"}</div>
          {product.allergen_info && (
            <div style={{ marginTop: "1mm" }}>
              <strong>Allergens:</strong> {product.allergen_info}
            </div>
          )}
          {product.storage_instructions && (
            <div style={{ marginTop: "1mm" }}>
              <strong>Storage:</strong> {product.storage_instructions}
            </div>
          )}
          <h4 style={{ marginTop: "2mm" }}>Marketed By</h4>
          <div style={{ fontWeight: 600 }}>{companyName}</div>
          {address && <div>{address}</div>}
          {email && <div>Email: {email}</div>}
          {care && <div>Customer Care: {care}</div>}
          {fssai && <div style={{ marginTop: "1mm" }}>FSSAI Lic. No. {fssai}</div>}
        </div>
      </div>
      <div className="p-foot">
        <div>
          <div><strong>Packed:</strong> {packedOn}</div>
          <div><strong>Best Before:</strong> {expiryOn}</div>
          {(batchNo || product.batch_no) && (
            <div><strong>Batch:</strong> {batchNo || product.batch_no}</div>
          )}
          {mrp && <div><strong>MRP:</strong> ₹{mrp} (incl. of all taxes)</div>}
        </div>
        <div className="barcode">
          <svg ref={svgRef} />
        </div>
      </div>
    </div>
  );
}

// ---------- Company Settings Tab ----------
function CompanySettingsTab() {
  const { current } = useCurrentProperty();
  const { can } = usePermissions();
  const [form, setForm] = useState<Partial<CompanySettings>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const canEdit = can("label_printing", "edit");

  useEffect(() => {
    if (!current) return;
    setLoading(true);
    supabase
      .from("label_company_settings" as any)
      .select("*")
      .eq("property_id", current.id)
      .maybeSingle()
      .then(({ data }) => {
        setForm((data as any) ?? { property_id: current.id });
        setLoading(false);
      });
  }, [current?.id]);

  async function save() {
    if (!current) return;
    setSaving(true);
    const payload = {
      property_id: current.id,
      company_name: form.company_name || null,
      address: form.address || null,
      email: form.email || null,
      customer_care_number: form.customer_care_number || null,
      fssai_lic_no: form.fssai_lic_no || null,
      facebook_url: form.facebook_url || null,
      instagram_url: form.instagram_url || null,
    };
    const { error } = await supabase
      .from("label_company_settings" as any)
      .upsert(payload, { onConflict: "property_id" });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Company details saved");
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Company Details (Premium Label defaults)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Company Name">
            <Input
              value={form.company_name ?? ""}
              onChange={(e) => setForm({ ...form, company_name: e.target.value })}
              disabled={!canEdit}
            />
          </Field>
          <Field label="Email">
            <Input
              value={form.email ?? ""}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              disabled={!canEdit}
            />
          </Field>
          <Field label="Address" className="md:col-span-2">
            <Textarea
              rows={2}
              value={form.address ?? ""}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              disabled={!canEdit}
            />
          </Field>
          <Field label="Customer Care Number">
            <Input
              value={form.customer_care_number ?? ""}
              onChange={(e) => setForm({ ...form, customer_care_number: e.target.value })}
              disabled={!canEdit}
            />
          </Field>
          <Field label="FSSAI Lic No">
            <Input
              value={form.fssai_lic_no ?? ""}
              onChange={(e) => setForm({ ...form, fssai_lic_no: e.target.value })}
              disabled={!canEdit}
            />
          </Field>
          <Field label="Facebook URL">
            <Input
              value={form.facebook_url ?? ""}
              onChange={(e) => setForm({ ...form, facebook_url: e.target.value })}
              disabled={!canEdit}
            />
          </Field>
          <Field label="Instagram URL">
            <Input
              value={form.instagram_url ?? ""}
              onChange={(e) => setForm({ ...form, instagram_url: e.target.value })}
              disabled={!canEdit}
            />
          </Field>
        </div>
        {canEdit && (
          <div className="pt-2">
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProductDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: LabelProduct | null;
  onSaved: () => void;
}) {
  const { current } = useCurrentProperty();
  const [form, setForm] = useState<Partial<LabelProduct>>(
    initial ?? {
      name: "",
      mrp: null,
      batch_no: "",
      ingredients: "",
      fssai_no: "",
      shelf_life_days: 7,
      storage_instructions: "",
      allergen_info: "",
      net_weight: "",
      is_active: true,
      serving_size_g: null,
      servings_per_package: null,
      default_label_template: "thermal",
    },
  );
  const [nutrition, setNutrition] = useState<NutritionInfo>(() =>
    normalizeNutrition(initial?.nutrition_info),
  );
  const [overridesOpen, setOverridesOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!current) return;
    if (!form.name?.trim()) return toast.error("Name is required");
    setSaving(true);
    const payload: any = {
      property_id: current.id,
      name: form.name.trim(),
      mrp: form.mrp === null || form.mrp === undefined || (form.mrp as any) === "" ? null : Number(form.mrp),
      batch_no: form.batch_no || null,
      ingredients: form.ingredients || null,
      fssai_no: form.fssai_no || null,
      shelf_life_days: Number(form.shelf_life_days ?? 7),
      storage_instructions: form.storage_instructions || null,
      allergen_info: form.allergen_info || null,
      net_weight: form.net_weight || null,
      is_active: form.is_active ?? true,
      serving_size_g:
        form.serving_size_g === null || form.serving_size_g === undefined || (form.serving_size_g as any) === ""
          ? null
          : Number(form.serving_size_g),
      servings_per_package:
        form.servings_per_package === null ||
        form.servings_per_package === undefined ||
        (form.servings_per_package as any) === ""
          ? null
          : Number(form.servings_per_package),
      default_label_template: form.default_label_template || "thermal",
      company_name_override: form.company_name_override || null,
      address_override: form.address_override || null,
      email_override: form.email_override || null,
      customer_care_override: form.customer_care_override || null,
      fssai_lic_override: form.fssai_lic_override || null,
      nutrition_info: nutrition,
    };
    const q = initial
      ? supabase.from("label_products" as any).update(payload).eq("id", initial.id)
      : supabase.from("label_products" as any).insert(payload);
    const { error } = await q;
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(initial ? "Product updated" : "Product created");
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Product" : "New Product"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Name *">
            <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="MRP (₹)">
            <Input
              type="number"
              value={form.mrp ?? ""}
              onChange={(e) => setForm({ ...form, mrp: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </Field>
          <Field label="Batch No.">
            <Input value={form.batch_no ?? ""} onChange={(e) => setForm({ ...form, batch_no: e.target.value })} />
          </Field>
          <Field label="Shelf Life (days)">
            <Input
              type="number"
              value={form.shelf_life_days ?? 7}
              onChange={(e) => setForm({ ...form, shelf_life_days: Number(e.target.value) })}
            />
          </Field>
          <Field label="FSSAI No.">
            <Input value={form.fssai_no ?? ""} onChange={(e) => setForm({ ...form, fssai_no: e.target.value })} />
          </Field>
          <Field label="Net Weight">
            <Input value={form.net_weight ?? ""} onChange={(e) => setForm({ ...form, net_weight: e.target.value })} />
          </Field>
          <Field label="Serving Size (g)">
            <Input
              type="number"
              value={form.serving_size_g ?? ""}
              onChange={(e) =>
                setForm({ ...form, serving_size_g: e.target.value === "" ? null : Number(e.target.value) })
              }
            />
          </Field>
          <Field label="Servings Per Package">
            <Input
              type="number"
              value={form.servings_per_package ?? ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  servings_per_package: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </Field>
          <Field label="Default Label Template" className="md:col-span-2">
            <Select
              value={form.default_label_template ?? "thermal"}
              onValueChange={(v) => setForm({ ...form, default_label_template: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="thermal">Thermal Barcode Sticker</SelectItem>
                <SelectItem value="premium">Premium Full Label</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Storage Instructions" className="md:col-span-2">
            <Input
              value={form.storage_instructions ?? ""}
              onChange={(e) => setForm({ ...form, storage_instructions: e.target.value })}
            />
          </Field>
          <Field label="Allergen Info" className="md:col-span-2">
            <Input
              value={form.allergen_info ?? ""}
              onChange={(e) => setForm({ ...form, allergen_info: e.target.value })}
            />
          </Field>
          <Field label="Ingredients" className="md:col-span-2">
            <Textarea
              rows={3}
              value={form.ingredients ?? ""}
              onChange={(e) => setForm({ ...form, ingredients: e.target.value })}
            />
          </Field>
          <div className="flex items-center gap-2">
            <Switch
              checked={form.is_active ?? true}
              onCheckedChange={(v) => setForm({ ...form, is_active: v })}
            />
            <Label>Active</Label>
          </div>
        </div>

        {/* Nutrition Information */}
        <div className="mt-2 border rounded p-3">
          <div className="text-sm font-medium mb-2">Nutrition Information (per 100g)</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {NUTRIENTS.map((n) => {
              const cell = nutrition[n.key] ?? { value: 0, show_rda: n.defaultShow };
              return (
                <div key={n.key} className="flex items-center gap-2 border rounded px-2 py-1.5">
                  <div className="flex-1 text-xs">{n.label}</div>
                  <Input
                    type="number"
                    step="0.01"
                    className="h-8 w-24"
                    value={cell.value === 0 && !cell.show_rda ? "" : cell.value}
                    onChange={(e) =>
                      setNutrition({
                        ...nutrition,
                        [n.key]: {
                          value: e.target.value === "" ? 0 : Number(e.target.value),
                          show_rda: cell.show_rda,
                        },
                      })
                    }
                  />
                  <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                    <Checkbox
                      checked={cell.show_rda}
                      onCheckedChange={(v) =>
                        setNutrition({
                          ...nutrition,
                          [n.key]: { value: cell.value, show_rda: !!v },
                        })
                      }
                    />
                    %RDA
                  </label>
                </div>
              );
            })}
          </div>
        </div>

        {/* Label Overrides */}
        <div className="mt-2 border rounded">
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-muted/50"
            onClick={() => setOverridesOpen((v) => !v)}
          >
            {overridesOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Label Overrides (fall back to Company Details if empty)
          </button>
          {overridesOpen && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 border-t">
              <Field label="Company Name">
                <Input
                  value={form.company_name_override ?? ""}
                  placeholder="(using property default)"
                  onChange={(e) => setForm({ ...form, company_name_override: e.target.value })}
                />
              </Field>
              <Field label="Email">
                <Input
                  value={form.email_override ?? ""}
                  placeholder="(using property default)"
                  onChange={(e) => setForm({ ...form, email_override: e.target.value })}
                />
              </Field>
              <Field label="Address" className="md:col-span-2">
                <Input
                  value={form.address_override ?? ""}
                  placeholder="(using property default)"
                  onChange={(e) => setForm({ ...form, address_override: e.target.value })}
                />
              </Field>
              <Field label="Customer Care Number">
                <Input
                  value={form.customer_care_override ?? ""}
                  placeholder="(using property default)"
                  onChange={(e) => setForm({ ...form, customer_care_override: e.target.value })}
                />
              </Field>
              <Field label="FSSAI Lic No">
                <Input
                  value={form.fssai_lic_override ?? ""}
                  placeholder="(using property default)"
                  onChange={(e) => setForm({ ...form, fssai_lic_override: e.target.value })}
                />
              </Field>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

// ---------- Print Tab ----------
function PrintLabelTab() {
  const { current } = useCurrentProperty();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<LabelProduct[]>([]);
  const [selected, setSelected] = useState<LabelProduct | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [packedOn, setPackedOn] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [batchNo, setBatchNo] = useState("");
  const [mrp, setMrp] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [template, setTemplate] = useState<"thermal" | "premium">("thermal");
  const [company, setCompany] = useState<CompanySettings | null>(null);

  useEffect(() => {
    if (!current) return;
    supabase
      .from("label_products" as any)
      .select("*")
      .eq("property_id", current.id)
      .eq("is_active", true)
      .order("name")
      .then(({ data, error }) => {
        if (error) return toast.error(error.message);
        setProducts((data ?? []) as any);
      });
    supabase
      .from("label_company_settings" as any)
      .select("*")
      .eq("property_id", current.id)
      .maybeSingle()
      .then(({ data }) => setCompany((data as any) ?? null));
  }, [current?.id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, query]);

  const expiryOn = useMemo(() => {
    if (!selected || !packedOn) return "";
    const d = parseISO(packedOn);
    return format(addDays(d, selected.shelf_life_days), "yyyy-MM-dd");
  }, [selected, packedOn]);

  function pick(p: LabelProduct) {
    setSelected(p);
    setBatchNo(p.batch_no ?? "");
    setMrp(p.mrp != null ? String(p.mrp) : "");
    setTemplate((p.default_label_template as any) === "premium" ? "premium" : "thermal");
  }

  async function printAndSave() {
    if (!current || !selected) return toast.error("Select a product");
    if (quantity < 1) return toast.error("Quantity must be at least 1");
    setSaving(true);
    const { error } = await supabase.from("label_print_batches" as any).insert({
      property_id: current.id,
      product_id: selected.id,
      quantity,
      packed_on: packedOn,
      expiry_on: expiryOn,
      batch_no: batchNo || null,
      mrp: mrp === "" ? null : Number(mrp),
      notes: notes || null,
      printed_by: user?.id ?? null,
      template_used: template,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Logged ${quantity} label(s)`);
    doPrint();
  }

  function doPrint() {
    window.print();
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4">
      <Card className="no-print">
        <CardHeader>
          <CardTitle className="text-base">Select Product</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search product…"
              className="pl-8"
            />
          </div>
          <div className="max-h-56 overflow-y-auto border rounded">
            {filtered.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">No products found.</p>
            ) : (
              filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => pick(p)}
                  className={`w-full text-left px-3 py-2 border-b last:border-b-0 hover:bg-muted/50 ${
                    selected?.id === p.id ? "bg-muted" : ""
                  }`}
                >
                  <div className="font-medium text-sm">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Shelf {p.shelf_life_days}d {p.mrp != null ? `· ₹${p.mrp}` : ""}
                  </div>
                </button>
              ))
            )}
          </div>

          {selected && (
            <div className="space-y-3 pt-2">
              <Field label="Template">
                <Select value={template} onValueChange={(v) => setTemplate(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="thermal">Thermal Barcode Sticker</SelectItem>
                    <SelectItem value="premium">Premium Full Label (4×6 in)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Packed On">
                  <Input type="date" value={packedOn} onChange={(e) => setPackedOn(e.target.value)} />
                </Field>
                <Field label="Expiry (auto)">
                  <Input value={expiryOn} readOnly />
                </Field>
                <Field label="Quantity">
                  <Input
                    type="number"
                    min={1}
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                  />
                </Field>
                <Field label="MRP (₹)">
                  <Input type="number" value={mrp} onChange={(e) => setMrp(e.target.value)} />
                </Field>
                <Field label="Batch No." className="col-span-2">
                  <Input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} />
                </Field>
                <Field label="Notes" className="col-span-2">
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>
              </div>
              <Button onClick={printAndSave} disabled={saving} className="w-full">
                <PrinterIcon className="h-4 w-4 mr-1" /> {saving ? "Saving…" : "Print & Save"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <div className="text-sm text-muted-foreground mb-2 no-print">Preview</div>
        <div className="label-print-area">
          {selected ? (
            Array.from({ length: quantity }).map((_, i) => (
              template === "premium" ? (
                <PremiumLabel
                  key={i}
                  product={selected}
                  company={company}
                  packedOn={packedOn}
                  expiryOn={expiryOn}
                  batchNo={batchNo}
                  mrp={mrp}
                />
              ) : (
                <LabelSheet
                  key={i}
                  product={selected}
                  packedOn={packedOn}
                  expiryOn={expiryOn}
                  batchNo={batchNo}
                  mrp={mrp}
                />
              )
            ))
          ) : (
            <div className="text-sm text-muted-foreground border rounded p-6 text-center no-print">
              Select a product to preview label.
            </div>
          )}
        </div>
      </div>

      <style>{`
        .label-sheet {
          width: 50mm;
          padding: 2mm 3mm;
          border: 1px dashed #999;
          margin: 0 0 3mm 0;
          font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
          font-size: 8pt;
          color: #000;
          background: #fff;
          page-break-inside: avoid;
        }
        .label-sheet .brand { font-weight: 700; font-size: 10pt; text-align: center; }
        .label-sheet .pname { font-weight: 600; font-size: 9pt; text-align: center; margin: 1mm 0; }
        .label-sheet .row { display: flex; justify-content: space-between; gap: 2mm; margin: 0.3mm 0; }
        .label-sheet .k { color: #333; }
        .label-sheet .v { font-weight: 600; }
        .label-sheet .ingredients { font-size: 7pt; margin-top: 1mm; line-height: 1.15; }
        .label-sheet .barcode { display: flex; justify-content: center; margin-top: 1mm; }
        .label-sheet .fssai { text-align: center; font-size: 7pt; margin-top: 0.5mm; }

        .premium-label {
          width: 4in; min-height: 6in;
          padding: 4mm; border: 1px dashed #999; margin: 0 0 4mm 0;
          font-family: "Helvetica Neue", Arial, sans-serif; color: #111;
          background: #fff; box-sizing: border-box;
          page-break-after: always; page-break-inside: avoid;
          display: flex; flex-direction: column; gap: 2mm;
        }
        .premium-label .p-head { text-align: center; }
        .premium-label .p-brand { font-weight: 800; font-size: 13pt; letter-spacing: 0.5px; }
        .premium-label .p-name { font-weight: 700; font-size: 11pt; margin-top: 1mm; }
        .premium-label .p-net { font-size: 9pt; color: #333; }
        .premium-label .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm; }
        .premium-label .card { border: 1px solid #111; border-radius: 2mm; padding: 2mm; font-size: 8pt; line-height: 1.25; }
        .premium-label .card h4 { margin: 0 0 1mm 0; font-size: 9pt; border-bottom: 1px solid #111; padding-bottom: 1mm; }
        .premium-label .nf-table { width: 100%; border-collapse: collapse; margin-top: 1mm; font-size: 8pt; }
        .premium-label .nf-table td { padding: 0.6mm 0; border-bottom: 0.3mm solid #ddd; }
        .premium-label .nf-table td.right { text-align: right; font-variant-numeric: tabular-nums; }
        .premium-label .p-foot { display: flex; justify-content: space-between; align-items: end; gap: 2mm; font-size: 7.5pt; margin-top: auto; }
        .premium-label .p-foot .barcode svg { height: 12mm; }

        @media print {
          @page { size: 50mm auto; margin: 0; }
          body * { visibility: hidden !important; }
          .label-print-area, .label-print-area * { visibility: visible !important; }
          .label-print-area { position: absolute; left: 0; top: 0; }
          .no-print { display: none !important; }
          .label-sheet { border: none; margin: 0; }
          .premium-label { border: none; margin: 0; }
        }
      `}</style>
      {template === "premium" && (
        <style>{`@media print { @page { size: 4in 6in; margin: 0; } }`}</style>
      )}
    </div>
  );
}

function LabelSheet({
  product,
  packedOn,
  expiryOn,
  batchNo,
  mrp,
}: {
  product: LabelProduct;
  packedOn: string;
  expiryOn: string;
  batchNo: string;
  mrp: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const barcodeValue = useMemo(() => {
    const bn = batchNo || product.batch_no || product.id.slice(0, 8);
    return `${bn}-${packedOn.replace(/-/g, "")}`;
  }, [batchNo, product, packedOn]);

  useEffect(() => {
    if (!svgRef.current) return;
    try {
      JsBarcode(svgRef.current, barcodeValue, {
        format: "CODE128",
        displayValue: true,
        fontSize: 10,
        height: 30,
        margin: 0,
      });
    } catch (e) {
      // silent
    }
  }, [barcodeValue]);

  return (
    <div className="label-sheet">
      <div className="brand">BRIJ SWEETS</div>
      <div className="pname">{product.name}</div>
      {product.net_weight && (
        <div className="row">
          <span className="k">Net Wt:</span>
          <span className="v">{product.net_weight}</span>
        </div>
      )}
      {mrp && (
        <div className="row">
          <span className="k">MRP:</span>
          <span className="v">₹{mrp}</span>
        </div>
      )}
      <div className="row">
        <span className="k">Packed:</span>
        <span className="v">{packedOn}</span>
      </div>
      <div className="row">
        <span className="k">Best Before:</span>
        <span className="v">{expiryOn}</span>
      </div>
      {(batchNo || product.batch_no) && (
        <div className="row">
          <span className="k">Batch:</span>
          <span className="v">{batchNo || product.batch_no}</span>
        </div>
      )}
      {product.ingredients && <div className="ingredients">Ingredients: {product.ingredients}</div>}
      {product.allergen_info && <div className="ingredients">Allergens: {product.allergen_info}</div>}
      {product.storage_instructions && (
        <div className="ingredients">Storage: {product.storage_instructions}</div>
      )}
      <div className="barcode">
        <svg ref={svgRef} />
      </div>
      {product.fssai_no && <div className="fssai">FSSAI Lic. No. {product.fssai_no}</div>}
    </div>
  );
}

// ---------- History Tab ----------
function HistoryTab() {
  const { current } = useCurrentProperty();
  const [rows, setRows] = useState<LabelBatch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!current) return;
    setLoading(true);
    supabase
      .from("label_print_batches" as any)
      .select("*, label_products(name)")
      .eq("property_id", current.id)
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        setLoading(false);
        if (error) return toast.error(error.message);
        setRows((data ?? []) as any);
      });
  }, [current?.id]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Print History</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No print records yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Product</th>
                  <th className="py-2 pr-3">Qty</th>
                  <th className="py-2 pr-3">Packed</th>
                  <th className="py-2 pr-3">Expiry</th>
                  <th className="py-2 pr-3">Batch</th>
                  <th className="py-2 pr-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-b-0">
                    <td className="py-2 pr-3">{format(new Date(r.created_at), "dd MMM yyyy, HH:mm")}</td>
                    <td className="py-2 pr-3 font-medium">{r.label_products?.name ?? "—"}</td>
                    <td className="py-2 pr-3">{r.quantity}</td>
                    <td className="py-2 pr-3">{r.packed_on}</td>
                    <td className="py-2 pr-3">{r.expiry_on}</td>
                    <td className="py-2 pr-3">{r.batch_no ?? "—"}</td>
                    <td className="py-2 pr-3">{r.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}