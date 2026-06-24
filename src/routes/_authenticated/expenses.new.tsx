import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import { PAYMENT_MODES, PAYMENT_MODE_LABEL, type PaymentMode } from "@/lib/expenses";

export const Route = createFileRoute("/_authenticated/expenses/new")({
  head: () => ({ meta: [{ title: "New Expense — HotelPilot" }] }),
  component: NewExpensePage,
});

interface Opt { id: string; name: string }

function NewExpensePage() {
  const { currentId: propertyId } = useCurrentProperty();
  const navigate = useNavigate();
  const [cats, setCats] = useState<Opt[]>([]);
  const [vendors, setVendors] = useState<Opt[]>([]);
  const [staff, setStaff] = useState<Opt[]>([]);
  const [saving, setSaving] = useState(false);

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
      supabase.from("vendors").select("id,name")
        .eq("property_id", propertyId).eq("is_active", true).order("name"),
      supabase.from("staff").select("id,name")
        .eq("property_id", propertyId).eq("is_active", true).order("name"),
    ]);
    setCats((c.data ?? []) as Opt[]);
    setVendors((v.data ?? []) as Opt[]);
    setStaff((s.data ?? []) as Opt[]);
  }, [propertyId]);

  useEffect(() => { loadRefs(); }, [loadRefs]);

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
    const { error } = await supabase.from("expenses").insert(payload as never);
    setSaving(false);
    if (error) return toast.error(error.message);
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
            <Select value={form.category_id} onValueChange={(v) => setForm((f) => ({ ...f, category_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Choose category…" /></SelectTrigger>
              <SelectContent>
                {cats.length === 0 ? (
                  <SelectItem value="__none" disabled>No categories — add via Masters</SelectItem>
                ) : cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
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
            <Select value={form.vendor_id} onValueChange={(v) => setForm((f) => ({ ...f, vendor_id: v, paid_to_staff_id: "" }))}>
              <SelectTrigger><SelectValue placeholder="Optional…" /></SelectTrigger>
              <SelectContent>
                {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Paid to staff</Label>
            <Select value={form.paid_to_staff_id} onValueChange={(v) => setForm((f) => ({ ...f, paid_to_staff_id: v, vendor_id: "" }))}>
              <SelectTrigger><SelectValue placeholder="Optional…" /></SelectTrigger>
              <SelectContent>
                {staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
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
    </AppShell>
  );
}