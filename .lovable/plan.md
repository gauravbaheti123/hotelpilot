# Pending Issues Checklist — Site Audit

## 1. Receptionist RBAC / "Access Denied" bug
- **Status:** 3 fix attempts kiye gaye (`RequirePermission.tsx`, `use-permissions.ts`, `use-property.ts`), but user ne end-to-end confirm nahi kiya ki actual login pe dashboard ab load hota hai.
- **Pending actions:**
  - `counter@hotelbrij.in` (role_id `25ab518f-8c00-4b8f-961a-3f47f83018c0`) se live login karke Dashboard + Front Desk + Housekeeping load verify karna.
  - Console pe `[permissions]` debug logs check karke `property_id`, `role_id`, aur fetched `role_permissions` rows ka actual snapshot dekhna.
  - Fail-open vs fail-closed policy confirm karna: loading/error states me "Access Denied" NAHI render hona chahiye — sirf definitive `allowed=false` par.
  - Spot-check ek aur non-owner role (housekeeping/manager) pe bhi same guard.

## 2. Split Bill — %/Amount mode
- **Status:** Code likha gaya (`SplitBillDialog.tsx` + `billing.ts` helpers), TS pass, lekin runtime QA baaki.
- **Pending actions:**
  - Whole-bill %-split (2 parties, 3 parties, uneven %) — sum validator, last-party paise remainder verify.
  - Whole-bill ₹-split — same checks.
  - Per-charge-line %/₹ split (agar wizard me line-scope enabled hai) — regression test item-wise flow ke sath.
  - **GST proportionality:** Har party ke lump-sum share pe `weightedGstRate(baseCharges)` apply hota hai — sum of per-party GST == original bill GST (paise tak) verify karna zaroori hai.
  - Folios created (`charge_type='share'`) → payment step N-row → check-out flow end-to-end.
  - Print/receipt template me new `share` line-item sahi render ho raha hai ya nahi.

## 3. Room-less Future Reservations
- **Status:** Code shipped (`front-desk.new.tsx`, `AssignRoomDialog.tsx`, `dashboard.tsx`, `front-desk.booking.$id.tsx`). No DB migration.
- **Pending actions:**
  - New booking with "Assign room later" checkbox → `booking_rooms.room_id = NULL` row created, category/tariff/rate set.
  - Dashboard "Unassigned Reservations" panel: sahi bookings dikhti hain, "Assign Room" button open karta hai dialog.
  - AssignRoomDialog: same-category vacant rooms first, other-category prompt with rate confirmation, overlap trigger safety.
  - Booking detail page: per-row "To be assigned" badge, check-in guard (null room → dialog opens, block proceed).
  - "Save & check-in now" disabled while assign-later on — verify.
  - Existing bookings with pre-assigned rooms: zero regression.
  - Activity log entries: `unassigned: true` on create, `ROOM_ASSIGNED` on assign.

## 4. Full Audit — Other Findings To Verify
Ye items code review + tooling se dikhne wale potential gaps hain, user-reported nahi. Har ek ko confirm/dismiss karna hai:

**Auth / RBAC layer**
- `RequirePermission` fail-open behavior sirf dashboard ke liye lagayi hai ya global? Har protected page (POS, Banquet, Reports, Night Audit, Expenses) pe consistent hai verify karo.
- Owner-only pages (Roles/Permissions editor, Users, Property Settings) pe permission gate strict hai ya sirf UI hide? Server-side RLS bhi enforce ho.
- `_authenticated/route.tsx` integration-managed — kisi ne edit toh nahi kiya check karo.

**Data & RLS**
- 70+ tables me `role_permissions`, `user_roles`, `permissions` pe `has_permission()` / `has_role()` security-definer function use ho raha hai — recursive policy risk audit.
- `booking_rooms.room_id NULL` ke saath koi query hai jo `NOT NULL` maan ke chal rahi ho (housekeeping tasks, night audit, rate seasons)? Grep karna hoga.
- `folios` / `folio_charges` me new `charge_type='share'` value ka enum/check-constraint constraint allow karta hai — verify.

**Frontend regressions ka risk**
- `routeTree.gen.ts` kayi baar edit hua — manual edit ka koi trace na ho.
- `SplitBillDialog.tsx` large refactor — item-wise + type-wise legacy path untouched, snapshot test na hone ki wajah se manual verify zaroori.
- Dashboard "Unassigned Reservations" query performance (index on `booking_rooms(room_id) WHERE room_id IS NULL`?).

**SEO / metadata (secondary)**
- Public routes (`/`, marketing) pe `head()` me app-specific title/description/og set hai ya default "Lovable App".
- og:image sirf leaf routes pe, absolute https.

**Console / network signals**
- Preview me abhi koi errors log nahi hue (session replay clean), lekin logged-in flows par aur signals chahiye — receptionist login turn pe repro karna.

---

## Recommended Next Step
Sabse pehle **Item 1 (Receptionist RBAC)** ko live verify karo — kyunki agar wo still broken hai, non-owner users kuch bhi test nahi kar payenge (including Split Bill aur Assign Room). Uske baad Item 2 → 3 → 4 order me QA.

Agar aap approve karte hain, main build mode me:
1. Playwright script se receptionist login karke dashboard + guarded pages ke screenshots + console dump lunga.
2. Split Bill %/₹ ka scripted E2E chalaunga (2 parties, GST-match assert).
3. Room-less booking create → assign → check-in ka happy path chalaunga.
4. Findings ke basis pe surgical fixes.

Koi bhi step skip karna ho ya priority badalni ho toh batao.
