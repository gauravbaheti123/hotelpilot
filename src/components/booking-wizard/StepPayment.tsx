// Part 4 — Step 5: advance payment at check-in. Totals come from Step 3's rooms.
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { usePaymentMethods, formatPaymentMethodLabel } from "@/hooks/use-payment-methods";
import { nightsBetween } from "@/lib/front-desk";
import { roomsTotal, type WizardPayment, type WizardRoom } from "@/lib/bookingWizard";
import { inr } from "@/lib/billing";

interface Props {
  propertyId: string;
  rooms: WizardRoom[];
  value: WizardPayment;
  onChange: (patch: Partial<WizardPayment>) => void;
}

export function StepPayment({ propertyId, rooms, value, onChange }: Props) {
  const { methods } = usePaymentMethods(propertyId);
  const total = roomsTotal(rooms);
  const advance = Number(value.advance) || 0;
  const balance = Math.max(0, total - advance);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold">Payment at check-in</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Advance is optional — ₹0 is fine. Taxes and extras are added on the folio.
        </p>
      </div>

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <tbody>
            {rooms.map((r, i) => {
              const n = nightsBetween(r.checkIn, r.checkOut);
              return (
                <tr key={r.key} className="border-b last:border-0">
                  <td className="px-3 py-2 text-muted-foreground">
                    Room {i + 1} — {n} night{n === 1 ? "" : "s"} × {inr(Number(r.rate) || 0)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {inr(n * (Number(r.rate) || 0))}
                  </td>
                </tr>
              );
            })}
            <tr className="bg-muted/40 font-medium">
              <td className="px-3 py-2">Room total</td>
              <td className="px-3 py-2 text-right tabular-nums">{inr(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Advance ₹</Label>
          <Input
            type="number"
            min={0}
            value={value.advance}
            onChange={(e) => onChange({ advance: Math.max(0, Number(e.target.value) || 0) })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Mode of payment</Label>
          <SearchableSelect
            value={value.mode}
            onChange={(mode) => onChange({ mode })}
            options={methods.map((m) => ({ value: m.name, label: formatPaymentMethodLabel(m.name) }))}
            placeholder="Select mode"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Reference no.</Label>
          <Input
            value={value.reference}
            onChange={(e) => onChange({ reference: e.target.value })}
            placeholder="UPI / card / receipt ref"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Balance</Label>
          <Input readOnly value={inr(balance)} className="bg-muted/40 font-medium" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Notes</Label>
          <Textarea
            rows={3}
            value={value.notes}
            onChange={(e) => onChange({ notes: e.target.value })}
            placeholder="Booking notes (internal)"
          />
        </div>
      </div>
    </div>
  );
}
