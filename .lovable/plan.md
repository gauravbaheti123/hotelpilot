
# HotelPilot — Standard Security Audit

Scope: RLS, auth, secrets, privilege escalation, function permissions. Based on Supabase security scanner, DB linter, and review of auth/RLS helpers.

---

## Findings

### CRITICAL — Cross-property privilege escalation

A staff member who holds **any** role at Property A and a **low-privilege** role (kitchen/housekeeping) at Property B can act on Property B's data as if they were a manager there, because some policies still use the single-argument role helpers.

1. **`activity_log` INSERT** — `tenant insert` policy uses `can_front_desk(auth.uid())` instead of `can_front_desk(auth.uid(), property_id)`. A kitchen user at Property B who is a receptionist at Property A can forge activity log entries against Property B.
2. **`hotel-assets` storage bucket** — INSERT/UPDATE/DELETE policies use `can_manage_masters(auth.uid())`. A manager at Property A who is housekeeping at Property B can overwrite/delete Property B's logos, invoice headers, ID document scans, etc.

Fix: rewrite both policies to pass the row's `property_id` (for storage: derive from `split_part(name,'/',1)::uuid`) into the two-argument overload.

### HIGH — `SECURITY DEFINER` functions executable by `anon` / all authenticated users

- 1 function executable by **anon** (scanner finding `SUPA_anon_security_definer_function_executable`). Earlier hardening pass intentionally left login helpers (`check_login_allowed`, `record_login_attempt`) public; we need to confirm this one is in that allowlist and not a regression.
- 41 functions executable by **authenticated**. Many are internal helpers (`recompute_folio_totals`, `sync_booking_balance`, `post_nightly_room_charges`, trigger helpers like `tg_*`, `apply_stock_movement`, `seed_printer_roles_for_property`) that the client should never call directly. They self-authorize via `auth.uid()` checks, but exposing them widens the attack surface (e.g. someone forcing folio recompute on another tenant's folio).

Fix: revoke `EXECUTE` from `authenticated` and `PUBLIC` on every helper that's only used by triggers/migrations; keep grants only on RPCs the UI calls (`shift_room`, `get_or_create_folio`, `delete_night_audit`, `get_property_secrets`, `save_property_secrets`, `has_role`, `user_has_property`, `is_superadmin`, `is_owner_or_super`, `user_max_discount_pct`, `user_has_permission`, `check_login_allowed`, `record_login_attempt`, `log_auth_event`, `auto_cancel_incomplete_bookings`).

### MEDIUM — `extensions` installed in `public` schema

Linter flag (`0014_extension_in_public`). Low real-world impact but pollutes the API surface. Migrate extensions (likely `pgcrypto`, `pg_trgm`) into an `extensions` schema. **Recommendation: leave as-is unless we plan a broader cleanup** — moving extensions can break dependent functions.

### LOW / informational — observed during review

- `src/integrations/supabase/client.ts` falls back to `process.env` at runtime; harmless on Vite but the message implies SSR config that doesn't apply here. No action.
- `useAuth` loads roles directly from `user_roles` on the client. RLS already restricts that read, but rendering decisions still happen client-side (defense in depth) — server-side checks via `has_role`/`is_superadmin` already gate sensitive RPCs, so this is acceptable.
- Auth logs show clean successful `/user` calls; no anomalies.

---

## Fix Plan (one migration, no UI changes)

### Step 1 — Re-scope `activity_log` INSERT policy
```sql
DROP POLICY IF EXISTS "activity_log tenant insert" ON public.activity_log;
CREATE POLICY "activity_log tenant insert" ON public.activity_log
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_property(auth.uid(), property_id)
    AND public.can_front_desk(auth.uid(), property_id)
  );
```

### Step 2 — Re-scope `hotel-assets` storage write policies
Drop the three single-arg policies and recreate with:
```sql
WITH CHECK (
  bucket_id = 'hotel-assets'
  AND public.can_manage_masters(
        auth.uid(),
        NULLIF(split_part(name,'/',1),'')::uuid
      )
)
```
Apply to INSERT, UPDATE (USING + WITH CHECK), DELETE (USING).

### Step 3 — Revoke EXECUTE on internal SECURITY DEFINER helpers
Programmatic block: for every `SECURITY DEFINER` function in `public` whose name matches `tg_%`, `apply_stock_movement`, `seed_printer_roles_for_property`, `create_mis_for_property`, `create_bill_sequences_for_property`, `handle_new_user`, `recompute_folio_totals`, `sync_booking_balance`, `post_nightly_room_charges`, `void_folio_safe`, `is_day_locked`:
```sql
REVOKE EXECUTE ON FUNCTION public.<fn>(...) FROM PUBLIC, anon, authenticated;
```
Keep `GRANT EXECUTE ... TO authenticated` on RPCs listed in the High finding.

### Step 4 — Confirm anon-callable allowlist
Verify that the only `anon`-executable `SECURITY DEFINER` functions are `check_login_allowed` and `record_login_attempt`. Revoke any others from `anon`.

### Step 5 — Mark findings fixed
After migration applies cleanly, mark `activity_log_insert_single_arg_can_front_desk`, `storage_single_arg_can_manage_masters`, and `SUPA_anon_security_definer_function_executable` fixed via `manage_security_finding` and re-run the linter to verify the WARN count drops.

### Out of scope (deferred unless you ask)
- Moving extensions out of `public` (medium-risk refactor).
- Adding MFA enforcement (infra already exists in `user_mfa_settings`, UI not wired).
- Sentry/error reporting review.

---

## Risk if not fixed
- Steps 1–2: real privilege-escalation paths between properties for any user with multi-property assignments. **Should fix.**
- Step 3: defense-in-depth; closes the surface but no known exploit chain today.

Approve and I'll ship a single migration covering steps 1–4 and mark the findings fixed.
