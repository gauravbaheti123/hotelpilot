import { Link, useRouter } from "@tanstack/react-router";
import { ReactNode, Suspense, lazy, useEffect, useState } from "react";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  ClipboardList,
  ClipboardCheck,
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
  Menu,
  Tag,
  PanelLeftClose,
  PanelLeftOpen,
  UserRound,
} from "lucide-react";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { PropertySelector } from "./PropertySelector";
import { usePermissions } from "@/hooks/use-permissions";
import { useCurrentProperty } from "@/hooks/use-property";
import { useRoomStatusColorOverrides } from "@/hooks/use-room-status-colors";
import { RemindersBell } from "./Reminders";
import { useSuperadminView } from "@/lib/superadmin-view";
const QZStatusIndicator = lazy(() =>
  import("./QZStatusIndicator").then((m) => ({ default: m.QZStatusIndicator })),
);
import { ProfileDialog } from "./ProfileDialog";
import { reportQueryError } from "@/lib/queryError";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  requireSuperadmin?: boolean;
  requireOwner?: boolean;
  requireManagerOrAbove?: boolean;
  module?: string;
  modules?: string[];
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
        to: "/front-desk/bookings", label: "Front Desk", icon: ListChecks,
        modules: ["bookings", "calendar", "inhouse"],
        children: [
          { to: "/front-desk/bookings", label: "Bookings", icon: ListChecks, module: "bookings" },
          { to: "/front-desk/calendar", label: "Calendar", icon: CalendarRange, module: "calendar" },
          { to: "/front-desk/in-house", label: "In-house", icon: BedDouble, module: "inhouse" },
        ],
      },
      {
        to: "/billing/invoices", label: "Billing", icon: Receipt,
        modules: ["restaurant_billing", "invoices"],
        children: [
          { to: "/restaurant", label: "Restaurant Billing", icon: UtensilsCrossed, module: "restaurant_billing" },
          { to: "/billing/invoices", label: "Invoices", icon: FileText, module: "invoices" },
          { to: "/billing/companies", label: "Billing Companies", icon: Building2, module: "invoices" },
        ],
      },
      {
        to: "/reports", label: "Reports", icon: BarChart3,
        modules: ["reports", "day_close"],
        children: [
          { to: "/reports", label: "Reports", icon: BarChart3, module: "reports" },
          { to: "/reports/night-audit", label: "Day Close", icon: Moon, module: "day_close" },
        ],
      },
      {
        to: "/housekeeping/board", label: "Housekeeping", icon: LayoutGrid,
        modules: ["room_board", "tasks"],
        children: [
          { to: "/housekeeping/board", label: "Room Board", icon: LayoutGrid, module: "room_board" },
          { to: "/housekeeping/tasks", label: "Tasks", icon: ClipboardList, module: "tasks" },
        ],
      },
      { to: "/guests", label: "Guest CRM", icon: UserCircle2, module: "guest_crm" },
      { to: "/inventory", label: "Inventory", icon: Package, module: "inventory" },
      { to: "/expenses", label: "Expenses", icon: Wallet, module: "expenses" },
      { to: "/staff", label: "Staff HR", icon: Users, module: "staff_hr" },
      { to: "/banquet/bookings", label: "Banquet", icon: PartyPopper, module: "banquet" },
      { to: "/handover/new", label: "Shift Handover", icon: ClipboardCheck, module: "shift_handover" },
      { to: "/petty-cash", label: "Petty Cash", icon: Wallet, module: "shift_handover" },
      { to: "/label-printing", label: "Label Printing", icon: Tag, module: "label_printing" },
      { to: "/masters", label: "Master Data", icon: LayoutGrid, module: "master_data" },
      { to: "/settings", label: "Settings", icon: Settings,
        modules: ["settings_business", "settings_invoice", "settings_whatsapp", "user_management", "roles_permissions"] },
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
      { to: "/reports/activity", label: "System Logs", icon: ScrollText },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function AppShell({
  title,
  children,
  titleSlot,
  onTitleClick,
}: {
  title: string;
  children: ReactNode;
  /** Optional controls rendered inline next to the page title. */
  titleSlot?: ReactNode;
  /** When set, the page title becomes a clickable "go home" action. */
  onTitleClick?: () => void;
}) {
  return (
    <AppShellInner title={title} titleSlot={titleSlot} onTitleClick={onTitleClick}>
      {children}
    </AppShellInner>
  );
}

function NavEntry({ item, currentPath, collapsed }: { item: NavItem; currentPath: string; collapsed: boolean }) {
  const Icon = item.icon;
  const hasChildren = !!item.children?.length;
  const childActive = hasChildren && item.children!.some(
    (c) => currentPath === c.to || currentPath.startsWith(c.to + "/"),
  );
  const selfActive = currentPath === item.to || currentPath.startsWith(item.to + "/");
  const [open, setOpen] = useState<boolean>(childActive || selfActive);

  if (collapsed) {
    // Icon-only mode — always render top-level item as a link to its primary route.
    return (
      <Link
        to={item.to}
        title={item.label}
        className={`flex items-center justify-center px-2 py-2 rounded-md transition-colors ${
          selfActive || childActive
            ? "bg-sidebar-primary text-sidebar-primary-foreground"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        }`}
      >
        <Icon className="h-5 w-5" />
      </Link>
    );
  }

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

function AppShellInner({
  title,
  children,
  titleSlot,
  onTitleClick,
}: {
  title: string;
  children: ReactNode;
  titleSlot?: ReactNode;
  onTitleClick?: () => void;
}) {
  const router = useRouter();
  const { user, roles, loading: authLoading } = useAuth();
  // Superadmin sidebar is reserved for the platform owner email ONLY.
  // Do NOT derive this from role names, permission counts, or property_id.
  const isPlatformSuper =
    (user?.email ?? "").toLowerCase() === "growth@hotelpilot.in";
  const isSuperadmin = isPlatformSuper;
  const { isViewing, exit } = useSuperadminView();
  const inAdminMode = isPlatformSuper && !isViewing;
  const normalizedRoles = roles.map((role) => role.toLowerCase());
  const isOwner = normalizedRoles.includes("owner") || isSuperadmin;
  const isManagerOrAbove = roles.includes("manager") || isOwner;
  const currentPath = router.state.location.pathname;
  const { can, loading: permsLoading, isSuperadmin: permSuper, map } = usePermissions();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [currentPath]);
  const hasAnyAssignment = permSuper || Object.keys(map).length > 0;
  // Filter the sidebar by permissions only AFTER auth + perms have settled,
  // and never for Owners / Superadmin. This prevents the "full menu shrinks
  // to short menu" flicker right after sign-in.
  const skipPermissionFilter =
    isOwner || isSuperadmin || authLoading || permsLoading || !hasAnyAssignment;
  const { current } = useCurrentProperty();
  const propertyPaused = current?.status === "paused";
  const propertyId = current?.id ?? null;
  // Applies the property's custom room-status palette app-wide.
  useRoomStatusColorOverrides();

  // Sidebar collapsed state, persisted per-user in localStorage.
  const storageKey = user?.id ? `hp:sidebar_collapsed:${user.id}` : "hp:sidebar_collapsed";
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem("hp:sidebar_collapsed") === "1"; } catch { return false; }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const v = window.localStorage.getItem(storageKey);
      if (v !== null) setCollapsed(v === "1");
    } catch { /* ignore */ }
  }, [storageKey]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, collapsed ? "1" : "0");
      window.localStorage.setItem("hp:sidebar_collapsed", collapsed ? "1" : "0");
    } catch { /* ignore */ }
  }, [collapsed, storageKey]);

  // Profile dialog + display name/photo
  const [profileOpen, setProfileOpen] = useState(false);
  const [qzMounted, setQzMounted] = useState(false);
  useEffect(() => { setQzMounted(true); }, []);
  const [displayName, setDisplayName] = useState<string>("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!user?.id) return;
    let mounted = true;
    (async () => {
      const { data, error: __qe1 } = await supabase
        .from("profiles")
        .select("name, photo_url")
        .eq("id", user.id)
        .maybeSingle();
      if (__qe1) reportQueryError("profiles", __qe1);
      if (!mounted) return;
      setDisplayName((data as any)?.name ?? "");
      setPhotoUrl((data as any)?.photo_url ?? null);
    })();
    return () => { mounted = false; };
  }, [user?.id, profileOpen]);

  const shownName = displayName?.trim() || (user?.email?.split("@")[0] ?? "");
  const initials = (shownName || "?")
    .split(/\s+/)
    .map((s) => s.charAt(0))
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

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
          items: g.items
            .map((n) => {
              // Filter sub-items by their own module permission first
              if (n.children && !skipPermissionFilter) {
                const filteredChildren = n.children.filter(
                  (c) => !c.module || can(c.module, "view"),
                );
                return { ...n, children: filteredChildren };
              }
              return n;
            })
            .filter((n) => {
              if (n.requireSuperadmin && !isSuperadmin) return false;
              if (n.requireOwner && !isOwner) return false;
              if (n.requireManagerOrAbove && !isManagerOrAbove) return false;
              if (skipPermissionFilter) return true;
              // If the item aggregates multiple modules, show when ANY child module is allowed
              if (n.modules && n.modules.length > 0) {
                return n.modules.some((m) => can(m, "view"));
              }
              if (n.module) return can(n.module, "view");
              return true;
            }),
        }))
        .filter((g) => g.items.length > 0);

  const headerTitle = inAdminMode ? "HotelPilot Admin" : title;

  function backToAdmin() {
    exit();
    router.navigate({ to: "/dashboard" });
    setTimeout(() => window.location.reload(), 50);
  }

  const sidebarBody = (
    <>
      <div className={`flex items-center border-b border-sidebar-border ${collapsed ? "justify-center px-2 py-4" : "gap-3 px-5 py-5"}`}>
        <Logo size={collapsed ? 30 : 36} />
        {!collapsed && (
          <div>
            <div className="font-semibold">HotelPilot</div>
            <div className="text-[10px] text-sidebar-foreground/60">Hotel Management System</div>
          </div>
        )}
      </div>
      <nav className={`flex-1 py-4 space-y-4 overflow-y-auto ${collapsed ? "px-1" : "px-3"}`}>
        {visibleGroups.map((group, gi) => (
          <div key={gi} className="space-y-1">
            {group.label && !collapsed && (
              <div className="px-3 pt-1 pb-1 text-[10px] uppercase tracking-wider text-sidebar-foreground/50">
                {group.label}
              </div>
            )}
            {group.items.map((item) => (
              <NavEntry key={item.to} item={item} currentPath={currentPath} collapsed={collapsed} />
            ))}
          </div>
        ))}
      </nav>
      <div className={`py-3 border-t border-sidebar-border space-y-2 ${collapsed ? "px-1" : "px-3"}`}>
        {!inAdminMode && (
          <div className={`sm:hidden ${collapsed ? "hidden" : "px-1"}`}>
            <PropertySelector />
          </div>
        )}
        {!collapsed && (
          <>
            <div className="px-3 text-xs text-sidebar-foreground/60 truncate">{user?.email}</div>
            <div className="px-3 text-[10px] uppercase tracking-wider text-sidebar-foreground/50">
              {roles.length ? roles.join(", ") : "no role"}
            </div>
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={signOut}
          className={`w-full text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${collapsed ? "justify-center px-0" : "justify-start"}`}
          title="Sign out"
        >
          <LogOut className="h-4 w-4" /> {!collapsed && <span className="ml-2">Sign out</span>}
        </Button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex bg-background">
      <aside
        className={`hidden md:flex flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 ${
          collapsed ? "w-16" : "w-64"
        }`}
      >
        {sidebarBody}
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-72 p-0 bg-sidebar text-sidebar-foreground flex flex-col md:hidden"
        >
          {sidebarBody}
        </SheetContent>
      </Sheet>

      <div className="flex-1 flex flex-col min-w-0">
        {isPlatformSuper && isViewing && (
          <div
            className="flex items-center justify-between gap-3 px-4 py-2 text-white text-sm"
            style={{ backgroundColor: "#b45309" }}
          >
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              <span className="truncate">
                Viewing as: <strong>{current?.name ?? "—"}</strong>
                {current?.city ? ` · ${current.city}` : ""}
              </span>
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="h-7 shrink-0"
              onClick={backToAdmin}
            >
              ← Back to Admin Dashboard
            </Button>
          </div>
        )}
        <header className="h-14 border-b bg-card flex items-center justify-between gap-2 px-3 sm:px-6">
          <div className="flex items-center gap-2 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden h-9 w-9 shrink-0"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="hidden md:inline-flex h-9 w-9 shrink-0"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
            </Button>
            <div className="md:hidden shrink-0"><Logo size={28} /></div>
            {onTitleClick ? (
              <button
                type="button"
                onClick={onTitleClick}
                className="text-base sm:text-lg font-semibold truncate hover:text-primary transition-colors"
                title="Back to default view"
              >
                {headerTitle}
              </button>
            ) : (
              <h1 className="text-base sm:text-lg font-semibold truncate">{headerTitle}</h1>
            )}
            {titleSlot}
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {qzMounted ? (
              <Suspense fallback={<span className="inline-block h-8 w-8" />}>
                <QZStatusIndicator />
              </Suspense>
            ) : (
              <span className="inline-block h-8 w-8" />
            )}
            {(isOwner ||
              permSuper ||
              permsLoading ||
              can("shift_handover") ||
              can("shift_handover", "create") ||
              can("shift_handover", "edit")) && (
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                data-testid="handover-icon"
                aria-label="Shift Handover"
                title="Shift Handover"
              >
                <Link to="/handover/new">
                  <ClipboardCheck className="h-5 w-5" />
                </Link>
              </Button>
            )}
            {user?.id && (
              <RemindersBell propertyId={propertyId} userId={user.id} />
            )}
            <span className="hidden sm:inline text-sm font-medium text-foreground truncate max-w-[140px]">
              {shownName}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center overflow-hidden ring-1 ring-border hover:ring-primary/40 transition"
                  aria-label="Account menu"
                >
                  {photoUrl ? (
                    <img src={photoUrl} alt="avatar" className="h-full w-full object-cover" />
                  ) : initials ? (
                    <span className="text-sm font-semibold">{initials}</span>
                  ) : (
                    <UserRound className="h-5 w-5" />
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="truncate">{shownName || user?.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setProfileOpen(true)}>
                  <UserRound className="h-4 w-4 mr-2" /> Edit Profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={signOut}>
                  <LogOut className="h-4 w-4 mr-2" /> Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 p-3 sm:p-6 overflow-auto">{children}</main>
      </div>
      {user?.id && (
        <ProfileDialog
          open={profileOpen}
          onOpenChange={setProfileOpen}
          userId={user.id}
          email={user.email ?? null}
        />
      )}
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