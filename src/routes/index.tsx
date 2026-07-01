import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import {
  Building2,
  Receipt,
  ConciergeBell,
  Sparkles,
  ChefHat,
  BarChart3,
  PartyPopper,
  Globe2,
  Check,
  Star,
  ArrowRight,
  Phone,
  Mail,
  Twitter,
  Linkedin,
  Facebook,
} from "lucide-react";

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

const TEAL = "#0F766E";
const TEAL_DARK = "#134E4A";
const TEAL_LIGHT = "#14B8A6";

function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return scrolled;
}

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>("[data-reveal]");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("reveal-in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

function smoothScrollTo(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function Index() {
  const navigate = useNavigate();
  const scrolled = useScrolled();
  useReveal();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  const features = [
    { icon: Building2, title: "Multi-property", desc: "Manage multiple hotels from a single login with isolated data." },
    { icon: Receipt, title: "Billing", desc: "Invoice with category, slabs wise ready made templates." },
    { icon: ConciergeBell, title: "Front Desk", desc: "Check-in, check-out, room shifts and folios with full audit trail." },
    { icon: Sparkles, title: "Housekeeping", desc: "Live room status, dirty/clean/maintenance and task assignments." },
    { icon: ChefHat, title: "Kitchen / KOT", desc: "Dual-print KOTs by station, restaurant credits and settlements." },
    { icon: BarChart3, title: "Reports Suite", desc: "10+ reports — occupancy, revenue, GST, night audit, Tally export." },
    { icon: PartyPopper, title: "Banquet & Events", desc: "Bulk room blocks, event bill sequences and combined invoicing." },
    { icon: Globe2, title: "Channel Ready", desc: "Multi-user, role-based access and OTA-friendly rate management." },
  ];

  const stats = [
    { num: "13+", label: "Modules", sub: "Front desk to reports, all in one" },
    { num: "100%", label: "Invoice Ready", sub: "Invoice at finger tips" },
    { num: "Multi", label: "Property", sub: "Manage multiple hotels, one login" },
    { num: "24/7", label: "Support", sub: "Real help, real fast" },
  ];

  const plans = [
    {
      name: "Starter",
      price: "Contact for pricing",
      features: ["Up to 20 rooms", "Front desk & billing", "GST invoices", "Email support", "Single property"],
      popular: false,
    },
    {
      name: "Professional",
      price: "Most chosen plan",
      features: ["Unlimited rooms", "Kitchen / KOT + Restaurant", "Banquet & events", "Full reports suite", "Priority support"],
      popular: true,
    },
    {
      name: "Enterprise",
      price: "Custom pricing",
      features: ["Multi-property", "Role & permission control", "Custom integrations", "Dedicated onboarding", "24/7 SLA support"],
      popular: false,
    },
  ];

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col antialiased">
      <style>{`
        [data-reveal]{opacity:0;transform:translateY(16px);transition:opacity .7s ease, transform .7s ease}
        [data-reveal].reveal-in{opacity:1;transform:translateY(0)}
        .hp-teal-text{background:linear-gradient(90deg,${TEAL} 0%, ${TEAL_LIGHT} 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
        .hp-mesh{position:absolute;inset:0;overflow:hidden;pointer-events:none}
        .hp-blob{position:absolute;border-radius:9999px;filter:blur(80px);opacity:.35}
        .hp-card-hover{transition:transform .25s ease, box-shadow .25s ease, border-color .25s ease}
        .hp-card-hover:hover{transform:translateY(-4px);box-shadow:0 20px 40px -20px rgba(15,118,110,.25);border-color:${TEAL}}
      `}</style>

      {/* NAVBAR */}
      <header className={`sticky top-0 z-50 bg-white/80 backdrop-blur-md transition-all ${scrolled ? "border-b border-slate-200 shadow-sm" : "border-b border-transparent"}`}>
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <button onClick={() => smoothScrollTo("top")} className="flex items-center gap-2.5">
            <Logo size={32} />
            <span className="font-semibold text-lg tracking-tight">HotelPilot</span>
          </button>
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600">
            <button onClick={() => smoothScrollTo("features")} className="hover:text-slate-900 transition">Features</button>
            <button onClick={() => smoothScrollTo("pricing")} className="hover:text-slate-900 transition">Pricing</button>
            <button onClick={() => smoothScrollTo("footer")} className="hover:text-slate-900 transition">Support</button>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/login">
              <Button variant="outline" className="border-slate-300 hover:border-slate-400">Sign in</Button>
            </Link>
            <Link to="/login">
              <Button style={{ backgroundColor: TEAL }} className="text-white hover:opacity-90 hidden sm:inline-flex">Get Started</Button>
            </Link>
          </div>
        </div>
      </header>

      <main id="top" className="flex-1">
        {/* HERO */}
        <section className="relative overflow-hidden">
          <div className="hp-mesh" aria-hidden>
            <div className="hp-blob" style={{ background: TEAL_LIGHT, width: 500, height: 500, top: -120, left: "-10%" }} />
            <div className="hp-blob" style={{ background: "#5EEAD4", width: 460, height: 460, top: 40, right: "-8%" }} />
            <div className="hp-blob" style={{ background: "#CCFBF1", width: 700, height: 400, bottom: -200, left: "20%", opacity: 0.5 }} />
          </div>
          <div className="relative max-w-6xl mx-auto px-6 pt-20 pb-24 sm:pt-28 sm:pb-32 text-center" data-reveal>
            <span
              className="inline-block text-[11px] font-semibold uppercase tracking-[0.14em] px-3.5 py-1.5 rounded-full border"
              style={{ color: TEAL_DARK, background: "#F0FDFA", borderColor: "#CCFBF1" }}
            >
              Hotel management, simplified
            </span>
            <h1 className="mt-6 text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.05]">
              Run your hotel end to end with{" "}
              <span className="hp-teal-text">HotelPilot</span>.
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-slate-600 max-w-3xl mx-auto leading-relaxed">
              One platform for your front desk, billing, GST invoicing, kitchen, housekeeping and reports — built for independent hotels and small chains.
            </p>
            <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link to="/login">
                <Button size="lg" style={{ backgroundColor: TEAL }} className="text-white hover:opacity-90 h-12 px-7 text-base">
                  Get Started <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
              <a href="tel:8007444464">
                <Button size="lg" variant="outline" className="border-slate-300 hover:border-slate-400 h-12 px-7 text-base">
                  Talk to us
                </Button>
              </a>
            </div>
            <p className="mt-6 text-sm text-slate-500">
              Trusted by hotels across Maharashtra · Multi-property
            </p>
          </div>
        </section>

        {/* STATS */}
        <section className="py-10" style={{ background: "#F0FDFA" }}>
          <div className="max-w-6xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8" data-reveal>
            {stats.map((s) => (
              <div key={s.label} className="text-center md:text-left">
                <div className="text-3xl sm:text-4xl font-bold tracking-tight" style={{ color: TEAL_DARK }}>{s.num}</div>
                <div className="mt-1 text-sm font-semibold text-slate-800">{s.label}</div>
                <div className="text-xs text-slate-500 mt-0.5">{s.sub}</div>
              </div>
            ))}
          </div>
        </section>

        {/* FEATURES */}
        <section id="features" className="py-24 sm:py-32">
          <div className="max-w-6xl mx-auto px-6">
            <div className="max-w-3xl mx-auto text-center" data-reveal>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Everything your front desk, kitchen, and back office need</h2>
              <p className="mt-4 text-slate-600 text-lg">Purpose-built modules that work together — no bolted-on add-ons, no spreadsheets.</p>
            </div>
            <div className="mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5" data-reveal>
              {features.map(({ icon: Icon, title, desc }) => (
                <div key={title} className="hp-card-hover rounded-2xl border border-slate-200 bg-white p-6">
                  <div className="h-11 w-11 rounded-xl flex items-center justify-center" style={{ background: "#F0FDFA", color: TEAL }}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 font-semibold text-lg">{title}</h3>
                  <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="py-24 sm:py-32 bg-slate-50 border-y border-slate-200">
          <div className="max-w-6xl mx-auto px-6">
            <div className="max-w-3xl mx-auto text-center" data-reveal>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">How it works</h2>
              <p className="mt-4 text-slate-600 text-lg">Go from paperwork to a modern PMS in three simple steps.</p>
            </div>
            <div className="mt-16 relative" data-reveal>
              <div className="hidden md:block absolute top-8 left-[15%] right-[15%] border-t-2 border-dashed border-slate-300" aria-hidden />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-10 relative">
                {[
                  { n: 1, t: "Setup your property", d: "Add rooms, tariffs, and staff in minutes with guided onboarding." },
                  { n: 2, t: "Go live", d: "Start taking bookings, generating bills, and pushing KOT orders instantly." },
                  { n: 3, t: "Grow with reports", d: "Track revenue, occupancy, and staff performance with real-time reports." },
                ].map((s) => (
                  <div key={s.n} className="text-center flex flex-col items-center">
                    <div
                      className="h-16 w-16 rounded-full flex items-center justify-center text-white text-xl font-bold shadow-lg"
                      style={{ background: `linear-gradient(135deg, ${TEAL} 0%, ${TEAL_LIGHT} 100%)`, boxShadow: `0 10px 30px -10px ${TEAL}` }}
                    >
                      {s.n}
                    </div>
                    <h3 className="mt-6 font-semibold text-lg">{s.t}</h3>
                    <p className="mt-2 text-slate-600 text-sm max-w-xs">{s.d}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* TESTIMONIAL */}
        <section className="py-24 sm:py-32">
          <div className="max-w-4xl mx-auto px-6 text-center" data-reveal>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Built with real hotels, for real hotels</h2>
            <div className="mt-12 rounded-3xl bg-white border border-slate-200 shadow-xl px-8 py-12 sm:px-14 sm:py-14">
              <div className="flex items-center justify-center gap-1">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="h-5 w-5 fill-amber-400 text-amber-400" />
                ))}
              </div>
              <blockquote className="mt-6 text-xl sm:text-2xl leading-relaxed text-slate-800 font-medium">
                "HotelPilot has simplified our entire front desk and billing operations."
              </blockquote>
              <div className="mt-6">
                <div className="font-semibold text-slate-900">Brij Hotel</div>
                <div className="text-sm text-slate-500">Latur, Maharashtra</div>
              </div>
            </div>
          </div>
        </section>

        {/* PRICING */}
        <section id="pricing" className="py-24 sm:py-32 bg-slate-50 border-y border-slate-200">
          <div className="max-w-6xl mx-auto px-6">
            <div className="max-w-3xl mx-auto text-center" data-reveal>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Simple, transparent pricing</h2>
              <p className="mt-4 text-slate-600 text-lg">Custom plans built around your property size — no hidden fees.</p>
            </div>
            <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch" data-reveal>
              {plans.map((p) => (
                <div
                  key={p.name}
                  className={`relative rounded-2xl bg-white p-8 flex flex-col ${
                    p.popular ? "md:scale-105 md:-my-2 shadow-2xl border-2" : "border border-slate-200 shadow-sm"
                  }`}
                  style={p.popular ? { borderColor: TEAL } : undefined}
                >
                  {p.popular && (
                    <span
                      className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-semibold px-3 py-1 rounded-full text-white"
                      style={{ backgroundColor: TEAL }}
                    >
                      Most Popular
                    </span>
                  )}
                  <h3 className="text-xl font-bold">{p.name}</h3>
                  <div className="mt-2 text-slate-600 text-sm">{p.price}</div>
                  <ul className="mt-6 space-y-3 flex-1">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5 text-sm text-slate-700">
                        <Check className="h-4 w-4 mt-0.5 shrink-0" style={{ color: TEAL }} />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <a href="tel:8007444464" className="mt-8">
                    <Button
                      className="w-full text-white hover:opacity-90"
                      style={{ backgroundColor: p.popular ? TEAL : "#0F172A" }}
                    >
                      Talk to us
                    </Button>
                  </a>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="py-20 sm:py-28">
          <div className="max-w-6xl mx-auto px-6" data-reveal>
            <div
              className="rounded-3xl px-8 py-16 sm:px-16 sm:py-20 text-center relative overflow-hidden"
              style={{ background: `linear-gradient(135deg, ${TEAL_DARK} 0%, ${TEAL} 60%, ${TEAL_LIGHT} 100%)` }}
            >
              <h2 className="text-3xl sm:text-5xl font-bold text-white tracking-tight">Ready to simplify your hotel operations?</h2>
              <p className="mt-4 text-teal-50/90 text-lg max-w-2xl mx-auto">
                Join hotels running their entire operation on HotelPilot — from check-in to GST invoice.
              </p>
              <div className="mt-9 flex flex-col sm:flex-row gap-3 justify-center">
                <Link to="/login">
                  <Button size="lg" className="bg-white hover:bg-white/90 h-12 px-8 text-base font-semibold" style={{ color: TEAL_DARK }}>
                    Get Started <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                </Link>
                <a href="tel:8007444464">
                  <Button size="lg" variant="outline" className="h-12 px-8 text-base bg-transparent border-white/40 text-white hover:bg-white/10">
                    <Phone className="mr-2 h-4 w-4" /> 8007 444 464
                  </Button>
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer id="footer" className="bg-slate-950 text-slate-300">
        <div className="max-w-6xl mx-auto px-6 py-16 grid grid-cols-2 md:grid-cols-4 gap-10">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2.5">
              <Logo size={32} />
              <span className="font-semibold text-white text-lg">HotelPilot</span>
            </div>
            <p className="mt-4 text-sm text-slate-400 leading-relaxed max-w-xs">
              End-to-end hotel management for independent hotels and small chains.
            </p>
          </div>
          <div>
            <div className="text-white font-semibold text-sm mb-4">Product</div>
            <ul className="space-y-2.5 text-sm">
              <li><button onClick={() => smoothScrollTo("features")} className="hover:text-white">Features</button></li>
              <li><button onClick={() => smoothScrollTo("pricing")} className="hover:text-white">Pricing</button></li>
              <li><a href="tel:8007444464" className="hover:text-white">Support</a></li>
            </ul>
          </div>
          <div>
            <div className="text-white font-semibold text-sm mb-4">Company</div>
            <ul className="space-y-2.5 text-sm">
              <li><a href="#" className="hover:text-white">About</a></li>
              <li><a href="mailto:Consult@GrowthStoryCo.in" className="hover:text-white">Contact</a></li>
            </ul>
          </div>
          <div>
            <div className="text-white font-semibold text-sm mb-4">Legal</div>
            <ul className="space-y-2.5 text-sm">
              <li><a href="#" className="hover:text-white">Privacy Policy</a></li>
              <li><a href="#" className="hover:text-white">Terms of Service</a></li>
              <li><a href="#" className="hover:text-white">Refund Policy</a></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-800">
          <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
            <div>© 2026 HotelPilot — A Growth Story Company</div>
            <div className="flex items-center gap-5">
              <a href="tel:8007444464" className="flex items-center gap-1.5 hover:text-white">
                <Phone className="h-3.5 w-3.5" /> 8007 444 464
              </a>
              <a href="mailto:Consult@GrowthStoryCo.in" className="flex items-center gap-1.5 hover:text-white">
                <Mail className="h-3.5 w-3.5" /> Consult@GrowthStoryCo.in
              </a>
              <div className="flex items-center gap-3">
                <a href="#" aria-label="Twitter" className="hover:text-white"><Twitter className="h-4 w-4" /></a>
                <a href="#" aria-label="LinkedIn" className="hover:text-white"><Linkedin className="h-4 w-4" /></a>
                <a href="#" aria-label="Facebook" className="hover:text-white"><Facebook className="h-4 w-4" /></a>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
