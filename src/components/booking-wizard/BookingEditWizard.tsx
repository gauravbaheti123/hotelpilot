// Booking edit wizard — the step-based editor for the fields that are safe to
// change after a booking exists: guest details, additional guests, stay dates /
// room / tariff (Phase 2), Bill To and the custom remark.
//
// Extracted from the standalone /front-desk/booking/$id/edit route so the
// unified booking page can host the very same wizard inline (Phase 3). Saving
// still goes through saveBookingEdit() + saveStayEdits(); nothing new is
// written here.
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StepGuestDetails } from "@/components/booking-wizard/StepGuestDetails";
import { StepAdditionalGuests } from "@/components/booking-wizard/StepAdditionalGuests";
import { StepBillTo } from "@/components/booking-wizard/StepBillTo";
import { StepRemarks } from "@/components/booking-wizard/StepRemarks";
import { StepEditStayRoom } from "@/components/booking-wizard/StepEditStayRoom";
import { StepEditReview } from "@/components/booking-wizard/StepEditReview";
import { useAuth } from "@/hooks/use-auth";
import { useBackIntent } from "@/hooks/use-back-intent";
import { userDisplayName } from "@/lib/activityLog";
import { isValidMobile } from "@/lib/mobile";
import { isValidOrEmptyGSTIN } from "@/lib/gstin";
import {
  isBookingEditable, loadBookingForEdit, saveBookingEdit, saveStayEdits,
  type BookingEditState, type StayEdit,
} from "@/lib/bookingEdit";
import { toastError } from "@/lib/errorMessage";
import type { WizardBillTo, WizardExtraGuest, WizardGuest } from "@/lib/bookingWizard";

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

interface Props {
  bookingId: string;
  /** Called after a successful save (the caller reloads and leaves edit mode). */
  onSaved: () => void;
  /** Called when the user backs out of step 1 / cancels. */
  onCancel: () => void;
}

export function BookingEditWizard({ bookingId, onSaved, onCancel }: Props) {
  const { user } = useAuth();
  const [state, setState] = useState<BookingEditState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [stayBlocked, setStayBlocked] = useState(false);

  // Android back steps through the wizard instead of leaving the booking.
  useBackIntent(step > 0, () => {
    setStep((s) => s - 1);
    return true;
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const s = await loadBookingForEdit(bookingId);
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
  }, [bookingId]);

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
      await saveStayEdits(state, user?.id ?? null, userDisplayName(user));
      toast.success("Booking updated");
      onSaved();
    } catch (e) {
      toastError(e, "updating the booking");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !state) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{error ?? "This booking could not be loaded."}</p>
        <Button type="button" variant="outline" onClick={onCancel}>Back</Button>
      </div>
    );
  }

  const valid = stepValid(step, state, stayBlocked);
  const last = step === STEPS.length - 1;

  return (
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
              className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-muted"}`}
              aria-label={label}
            />
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {step === 0 && (
          <StepGuestDetails propertyId={state.propertyId} guest={state.guest} onChange={patchGuest} />
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
            bookingId={state.bookingId}
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
          <div className="space-y-6">
            <StepRemarks value={state.customRemark} onChange={(customRemark) => patch({ customRemark })} />
            <div className="border-t pt-4">
              <h3 className="mb-3 text-sm font-semibold">Booking source</h3>
              <BookingSourceFields
                source={state.source}
                detail={state.otaPartnerName}
                onChange={(p) =>
                  patch({
                    ...(p.source !== undefined ? { source: p.source } : {}),
                    ...(p.otaPartnerName !== undefined ? { otaPartnerName: p.otaPartnerName } : {}),
                  })
                }
              />
            </div>
          </div>
        )}

        {step === 5 && <StepEditReview state={state} />}

        <div className="sticky bottom-0 z-10 -mx-6 flex flex-col-reverse gap-2 border-t bg-background/95 px-6 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:static sm:mx-0 sm:flex-row sm:items-center sm:justify-between sm:bg-transparent sm:px-0 sm:pt-4 sm:pb-0 sm:backdrop-blur-none">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            disabled={saving}
            onClick={() => (step === 0 ? onCancel() : setStep((s) => s - 1))}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {step === 0 ? "Cancel" : "Back"}
          </Button>
          {last ? (
            <Button type="button" className="w-full sm:w-auto" disabled={saving || !valid} onClick={handleSave}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save changes
            </Button>
          ) : (
            <Button type="button" className="w-full sm:w-auto" disabled={!valid} onClick={() => setStep((s) => s + 1)}>
              Next
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
