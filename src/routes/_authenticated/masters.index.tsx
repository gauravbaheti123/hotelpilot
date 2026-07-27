import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { RequirePermission } from "@/components/RequirePermission";
import {
  BedDouble, IndianRupee, TrendingUp, UtensilsCrossed, PartyPopper,
  Users, Printer, Tags, MessageSquare, ShoppingCart, Cloud, CalendarDays, Wallet, Building2,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/masters/")({
  head: () => ({ meta: [{ title: "Master Data — HotelPilot" }] }),
  component: () => (<RequirePermission module="master_data"><MastersIndex /></RequirePermission>),
});

const ITEMS = [
  { to: "/masters/rooms", label: "Rooms & Categories", icon: BedDouble },
  { to: "/masters/tariff", label: "Tariff Plans", icon: IndianRupee },
  { to: "/masters/rate-seasons", label: "Rate Seasons", icon: TrendingUp },
  { to: "/front-desk/rate-calendar", label: "Rate Calendar", icon: CalendarDays },
  { to: "/masters/menu", label: "Menu", icon: UtensilsCrossed },
  { to: "/masters/halls", label: "Halls", icon: PartyPopper },
  { to: "/masters/staff", label: "Staff", icon: Users },
  { to: "/masters/printers", label: "Printers", icon: Printer },
  { to: "/masters/expense-categories", label: "Expense Categories", icon: Tags },
  { to: "/masters/pos-categories", label: "POS Categories", icon: Tags },
  { to: "/masters/sundry-items", label: "Sundry Items", icon: ShoppingCart },
  { to: "/masters/payment-methods", label: "Payment Methods", icon: Wallet },
  { to: "/masters/billing-companies", label: "Billing Companies", icon: Building2 },
  { to: "/masters/channels", label: "OTA Channels", icon: Cloud },
  { to: "/masters/message-templates", label: "Message Templates", icon: MessageSquare },
];

function MastersIndex() {
  return (
    <AppShell title="Master Data">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {ITEMS.map((it) => (
          <Link key={it.to} to={it.to}>
            <Card className="hover:shadow-md hover:border-primary/40 transition-all h-full">
              <CardContent className="p-5 flex items-center gap-3">
                <div className="p-2 rounded-md bg-primary/10 text-primary"><it.icon className="h-5 w-5" /></div>
                <div className="font-medium">{it.label}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}