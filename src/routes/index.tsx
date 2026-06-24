import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "HotelPilot — Hotel Management Platform" },
      { name: "description", content: "HotelPilot is an end-to-end hotel management platform: front desk, rooms, billing, kitchen, housekeeping and reports. Powered by Growth Story Company." },
      { property: "og:title", content: "HotelPilot — Hotel Management Platform" },
      { property: "og:description", content: "End-to-end SaaS for independent hotels and small chains." },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo size={36} />
            <div>
              <div className="font-semibold">HotelPilot</div>
              <div className="text-[10px] text-muted-foreground">Growth Story Company</div>
            </div>
          </div>
          <Link to="/login"><Button>Sign in</Button></Link>
        </div>
      </header>
      <main className="flex-1">
        <section className="max-w-6xl mx-auto px-6 py-20 sm:py-28 grid lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-6">
            <span className="inline-block text-xs font-medium uppercase tracking-wider text-primary bg-primary/10 px-3 py-1 rounded-full">
              Hotel management, simplified
            </span>
            <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">
              Run your hotel end to end with <span className="text-primary">HotelPilot</span>.
            </h1>
            <p className="text-lg text-muted-foreground max-w-xl">
              Front desk, rooms, tariffs, kitchen, billing, housekeeping and
              reports — one clean SaaS for independent hotels and small chains.
            </p>
            <div className="flex gap-3">
              <Link to="/login"><Button size="lg">Get started</Button></Link>
              <a href="tel:8007444464"><Button size="lg" variant="outline">Talk to us</Button></a>
            </div>
            <p className="text-xs text-muted-foreground">Support: 8007444464</p>
          </div>
          <div className="rounded-xl border bg-card p-8 shadow-sm">
            <div className="grid grid-cols-2 gap-4 text-sm">
              {[
                "Multi-property",
                "GST billing",
                "Front desk",
                "Housekeeping",
                "Kitchen / KOT",
                "Reports suite",
                "Banquet",
                "Channel manager",
              ].map((f) => (
                <div key={f} className="rounded-md border bg-background px-4 py-3 font-medium">
                  {f}
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} HotelPilot · Powered by Growth Story Company
      </footer>
    </div>
  );
}
