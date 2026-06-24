import { createFileRoute } from "@tanstack/react-router";
import { CrudPage, FieldDef, ColumnDef } from "@/components/master/CrudPage";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/masters/expense-categories")({
  head: () => ({ meta: [{ title: "Expense Categories — HotelPilot" }] }),
  component: ExpenseCategoriesPage,
});

interface Cat { id: string; name: string; is_active: boolean }

const fields: FieldDef[] = [
  { name: "name", label: "Category name", type: "text", required: true, colSpan: 2 },
  { name: "is_active", label: "Active", type: "switch", defaultValue: true },
];

const columns: ColumnDef<Cat>[] = [
  { header: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
  {
    header: "Status",
    render: (r) => <Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "Active" : "Inactive"}</Badge>,
  },
];

function ExpenseCategoriesPage() {
  return (
    <CrudPage<Cat>
      title="Expense Categories"
      subtitle="Define heads of expense for accounting"
      table="expense_categories"
      fields={fields}
      columns={columns}
      orderBy={{ column: "name", ascending: true }}
    />
  );
}