import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logAuthEvent } from "@/lib/auth-security";

/**
 * Idle + absolute session timeouts.
 *
 *   IDLE_TIMEOUT_MS     — auto-logout after no user activity
 *   ABSOLUTE_SESSION_MS — hard cap on a session regardless of activity
 *   WARN_BEFORE_MS      — show a toast this long before idle logout
 *
 * Adjust the constants below to retune. Activity is tracked via
 * mousemove / keydown / click / scroll / touchstart on the window.
 */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const ABSOLUTE_SESSION_MS = 12 * 60 * 60 * 1000; // 12 hours
const WARN_BEFORE_MS = 60 * 1000; // 1 minute warning

const LAST_ACTIVITY_KEY = "hp.lastActivity";
const SESSION_START_KEY = "hp.sessionStart";

function now() {
  return Date.now();
}

async function forceLogout(reason: "idle" | "absolute") {
  try {
    await logAuthEvent("auto_logout", { reason });
  } catch {
    /* swallow */
  }
  try {
    await supabase.auth.signOut();
  } catch {
    /* swallow */
  }
  try {
    sessionStorage.removeItem(LAST_ACTIVITY_KEY);
    sessionStorage.removeItem(SESSION_START_KEY);
  } catch {
    /* swallow */
  }
  toast.error(
    reason === "idle"
      ? "You were signed out due to inactivity."
      : "Your session expired. Please sign in again.",
  );
  if (typeof window !== "undefined") {
    window.location.href = "/login";
  }
}

export function useSessionTimeout() {
  const warnedRef = useRef(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let active = false;

    const markActivity = () => {
      if (!active) return;
      try {
        sessionStorage.setItem(LAST_ACTIVITY_KEY, String(now()));
      } catch {
        /* ignore */
      }
      warnedRef.current = false;
    };

    const ensureSessionStart = () => {
      try {
        if (!sessionStorage.getItem(SESSION_START_KEY)) {
          sessionStorage.setItem(SESSION_START_KEY, String(now()));
        }
      } catch {
        /* ignore */
      }
    };

    const evaluate = () => {
      if (!active) return;
      let last = 0;
      let start = 0;
      try {
        last = Number(sessionStorage.getItem(LAST_ACTIVITY_KEY) || "0");
        start = Number(sessionStorage.getItem(SESSION_START_KEY) || "0");
      } catch {
        /* ignore */
      }
      const t = now();
      if (start && t - start > ABSOLUTE_SESSION_MS) {
        void forceLogout("absolute");
        return;
      }
      if (last && t - last > IDLE_TIMEOUT_MS) {
        void forceLogout("idle");
        return;
      }
      if (last && t - last > IDLE_TIMEOUT_MS - WARN_BEFORE_MS && !warnedRef.current) {
        warnedRef.current = true;
        toast.warning("You will be signed out shortly due to inactivity.");
      }
    };

    const start = () => {
      active = true;
      ensureSessionStart();
      markActivity();
      tickRef.current = setInterval(evaluate, 15 * 1000);
    };

    const stop = () => {
      active = false;
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      try {
        sessionStorage.removeItem(LAST_ACTIVITY_KEY);
        sessionStorage.removeItem(SESSION_START_KEY);
      } catch {
        /* ignore */
      }
    };

    // Start tracking only if a session exists; respond to auth changes.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) start();
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        stop();
      } else if (event === "SIGNED_IN") {
        try {
          sessionStorage.setItem(SESSION_START_KEY, String(now()));
        } catch {
          /* ignore */
        }
        start();
      } else if (!active) {
        start();
      }
    });

    const events = [
      "mousemove",
      "keydown",
      "click",
      "scroll",
      "touchstart",
    ] as const;
    events.forEach((e) => window.addEventListener(e, markActivity, { passive: true }));
    document.addEventListener("visibilitychange", markActivity);

    return () => {
      sub.subscription.unsubscribe();
      events.forEach((e) => window.removeEventListener(e, markActivity));
      document.removeEventListener("visibilitychange", markActivity);
      stop();
    };
  }, []);
}