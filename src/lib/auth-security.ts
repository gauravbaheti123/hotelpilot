import { supabase } from "@/integrations/supabase/client";

/**
 * Client-side auth security helpers.
 * Backed by RPCs: check_login_allowed, record_login_attempt, log_auth_event.
 *
 * Configuration (server-side, see migration):
 *   - MAX_FAILS_BEFORE_LOCK = 5
 *   - LOCK_DURATION         = 15 minutes
 *   - RATE_LIMIT_WINDOW     = 10 minutes / 10 attempts per email
 *
 * Inactivity / session timeouts (client, see use-session-timeout.ts):
 *   - IDLE_TIMEOUT_MS       = 30 minutes
 *   - ABSOLUTE_SESSION_MS   = 12 hours
 */

function getUA(): string | undefined {
  if (typeof navigator === "undefined") return undefined;
  return navigator.userAgent;
}

export type LoginCheck =
  | { allowed: true; failed_count: number }
  | { allowed: false; reason: string; locked_until?: string; failed_count?: number };

export async function checkLoginAllowed(email: string): Promise<LoginCheck> {
  const { data, error } = await supabase.rpc("check_login_allowed", { _email: email });
  if (error) {
    // Fail-open on infra error so users aren't locked out by a DB hiccup,
    // but log to console for monitoring.
    console.warn("[auth-security] check_login_allowed failed:", error.message);
    return { allowed: true, failed_count: 0 };
  }
  return data as LoginCheck;
}

export async function recordLoginAttempt(
  email: string,
  success: boolean,
  reason?: string,
): Promise<void> {
  await supabase.rpc("record_login_attempt", {
    _email: email,
    _success: success,
    _ip: undefined,
    _user_agent: getUA(),
    _reason: reason,
  });
}

export async function logAuthEvent(
  eventType: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await supabase.rpc("log_auth_event", {
      _event_type: eventType,
      _metadata: metadata as never,
      _ip: undefined,
      _user_agent: getUA(),
    });
  } catch (e) {
    console.warn("[auth-security] log_auth_event failed", e);
  }
}

export function lockoutMessage(check: Extract<LoginCheck, { allowed: false }>): string {
  if (check.reason === "locked" && check.locked_until) {
    const mins = Math.max(
      1,
      Math.ceil((new Date(check.locked_until).getTime() - Date.now()) / 60000),
    );
    return `Account temporarily locked due to too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`;
  }
  if (check.reason === "rate_limited") {
    return "Too many login attempts. Please wait a few minutes and try again.";
  }
  if (check.reason === "invalid_email") return "Please enter a valid email.";
  return "Sign-in temporarily unavailable. Please try again shortly.";
}