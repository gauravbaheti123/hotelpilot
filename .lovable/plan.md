# Plan: Back Button on Every Page

## Current state (verified)

A universal back button is already implemented and live on every page:

- `src/components/AppShell.tsx` renders `HeaderBackButton` in the shared header, next to the page title (mobile + desktop).
- Every page reaches this header: directly via `AppShell` (64 route files), via `ReportShell` (all Reports pages), or via `CrudPage` (all Masters / Inventory / Billing Companies pages). Redirect-only routes (`/security`, `/feedback`) render nothing, so nothing is missing.
- Behavior: if there is in-app history it goes back one step; otherwise (deep link / hard refresh) it walks up one path level, falling back to the Dashboard.
- It is hidden only on `/dashboard` and `/`, where "back" has no meaning.

## What remains

1. Verify in the preview: open a few pages (Reports, a Master page, a booking, an invoice), confirm the ← button appears in the header and navigates back correctly.
2. Optional polish (only if you want it):
   - Show the button on the Dashboard too (navigates to a fixed page you choose).
   - Add a visible "Back" text label next to the arrow on desktop.

No code changes are required for the request itself; only verification, plus the two optional tweaks if approved.

## Technical notes

- Logic lives in `HeaderBackButton` (`AppShell.tsx` lines ~655-683): `router.history.back()` when `window.history.length > 1` and `router.history.canGoBack()`, else parent path derived from the URL, else `/dashboard`.
- No schema, RBAC, or layout changes involved.
