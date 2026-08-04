// Banquet Step 3 — event window, pricing, extra charges and room blocks.
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { FUNCTION_TYPES } from "@/lib/banquet";
import { useRooms, useTariffPlans } from "@/hooks/use-rooms";
import { useDiscountLimit } from "@/hooks/use-discount-limit";
import { describeLimit } from "@/lib/discountLimit";
import { EventRoomBlocks } from "@/components/booking-wizard/EventRoomBlocks";
import { eventExtrasTotal, emptyEventExtra, type WizardEvent } from "@/lib/bookingWizard";
import type { RoomOption } from "@/lib/eventRoomsForm";

interface Props {
  propertyId: string;
  value: WizardEvent;
  onChange: (patch: Partial<WizardEvent>) => void;
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`space-y-1.5 ${wide ? "sm:col-span-3" : ""}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

export function StepEventDetails({ propertyId, value, onChange }: Props) {
  const { plans } = useTariffPlans(propertyId);
  const { rooms: sharedRooms } = useRooms(propertyId);
  const { limit } = useDiscountLimit();

  const { data: halls = [] } = useQuery({
    queryKey: ["halls", propertyId],
    enabled: !!propertyId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("halls")
        .select("id,name,capacity")
        .eq("property_id", propertyId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; capacity: number }[];
    },
  });

  const vacantRooms: RoomOption[] = sharedRooms
    .filter((r) => r.status === "vacant")
    .map((r) => ({
      id: r.id,
      room_number: r.room_number,
      category_id: r.category_id,
      category_name: r.category_name,
    }));

  const extrasTotal = eventExtrasTotal(value);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold">Event</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Hall, timing and pricing for this function. Events may run past midnight.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Hall (optional)">
          <Select value={value.hallId} onValueChange={(hallId) => onChange({ hallId })}>
            <SelectTrigger>
              <SelectValue placeholder="Pick hall" />
            </SelectTrigger>
            <SelectContent>
              {halls.length === 0 && (
                <div className="px-2 py-1 text-xs text-muted-foreground">Add halls in Masters first.</div>
              )}
              {halls.map((h) => (
                <SelectItem key={h.id} value={h.id}>
                  {h.name} · cap {h.capacity}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Function type">
          <Select value={value.functionType} onValueChange={(functionType) => onChange({ functionType })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FUNCTION_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Pax">
          <Input type="number" value={value.pax} onChange={(e) => onChange({ pax: e.target.value })} />
        </Field>
      </div>

      <div className="grid items-start gap-3 sm:grid-cols-2">
        <Field label="Check-in Date *">
          <div className="flex gap-2">
            <Input
              type="date"
              value={value.eventDate}
              onChange={(e) => {
                const v = e.target.value;
                onChange({
                  eventDate: v,
                  ...(!value.eventEndDate || value.eventEndDate < v ? { eventEndDate: v } : {}),
                });
              }}
            />
            <Input
              type="time"
              className="w-32"
              value={value.startTime}
              onChange={(e) => onChange({ startTime: e.target.value })}
            />
          </div>
        </Field>
        <Field label="Check-out Date *">
          <div className="flex gap-2">
            <Input
              type="date"
              value={value.eventEndDate}
              min={value.eventDate}
              onChange={(e) => onChange({ eventEndDate: e.target.value })}
            />
            <Input
              type="time"
              className="w-32"
              value={value.endTime}
              onChange={(e) => onChange({ endTime: e.target.value })}
            />
          </div>
        </Field>
      </div>

      <div className="space-y-3 border-t pt-6">
        <h3 className="text-sm font-semibold">Charges</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Event Price (₹)">
            <Input
              type="number"
              value={value.eventPrice}
              onChange={(e) => onChange({ eventPrice: e.target.value })}
            />
          </Field>
          <Field label="Discount (₹)">
            <Input
              type="number"
              value={value.discount}
              onChange={(e) => onChange({ discount: e.target.value })}
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">{describeLimit(limit)}</p>
      </div>

      <div className="space-y-3 border-t pt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Extra Charges</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange({ extras: [...value.extras, emptyEventExtra()] })}
          >
            <Plus className="h-4 w-4 mr-1" /> Add Extra Charge
          </Button>
        </div>
        {value.extras.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Optional. Add named line items (e.g. "DJ Setup", "Extra Chairs", "Decoration") that appear
            on the event bill.
          </p>
        )}
        {value.extras.map((x, i) => (
          <div key={x.key} className="grid gap-2 sm:grid-cols-[1.5fr_140px_30px] items-end">
            <Field label={i === 0 ? "Point name" : ""}>
              <Input
                placeholder="e.g. DJ Setup"
                value={x.pointName}
                onChange={(e) =>
                  onChange({
                    extras: value.extras.map((r, idx) =>
                      idx === i ? { ...r, pointName: e.target.value } : r,
                    ),
                  })
                }
              />
            </Field>
            <Field label={i === 0 ? "Amount (₹)" : ""}>
              <Input
                type="number"
                value={x.amount}
                onChange={(e) =>
                  onChange({
                    extras: value.extras.map((r, idx) =>
                      idx === i ? { ...r, amount: e.target.value } : r,
                    ),
                  })
                }
              />
            </Field>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              onClick={() => onChange({ extras: value.extras.filter((_, idx) => idx !== i) })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {extrasTotal > 0 && (
          <p className="text-xs text-muted-foreground">
            Extras subtotal: <b>₹{extrasTotal.toLocaleString("en-IN")}</b>
          </p>
        )}
      </div>

      <div className="space-y-3 border-t pt-6">
        <h3 className="text-sm font-semibold">Rooms · Assign Guest</h3>
        <EventRoomBlocks
          mode={value.roomMode}
          onModeChange={(roomMode) => onChange({ roomMode })}
          eventName={value.eventName}
          onEventNameChange={(eventName) => onChange({ eventName })}
          rows={value.roomRows}
          onRowsChange={(roomRows) => onChange({ roomRows })}
          eventDate={value.eventDate}
          rooms={vacantRooms}
          plans={plans}
        />
      </div>
    </div>
  );
}
