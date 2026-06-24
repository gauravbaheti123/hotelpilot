import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Users, BedDouble, IndianRupee } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — HotelPilot" }] }),
  component: DashboardPage,
});

const stats = [
  { label: "Properties", value: "—", icon: Building2 },
  { label: "Rooms", value: "—", icon: BedDouble },
  { label: "Staff", value: "—", icon: Users },
  { label: "Today's revenue", value: "₹0", icon: IndianRupee },
];

function DashboardPage() {
  const { user, roles } = useAuth();
  const role = roles[0] ?? "user";

  return (
    <AppShell title="Dashboard">
      <div className="max-w-6xl space-y-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Welcome{user?.email ? `, ${user.email.split("@")[0]}` : ""}
          </h2>
          <p className="text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{role}</span>. This is your HotelPilot home base.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <Card key={s.label}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {s.label}
                  </CardTitle>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold">{s.value}</div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Phase 1 ready</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Foundation is live: brand system, authentication, role-based access,
              properties schema and dashboard shell.
            </p>
            <p>
              Coming up — Phase 2: master data (rooms, categories, tariff plans,
              menu, staff, printers).
            </p>
            {roles.includes("superadmin") && (
              <p>
                You have <span className="font-medium text-foreground">superadmin</span> access.{" "}
                <Link to="/superadmin/dashboard" className="text-primary font-medium">
                  Open superadmin panel →
                </Link>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}