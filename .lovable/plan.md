# 8 point fixes — Reports, Invoice GST, Room Shift display, Back button, Dashboard labels

Sabhi 8 points code ke against verify kiye gaye hain. Neeche har point ka kaam.

## 1. Cancelled Report (new)
Reports me naya "Cancelled Bookings" report card + page.
Columns: Booking #, Guest, Room(s), Stay dates, Cancel date & time, Cancelled by, Reason, Advance received / Refund status.
Date range filter, search, Excel aur PDF export — baaki reports jaisa hi layout.

## 2. Item Sales Report
Reports index pe seedha "Item Sales" card, jo item-wise view directly kholega.
Item name, category, kitchen (Hotel / Restaurant), quantity, rate, total revenue — saath me category aur kitchen filter, Excel/PDF export.

## 3. Room Shift Report
Report table me do naye columns: Shift Reason aur Shifted By (staff name). Dono database me pehle se record ho rahe hain, sirf report me dikh nahi rahe. Exports me bhi aayenge.

## 4. GST in Bill To
Invoice ke Bill To block me GSTIN ab company mapped ho ya na ho, dono case me print hoga — jahan bhi guest ka GSTIN available hai. Company na hone par guest ke naam ke neeche GSTIN line aayegi.

## 5 & 6. Room number after shift
- In-house list me sirf current active room dikhega (301 vacate hone ke baad sirf 302).
- Booking detail card aur invoice stay details me "Room: 302 (Shifted from 301)" format.
- Multi-room bookings me har active room dikhega, shift hue purane room sirf bracket note me.

## 7. Back button har page pe
Global header me page title ke left me ← Back button. Browser history use karega, aur history na hone par sensible parent page (jaise Reports list ya Dashboard) pe le jayega. Jin pages pe pehle se manual back hai, unka duplicate hata denge.

## 8. Dashboard Room / Food / Laundry
- Segment switch ka label "Lodge" se "Room" (Room | Food | Laundry). Bill titles/series jaise wahi rahenge.
- Teeno segments ke liye quick counters (active rooms / open food bills / open laundry bills) switch ke saath, ek click me us segment pe filter.

## Technical notes
- New routes: `reports.cancelled.tsx`, `reports.item-sales.tsx`; dono `ReportShell` + `ReportDataTable` + `pagedSelect` pattern par, `RequirePermission module="reports"` ke saath.
- Cancelled data: `bookings` where status = `cancelled` (+ cancellation fields, `activity_log` fallback for actor), advances `payments`/`folios` se.
- Item sales: existing food-kot items aggregation ko apne route me nikaal kar shared helper banayenge (`src/lib/reports.ts`).
- Room shift: `room_shifts.reason`, `room_shifts.shifted_by` → `profiles` join for staff name.
- Bill To GST: invoice templates (`src/lib/invoiceTemplates.ts`) aur folio Bill To block me GSTIN condition company-independent.
- Active room: `booking_rooms` ke shift/ end-date state se current room derive karke in-house list aur invoice stay details me use.
- Back button: `AppShell.tsx` header me existing `BackButton` component, per-route fallback path.
- No schema changes, no RBAC changes, koi design/layout redesign nahi — sirf yeh additions.
