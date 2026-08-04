import { createFileRoute, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LogOut, ShieldAlert, Mail } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/access-denied")({
  head: () => ({
    meta: [
      { title: "Access Denied — HotelPilot" },
      {
        name: "description",
        content:
          "Your HotelPilot account has no module permissions assigned yet. Contact your administrator to request access.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Access Denied — HotelPilot" },
      {
        property: "og:description",
        content:
          "Your HotelPilot account has no module permissions assigned yet. Contact your administrator to request access.",
      },
    ],
  }),
  component: AccessDeniedPage,
});

const SUPPORT_EMAIL = "Consult@Growthstoryco.in";

function AccessDeniedPage() {
  const router = useRouter();

  async function handleSignOut() {
    localStorage.removeItem("hp.currentPropertyId");
    await supabase.auth.signOut();
    toast.success("Signed out");
    router.navigate({ to: "/login", replace: true });
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="max-w-md w-full">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            <CardTitle>Access Denied</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            Your account is signed in, but no module permissions have been
            assigned to it yet — so there is no screen available for you to open.
          </p>
          <p>
            Contact your administrator to get access. If you need help, reach
            our support team:
          </p>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline"
          >
            <Mail className="h-4 w-4" /> {SUPPORT_EMAIL}
          </a>
          <div className="pt-2">
            <Button variant="outline" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" /> Sign Out
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}