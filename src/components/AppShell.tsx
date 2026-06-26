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
  CalendarDays,
  History,
  Banknote,
  TrendingUp,
  Star,
  MessageSquare,
  MessagesSquare,
  ShoppingCart,
  Cloud,
  Settings,
  MessageCircle,
} from "lucide-react";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { PropertySelector } from "./PropertySelector";
import { usePermissions } from "@/hooks/use-permissions";
import { useCurrentProperty } from "@/hooks/use-property";
import { RemindersBell } from "./Reminders";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  requireSuperadmin?: boolean;
  requireOwner?: boolean;
  requireManagerOrAbove?: boolean;
  module?: string;
}

interface NavGroup {
  label?: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, module: "dashboard" },
      { to: "/front-desk/bookings", label: "Front Desk", icon: ListChecks, module: "bookings" },
      { to: "/food/dashboard", label: "Food & KOT", icon: ChefHat, module: "food_kot" },
      { to: "/pos", label: "Billing", icon: Receipt, module: "pos_sundry" },
      { to: "/reports", label: "Reports", icon: BarChart3, module: "reports_daily" },
      { to: "/housekeeping/board", label: "Housekeeping", icon: LayoutGrid, module: "room_board" },
      { to: "/guests", label: "Guest CRM", icon: UserCircle2, module: "guest_crm" },
      { to: "/comms", label: "Communications", icon: MessagesSquare, module: "communications" },
      { to: "/inventory", label: "Inventory", icon: Package, module: "inventory" },
      { to: "/expenses", label: "Expenses", icon: Wallet, module: "masters_expense_categories" },
      { to: "/staff", label: "Staff HR", icon: Users, module: "staff_hr" },
      { to: "/banquet/bookings", label: "Banquet", icon: PartyPopper, module: "masters_halls" },
      { to: "/masters", label: "Master Data", icon: LayoutGrid, module: "masters_rooms" },
      { to: "/settings", label: "Settings", icon: Settings, requireManagerOrAbove: true },
    ],
  },
];

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  const { user, roles } = useAuth();
  const isSuperadmin = roles.includes("superadmin");
  const isOwner = roles.includes("owner") || isSuperadmin;
  const isManagerOrAbove = roles.includes("manager") || isOwner;
  const currentPath = router.state.location.pathname;
  const { can, loading: permsLoading, isSuperadmin: permSuper, map } = usePermissions();
  const hasAnyAssignment = permSuper || Object.keys(map).length > 0;
  const { current } = useCurrentProperty();
  const propertyPaused = current?.status === "paused";
  const propertyId = current?.id ?? null;

  async function signOut() {
    await supabase.auth.signOut();
    toast.success("Signed out");
    router.navigate({ to: "/login" });
  }

  const visibleGroups = NAV_GROUPS
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (n) =>
          (!n.requireSuperadmin || isSuperadmin) &&
          (!n.requireOwner || isOwner) &&
          (!n.requireManagerOrAbove || isManagerOrAbove) &&
          // If user has a custom-role permission map, gate by module 'view'.
          // If no module declared, always show (legacy items).
          // If no role assignment at all, fall back to legacy app-role visibility.
          (!n.module || !hasAnyAssignment || permsLoading || can(n.module, "view")),
      ),
    }))
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
            {user?.id && (
              <RemindersBell propertyId={propertyId} userId={user.id} />
            )}
            <div className="hidden sm:block"><PropertySelector /></div>
            <div className="text-xs text-muted-foreground hidden lg:block">
              Support: 8007444464
            </div>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 overflow-auto">{children}</main>
      </div>
      {propertyPaused && !isSuperadmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur">
          <div className="max-w-md text-center px-6 py-10 rounded-lg border bg-card shadow-lg space-y-4">
            <ShieldAlert className="mx-auto h-12 w-12 text-rose-600" />
            <h2 className="text-xl font-semibold">Account on hold</h2>
            <p className="text-sm text-muted-foreground">
              This property is currently on hold. Please contact HotelPilot support to
              restore access.
            </p>
            <div className="text-base font-medium">📞 8007444464</div>
            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4 mr-2" /> Sign out
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}