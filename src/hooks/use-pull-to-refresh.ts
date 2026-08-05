import { useCallback, useEffect, useRef, useState } from "react";
import { isNativeApp } from "@/lib/native";

/** Pixels the finger must travel (after damping) before a release refreshes. */
export const PTR_THRESHOLD = 70;
/** Hard cap on how far the indicator can be dragged. */
const PTR_MAX = 110;
/** Finger travel is damped so the pull feels weighted, like native. */
const PTR_DAMPING = 0.5;
/** Keep the spinner up at least this long so a fast refresh doesn't flash. */
const PTR_MIN_SPIN_MS = 400;

export type PullPhase = "idle" | "pulling" | "armed" | "refreshing";

/**
 * Any Radix overlay (Dialog, AlertDialog, Sheet) renders with
 * `role="dialog" data-state="open"`. While one is up the user is interacting
 * with the overlay, not the page behind it, so the gesture must stand down.
 */
function overlayOpen(): boolean {
  if (typeof document === "undefined") return false;
  return !!document.querySelector('[data-state="open"][role="dialog"], [data-state="open"][role="alertdialog"]');
}

interface Options {
  /** Element that actually scrolls. Gesture is a no-op until this is set. */
  scrollRef: React.RefObject<HTMLElement | null>;
  /**
   * Current refresh callback. Read through a ref internally so screens can
   * register/unregister without re-binding listeners.
   */
  onRefresh: () => unknown | Promise<unknown>;
  enabled: boolean;
}

/**
 * Touch-driven pull-to-refresh bound to a specific scroll container.
 *
 * Deliberately hand-rolled: the available libraries assume document-level
 * scroll, but this app scrolls inside AppShell's <main>.
 */
export function usePullToRefresh({ scrollRef, onRefresh, enabled }: Options) {
  const [distance, setDistance] = useState(0);
  const [phase, setPhase] = useState<PullPhase>("idle");

  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const phaseRef = useRef<PullPhase>("idle");
  phaseRef.current = phase;

  const startYRef = useRef<number | null>(null);
  const distanceRef = useRef(0);

  const setDist = useCallback((d: number) => {
    distanceRef.current = d;
    setDistance(d);
  }, []);

  const runRefresh = useCallback(async () => {
    setPhase("refreshing");
    phaseRef.current = "refreshing";
    setDist(PTR_THRESHOLD);
    const startedAt = Date.now();
    try {
      await onRefreshRef.current();
    } catch {
      /* the screen's own loader surfaces errors; never break the gesture */
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < PTR_MIN_SPIN_MS) {
        await new Promise((r) => setTimeout(r, PTR_MIN_SPIN_MS - elapsed));
      }
      setDist(0);
      setPhase("idle");
      phaseRef.current = "idle";
    }
  }, [setDist]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Only wire the gesture up inside the native shell.
    if (!isNativeApp()) return;

    const reset = () => {
      startYRef.current = null;
      if (phaseRef.current !== "refreshing") {
        setDist(0);
        setPhase("idle");
        phaseRef.current = "idle";
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (!enabledRef.current || phaseRef.current === "refreshing") return;
      if (e.touches.length !== 1) return;
      if (el.scrollTop > 0 || overlayOpen()) return;
      startYRef.current = e.touches[0]!.clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      const startY = startYRef.current;
      if (startY == null || !enabledRef.current) return;
      if (phaseRef.current === "refreshing") return;
      // Scrolled away mid-gesture (or an overlay opened) — abandon.
      if (el.scrollTop > 0 || overlayOpen()) return reset();

      const raw = e.touches[0]!.clientY - startY;
      if (raw <= 0) {
        // Upward movement: hand the gesture back to normal scrolling.
        if (distanceRef.current > 0) reset();
        return;
      }
      const d = Math.min(raw * PTR_DAMPING, PTR_MAX);
      // Claim the gesture so the WebView doesn't rubber-band underneath us.
      if (e.cancelable) e.preventDefault();
      setDist(d);
      const next: PullPhase = d >= PTR_THRESHOLD ? "armed" : "pulling";
      setPhase(next);
      phaseRef.current = next;
    };

    const onTouchEnd = () => {
      if (startYRef.current == null) return;
      startYRef.current = null;
      if (phaseRef.current === "armed" && enabledRef.current) void runRefresh();
      else reset();
    };

    // passive:false is required for preventDefault() on touchmove.
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", reset);
    };
  }, [scrollRef, runRefresh, setDist]);

  return {
    distance,
    phase,
    /** Programmatic trigger — used by tests and by any "retry" affordance. */
    refresh: runRefresh,
  };
}