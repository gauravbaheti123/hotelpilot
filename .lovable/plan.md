
# Split Bill (%/Amount) + Room-less Reservations

Both features shipped in one turn. Additive only — existing item-wise / type-wise split, existing room-assigned bookings, existing RBAC and billing math stay untouched.

## Feature 1 — Percentage / Amount Split

### UX flow (SplitBillDialog)
Add a **mode selector** on step 1 alongside the existing item-wise split:
- Item-wise (existing 2-party flow — unchanged)
- **Split by %** (new)
- **Split by Amount ₹** (new)

For the two new modes, add a **scope** control:
- Split entire bill (all non-discount/non-tax charges lumped)
- Split a specific charge (dropdown of current charge lines)

Then a dynamic **Parties list** (min 2, Add/Remove, default 2):
- Name (required for party 2+), optional mobile/GSTIN, bill_type (cash_bill/gst_invoice — same owner-only guard as today)
- % or ₹ input per party (depending on mode)
- Live-computed counterpart shown inline (% shows ₹, ₹ shows %)
- Sum validator with a coloured chip: percent must equal 100.00, amount must equal target subtotal
- **Rounding**: last party absorbs the paise remainder so party sums exactly match the base. A muted note "Last party adjusted by ₹0.0X for rounding" is rendered when a remainder is applied.

Confirm is disabled until the sum validates and every party has a name.

### Persistence model (per user's answer)
Each party gets its **own folio with a single lump-sum "Share of Bill" charge line**:
- `charge_type = 'share'`, description like "Share of Bill — 40% of BILL003" (or "Share of Room Charge — ₹1,333.33 of BILL003")
- `amount = party_share_net` (pre-GST net)
- `gst_rate = weightedGstRate(baseCharges)` — the effective GST% of the base scope (charge GST / charge net). If mixed rates, use the weighted average so per-party GST re-sums to the original GST total.
- `gst_amount = round2(amount * gst_rate / 100)` for gst_invoice folios, 0 for cash_bill
- The last party's amount/GST is nudged by the paise remainder so totals reconcile.

Reuse the existing folio-creation path in `confirmSplit`:
- Extract a helper `createSplitFolios(parties, chargeRowsFactory)` from the current 2-party loop so both the existing item-wise flow and the new %/amount flow feed the same insert code (folios insert → folio_charges insert → `void_folio_safe` on the source → activity log → step-4 payment collection).
- Rollback on any error stays as-is.

Activity log gets a new `split_mode` detail (`item` | `percent` | `amount`) and, for scoped splits, the `scope_charge_id`.

Payment step (step 4) becomes N-row instead of hardcoded 2 — reuse the same row component in a loop.

### RBAC
No new checks. The dialog is already gated by `billing/split_bill`; the new modes ride on the same button.

### Files touched
- `src/components/SplitBillDialog.tsx` — the bulk of the work: mode/scope state, dynamic parties array, sum validators, refactored `confirmSplit` and `completeCheckout` for N parties, weighted-GST helper.
- `src/lib/billing.ts` — add `weightedGstRate(charges)` and `distributeWithRemainder(total, weights)` pure helpers with tests-shaped signatures.
- No DB changes; `folio_charges.charge_type = 'share'` fits the existing free-text column.

## Feature 2 — Room-less Future Reservations

### Data model
`booking_rooms.room_id` is already nullable and the overlap trigger already `RETURN NEW`s when `room_id IS NULL` — verified. No migration needed for that. One tiny migration to relax the `booking_rooms` insert path if any NOT NULL FK exists (spot-check confirms it doesn't). If the linter flags anything, we add it in the same turn.

An unassigned reservation is stored as a `bookings` row + one `booking_rooms` row per requested room with:
- `category_id` set, `tariff_id` optional, `rate` set (drives billing)
- `room_id = NULL`
- `status = 'active'`

### New Booking form (`front-desk.new.tsx`)
- Room Category stays required.
- Room-number dropdown gets a "To be assigned later" sentinel option at the top. Selecting it stores `roomId = null` for that entry.
- Submit path passes `room_id: roomId || null` into the `booking_rooms` insert. Rate/tariff/category logic unchanged.
- Activity log for booking creation includes `unassigned: true` when applicable.

### Dashboard — Unassigned Reservations panel
On `dashboard.tsx`, add a new card **Unassigned Reservations** above/beside the room-status board (only rendered when count > 0):
- Query: `bookings` joined with `booking_rooms` where any `booking_rooms.room_id IS NULL` and `booking.status IN ('reserved','checked_in')` and `check_out >= today`.
- Rows: guest name, category name, check-in → check-out, adults/children, "Assign Room" button.
- Room tiles are unaffected — a booking without a room does not attach to any tile.

### Assign Room dialog (new component `AssignRoomDialog`)
Opens from the panel and from the booking detail page:
- Lists vacant rooms of the same category first (labelled "Suggested — same category"), then vacant rooms of other categories under a collapsed "Other categories" section.
- The top suggestion (first vacant same-category room) is pre-selected.
- Confirm updates the target `booking_rooms.id` with the chosen `room_id`; if a different category is picked, it also updates `category_id` and prompts to confirm keeping vs. updating `rate` (reusing the same rate-choice pattern as room-shift: "keep rate" vs "apply category default").
- Overlap trigger enforces conflict safety at DB level.
- Activity log: `ROOM_ASSIGNED` with from=null, to=room_id.

### Booking detail (`front-desk.booking.$id.tsx`)
- For each `booking_rooms` row with `room_id = null`, replace the room-number cell with an "Assign Room" button that opens `AssignRoomDialog` for that row.
- Check-in action: if the booking has any `booking_rooms.room_id IS NULL`, block check-in and open `AssignRoomDialog` first. Only after every row has a room can check-in proceed. Existing check-in code path otherwise unchanged.

### Files touched
- `src/routes/_authenticated/front-desk.new.tsx` — sentinel option, nullable submit.
- `src/routes/_authenticated/front-desk.booking.$id.tsx` — assign-room CTA + check-in guard.
- `src/routes/_authenticated/dashboard.tsx` — new Unassigned Reservations panel + query.
- `src/components/AssignRoomDialog.tsx` — new.

## Verification
- `bunx tsgo --noEmit` after each feature.
- Manual reasoning walk-through for Split by %: three parties on ₹10,000 GST invoice at 12% → 33.33% / 33.33% / 33.34%; net = 3333.33/3333.33/3333.34, GST = 400/400/400.02, totals = 3733.33/3733.33/3733.36; sum = 10,000.02… → remainder is applied on the net side before GST so total re-sums to 10,000.00 exactly. Helper is written to guarantee `sum(shares) === total` at the paise level.
- Manual walk-through for unassigned booking: create → dashboard shows it in the panel → Assign Room picker → assign → check-in works.

## Out of scope
- No changes to item-wise split flow, RBAC, billing formulas outside split bill, or unrelated modules.
- No changes to `src/integrations/supabase/*` generated files, and no schema migration unless the linter demands one.
