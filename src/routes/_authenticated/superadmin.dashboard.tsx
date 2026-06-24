import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_authenticated/superadmin/dashboard")({
  head: () => ({ meta: [{ title: "Superadmin — HotelPilot" }] }),
  component: SuperadminPage,
});

function SuperadminPage() {
  const { roles, loading } = useAuth();
  const [counts, setCounts] = useState({ properties: 0, users: 0 });

  useEffect(() => {
    if (!roles.includes("superadmin")) return;
    (async () => {
      const [p, u] = await Promise.all([
        supabase.from("properties").select("id", { count: "exact", head: true }),
        supabase.from("profiles").select("id", { count: "exact", head: true }),
      ]);
      setCounts({ properties: p.count ?? 0, users: u.count ?? 0 });
    })();
  }, [roles]);

  if (loading) {
    return <AppShell title="Superadmin"><div className="text-muted-foreground">Loading…</div></AppShell>;
  }

  if (!roles.includes("superadmin")) {
    return (
      <AppShell title="Superadmin">
        <Card className="max-w-md">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              <CardTitle>Access denied</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            You need the superadmin role to view this page.
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell title="Superadmin">
      <div className="max-w-5xl space-y-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Platform overview</h2>
          <p className="text-sm text-muted-foreground">
            Top-level controls for all HotelPilot tenants.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Properties</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-semibold">{counts.properties}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Users</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-semibold">{counts.users}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Modules enabled</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-semibold">Phase 1</div></CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader><CardTitle>Next up</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>Tenant provisioning, module toggles, subscription management and platform-wide analytics arrive with later phases.</p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}