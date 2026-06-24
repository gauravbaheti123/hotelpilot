import { Link, useRouter } from "@tanstack/react-router";
import { ReactNode } from "react";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  LayoutDashboard,
  Building2,
  Users,
  LogOut,
  ShieldCheck,
  BedDouble,
  IndianRupee,
  UtensilsCrossed,
  Printer,
  CalendarCheck,
  ListChecks,
  PlusCircle,
  ChefHat,
  ClipboardList,
  Receipt,
  FileText,
  PartyPopper,
  CalendarRange,
  BarChart3,
  Moon,
  FileSpreadsheet,
  Sparkles,
  LayoutGrid,
  UserCircle2,
  Package,
  Boxes,
  Truck,
  ArrowLeftRight,
  Wallet,
  Tags,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { PropertySelector } from "./PropertySelector";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  requireSuperadmin?: boolean;
}

interface NavGroup {
  label?: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/properties", label: "Properties", icon: Building2 },
    ],
  },
  {
    label: "Front Desk",
    items: [
      { to: "/front-desk/new", label: "New Booking", icon: PlusCircle },
      { to: "/front-desk/bookings", label: "Bookings", icon: ListChecks },
      { to: "/front-desk/in-house", label: "In-house", icon: CalendarCheck },
    ],
  },
  {
    label: "Food & KOT",
    items: [
      { to: "/food/dashboard", label: "Food Dashboard", icon: ChefHat },
      { to: "/food/new", label: "New KOT", icon: PlusCircle },
      { to: "/food/kots", label: "All KOTs", icon: ClipboardList },
    ],
  },
  {
    label: "Billing",
    items: [
      { to: "/billing/invoices", label: "Invoices", icon: Receipt },
    ],
  },
  {
    label: "Reports",
    items: [
      { to: "/reports/daily", label: "Daily Report", icon: BarChart3 },
      { to: "/reports/sales", label: "Sales", icon: FileSpreadsheet },
      { to: "/reports/gst", label: "GST", icon: FileText },
      { to: "/reports/night-audit", label: "Night Audit", icon: Moon },
    ],
  },
  {
    label: "Housekeeping",
    items: [
      { to: "/housekeeping/board", label: "Room Board", icon: LayoutGrid },
      { to: "/housekeeping/tasks", label: "Tasks", icon: Sparkles },
      { to: "/housekeeping/new", label: "New Task", icon: PlusCircle },
    ],
  },
  {
    label: "Guests",
    items: [
      { to: "/guests", label: "Guest CRM", icon: UserCircle2 },
      { to: "/guests/new", label: "New Guest", icon: PlusCircle },
    ],
  },
  {
    label: "Inventory",
    items: [
      { to: "/inventory/stock", label: "Current Stock", icon: Boxes },
      { to: "/inventory/movements", label: "Stock Movements", icon: ArrowLeftRight },
      { to: "/inventory/items", label: "Items", icon: Package },
      { to: "/inventory/vendors", label: "Vendors", icon: Truck },
    ],
  },
  {
    label: "Expenses",
    items: [
      { to: "/expenses", label: "Expenses", icon: Wallet },
      { to: "/expenses/new", label: "New Expense", icon: PlusCircle },
    ],
  },
  {
    label: "Banquet",
    items: [
      { to: "/banquet/bookings", label: "Events", icon: CalendarRange },
      { to: "/banquet/new", label: "New Event", icon: PartyPopper },
    ],
  },
  {
    label: "Master Data",
    items: [
      { to: "/masters/rooms", label: "Rooms & Categories", icon: BedDouble },
      { to: "/masters/tariff", label: "Tariff Plans", icon: IndianRupee },
      { to: "/masters/menu", label: "Menu", icon: UtensilsCrossed },
      { to: "/masters/halls", label: "Halls", icon: PartyPopper },
      { to: "/masters/staff", label: "Staff", icon: Users },
      { to: "/masters/printers", label: "Printers", icon: Printer },
      { to: "/masters/expense-categories", label: "Expense Categories", icon: Tags },
    ],
  },
  {
    label: "Admin",
    items: [
      { to: "/superadmin/dashboard", label: "Superadmin", icon: ShieldCheck, requireSuperadmin: true },
    ],
  },
];

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  const { user, roles } = useAuth();
  const isSuperadmin = roles.includes("superadmin");
  const currentPath = router.state.location.pathname;

  async function signOut() {
    await supabase.auth.signOut();
    toast.success("Signed out");
    router.navigate({ to: "/login" });
  }

  const visibleGroups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((n) => !n.requireSuperadmin || isSuperadmin) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="hidden md:flex w-64 flex-col bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
          <Logo size={36} />
          <div>
            <div className="font-semibold">HotelPilot</div>
            <div className="text-[10px] text-sidebar-foreground/60">Hotel Management System</div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-4 overflow-y-auto">
          {visibleGroups.map((group, gi) => (
            <div key={gi} className="space-y-1">
              {group.label && (
                <div className="px-3 pt-1 pb-1 text-[10px] uppercase tracking-wider text-sidebar-foreground/50">
                  {group.label}
                </div>
              )}
              {group.items.map((item) => {
                const active =
                  currentPath === item.to || currentPath.startsWith(item.to + "/");
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                      active
                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-sidebar-border space-y-2">
          <div className="px-3 text-xs text-sidebar-foreground/60 truncate">
            {user?.email}
          </div>
          <div className="px-3 text-[10px] uppercase tracking-wider text-sidebar-foreground/50">
            {roles.length ? roles.join(", ") : "no role"}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={signOut}
            className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </Button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b bg-card flex items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="md:hidden"><Logo size={28} /></div>
            <h1 className="text-base sm:text-lg font-semibold">{title}</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:block"><PropertySelector /></div>
            <div className="text-xs text-muted-foreground hidden lg:block">
              Support: 8007444464
            </div>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}