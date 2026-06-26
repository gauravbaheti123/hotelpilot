import { Link, useRouter } from "@tanstack/react-router";
import { ReactNode, useState } from "react";
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
  ChevronDown,
  ChevronRight,
  Eye,
  KeyRound,
  ScrollText,
} from "lucide-react";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { PropertySelector } from "./PropertySelector";
import { usePermissions } from "@/hooks/use-permissions";
import { useCurrentProperty } from "@/hooks/use-property";
import { RemindersBell } from "./Reminders";
import { useSuperadminView } from "@/lib/superadmin-view";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  requireSuperadmin?: boolean;
  requireOwner?: boolean;
  requireManagerOrAbove?: boolean;
  module?: string;
  children?: NavItem[];
}

interface NavGroup {
  label?: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, module: "dashboard" },
      {
        to: "/front-desk/bookings", label: "Front Desk", icon: ListChecks, module: "bookings",
        children: [
          { to: "/front-desk/bookings", label: "Bookings", icon: ListChecks },
          { to: "/front-desk/calendar", label: "Calendar", icon: CalendarRange },
          { to: "/front-desk/in-house", label: "In-house", icon: BedDouble },
        ],
      },
      {
        to: "/food/dashboard", label: "Food & KOT", icon: ChefHat, module: "food_kot",
        children: [
          { to: "/food/dashboard", label: "Food Dashboard", icon: LayoutDashboard },
          { to: "/food/kots", label: "All KOTs", icon: ClipboardList },
          { to: "/food/new", label: "New KOT", icon: PlusCircle },
          { to: "/food/pending-bills", label: "Pending Bills", icon: Receipt },
        ],
      },
      {
        to: "/pos", label: "Billing", icon: Receipt, module: "pos_sundry",
        children: [
          { to: "/pos", label: "POS", icon: ShoppingCart },
          { to: "/restaurant", label: "Restaurant Billing", icon: UtensilsCrossed },
          { to: "/billing/invoices", label: "Invoices", icon: FileText },
          { to: "/billing/mis", label: "MIS A/c", icon: Banknote },
        ],
      },
      {
        to: "/reports", label: "Reports", icon: BarChart3, module: "reports_daily",
        children: [
          { to: "/reports", label: "Reports", icon: BarChart3 },
          { to: "/reports/night-audit", label: "Day Close", icon: Moon },
        ],
      },
      {
        to: "/housekeeping/board", label: "Housekeeping", icon: LayoutGrid, module: "room_board",
        children: [
          { to: "/housekeeping/board", label: "Room Board", icon: LayoutGrid },
          { to: "/housekeeping/tasks", label: "Tasks", icon: ClipboardList },
        ],
      },
      { to: "/guests", label: "Guest CRM", icon: UserCircle2, module: "guest_crm" },
      { to: "/inventory", label: "Inventory", icon: Package, module: "inventory" },
      { to: "/expenses", label: "Expenses", icon: Wallet, module: "masters_expense_categories" },
      { to: "/staff", label: "Staff HR", icon: Users, module: "staff_hr" },
      { to: "/banquet/bookings", label: "Banquet", icon: PartyPopper, module: "masters_halls" },
      { to: "/masters", label: "Master Data", icon: LayoutGrid, module: "masters_rooms" },
      { to: "/settings", label: "Settings", icon: Settings, requireManagerOrAbove: true },
    ],
  },
];

const SUPERADMIN_NAV: NavGroup[] = [
  {
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/properties", label: "Properties", icon: Building2 },
      { to: "/superadmin/users", label: "Users", icon: Users },
      { to: "/superadmin/roles", label: "Roles & Permissions", icon: KeyRound },
      { to: "/security", label: "Security Dashboard", icon: ShieldCheck },
      { to: "/reports/activity", label: "System Logs", icon: ScrollText },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  return <AppShellInner title={title}>{children}</AppShellInner>;
}

function NavEntry({ item, currentPath }: { item: NavItem; currentPath: string }) {
  const Icon = item.icon;
  const hasChildren = !!item.children?.length;
  const childActive = hasChildren && item.children!.some(
    (c) => currentPath === c.to || currentPath.startsWith(c.to + "/"),
  );
  const selfActive = currentPath === item.to || currentPath.startsWith(item.to + "/");
  const [open, setOpen] = useState<boolean>(childActive || selfActive);

  if (!hasChildren) {
    return (
      <Link
        to={item.to}
        className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
          selfActive
            ? "bg-sidebar-primary text-sidebar-primary-foreground"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        }`}
      >
        <Icon className="h-4 w-4" />
        {item.label}
      </Link>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
          childActive
            ? "bg-sidebar-primary text-sidebar-primary-foreground"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        }`}
      >
        <Icon className="h-4 w-4" />
        <span className="flex-1 text-left">{item.label}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="ml-6 mt-1 space-y-0.5 border-l border-sidebar-border/60 pl-2">
          {item.children!.map((c) => {
            const ca = currentPath === c.to || currentPath.startsWith(c.to + "/");
            const CIcon = c.icon;
            return (
              <Link
                key={c.to}
                to={c.to}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors ${
                  ca
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
              >
                <CIcon className="h-3.5 w-3.5" />
                {c.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AppShellInner({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  const { user, roles } = useAuth();
  const isSuperadmin = roles.includes("superadmin");
  const isPlatformSuper =
    isSuperadmin ||
    (user?.email ?? "").toLowerCase() === "growth@hotelpilot.in";
  const { isViewing, exit } = useSuperadminView();
  const inAdminMode = isPlatformSuper && !isViewing;
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

  const visibleGroups = inAdminMode
    ? SUPERADMIN_NAV
    : NAV_GROUPS
        .map((g) => ({
          ...g,
          items: g.items.filter(
            (n) =>
              (!n.requireSuperadmin || isSuperadmin) &&
              (!n.requireOwner || isOwner) &&
              (!n.requireManagerOrAbove || isManagerOrAbove) &&
              (!n.module || !hasAnyAssignment || permsLoading || can(n.module, "view")),
          ),
        }))
        .filter((g) => g.items.length > 0);

  const headerTitle = inAdminMode ? "HotelPilot Admin" : title;

  function backToAdmin() {
    exit();
    router.navigate({ to: "/dashboard" });
    setTimeout(() => window.location.reload(), 50);
  }

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
              {group.items.map((item) => (
                <NavEntry key={item.to} item={item} currentPath={currentPath} />
              ))}
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
        {isPlatformSuper && isViewing && (
          <div
            className="flex items-center justify-between gap-3 px-4 py-2 text-white text-sm"
            style={{ backgroundColor: "#b45309" }}
          >
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              <span>
                Viewing as: <strong>{current?.name ?? "—"}</strong>
                {current?.city ? ` · ${current.city}` : ""}
              </span>
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="h-7"
              onClick={backToAdmin}
            >
              ← Back to Admin Dashboard
            </Button>
          </div>
        )}
        <header className="h-14 border-b bg-card flex items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="md:hidden"><Logo size={28} /></div>
            <h1 className="text-base sm:text-lg font-semibold">{headerTitle}</h1>
          </div>
          <div className="flex items-center gap-4">
            {user?.id && (
              <RemindersBell propertyId={propertyId} userId={user.id} />
            )}
            {!inAdminMode && (
              <div className="hidden sm:block"><PropertySelector /></div>
            )}
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