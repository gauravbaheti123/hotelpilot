import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import {
  BarChart3, FileSpreadsheet, FileText, Moon, History, ClipboardList, Wallet,
} from "lucide-react";
import { useAuth, hasRole } from "@/hooks/use-auth";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/reports/")({
  head: () => ({ meta: [{ title: "Reports — HotelPilot" }] }),
  component: () => (<RequirePermission module="reports"><ReportsIndex /></RequirePermission>),
});

const ITEMS = [
  { to: "/reports/daily", label: "Daily Report", icon: BarChart3, desc: "Today's operational snapshot" },
  { to: "/reports/analytics", label: "Analytics", icon: BarChart3, desc: "Trends and KPIs" },
  { to: "/reports/sales", label: "Sales", icon: FileSpreadsheet, desc: "Sales summary" },
  { to: "/reports/gst", label: "GST Report", icon: FileText, desc: "Tax-wise summary" },
  { to: "/reports/bill-wise", label: "Bill-Wise", icon: FileSpreadsheet, desc: "Per-invoice details" },
  { to: "/reports/cash-collection", label: "Cash Collection", icon: FileSpreadsheet, desc: "Cash receipts" },
  { to: "/reports/cash-handover", label: "Cash Handover", icon: Wallet, desc: "Shift handover & mismatches" },
  { to: "/reports/date-wise-revenue", label: "Date-Wise Revenue", icon: BarChart3, desc: "Revenue by date" },
  { to: "/reports/room-wise", label: "Room-Wise", icon: FileSpreadsheet, desc: "Occupancy & revenue per room" },
  { to: "/reports/room-shift", label: "Room Shift", icon: FileSpreadsheet, desc: "Shifts & rate decisions" },
  { to: "/reports/food-kot", label: "Food / KOT", icon: FileSpreadsheet, desc: "Restaurant report" },
  { to: "/reports/banquet", label: "Banquet", icon: FileSpreadsheet, desc: "Events report" },
  { to: "/reports/guest-wise", label: "Guest-Wise", icon: FileSpreadsheet, desc: "By guest" },
  { to: "/reports/expenses", label: "Expenses", icon: FileSpreadsheet, desc: "Expense report" },
  { to: "/reports/activity", label: "Activity Log", icon: History, desc: "User activity" },
  { to: "/reports/night-audit", label: "Day Close", icon: Moon, desc: "End-of-day close" },
];

const OWNER_ITEMS = [
  { to: "/reports/kot-activity", label: "KOT Activity Log", icon: ClipboardList, desc: "KOT edits, voids & deletes (Owner)" },
  { to: "/reports/banquet-billing", label: "Banquet Billing", icon: FileSpreadsheet, desc: "Event-block folios & food bills (Owner)" },
];

function ReportsIndex() {
  const { roles } = useAuth();
  const isOwner = hasRole(roles, "owner") || hasRole(roles, "superadmin");
  const items = isOwner ? [...ITEMS, ...OWNER_ITEMS] : ITEMS;
  return (
    <AppShell title="Reports">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((it) => (
          <Link key={it.to} to={it.to}>
            <Card className="hover:shadow-md hover:border-primary/40 transition-all h-full">
              <CardContent className="p-5 flex items-start gap-3">
                <div className="p-2 rounded-md bg-primary/10 text-primary">
                  <it.icon className="h-5 w-5" />
                </div>
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