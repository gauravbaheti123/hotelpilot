// Part 2 of the New Booking rebuild — wizard shell + Step 0 and Step 1.
// Runs in parallel with the legacy front-desk.new route until Part 5 cutover.
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, Printer, Save } from "lucide-react";
import { toast } from "sonner";
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
import { StepAdditionalGuests } from "@/components/booking-wizard/StepAdditionalGuests";
import { StepStayRoom } from "@/components/booking-wizard/StepStayRoom";
import { StepBillTo } from "@/components/booking-wizard/StepBillTo";
import { StepPayment } from "@/components/booking-wizard/StepPayment";
import { StepRemarks } from "@/components/booking-wizard/StepRemarks";
import { StepReview } from "@/components/booking-wizard/StepReview";
import { supabase } from "@/integrations/supabase/client";
import { userDisplayName } from "@/lib/activityLog";
import { submitWizard } from "@/lib/bookingWizardSubmit";
import type { CreateBookingResult } from "@/lib/bookingCreate";
import {
  emptyWizardState, isPristine, isStepValid, isStepSkipped, nextStepIndex, prevStepIndex,
  normalizeWizardState, emptyRoom,
  STEP, WIZARD_DRAFT_KEY, WIZARD_STEPS,
  type WizardGuest, type WizardState, type WizardExtraGuest, type WizardRoom,
  type WizardBillTo, type WizardPayment,
} from "@/lib/bookingWizard";
import { toastError } from "@/lib/errorMessage";

export const Route = createFileRoute("/_authenticated/front-desk/new")({
  validateSearch: (s: Record<string, unknown>) => ({
    roomId: typeof s.roomId === "string" ? s.roomId : undefined,
    categoryId: typeof s.categoryId === "string" ? s.categoryId : undefined,
    checkIn: typeof s.checkIn === "string" ? s.checkIn : undefined,
    checkOut: typeof s.checkOut === "string" ? s.checkOut : undefined,
    // Banquet → front-desk room-block handoff (existing integration point).
    eventId: typeof s.eventId === "string" ? s.eventId : undefined,
    blockId: typeof s.blockId === "string" ? s.blockId : undefined,
    eventName: typeof s.eventName === "string" ? s.eventName : undefined,
  }),
  head: () => ({
    meta: [
      { title: "New Booking | HotelPilot" },
      { name: "description", content: "Step-by-step new booking flow for front desk check-ins and reservations." },
      { property: "og:title", content: "New Booking | HotelPilot" },
      { property: "og:description", content: "Step-by-step new booking flow for front desk check-ins and reservations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NewBookingWizardPage,
});

function Stepper({ step, skipped }: { step: number; skipped: (i: number) => boolean }) {
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
              skipped(i) && "opacity-40 line-through",
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
  const search = Route.useSearch();
  const { roles, user } = useAuth();
  const canBook = roles.some((r) => ["superadmin", "owner", "manager", "receptionist"].includes(r));
  const { current, loading: propLoading } = useCurrentProperty();

  const draft = useFormDraft<WizardState>(WIZARD_DRAFT_KEY);
  const [state, setState] = useState<WizardState>(() => emptyWizardState());
  const [step, setStep] = useState(0);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [stepBlocked, setStepBlocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<CreateBookingResult | null>(null);
  const [catNames, setCatNames] = useState<Record<string, string>>({});
  const [roomNames, setRoomNames] = useState<Record<string, string>>({});
  const resumeChecked = useRef(false);
  const prefilled = useRef(false);

  // Offer to resume an existing draft, once on mount.
  useEffect(() => {
    if (resumeChecked.current) return;
    resumeChecked.current = true;
    try {
      const saved = normalizeWizardState(draft.load());
      if (saved && !isPristine(saved)) setResumeOpen(true);
    } catch {
      // A corrupt/legacy draft must never block the wizard from rendering.
      draft.clear();
    }
  }, [draft]);

  // Debounced autosave.
  useEffect(() => {
    if (isPristine(state)) return;
    draft.save(state);
  }, [state, draft]);

  const patchGuest = useCallback((patch: Partial<WizardGuest>) => {
    setState((s) => ({ ...s, guest: { ...s.guest, ...patch } }));
  }, []);

  const setExtraGuests = useCallback((extraGuests: WizardExtraGuest[]) => {
    setState((s) => ({ ...s, extraGuests }));
  }, []);
  const setCounts = useCallback((p: { adults?: number; children?: number }) => {
    setState((s) => ({ ...s, ...p }));
  }, []);
  const setRooms = useCallback((rooms: WizardRoom[]) => {
    setState((s) => ({ ...s, rooms }));
  }, []);
  const setMeta = useCallback((p: { source?: string; otaPartnerName?: string }) => {
    setState((s) => ({ ...s, ...p }));
  }, []);
  const patchBillTo = useCallback((patch: Partial<WizardBillTo>) => {
    setState((s) => ({ ...s, billTo: { ...s.billTo, ...patch } }));
  }, []);
  const patchPayment = useCallback((patch: Partial<WizardPayment>) => {
    setState((s) => ({ ...s, payment: { ...s.payment, ...patch } }));
  }, []);

  // Label lookups for the read-only Review step.
  useEffect(() => {
    if (!current?.id) return;
    let cancelled = false;
    (async () => {
      const [c, r] = await Promise.all([
        supabase.from("room_categories").select("id,name").eq("property_id", current.id),
        supabase.from("rooms").select("id,room_number").eq("property_id", current.id),
      ]);
      if (cancelled) return;
      setCatNames(Object.fromEntries(((c.data ?? []) as any[]).map((x) => [x.id, x.name])));
      setRoomNames(Object.fromEntries(((r.data ?? []) as any[]).map((x) => [x.id, x.room_number])));
    })();
    return () => { cancelled = true; };
  }, [current?.id]);

  // Entry-context prefill (?roomId=…&categoryId=…&checkIn=…&checkOut=…).
  // Values stay changeable — they only seed the first room line.
  useEffect(() => {
    if (prefilled.current) return;
    if (!search?.roomId && !search?.categoryId && !search?.checkIn) return;
    prefilled.current = true;
    try {
      setState((s) => {
        const existing = Array.isArray(s.rooms) && s.rooms.length > 0 ? s.rooms : [emptyRoom()];
        const [first, ...rest] = existing;
        return {
          ...s,
          rooms: [
            {
              ...first,
              categoryId: search.categoryId ?? first.categoryId,
              roomId: search.roomId ?? first.roomId,
              checkIn: search.checkIn ?? first.checkIn,
              checkOut: search.checkOut ?? first.checkOut,
            },
            ...rest,
          ],
        };
      });
    } catch {
      // Prefill is a convenience — never let it take the page down.
    }
  }, [search?.roomId, search?.categoryId, search?.checkIn, search?.checkOut]);

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
  const onReview = step === STEP.REVIEW;

  async function handleSubmit(checkInNow: boolean) {
    if (!current) return;
    if (checkInNow && state.rooms.some((r) => r.assignLater || !r.roomId)) {
      toast.error("Assign a room before checking in — a room is required to check in a guest");
      return;
    }
    setSaving(true);
    try {
      const res = await submitWizard({
        propertyId: current.id,
        state,
        checkInNow,
        actorName: userDisplayName(user as never),
        event: {
          eventId: search?.eventId ?? null,
          blockId: search?.blockId ?? null,
          eventName: search?.eventName ?? null,
        },
      });
      draft.clear();
      setSaved(res);
      toast.success(`Booking ${res.booking_number ?? ""} created`);
    } catch (e: any) {
      // Draft is deliberately kept on failure so nothing typed is lost.
      toastError(e, "Failed to save booking");
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <AppShell title="New Booking">
        <Card className="mx-auto max-w-xl">
          <CardHeader>
            <CardTitle>Booking {saved.booking_number ?? ""} created</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {state.guest.name} · {state.rooms.length} room{state.rooms.length === 1 ? "" : "s"}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() =>
                  router.navigate({ to: "/bookings/$bookingId/grc", params: { bookingId: saved.booking_id } })
                }
              >
                <Printer className="mr-2 h-4 w-4" /> Print GRC
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  router.navigate({ to: "/front-desk/booking/$id", params: { id: saved.booking_id } })
                }
              >
                Open booking
              </Button>
              <Button variant="ghost" onClick={() => router.navigate({ to: "/dashboard" })}>
                Back to dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

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
          <Stepper step={step} skipped={(i) => isStepSkipped(i, state)} />
        </CardHeader>
        <CardContent className="space-y-8">
          {step === STEP.TYPE && (
            <StepBookingType
              kind={state.kind}
              reservation={state.reservation}
              onKindChange={(kind) => setState((s) => ({ ...s, kind }))}
              onReservationChange={(reservation) => setState((s) => ({ ...s, reservation }))}
            />
          )}

          {step === STEP.GUEST && (
            <StepGuestDetails propertyId={current.id} guest={state.guest} onChange={patchGuest} />
          )}

          {step === STEP.EXTRA_GUESTS && (
            <StepAdditionalGuests
              propertyId={current.id}
              adults={state.adults}
              children={state.children}
              guests={state.extraGuests}
              onCountsChange={setCounts}
              onGuestsChange={setExtraGuests}
            />
          )}

          {step === STEP.STAY && (
            <StepStayRoom
              propertyId={current.id}
              reservation={state.reservation}
              rooms={state.rooms}
              source={state.source}
              otaPartnerName={state.otaPartnerName}
              onRoomsChange={setRooms}
              onMetaChange={setMeta}
              onBlockedChange={setStepBlocked}
            />
          )}

          {step === STEP.BILL_TO && (
            <StepBillTo propertyId={current.id} value={state.billTo} onChange={patchBillTo} />
          )}

          {step === STEP.PAYMENT && (
            <StepPayment
              propertyId={current.id}
              rooms={state.rooms}
              value={state.payment}
              onChange={patchPayment}
            />
          )}

          {step === STEP.REMARKS && (
            <StepRemarks
              value={state.customRemark}
              onChange={(customRemark) => setState((s) => ({ ...s, customRemark }))}
            />
          )}

          {step === STEP.REVIEW && (
            <StepReview
              state={state}
              categoryName={(id) => catNames[id] ?? "Category"}
              roomLabel={(id) => (roomNames[id] ? `Room ${roomNames[id]}` : "Room")}
              onEdit={setStep}
            />
          )}

          <div className="flex items-center justify-between border-t pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() =>
                step === 0
                  ? (dirty ? setExitOpen(true) : router.history.back())
                  : setStep((s) => prevStepIndex(s, state))
              }
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              {step === 0 ? "Cancel" : "Back"}
            </Button>
            {onReview ? (
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" disabled={saving} onClick={() => handleSubmit(false)}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save as reservation
                </Button>
                <Button type="button" disabled={saving} onClick={() => handleSubmit(true)}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save &amp; check-in now
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                disabled={!stepValid || banquetBlocked || (step === STEP.STAY && stepBlocked)}
                onClick={() => setStep((s) => nextStepIndex(s, state))}
              >
                Next
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
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
                const saved = normalizeWizardState(draft.load());
                if (saved) setState(saved);
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