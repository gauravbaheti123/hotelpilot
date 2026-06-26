import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/dashboard')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/_authenticated/dashboard"!</div>
}
  if (isEventBlock || isEventCheckedIn) {
    const evBg = isEventCheckedIn ? EVENT_IN_BG : EVENT_BLOCK_BG;
    return (
      <div
        role={isEventCheckedIn ? "button" : undefined}
        tabIndex={isEventCheckedIn ? 0 : -1}
        onClick={isEventCheckedIn ? onPick : undefined}
        onKeyDown={isEventCheckedIn
          ? (e) => { if (e.key === "Enter" || e.key === " ") onPick(); }
          : undefined}
        className="relative transition cursor-pointer overflow-hidden flex flex-col"
        style={{ backgroundColor: evBg, color: "#ffffff", height: 140, borderRadius: 10 }}
      >
        <div className="px-2.5 pt-2 pb-1.5 flex-1 min-h-0 flex flex-col">
          <div className="flex items-start justify-between gap-2">
            <span style={{ color: "#ffffff", fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{room.room_number}</span>
            <span className="font-semibold uppercase tracking-wide rounded-full"
              style={{ backgroundColor: "rgba(255,255,255,0.25)", color: "#ffffff", fontSize: 10, padding: "2px 7px" }}>
              {isEventCheckedIn ? "Event·In" : "Event Block"}
            </span>
          </div>
          <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 11, marginTop: 1 }}>{category}</div>
          <div className="truncate" style={{ color: "#ffffff", fontSize: 13, fontWeight: 600, marginTop: 2 }}>{eventInfo!.eventName}</div>
          <div className="truncate" style={{ color: eventInfo!.guestName ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.7)", fontStyle: eventInfo!.guestName ? "normal" : "italic", fontSize: 12 }}>
            {eventInfo!.guestName ?? "Guest Unassigned"}
          </div>
          <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 11 }}>{fmtShort(eventInfo!.checkin)} → {fmtShort(eventInfo!.checkout)}</div>
          <div className="mt-auto pt-1 flex flex-wrap gap-1">
            {isEventBlock && !eventInfo!.guestName && (
              <button type="button"
                style={{ backgroundColor: "transparent", color: "#ffffff", border: "1px solid #ffffff", borderRadius: 4, padding: "3px 8px", fontSize: 11, fontWeight: 600 }}
                onClick={(e) => { e.stopPropagation(); onAssignEvent({
                  id: eventInfo!.blockId, banquet_booking_id: eventInfo!.banquetBookingId,
                  event_name: eventInfo!.eventName, room_id: room.id,
                  room_number: room.room_number, room_category: category,
                  guest_name: null, guest_mobile: null,
                  checkin_date: eventInfo!.checkin, checkout_date: eventInfo!.checkout,
                  special_rate: null, status: "blocked", booking_id: null,
                } as EventBlockRecord); }}>Assign</button>
            )}
            {isEventBlock && (
              <button type="button"
                disabled={!eventInfo!.guestName}
                title={eventInfo!.guestName ? "Check in this guest" : "Assign guest first"}
                style={{
                  backgroundColor: eventInfo!.guestName ? "#ffffff" : "rgba(255,255,255,0.4)",
                  color: evBg,
                  cursor: eventInfo!.guestName ? "pointer" : "not-allowed",
                  borderRadius: 4, padding: "3px 8px", fontSize: 11, fontWeight: 600, border: "none",
                }}
                onClick={(e) => { e.stopPropagation(); if (!eventInfo!.guestName) return; onEventCheckIn({
                  id: eventInfo!.blockId, banquet_booking_id: eventInfo!.banquetBookingId,
                  event_name: eventInfo!.eventName, room_id: room.id,
                  room_number: room.room_number, room_category: category,
                  guest_name: eventInfo!.guestName, guest_mobile: null,
                  checkin_date: eventInfo!.checkin, checkout_date: eventInfo!.checkout,
                  special_rate: null, status: "blocked", booking_id: null,
                } as EventBlockRecord); }}>Check In</button>
            )}
            {isEventCheckedIn && eventInfo!.bookingId && (
              <button type="button"
                style={{ backgroundColor: "#ffffff", color: evBg, borderRadius: 4, padding: "3px 10px", fontSize: 11, fontWeight: 600, border: "none" }}
                onClick={(e) => { e.stopPropagation(); onCheckout(eventInfo!.bookingId); }}>Checkout</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const isCompact = kind !== "occupied";
  const cardHeight = isCompact ? 100 : 140;
  const hintText =
    kind === "dirty" ? "🧹 Needs cleaning"
    : kind === "maintenance" ? "🔧 Under repair"
    : kind === "blocked" ? "⛔ Blocked"
    : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onPick(); }}
      className="relative transition cursor-pointer overflow-hidden flex flex-col"
      style={{ backgroundColor: meta.bg, color: "#ffffff", height: cardHeight, borderRadius: 10 }}
    >
      <div className="px-2.5 pt-2 pb-1.5 flex-1 min-h-0 flex flex-col">
        <div className="flex items-start justify-between gap-2">
          <span style={{ color: "#ffffff", fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{room.room_number}</span>
          <span
            className="font-semibold uppercase tracking-wide rounded-full"
            style={{ backgroundColor: "rgba(255,255,255,0.25)", color: "#ffffff", fontSize: 10, padding: "2px 7px" }}
          >
            {meta.label}
          </span>
        </div>
        <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 11, marginTop: 1 }}>{category}</div>

        {kind === "occupied" && occ && (
          <>
            <div className="truncate" style={{ color: "#ffffff", fontSize: 13, fontWeight: 700, marginTop: 2 }}>
              {occ.guestName ?? "Guest"}
            </div>
            <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 11 }}>
              {fmtShort(occ.checkIn)} → {fmtShort(occ.checkOut)}
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: pending > 0 ? "#fbbf24" : "rgba(255,255,255,0.9)" }}>
              {pending > 0 ? `₹${pending.toLocaleString("en-IN")} pending` : "Balance ₹0"}
            </div>
            <div className="mt-auto pt-1">
              <button
                type="button"
                style={{ backgroundColor: "#ffffff", color: meta.bg, borderRadius: 4, padding: "3px 10px", fontSize: 11, fontWeight: 600, border: "none" }}
                onClick={(e) => { e.stopPropagation(); onCheckout(occ.bookingId); }}
              >
                Checkout
              </button>
            </div>
          </>
        )}

        {isCompact && hintText && (
          <div className="mt-auto" style={{ color: "rgba(255,255,255,0.7)", fontSize: 11 }}>
            {hintText}
          </div>
        )}
      </div>

      {hasFood && kind === "occupied" && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onPickFood(); }}
          className="absolute flex items-center gap-1 font-semibold"
          style={{
            right: 6, bottom: 6, backgroundColor: "#fbbf24", color: "#78350f",
            borderRadius: 999, padding: "2px 8px", fontSize: 10, border: "none",
          }}
          title={`${pendingFood!.count} pending KOT${pendingFood!.count === 1 ? "" : "s"}`}
        >
          <UtensilsCrossed className="h-3 w-3" />
          ₹{pendingFood!.amount.toLocaleString("en-IN")}
        </button>
      )}
    </div>
  );
}
