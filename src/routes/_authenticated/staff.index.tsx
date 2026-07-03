import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarDays, History, Banknote } from "lucide-react";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/staff/")({
  head: () => ({ meta: [{ title: "Staff HR — HotelPilot" }] }),
  component: () => (<RequirePermission module="staff_hr"><StaffIndex /></RequirePermission>),
});

const ITEMS = [
  { to: "/staff/attendance", label: "Attendance", icon: CalendarDays, desc: "Mark today's attendance" },
  { to: "/staff/attendance-history", label: "History", icon: History, desc: "Past attendance records" },
  { to: "/staff/payroll", label: "Payroll", icon: Banknote, desc: "Monthly salary & payouts" },
];

function StaffIndex() {
  return (
    <AppShell title="Staff HR">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {ITEMS.map((it) => (
          <Link key={it.to} to={it.to}>
            <Card className="hover:shadow-md hover:border-primary/40 transition-all h-full">
              <CardContent className="p-5 flex items-start gap-3">
                <div className="p-2 rounded-md bg-primary/10 text-primary"><it.icon className="h-5 w-5" /></div>
                <div>
                  <div className="font-medium">{it.label}</div>
                  <div className="text-xs text-muted-foreground">{it.desc}</div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}