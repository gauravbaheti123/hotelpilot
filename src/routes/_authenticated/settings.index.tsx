import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { RequirePermission } from "@/components/RequirePermission";
import {
  Building2, MessageCircle, Cloud, Receipt, ShieldCheck, Palette,
  Lock,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings/")({
  head: () => ({ meta: [{ title: "Settings — HotelPilot" }] }),
  component: () => (<RequirePermission module="settings_business"><SettingsIndex /></RequirePermission>),
});

const ITEMS: Array<{ to: string; label: string; icon: any; desc: string; soon?: boolean; ownerOnly?: boolean }> = [
  { to: "/settings/hotel", label: "Business (Hotel, Logo, GST)", icon: Building2, desc: "Property profile & branding" },
  { to: "/settings/whatsapp", label: "WhatsApp / AiSensy", icon: MessageCircle, desc: "Messaging integration" },
  { to: "/channels", label: "Channel Manager", icon: Cloud, desc: "OTA distribution", soon: true },
  { to: "/settings/hotel", label: "Invoice Settings", icon: Receipt, desc: "Numbering, layout, footer" },
  { to: "/superadmin/users", label: "Users & Roles", icon: ShieldCheck, desc: "Manage users, roles & permissions", ownerOnly: true },
  { to: "/properties", label: "Properties", icon: Building2, desc: "Manage properties" },
  { to: "/masters/room-status-colors", label: "Room Status Colours", icon: Palette, desc: "Customize room tile colours" },
];

function SettingsIndex() {
  const { roles } = useAuth();
  const canManageRoles = roles.includes("superadmin") || roles.includes("owner");
  const items = ITEMS.filter((it) => !it.ownerOnly || canManageRoles);
  return (
    <AppShell title="Settings">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((it, idx) => (
          <Link key={idx} to={it.to}>
            <Card className="hover:shadow-md hover:border-primary/40 transition-all h-full">
              <CardContent className="p-5 flex items-start gap-3">
                <div className="p-2 rounded-md bg-primary/10 text-primary"><it.icon className="h-5 w-5" /></div>
                <div className="flex-1">
                  <div className="font-medium flex items-center gap-2">
                    {it.label}
                    {it.soon && <Badge variant="secondary" className="text-[10px]">Coming Soon</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">{it.desc}</div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        <Card className="border-dashed bg-muted/40 h-full">
          <CardContent className="p-5 flex items-start gap-3">
            <div className="p-2 rounded-md bg-primary/10 text-primary"><Lock className="h-5 w-5" /></div>
            <div className="flex-1">
              <div className="font-medium flex items-center gap-2">
                Communications <Badge variant="secondary" className="text-[10px]">Coming Soon</Badge>
              </div>
              <div className="text-xs text-muted-foreground">Guest messaging & broadcasts</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}