import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ArrowLeft, Mail, Phone } from "lucide-react";
import { Logo } from "@/components/Logo";

export function LegalPage({
  title,
  updated = "1st July 2026",
  children,
}: {
  title: string;
  updated?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white text-slate-800">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <Logo />
            <span className="font-semibold text-slate-900">HotelPilot</span>
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-teal-700"
          >
            <ArrowLeft className="h-4 w-4" /> Back to home
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12 md:py-16">
        <div className="mb-10">
          <div className="inline-block text-xs font-semibold tracking-wider text-teal-700 uppercase mb-3">
            Legal
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">
            {title}
          </h1>
          <p className="mt-3 text-sm text-slate-500">Effective Date: {updated}</p>
        </div>

        <article className="legal-prose text-[15px] leading-7 text-slate-700 space-y-6">
          {children}
        </article>

        <div className="mt-16 border-t border-slate-200 pt-8 text-sm text-slate-500">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>© 2026 HotelPilot — A Growth Story Company</div>
            <div className="flex flex-wrap items-center gap-5">
              <a href="tel:8007444464" className="flex items-center gap-1.5 hover:text-teal-700">
                <Phone className="h-3.5 w-3.5" /> 8007 444 464
              </a>
              <a
                href="mailto:Consult@GrowthStoryCo.in"
                className="flex items-center gap-1.5 hover:text-teal-700"
              >
                <Mail className="h-3.5 w-3.5" /> Consult@GrowthStoryCo.in
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg md:text-xl font-semibold text-slate-900 mt-8 mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function LegalContact() {
  return (
    <LegalSection title="Contact Us">
      <p>
        <strong>Growth Story Company</strong>
        <br />
        Office No. 2, Second Floor, Opposite Zudio Clothing, Hatte Corner, Ganj Golai, Latur - 413512,
        Maharashtra, India
      </p>
      <p>
        Email:{" "}
        <a className="text-teal-700 hover:underline" href="mailto:Consult@Growthstoryco.in">
          Consult@Growthstoryco.in
        </a>
        <br />
        Phone:{" "}
        <a className="text-teal-700 hover:underline" href="tel:8007444464">
          8007444464
        </a>
      </p>
    </LegalSection>
  );
}