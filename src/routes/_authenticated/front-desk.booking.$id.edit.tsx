// Booking edit — a trimmed wizard for the fields that are safe to change after
// a booking exists: guest details, additional guests, Bill To, the custom
// remark, and (Phase 2) stay dates, room and tariff.
//
// Stay & Room changes are not written here: they are replayed through the same
// "Shift room" / "Modify dates" operations the booking page uses.
// Taxes and payments remain out of scope.
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RequirePermission } from "@/components/RequirePermission";
import { StepGuestDetails } from "@/components/booking-wizard/StepGuestDetails";
import { StepAdditionalGuests } from "@/components/booking-wizard/StepAdditionalGuests";
import { StepBillTo } from "@/components/booking-wizard/StepBillTo";
import { StepRemarks } from "@/components/booking-wizard/StepRemarks";
import { StepEditStayRoom } from "@/components/booking-wizard/StepEditStayRoom";
import { StepEditReview } from "@/components/booking-wizard/StepEditReview";
import { useAuth } from "@/hooks/use-auth";
import { userDisplayName } from "@/lib/activityLog";
import { isValidMobile } from "@/lib/mobile";
import { isValidOrEmptyGSTIN } from "@/lib/gstin";
import {
  isBookingEditable, loadBookingForEdit, saveBookingEdit, saveStayEdits,
  type BookingEditState, type StayEdit,
} from "@/lib/bookingEdit";
import { toastError } from "@/lib/errorMessage";
import type { WizardBillTo, WizardExtraGuest, WizardGuest } from "@/lib/bookingWizard";

export const Route = createFileRoute("/_authenticated/front-desk/booking/$id/edit")({
  head: () => ({ meta: [{ title: "Edit Booking — HotelPilot" }] }),
  component: () => (
    <RequirePermission module="bookings" action="edit">
      <EditBookingPage />
    </RequirePermission>
  ),
});

const STEPS = ["Guest Details", "Additional Guests", "Stay & Room", "Bill To", "Remarks", "Review"];

function stepValid(step: number, s: BookingEditState, stayBlocked: boolean): boolean {
  if (step === 0) return s.guest.name.trim().length > 0 && isValidMobile(s.guest.mobile);
  if (step === 1) {
    if (s.adults < 1) return false;
    return s.extraGuests.every(
      (g) => g.name.trim().length > 0 && (g.mobile.length === 0 || isValidMobile(g.mobile)),
    );
  }
  if (step === 2) return !stayBlocked;
  if (step === 3) {
    if (!s.billTo.enabled) return true;
    if (s.billTo.companyId) return true;
    return s.billTo.name.trim().length > 0 && isValidOrEmptyGSTIN(s.billTo.gstin);
  }
  return true;
}

function EditBookingPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const { user } = useAuth();
  const [state, setState] = useState<BookingEditState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [stayBlocked, setStayBlocked] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const s = await loadBookingForEdit(id);
        if (!alive) return;
        if (!s) setError("This booking could not be found.");
        else if (!isBookingEditable(s.status)) {
          setError("This booking can no longer be edited.");
          setState(s);
        } else setState(s);
      } catch {
        if (alive) setError("This booking could not be loaded.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  function patch(p: Partial<BookingEditState>) {
    setState((s) => (s ? { ...s, ...p } : s));
  }
  function patchGuest(p: Partial<WizardGuest>) {
    setState((s) => (s ? { ...s, guest: { ...s.guest, ...p } } : s));
  }
  function patchBillTo(p: Partial<WizardBillTo>) {
    setState((s) => (s ? { ...s, billTo: { ...s.billTo, ...p } } : s));
  }
  function setExtraGuests(next: WizardExtraGuest[]) {
    setState((s) => (s ? { ...s, extraGuests: next } : s));
  }
  function patchStay(p: Partial<StayEdit>) {
    setState((s) => (s ? { ...s, stay: { ...s.stay, ...p } } : s));
  }
  const handleStayBlocked = useCallback((b: boolean) => setStayBlocked(b), []);

  async function handleSave() {
    if (!state) return;
    setSaving(true);
    try {
      await saveBookingEdit(state, userDisplayName(user));
      // Stay & Room replays the existing shift / date operations. Any blocking
      // condition they raise (unsettled bill, night-audit lock, room overlap,
      // missing permission) surfaces here with its original message.
      await saveStayEdits(state, user?.id ?? null);
      toast.success("Booking updated");
      router.navigate({ to: "/front-desk/booking/$id", params: { id } });
    } catch (e) {
      toastError(e, "updating the booking");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <AppShell title="Edit booking"><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  }
  if (error || !state) {
    return (
      <AppShell title="Edit booking">
        <div className="max-w-2xl space-y-4">
          <BackButton fallbackTo="/front-desk/bookings" />
          <p className="text-sm text-muted-foreground">{error ?? "This booking could not be loaded."}</p>
        </div>
      </AppShell>
    );
  }

  const valid = stepValid(step, state, stayBlocked);
  const last = step === STEPS.length - 1;

  return (
    <AppShell title={`Edit booking ${state.bookingNumber}`}>
      <div className="max-w-4xl space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <BackButton fallbackTo="/front-desk/bookings" />
          <p className="text-sm text-muted-foreground">
            Guest details, stay dates, room, tariff, Bill To and remarks. Taxes and payments are
            still changed from the booking page.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Step {step + 1} of {STEPS.length} — {STEPS[step]}
            </CardTitle>
            <div className="mt-3 flex gap-1.5">
              {STEPS.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setStep(i)}
                  className={`h-1.5 flex-1 rounded-full transition-colors ${
                    i <= step ? "bg-primary" : "bg-muted"
                  }`}
                  aria-label={label}
                />
              ))}
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {step === 0 && (
              <StepGuestDetails
                propertyId={state.propertyId}
                guest={state.guest}
                onChange={patchGuest}
              />
            )}

            {step === 1 && (
              <StepAdditionalGuests
                propertyId={state.propertyId}
                adults={state.adults}
                children={state.children}
                guests={state.extraGuests}
                onCountsChange={(p) => patch(p)}
                onGuestsChange={setExtraGuests}
              />
            )}

            {step === 2 && (
              <StepEditStayRoom
                propertyId={state.propertyId}
                status={state.status}
                stay={state.stay}
                onChange={patchStay}
                onBlockedChange={handleStayBlocked}
              />
            )}

            {step === 3 && (
              <StepBillTo propertyId={state.propertyId} value={state.billTo} onChange={patchBillTo} />
            )}

            {step === 4 && (
              <StepRemarks value={state.customRemark} onChange={(customRemark) => patch({ customRemark })} />
            )}

            {step === 5 && <StepEditReview state={state} />}

            <div className="flex items-center justify-between border-t pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() =>
                  step === 0
                    ? router.navigate({ to: "/front-desk/booking/$id", params: { id } })
                    : setStep((s) => s - 1)
                }
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                {step === 0 ? "Cancel" : "Back"}
              </Button>
              {last ? (
                <Button type="button" disabled={saving || !valid} onClick={handleSave}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save changes
                </Button>
              ) : (
                <Button type="button" disabled={!valid} onClick={() => setStep((s) => s + 1)}>
                  Next
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
