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

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  requireSuperadmin?: boolean;
  requireOwner?: boolean;
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
      { to: "/properties", label: "Properties", icon: Building2, requireSuperadmin: true },
    ],
  },
  {
    label: "Front Desk",
    items: [
      { to: "/front-desk/new", label: "New Booking", icon: PlusCircle, module: "bookings" },
      { to: "/front-desk/bookings", label: "Bookings", icon: ListChecks, module: "bookings" },
      { to: "/front-desk/calendar", label: "Calendar", icon: CalendarRange, module: "calendar" },
      { to: "/front-desk/rate-calendar", label: "Rate Calendar", icon: TrendingUp, module: "calendar" },
      { to: "/front-desk/in-house", label: "In-house", icon: CalendarCheck, module: "inhouse" },
    ],
  },
  {
    label: "Food & KOT",
    items: [
      { to: "/food/dashboard", label: "Food Dashboard", icon: ChefHat, module: "food_kot" },
      { to: "/food/new", label: "New KOT", icon: PlusCircle, module: "food_kot" },
      { to: "/food/kots", label: "All KOTs", icon: ClipboardList, module: "food_kot" },
    ],
  },
  {
    label: "Billing",
    items: [
      { to: "/pos", label: "POS / Sundry", icon: ShoppingCart, module: "pos_sundry" },
      { to: "/billing/invoices", label: "Invoices", icon: Receipt, module: "invoices" },
      { to: "/restaurant", label: "Restaurant Billing", icon: UtensilsCrossed, module: "restaurant_billing" },
    ],
  },
  {
    label: "Reports",
    items: [
      { to: "/reports/daily", label: "Daily Report", icon: BarChart3, module: "reports_daily" },
      { to: "/reports/analytics", label: "Analytics", icon: BarChart3, module: "reports_analytics" },
      { to: "/reports/sales", label: "Sales", icon: FileSpreadsheet, module: "reports_sales" },
      { to: "/reports/gst", label: "GST", icon: FileText, module: "reports_gst" },
      { to: "/reports/night-audit", label: "Night Audit", icon: Moon, module: "night_audit" },
    ],
  },
  {
    label: "Housekeeping",
    items: [
      { to: "/housekeeping/board", label: "Room Board", icon: LayoutGrid, module: "room_board" },
      { to: "/housekeeping/tasks", label: "Tasks", icon: Sparkles, module: "housekeeping_tasks" },
      { to: "/housekeeping/new", label: "New Task", icon: PlusCircle, module: "housekeeping_tasks" },
    ],
  },
  {
    label: "Communications",
    items: [
      { to: "/guests", label: "Guest CRM", icon: UserCircle2, module: "guest_crm" },
      { to: "/comms", label: "Communications", icon: MessagesSquare, module: "communications" },
      { to: "/comms/new", label: "New Message", icon: MessageSquare, module: "communications" },
      { to: "/whatsapp", label: "WhatsApp Inbox", icon: MessageCircle, module: "whatsapp_inbox" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { to: "/inventory/stock", label: "Current Stock", icon: Boxes, module: "inventory" },
      { to: "/inventory/movements", label: "Stock Movements", icon: ArrowLeftRight, module: "inventory" },
      { to: "/inventory/items", label: "Items", icon: Package, module: "inventory" },
      { to: "/inventory/vendors", label: "Vendors", icon: Truck, module: "inventory" },
    ],
  },
  {
    label: "Expenses",
    items: [
      { to: "/expenses", label: "Expenses", icon: Wallet, module: "masters_expense_categories" },
      { to: "/expenses/new", label: "New Expense", icon: PlusCircle, module: "masters_expense_categories" },
    ],
  },
  {
    label: "Staff HR",
    items: [
      { to: "/staff/attendance", label: "Attendance", icon: CalendarDays, module: "staff_hr" },
      { to: "/staff/attendance-history", label: "History", icon: History, module: "staff_hr" },
      { to: "/staff/payroll", label: "Payroll", icon: Banknote, module: "payroll" },
    ],
  },
  {
    label: "Banquet",
    items: [
      { to: "/banquet/bookings", label: "Events", icon: CalendarRange, module: "masters_halls" },
      { to: "/banquet/new", label: "New Event", icon: PartyPopper, module: "masters_halls" },
    ],
  },
  {
    label: "Master Data",
    items: [
      { to: "/masters/rooms", label: "Rooms & Categories", icon: BedDouble, module: "masters_rooms" },
      { to: "/masters/tariff", label: "Tariff Plans", icon: IndianRupee, module: "masters_tariff" },
      { to: "/masters/rate-seasons", label: "Rate Seasons", icon: TrendingUp, module: "masters_tariff" },
      { to: "/masters/menu", label: "Menu", icon: UtensilsCrossed, module: "masters_menu" },
      { to: "/masters/halls", label: "Halls", icon: PartyPopper, module: "masters_halls" },
      { to: "/masters/staff", label: "Staff", icon: Users, module: "masters_staff" },
      { to: "/masters/printers", label: "Printers", icon: Printer, module: "masters_printers" },
      { to: "/masters/expense-categories", label: "Expense Categories", icon: Tags, module: "masters_expense_categories" },
      { to: "/masters/message-templates", label: "Message Templates", icon: MessageSquare, module: "masters_staff" },
      { to: "/masters/sundry-items", label: "Sundry Items", icon: ShoppingCart, module: "masters_sundry_items" },
      { to: "/masters/channels", label: "OTA Channels", icon: Cloud, module: "masters_ota_channels" },
    ],
  },
  {
    label: "Channel Manager",
    items: [
      { to: "/channels", label: "Distribution", icon: Cloud, module: "channel_manager" },
    ],
  },
  {
    label: "Settings",
    items: [
      { to: "/settings/whatsapp", label: "WhatsApp / AiSensy", icon: Settings, module: "settings_whatsapp" },
    ],
  },
  {
    label: "Admin",
    items: [
      { to: "/superadmin/dashboard", label: "Superadmin", icon: ShieldCheck, requireSuperadmin: true },
      { to: "/superadmin/roles", label: "Roles & Permissions", icon: ShieldCheck, requireSuperadmin: true },
      { to: "/superadmin/users", label: "User Role Assignments", icon: Users, requireSuperadmin: true },
      { to: "/security", label: "Security / Wipe", icon: ShieldAlert, requireOwner: true },
    ],
  },
];

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  const { user, roles } = useAuth();
  const isSuperadmin = roles.includes("superadmin");
  const isOwner = roles.includes("owner") || isSuperadmin;
  const currentPath = router.state.location.pathname;
  const { can, loading: permsLoading, isSuperadmin: permSuper, map } = usePermissions();
  const hasAnyAssignment = permSuper || Object.keys(map).length > 0;
  const { current } = useCurrentProperty();
  const propertyPaused = current?.status === "paused";

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