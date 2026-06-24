import { createFileRoute } from "@tanstack/react-router";
import { CrudPage, type FieldDef, type ColumnDef } from "@/components/master/CrudPage";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/masters/staff")({
  head: () => ({ meta: [{ title: "Staff — HotelPilot" }] }),
  component: StaffPage,
});

interface Staff {
  id: string;
  name: string;
  mobile: string | null;
  email: string | null;
  designation: string | null;
  department: string | null;
  salary: number | null;
  joining_date: string | null;
  is_active: boolean;
}

const fields: FieldDef[] = [
  { name: "name", label: "Full name", type: "text", required: true },
  { name: "mobile", label: "Mobile", type: "text" },
  { name: "email", label: "Email", type: "text" },
  { name: "designation", label: "Designation", type: "text" },
  {
    name: "department",
    label: "Department",
    type: "select",
    options: [
      { value: "front_office", label: "Front Office" },
      { value: "housekeeping", label: "Housekeeping" },
      { value: "kitchen", label: "Kitchen" },
      { value: "fnb", label: "F&B Service" },
      { value: "maintenance", label: "Maintenance" },
      { value: "management", label: "Management" },
    ],
  },
  { name: "salary", label: "Salary (₹)", type: "number", defaultValue: 0 },
  { name: "joining_date", label: "Joining date", type: "date" },
  { name: "id_proof", label: "ID proof number", type: "text" },
  { name: "address", label: "Address", type: "textarea", colSpan: 2 },
  { name: "is_active", label: "Active", type: "switch", defaultValue: true },
];

const columns: ColumnDef<Staff>[] = [
  { header: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
  { header: "Mobile", render: (r) => r.mobile ?? "—" },
  { header: "Designation", render: (r) => r.designation ?? "—" },
  { header: "Department", render: (r) => r.department ?? "—" },
  { header: "Salary", render: (r) => (r.salary ? `₹${r.salary}` : "—") },
  { header: "Joined", render: (r) => r.joining_date ?? "—" },
  {
    header: "Status",
    render: (r) => (
      <Badge variant={r.is_active ? "default" : "secondary"}>
        {r.is_active ? "Active" : "Inactive"}
      </Badge>
    ),
  },
];

function StaffPage() {
  return (
    <CrudPage<Staff>
      title="Staff"
      subtitle="Hotel staff directory. Linking to user accounts comes in a later phase."
      table="staff"
      fields={fields}
      columns={columns}
      orderBy={{ column: "name" }}
    />
  );
}