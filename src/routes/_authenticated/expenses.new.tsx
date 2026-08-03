import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import { PAYMENT_MODES, PAYMENT_MODE_LABEL, type PaymentMode } from "@/lib/expenses";
import { logActivity, userDisplayName } from "@/lib/activityLog";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/expenses/new")({
  head: () => ({ meta: [{ title: "New Expense — HotelPilot" }] }),
  component: () => (<RequirePermission module="expenses"><NewExpensePage /></RequirePermission>),
});

interface Opt { id: string; name: string; mobile?: string | null; designation?: string | null }

const ADD_NEW = "__add_new__";

type AddKind = "category" | "vendor" | "staff" | null;

function NewExpensePage() {
  const { currentId: propertyId } = useCurrentProperty();
  const navigate = useNavigate();
  const [cats, setCats] = useState<Opt[]>([]);
  const [vendors, setVendors] = useState<Opt[]>([]);
  const [staff, setStaff] = useState<Opt[]>([]);
  const [saving, setSaving] = useState(false);
  const [addKind, setAddKind] = useState<AddKind>(null);
  const [addSaving, setAddSaving] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", mobile: "", gstin: "", designation: "" });

  const [form, setForm] = useState({
    expense_date: new Date().toISOString().slice(0, 10),
    category_id: "",
    vendor_id: "",
    paid_to_staff_id: "",
    amount: "",
    payment_mode: "cash" as PaymentMode,
    reference: "",
    description: "",
  });

  const loadRefs = useCallback(async () => {
    if (!propertyId) return;
    const [c, v, s] = await Promise.all([
      supabase.from("expense_categories").select("id,name")
        .eq("property_id", propertyId).eq("is_active", true).order("name"),
      supabase.from("vendors").select("id,name,mobile")
        .eq("property_id", propertyId).eq("is_active", true).order("name"),
      supabase.from("staff").select("id,name,mobile,designation")
        .eq("property_id", propertyId).eq("is_active", true).order("name"),
    ]);
    setCats((c.data ?? []) as Opt[]);
    setVendors((v.data ?? []) as Opt[]);
    setStaff((s.data ?? []) as Opt[]);
  }, [propertyId]);

  useEffect(() => { loadRefs(); }, [loadRefs]);

  const catOptions = useMemo<SearchableOption[]>(() => [
    ...cats.map((c) => ({ value: c.id, label: c.name })),
    { value: ADD_NEW, label: "+ Add new category" },
  ], [cats]);

  const vendorOptions = useMemo<SearchableOption[]>(() => [
    ...vendors.map((v) => ({
      value: v.id, label: v.name, keywords: v.mobile ?? "", hint: v.mobile ?? undefined,
    })),
    { value: ADD_NEW, label: "+ Add new vendor" },
  ], [vendors]);

  const staffOptions = useMemo<SearchableOption[]>(() => [
    ...staff.map((s) => ({
      value: s.id,
      label: s.name,
      keywords: `${s.mobile ?? ""} ${s.designation ?? ""}`.trim(),
      hint: s.designation || s.mobile || undefined,
    })),
    { value: ADD_NEW, label: "+ Add new staff" },
  ], [staff]);

  function openAdd(kind: Exclude<AddKind, null>) {
    setAddForm({ name: "", mobile: "", gstin: "", designation: "" });
    setAddKind(kind);
  }

  async function saveInline() {
    if (!propertyId || !addKind) return;
    const name = addForm.name.trim();
    if (!name) return toast.error("Enter a name");
    const mobile = addForm.mobile.trim();
    if (addKind !== "category" && mobile && !/^\d{10}$/.test(mobile)) {
      return toast.error("Mobile must be exactly 10 digits");
    }
    setAddSaving(true);
    let id: string | null = null;
    let error: { message: string } | null = null;
    if (addKind === "category") {
      const r = await supabase.from("expense_categories")
        .insert({ property_id: propertyId, name } as never).select("id,name").maybeSingle();
      error = r.error; id = (r.data as Opt | null)?.id ?? null;
      if (r.data) setCats((p) => [...p, r.data as Opt].sort((a, b) => a.name.localeCompare(b.name)));
    } else if (addKind === "vendor") {
      const r = await supabase.from("vendors")
        .insert({
          property_id: propertyId, name,
          mobile: mobile || null,
          gstin: addForm.gstin.trim().toUpperCase() || null,
        } as never).select("id,name,mobile").maybeSingle();
      error = r.error; id = (r.data as Opt | null)?.id ?? null;
      if (r.data) setVendors((p) => [...p, r.data as Opt].sort((a, b) => a.name.localeCompare(b.name)));
    } else {
      const r = await supabase.from("staff")
        .insert({
          property_id: propertyId, name,
          mobile: mobile || null,
          designation: addForm.designation.trim() || null,
        } as never).select("id,name,mobile,designation").maybeSingle();
      error = r.error; id = (r.data as Opt | null)?.id ?? null;
      if (r.data) setStaff((p) => [...p, r.data as Opt].sort((a, b) => a.name.localeCompare(b.name)));
    }
    setAddSaving(false);
    if (error) return toast.error(error.message);
    if (id) {
      if (addKind === "category") setForm((f) => ({ ...f, category_id: id! }));
      else if (addKind === "vendor") setForm((f) => ({ ...f, vendor_id: id!, paid_to_staff_id: "" }));
      else setForm((f) => ({ ...f, paid_to_staff_id: id!, vendor_id: "" }));
    }
    toast.success(
      addKind === "category" ? "Category added" : addKind === "vendor" ? "Vendor added" : "Staff added",
    );
    setAddKind(null);
  }

  async function save() {
    if (!propertyId) return;
    const amt = Number(form.amount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    if (!form.description.trim() && !form.category_id) {
      return toast.error("Pick a category or add a description");
    }
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const payload = {
      property_id: propertyId,
      expense_date: form.expense_date,
      category_id: form.category_id || null,
      vendor_id: form.vendor_id || null,
      paid_to_staff_id: form.paid_to_staff_id || null,
      amount: amt,
      payment_mode: form.payment_mode,
      reference: form.reference.trim() || null,
      description: form.description.trim() || null,
      created_by: u.user?.id ?? null,
    };
    const { data: inserted, error } = await supabase.from("expenses")
      .insert(payload as never).select("id").maybeSingle();
    setSaving(false);
    if (error) return toast.error(error.message);
    const catName = cats.find((c) => c.id === form.category_id)?.name ?? null;
    logActivity({
      property_id: propertyId,
      user_id: u.user?.id ?? "",
      user_name: userDisplayName(u.user as never),
      action_type: "EXPENSE_CREATED",
      module: "Expenses",
      reference_id: (inserted as { id?: string } | null)?.id ?? null,
      reference_label: form.description.trim() || catName || null,
      details: { expense_id: (inserted as { id?: string } | null)?.id ?? null, category: catName, amount: amt },
    });
    toast.success("Expense saved");
    navigate({ to: "/expenses" });
  }

  if (!propertyId) return <AppShell title="New Expense"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="New Expense">
      <Card className="max-w-2xl"><CardContent className="pt-6 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Date</Label>
            <Input type="date" value={form.expense_date}
              onChange={(e) => setForm((f) => ({ ...f, expense_date: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Amount (₹) *</Label>
            <Input type="number" step="0.01" value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Category</Label>
            <SearchableSelect
              value={form.category_id}
              onChange={(v) => (v === ADD_NEW
                ? openAdd("category")
                : setForm((f) => ({ ...f, category_id: v })))}
              options={catOptions}
              placeholder="Choose category…"
              searchPlaceholder="Search categories…"
              alwaysShowSearch
            />
            <Link to="/masters/expense-categories" className="text-[10px] text-primary underline">Manage categories</Link>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Payment mode</Label>
            <Select value={form.payment_mode} onValueChange={(v) => setForm((f) => ({ ...f, payment_mode: v as PaymentMode }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{PAYMENT_MODE_LABEL[m]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Paid to vendor</Label>
            <SearchableSelect
              value={form.vendor_id}
              onChange={(v) => (v === ADD_NEW
                ? openAdd("vendor")
                : setForm((f) => ({ ...f, vendor_id: v, paid_to_staff_id: "" })))}
              options={vendorOptions}
              placeholder="Optional…"
              searchPlaceholder="Search name or mobile…"
              alwaysShowSearch
            />
            <Link to="/inventory/vendors" className="text-[10px] text-primary underline">Manage vendors</Link>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Paid to staff</Label>
            <SearchableSelect
              value={form.paid_to_staff_id}
              onChange={(v) => (v === ADD_NEW
                ? openAdd("staff")
                : setForm((f) => ({ ...f, paid_to_staff_id: v, vendor_id: "" })))}
              options={staffOptions}
              placeholder="Optional…"
              searchPlaceholder="Search name, mobile or role…"
              alwaysShowSearch
            />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs">Reference / Bill #</Label>
            <Input value={form.reference} maxLength={100}
              onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs">Description</Label>
            <Textarea rows={3} value={form.description} maxLength={500}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => navigate({ to: "/expenses" })}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save expense"}</Button>
        </div>
      </CardContent></Card>

      <Dialog open={addKind !== null} onOpenChange={(o) => !o && setAddKind(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {addKind === "category" ? "New category" : addKind === "vendor" ? "New vendor" : "New staff"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Name *</Label>
              <Input value={addForm.name} maxLength={100}
                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            {addKind !== "category" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Mobile</Label>
                <Input inputMode="numeric" maxLength={10} value={addForm.mobile}
                  onChange={(e) => setAddForm((f) => ({ ...f, mobile: e.target.value.replace(/\D/g, "").slice(0, 10) }))} />
              </div>
            )}
            {addKind === "vendor" && (
              <div className="space-y-1.5">
                <Label className="text-xs">GSTIN (optional)</Label>
                <Input value={addForm.gstin} maxLength={15}
                  onChange={(e) => setAddForm((f) => ({ ...f, gstin: e.target.value.toUpperCase() }))} />
              </div>
            )}
            {addKind === "staff" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Designation</Label>
                <Input value={addForm.designation} maxLength={60}
                  onChange={(e) => setAddForm((f) => ({ ...f, designation: e.target.value }))} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddKind(null)}>Cancel</Button>
            <Button onClick={saveInline} disabled={addSaving}>{addSaving ? "Saving…" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}