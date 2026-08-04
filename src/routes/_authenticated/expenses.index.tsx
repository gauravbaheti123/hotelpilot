import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { RequirePermission } from "@/components/RequirePermission";
import {
  PAYMENT_MODES, PAYMENT_MODE_LABEL, PAYMENT_MODE_TONE, type PaymentMode,
} from "@/lib/expenses";
import { logActivity, userDisplayName } from "@/lib/activityLog";
import { useAuth } from "@/hooks/use-auth";
import { istDateISO, istToday } from "@/lib/date";
import { toastError } from "@/lib/errorMessage";

export const Route = createFileRoute("/_authenticated/expenses/")({
  head: () => ({ meta: [{ title: "Expenses — HotelPilot" }] }),
  component: () => (<RequirePermission module="expenses"><ExpensesPage /></RequirePermission>),
});

interface ExpenseRow {
  id: string;
  expense_date: string;
  amount: number;
  payment_mode: PaymentMode;
  reference: string | null;
  description: string | null;
  expense_categories: { name: string } | null;
  vendors: { name: string } | null;
  staff: { name: string } | null;
}

function today() { return istToday(); }
function daysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return istDateISO(d);
}

function ExpensesPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const { user } = useAuth();
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [mode, setMode] = useState<"all" | PaymentMode>("all");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    if (!propertyId) return;
    let qy = supabase.from("expenses")
      .select("id,expense_date,amount,payment_mode,reference,description,expense_categories(name),vendors(name),staff(name)")
      .eq("property_id", propertyId)
      .gte("expense_date", from)
      .lte("expense_date", to)
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500);
    if (mode !== "all") qy = qy.eq("payment_mode", mode);
    const { data, error } = await qy;
    if (error) toastError(error);
    setRows((data ?? []) as unknown as ExpenseRow[]);
  }, [propertyId, from, to, mode]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const n = q.toLowerCase();
    if (!n) return rows;
    return rows.filter((r) =>
      (r.description ?? "").toLowerCase().includes(n) ||
      (r.reference ?? "").toLowerCase().includes(n) ||
      (r.expense_categories?.name ?? "").toLowerCase().includes(n) ||
      (r.vendors?.name ?? "").toLowerCase().includes(n)
    );
  }, [rows, q]);

  const total = filtered.reduce((s, r) => s + Number(r.amount), 0);
  const byMode = PAYMENT_MODES.reduce<Record<PaymentMode, number>>((acc, m) => {
    acc[m] = filtered.filter((r) => r.payment_mode === m).reduce((s, r) => s + Number(r.amount), 0);
    return acc;
  }, { cash: 0, card: 0, upi: 0, bank: 0 });

  async function remove(id: string) {
    if (!confirm("Delete this expense?")) return;
    const prev = rows.find((r) => r.id === id);
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) return toastError(error);
    if (propertyId && user && prev) {
      logActivity({
        property_id: propertyId,
        user_id: user.id,
        user_name: userDisplayName(user as never),
        action_type: "EXPENSE_DELETED",
        module: "Expenses",
        reference_id: id,
        reference_label: prev.description ?? prev.expense_categories?.name ?? null,
        details: {
          expense_id: id,
          category: prev.expense_categories?.name ?? null,
          amount: Number(prev.amount),
        },
      });
    }
    toast.success("Deleted");
    load();
  }

  if (!propertyId) return <AppShell title="Expenses"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="Expenses">
      <div className="space-y-4 max-w-6xl">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Card><CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="text-2xl font-semibold">₹{total.toFixed(2)}</div>
            <div className="text-[10px] text-muted-foreground">{filtered.length} entries</div>
          </CardContent></Card>
          {PAYMENT_MODES.map((m) => (
            <Card key={m}><CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">{PAYMENT_MODE_LABEL[m]}</div>
              <div className="text-xl font-semibold">₹{byMode[m].toFixed(2)}</div>
            </CardContent></Card>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <div className="text-[10px] uppercase text-muted-foreground">From</div>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <div className="text-[10px] uppercase text-muted-foreground">To</div>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          <Select value={mode} onValueChange={(v) => setMode(v as PaymentMode | "all")}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All modes</SelectItem>
              {PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{PAYMENT_MODE_LABEL[m]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          <div className="ml-auto">
            <Button asChild><Link to="/expenses/new"><Plus className="h-4 w-4 mr-1" />New expense</Link></Button>
          </div>
        </div>

        <Card><CardContent className="pt-6">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No expenses in this range.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Paid to</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Ref</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{r.expense_date}</TableCell>
                    <TableCell>{r.expense_categories?.name ?? "—"}</TableCell>
                    <TableCell className="text-sm">{r.description ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.vendors?.name ?? r.staff?.name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={PAYMENT_MODE_TONE[r.payment_mode]}>
                        {PAYMENT_MODE_LABEL[r.payment_mode]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.reference ?? "—"}</TableCell>
                    <TableCell className="text-right font-medium">₹{Number(r.amount).toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => remove(r.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent></Card>
      </div>
    </AppShell>
  );
}