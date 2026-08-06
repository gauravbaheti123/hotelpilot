// Edit wizard — review / diff summary. Read-only.
import { Badge } from "@/components/ui/badge";
import { stayHasChanges, type BookingEditState } from "@/lib/bookingEdit";

function Row({ label, from, to }: { label: string; from: string; to: string }) {
  const changed = from !== to;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b py-1.5 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      {changed ? (
        <span className="text-sm">
          <span className="line-through text-muted-foreground">{from || "—"}</span>
          <span className="mx-1.5">→</span>
          <span className="font-medium">{to || "—"}</span>
        </span>
      ) : (
        <span className="text-sm">{to || "—"}</span>
      )}
    </div>
  );
}

export function StepEditReview({ state }: { state: BookingEditState }) {
  const s = state.stay;
  const changed = stayHasChanges(s);
  return (
    <div className="space-y-6">
      <section className="space-y-1">
        <h3 className="text-sm font-medium">Guest</h3>
        <div className="rounded-md border px-3">
          <Row label="Name" from={state.guest.name} to={state.guest.name} />
          <Row label="Mobile" from={state.guest.mobile} to={state.guest.mobile} />
          <Row label="Occupancy" from="" to={`${state.adults} adult(s), ${state.children} child(ren)`} />
          <Row label="Additional guests" from="" to={String(state.extraGuests.filter((g) => g.name.trim()).length)} />
        </div>
      </section>

      <section className="space-y-1">
        <h3 className="text-sm font-medium flex items-center gap-2">
          Stay &amp; Room
          {changed && <Badge variant="outline" className="text-[10px]">Changing</Badge>}
        </h3>
        <div className="rounded-md border px-3">
          <Row label="Check-in" from={s.origCheckIn} to={s.checkIn} />
          <Row label="Check-out" from={s.origCheckOut} to={s.checkOut} />
          <Row
            label="Tariff basis"
            from={s.origRateType === "inclusive" ? "Incl. GST" : "Excl. GST"}
            to={s.rateType === "inclusive" ? "Incl. GST" : "Excl. GST"}
          />
          {s.rooms.map((r, i) => (
            <div key={r.bookingRoomId}>
              <Row
                label={`Room ${s.rooms.length > 1 ? i + 1 : ""}`.trim()}
                from={`${r.origRoomNumber ?? "—"} (${r.origCategoryName ?? "—"})`}
                to={`${r.roomNumber ?? r.origRoomNumber ?? "—"} (${r.categoryName ?? r.origCategoryName ?? "—"})`}
              />
              <Row
                label={`Tariff ${s.rooms.length > 1 ? i + 1 : ""}`.trim()}
                from={`₹${r.origRate}/night`}
                to={`₹${r.rate}/night`}
              />
            </div>
          ))}
          {s.reason.trim() && <Row label="Reason" from="" to={s.reason.trim()} />}
        </div>
        {changed && state.status === "checked_in" && (
          <p className="text-[11px] text-muted-foreground">
            Room moves run through Shift Room (audit trail, room statuses and kitchen orders handled);
            tariff changes apply from today onward.
          </p>
        )}
      </section>

      <section className="space-y-1">
        <h3 className="text-sm font-medium">Bill To</h3>
        <div className="rounded-md border px-3">
          <Row label="Company" from="" to={state.billTo.enabled ? state.billTo.name : "Not applicable"} />
          {state.billTo.enabled && <Row label="GSTIN" from="" to={state.billTo.gstin} />}
        </div>
      </section>

      <section className="space-y-1">
        <h3 className="text-sm font-medium">Remarks</h3>
        <div className="rounded-md border px-3">
          <Row label="Remark" from="" to={state.customRemark} />
        </div>
      </section>
    </div>
  );
}
