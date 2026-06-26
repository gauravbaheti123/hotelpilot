import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Building2, MessageCircle, Cloud, Receipt, ShieldCheck, Users, ShieldAlert,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings/")({
  head: () => ({ meta: [{ title: "Settings — HotelPilot" }] }),
  component: SettingsIndex,
});

const ITEMS: Array<{ to: string; label: string; icon: any; desc: string; soon?: boolean }> = [
  { to: "/settings/hotel", label: "Business (Hotel, Logo, GST)", icon: Building2, desc: "Property profile & branding" },
  { to: "/settings/whatsapp", label: "WhatsApp / AiSensy", icon: MessageCircle, desc: "Messaging integration" },
  { to: "/channels", label: "Channel Manager", icon: Cloud, desc: "OTA distribution", soon: true },
  { to: "/settings/hotel", label: "Invoice Settings", icon: Receipt, desc: "Numbering, layout, footer" },
  { to: "/superadmin/roles", label: "Roles & Permissions", icon: ShieldCheck, desc: "Define role access" },
  { to: "/superadmin/users", label: "User Management", icon: Users, desc: "Assign roles to users" },
  { to: "/properties", label: "Properties", icon: Building2, desc: "Manage properties" },
  { to: "/security", label: "Security / Wipe", icon: ShieldAlert, desc: "Raid protection" },
];

function SettingsIndex() {
  return (
    <AppShell title="Settings">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {ITEMS.map((it, idx) => (
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
      </div>
    </AppShell>
  );
}