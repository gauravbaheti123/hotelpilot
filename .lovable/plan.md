## Root cause (verified from source)

`AppShell` is rendered inside every route component (`dashboard.tsx`, `front-desk.*`, etc.), so it **remounts on every navigation**. Every hook it (and its children) call re-runs its `useEffect` and re-fires Supabase from scratch:

- `useAuth` → `supabase.auth.getSession()` + `user_roles.select(role)`
- `useProperties` → `properties.select(...)`
- `useCurrentProperty` → another `user_roles.select(property_id)`
- `usePermissions` → `user_roles.select(role_id, property_id)` + `role_permissions` join (the expensive one)
- `RemindersBell` → reminders fetch
- Plus each page loader's own fetches

None of these use TanStack Query, so nothing is cached across navigations. Result: 5+ serial round-trips fire on every click, and until `usePermissions` resolves, the sidebar/`RequirePermission` guards show spinners → the ~5-second stall.

This matches the "every page, not one page" symptom exactly. Route-specific loaders are not the culprit.

## Fix

Convert the shared session/property/permission/reminders fetches to **TanStack Query** with a long `staleTime` so remounting `AppShell` reuses cached data instead of refetching. Invalidate only on real change (auth event, property switch, `invalidatePermissions()`).

### 1. `src/hooks/use-auth.ts`
- Replace `useState` + `useEffect` with `useQuery({ queryKey: ["auth","session"], staleTime: Infinity })` returning `{ user, session, roles }`.
- Keep a single module-level `supabase.auth.onAuthStateChange` subscriber that calls `queryClient.setQueryData(["auth","session"], …)` on `SIGNED_IN` / `SIGNED_OUT` / `TOKEN_REFRESHED` (session only, no role refetch).
- Roles fetched once inside the same query.

### 2. `src/hooks/use-property.ts`
- `useProperties` → `useQuery({ queryKey: ["properties"], staleTime: 5*60_000 })`.
- `useCurrentProperty`'s `user_roles` sync → `useQuery({ queryKey: ["user-assigned-properties", userId], staleTime: 5*60_000 })`.
- `setCurrentId` invalidates `["permissions", userId, newPropertyId]`.

### 3. `src/hooks/use-permissions.ts`
- Replace ad-hoc `useEffect` + `tick` + custom event with `useQuery({ queryKey: ["permissions", userId, propertyId], staleTime: 5*60_000, enabled: !!userId })`.
- `invalidatePermissions()` becomes `queryClient.invalidateQueries({ queryKey: ["permissions"] })`.
- Keep the owner/superadmin bypass — return synchronously without a query.

### 4. `src/components/Reminders.tsx`
- Wrap the fetch in `useQuery({ queryKey: ["reminders", propertyId, userId], staleTime: 60_000 })` and keep the existing realtime subscription to `setQueryData`/invalidate. Remove the per-mount refetch.

### 5. `_authenticated/route.tsx` `beforeLoad`
- It runs on every navigation and calls `supabase.auth.getUser()` + `rpc("current_user_totp_required")`. Cache both in router `context` via a memo keyed on session, so repeat navigations skip the network:
  - Store the last-verified `user.id` and a `totpChecked` flag in `sessionStorage`; short-circuit when the same user is already verified this tab.
  - Continue to force a real check when session changes (auth listener already invalidates the router with `router.invalidate()` — verify this exists in `__root.tsx`; if not, add it).

### 6. Verify no regressions
- After edits, click through Dashboard → Front Desk → Billing → Reports → Dashboard and confirm on the Network tab: `user_roles`, `role_permissions`, `properties` fire **once** for the session, not per navigation.
- Confirm sign-out clears the QueryClient (`queryClient.clear()`).
- Confirm `PropertySelector` switch still refetches permissions for the new property.

## Out of scope
- No UI/layout changes.
- No route-loader restructuring beyond the `_authenticated` `beforeLoad` cache above.
- No code-splitting/bundle changes (all evidence points to redundant network, not chunk load).

## Verification target
Sub-1s cached navigation between already-visited routes; ≤1 `user_roles` + 1 `role_permissions` request per session (not per click).
