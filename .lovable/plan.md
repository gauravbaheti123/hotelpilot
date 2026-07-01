# Mobile Responsiveness Fix Plan

## Issues found

1. **No mobile navigation** (blocker). `src/components/AppShell.tsx` line 273 hides the sidebar with `hidden md:flex` but there is no hamburger/drawer replacement. On any screen <768px, users cannot navigate anywhere except by typing URLs. This is the single biggest issue.
2. **Header cramped on mobile**. The top bar shows title + Reminders bell + PropertySelector + support text with no menu trigger and no wrapping/priority rules — the PropertySelector (a wide combobox) overflows on small screens.
3. **PropertySelector hidden on mobile** (`hidden sm:block`) — users on phones cannot switch property at all.
4. **Wide data tables overflow** (Reports, Invoices, MIS, Roles, Activity, Calendars). Most use raw `<Table>` inside cards without an `overflow-x-auto` wrapper, causing horizontal page scroll and layout break.
5. **Dashboard room-status tiles + KPI grid** work, but detail sections (Today's Schedule, In-house lists) use flex rows without `min-w-0` + `truncate`, so long guest names push layout.
6. **Modals / dialogs** (CheckoutDialog, SplitBillDialog, Room Shift wizard, RoomStatusModal) use fixed widths (`max-w-2xl` etc.) with multi-column grids that don't collapse — buttons get cut off on phones.
7. **Forms with side-by-side grids** (New Booking, New KOT, Banquet New, Settings/Hotel) use `grid-cols-2/3/4` with no `sm:` prefix, so labels + inputs squeeze on <400px.
8. **Login / Forgot password** cards are fine but the marketing left panel isn't hidden — worth double-checking.
9. **Print/preview viewport** — invoice pages assume desktop; not touching print CSS, only screen layout.

## Fixes

### 1. AppShell mobile nav (primary fix)
- Add a hamburger `Button` in the header, visible only on `<md`.
- Slide-out drawer using shadcn `Sheet` (`src/components/ui/sheet.tsx` exists) containing the exact same `visibleGroups` sidebar content. Close on link click via router listener.
- Show `Logo` + title on mobile header; move PropertySelector into the drawer footer so it's reachable on phones.
- Keep desktop `aside` unchanged.

### 2. Header layout
- Use `grid grid-cols-[auto_minmax(0,1fr)_auto]` on mobile → hamburger | title (truncate) | actions (bell + overflow menu).
- Hide "Support: …" on <lg (already the case), keep bell always visible.

### 3. Table overflow wrapper
- Add a small helper class or wrap each `<Table>` in `<div className="overflow-x-auto -mx-4 sm:mx-0">` in the affected report/list pages. Scope: `reports.*.tsx`, `billing.invoices.tsx`, `billing.mis.tsx`, `superadmin.roles.index.tsx`, `reports.activity.tsx`, `front-desk.calendar.tsx`, `front-desk.rate-calendar.tsx`, `channels.index.tsx`.

### 4. Dashboard rows
- Add `min-w-0` + `truncate` to Today's Schedule / In-house / Unassigned list rows; ensure KPI cards stack cleanly (`grid-cols-2 sm:grid-cols-2 lg:grid-cols-4`).

### 5. Dialogs
- Replace fixed `max-w-2xl`/`max-w-3xl` with `w-[95vw] max-w-2xl` and inner grids `grid-cols-1 sm:grid-cols-2`.
- Make dialog footers `flex-col sm:flex-row` so buttons stack.
- Files: `CheckoutDialog.tsx`, `SplitBillDialog.tsx`, `ShiftToMisDialog.tsx`, RoomShift wizard section in `front-desk.booking.$id.tsx`, RoomStatusModal in `dashboard.tsx`.

### 6. Form grids
- Sweep New Booking (`front-desk.new.tsx`), New KOT (`food.new.tsx`), Banquet New (`banquet.new.tsx`), Hotel Settings (`settings.hotel.tsx`): change `grid-cols-2/3` to `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`.

### 7. Aggregator index pages
- Cards already use `sm:grid-cols-2 lg:grid-cols-3/4` — fine. Just verify tap targets ≥44px (add `py-4` where cards are too tight).

## Out of scope
- Rewriting print/PDF CSS.
- Redesigning any page — pure responsive fixes only, no business logic or copy changes.
- Native mobile app.

## Deliverables
- Updated `AppShell.tsx` with `Sheet`-based mobile drawer + hamburger + repositioned header actions.
- Table wrappers on ~15 list/report pages.
- Dialog width/footer sweep on ~5 modals.
- Form grid sweep on ~4 heavy forms.
- Dashboard row `min-w-0`/`truncate` polish.

Estimated: single build session, no schema or backend changes.
