// Part 2 of the New Booking rebuild — wizard shell + Step 0 and Step 1.
// Runs in parallel with the legacy front-desk.new route until Part 5 cutover.
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Save } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentProperty } from "@/hooks/use-property";
import { useFormDraft } from "@/hooks/use-form-draft";
import { StepBookingType } from "@/components/booking-wizard/StepBookingType";
import { StepGuestDetails } from "@/components/booking-wizard/StepGuestDetails";
import {
  emptyWizardState, isPristine, isStepValid, WIZARD_DRAFT_KEY, WIZARD_STEPS,
  type WizardGuest, type WizardState,
} from "@/lib/bookingWizard";

export const Route = createFileRoute("/_authenticated/front-desk/new-wizard")({
  head: () => ({
    meta: [
      { title: "New Booking Wizard | HotelPilot" },
      { name: "description", content: "Step-by-step new booking flow for front desk check-ins and reservations." },
      { property: "og:title", content: "New Booking Wizard | HotelPilot" },
      { property: "og:description", content: "Step-by-step new booking flow for front desk check-ins and reservations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NewBookingWizardPage,
});

function Stepper({ step }: { step: number }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        Step {step + 1} of {WIZARD_STEPS.length} — {WIZARD_STEPS[step]}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {WIZARD_STEPS.map((label, i) => (
          <div
            key={label}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]",
              i < step && "border-primary/40 bg-primary/10 text-primary",
              i === step && "border-primary bg-primary text-primary-foreground",
              i > step && "text-muted-foreground",
            )}
          >
            {i < step ? <Check className="h-3 w-3" /> : <span className="font-semibold">{i + 1}</span>}
            <span className="hidden sm:inline">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewBookingWizardPage() {
  const router = useRouter();
  const { roles } = useAuth();
  const canBook = roles.some((r) => ["superadmin", "owner", "manager", "receptionist"].includes(r));
  const { current, loading: propLoading } = useCurrentProperty();

  const draft = useFormDraft<WizardState>(WIZARD_DRAFT_KEY);
  const [state, setState] = useState<WizardState>(() => emptyWizardState());
  const [step, setStep] = useState(0);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const resumeChecked = useRef(false);

  // Offer to resume an existing draft, once on mount.
  useEffect(() => {
    if (resumeChecked.current) return;
    resumeChecked.current = true;
    const saved = draft.load();
    if (saved && !isPristine(saved)) setResumeOpen(true);
  }, [draft]);

  // Debounced autosave.
  useEffect(() => {
    if (isPristine(state)) return;
    draft.save(state);
  }, [state, draft]);

  const patchGuest = useCallback((patch: Partial<WizardGuest>) => {
    setState((s) => ({ ...s, guest: { ...s.guest, ...patch } }));
  }, []);

  const dirty = !isPristine(state);

  const leave = useCallback(() => {
    draft.clear();
    router.history.back();
  }, [draft, router]);

  // ESC exits the wizard, confirming first when there is unsaved progress.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("[role=dialog]") || t.closest("[cmdk-root]"))) return;
      e.preventDefault();
      if (dirty) setExitOpen(true);
      else router.history.back();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, router]);

  if (propLoading) return <AppShell title="New Booking"><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (!current) return <AppShell title="New Booking"><EmptyPropertyState /></AppShell>;
  if (!canBook) {
    return (
      <AppShell title="New Booking">
        <p className="text-sm text-muted-foreground">You don't have permission to create bookings.</p>
      </AppShell>
    );
  }

  const stepValid = isStepValid(step, state);
  const banquetBlocked = step === 0 && state.kind === "banquet";

  return (
    <AppShell title="New Booking">
      <Card className="mx-auto max-w-4xl">
        <CardHeader className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <CardTitle>New Booking</CardTitle>
            {draft.savedAt && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Save className="h-3 w-3" /> Draft saved
              </span>
            )}
          </div>
          <Stepper step={step} />
        </CardHeader>
        <CardContent className="space-y-8">
          {step === 0 && (
            <StepBookingType
              kind={state.kind}
              reservation={state.reservation}
              onKindChange={(kind) => setState((s) => ({ ...s, kind }))}
              onReservationChange={(reservation) => setState((s) => ({ ...s, reservation }))}
            />
          )}

          {step === 1 && (
            <StepGuestDetails propertyId={current.id} guest={state.guest} onChange={patchGuest} />
          )}

          {step >= 2 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Step {step + 1} coming in the next update.
            </p>
          )}

          <div className="flex items-center justify-between border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => (step === 0 ? (dirty ? setExitOpen(true) : router.history.back()) : setStep((s) => s - 1))}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              {step === 0 ? "Cancel" : "Back"}
            </Button>
            <Button
              type="button"
              disabled={!stepValid || banquetBlocked || step >= WIZARD_STEPS.length - 1}
              onClick={() => setStep((s) => Math.min(s + 1, WIZARD_STEPS.length - 1))}
            >
              Next
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={resumeOpen} onOpenChange={setResumeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resume previous booking?</AlertDialogTitle>
            <AlertDialogDescription>
              An unfinished booking draft was found on this device. Resume where you left off, or start fresh.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { draft.clear(); setState(emptyWizardState()); setStep(0); }}>
              Start fresh
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const saved = draft.load();
                if (saved) setState({ ...emptyWizardState(), ...saved, guest: { ...emptyWizardState().guest, ...saved.guest } });
              }}
            >
              Resume
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={exitOpen} onOpenChange={setExitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this booking?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved progress. Leaving now deletes the saved draft.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={leave}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}