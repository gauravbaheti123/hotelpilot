## Plan: Stop sidebar from changing to short menu

1. **Make platform-admin detection absolute**
   - Keep only this condition for Superadmin sidebar: `user.email.toLowerCase() === "growth@hotelpilot.in"`.
   - For every other email, always render the hotel sidebar branch.

2. **Prevent the “full sidebar then short sidebar” flicker**
   - In `AppShell`, use `useAuth().loading` and avoid permission-based sidebar filtering while auth/roles are still resolving.
   - This prevents the initial full menu from being recalculated into a restricted short menu after permissions load.

3. **Bypass module permission filtering for Owner users**
   - Owners should always see the complete hotel sidebar.
   - Apply case-insensitive role checks for `owner` and `manager` so role casing from the backend cannot break the sidebar.

4. **Restrict permission filtering to staff only**
   - Managers/receptionists/other staff can still have menus filtered by their assigned permissions.
   - Owners and the platform admin are excluded from that filter.

5. **Verify with the reported account behavior**
   - Confirm that `owner@brijhotel.in` / `owner@hotelbrij.in` shows the full hotel sidebar and does not shrink after permissions finish loading.
   - Confirm that only `growth@hotelpilot.in` can see the Superadmin sidebar.

## Technical files involved

- `src/components/AppShell.tsx`
- `src/hooks/use-auth.ts`
- `src/hooks/use-permissions.ts` only if a loading-state refinement is needed