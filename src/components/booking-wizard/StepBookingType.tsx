// Part 2 — Step 0: booking type + reservation flag.
import { PartyPopper } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { BookingKind } from "@/lib/bookingWizard";

interface Props {
  kind: BookingKind;
  reservation: boolean;
  onKindChange: (k: BookingKind) => void;
  onReservationChange: (v: boolean) => void;
}

export function StepBookingType({ kind, reservation, onKindChange, onReservationChange }: Props) {
  return (
    <div className="space-y-6">
      <div className="grid gap-2 sm:max-w-sm">
        <Label>Booking Type</Label>
        <SearchableSelect
          value={kind}
          onChange={(v) => onKindChange(v as BookingKind)}
          options={[
            { value: "lodge", label: "Lodge", hint: "Rooms" },
            { value: "banquet", label: "Banquet", hint: "Halls & events" },
          ]}
          placeholder="Select booking type"
          alwaysShowSearch
          searchPlaceholder="Type to filter…"
        />
      </div>

      {kind === "lodge" ? (
        <div className="flex items-start gap-3 rounded-md border p-3 sm:max-w-sm">
          <Checkbox
            id="wizard-reservation"
            checked={reservation}
            onCheckedChange={(c) => onReservationChange(c === true)}
          />
          <div className="space-y-1">
            <Label htmlFor="wizard-reservation" className="cursor-pointer">Reservation</Label>
            <p className="text-xs text-muted-foreground">
              Future booking — no immediate check-in.
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-md border bg-muted/40 p-4 sm:max-w-lg">
          <div className="flex items-center gap-2 text-sm font-medium">
            <PartyPopper className="h-4 w-4" />
            Banquet event
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            The next steps collect the host, the event details (hall, timing, pricing, extra
            charges and any rooms to assign), billing and advance payment.
          </p>
        </div>
      )}
    </div>
  );
}