import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { RequirePermission } from "@/components/RequirePermission";
import {
  BedDouble, IndianRupee, TrendingUp, UtensilsCrossed, PartyPopper,
  Users, Printer, Tags, MessageSquare, ShoppingCart, Cloud, CalendarDays, Wallet, Clock, Palette,
  Armchair,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/masters/")({
  head: () => ({ meta: [{ title: "Master Data — HotelPilot" }] }),
  component: () => (<RequirePermission module="master_data"><MastersIndex /></RequirePermission>),
});

const GROUPS: Array<{
  title: string;
  items: Array<{ to: string; label: string; icon: any }>;
}> = [
  {
    title: "Property Setup",
    items: [
      { to: "/masters/rooms", label: "Rooms & Categories", icon: BedDouble },
      { to: "/masters/tariff", label: "Tariff Plans", icon: IndianRupee },
      { to: "/masters/rate-seasons", label: "Rate Seasons", icon: TrendingUp },
      { to: "/masters/early-checkin-slabs", label: "Early Check-in Slabs", icon: Clock },
      { to: "/front-desk/rate-calendar", label: "Rate Calendar", icon: CalendarDays },
      { to: "/masters/halls", label: "Halls", icon: PartyPopper },
      { to: "/masters/room-status-colors", label: "Room Status Colours", icon: Palette },
    ],
  },
  {
    title: "Food & Billing",
    items: [
      { to: "/masters/menu", label: "Menu", icon: UtensilsCrossed },
      { to: "/masters/sundry-items", label: "Sundry Items & POS Categories", icon: ShoppingCart },
      { to: "/masters/restaurant-outlets", label: "Restaurant Outlets", icon: UtensilsCrossed },
      { to: "/masters/tables", label: "Restaurant Tables", icon: Armchair },
      { to: "/masters/payment-methods", label: "Payment Methods", icon: Wallet },
    ],
  },
  {
    title: "Operations",
    items: [
      { to: "/masters/staff", label: "Staff", icon: Users },
      { to: "/masters/printers", label: "Printers", icon: Printer },
      { to: "/masters/expense-categories", label: "Expense Categories", icon: Tags },
    ],
  },
  {
    title: "Communication",
    items: [
      { to: "/masters/channels", label: "OTA Channels", icon: Cloud },
      { to: "/masters/message-templates", label: "Message Templates", icon: MessageSquare },
    ],
  },
];

function MastersIndex() {
  return (
    <AppShell title="Master Data">
      <div className="space-y-8">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {g.title}
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {g.items.map((it) => (
                <Link key={it.to} to={it.to}>
                  <Card className="hover:shadow-md hover:border-primary/40 transition-all h-full">
                    <CardContent className="p-5 flex items-center gap-3">
                      <div className="p-2 rounded-md bg-primary/10 text-primary">
                        <it.icon className="h-5 w-5" />
                      </div>
                      <div className="font-medium">{it.label}</div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}