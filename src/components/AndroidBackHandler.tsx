import { useEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { isNativeApp } from "@/lib/native";
import { useBackIntentStack } from "@/hooks/use-back-intent";

/** Window in which a second back press exits the app. */
const EXIT_WINDOW_MS = 2000;

/**
 * Closes the topmost open Radix overlay (Dialog / AlertDialog / Sheet /
 * Popover / DropdownMenu) by dispatching Escape, which is the same path the
 * component's own dismiss logic already handles.
 *
 * Done via the DOM rather than per-dialog registration so every existing
 * dialog in the app is covered without touching dozens of call sites.
 */
function closeTopOverlay(): boolean {
  if (typeof document === "undefined") return false;
  const overlays = document.querySelectorAll<HTMLElement>(
    '[data-state="open"][role="dialog"], [data-state="open"][role="alertdialog"], [data-state="open"][role="menu"], [data-state="open"][role="listbox"]',
  );
  if (overlays.length === 0) return false;
  // Last in DOM order is the most recently opened / topmost.
  const top = overlays[overlays.length - 1]!;
  const target = document.activeElement instanceof HTMLElement ? document.activeElement : top;
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }),
  );
  return true;
}

/**
 * Single owner of the Android hardware/gesture back action.
 *
 * Priority: open overlay -> registered back intents (wizard step, dirty
 * form) -> router history -> press-again-to-exit.
 *
 * Exported separately from the component so the priority chain can be
 * exercised in tests without a native runtime.
 */
export function createBackHandler(deps: {
  consumeIntent: () => boolean;
  canGoBack: () => boolean;
  goBack: () => void;
  exitApp: () => void;
  notifyExitHint: () => void;
  now?: () => number;
  closeOverlay?: () => boolean;
}) {
  const now = deps.now ?? (() => Date.now());
  const closeOverlay = deps.closeOverlay ?? closeTopOverlay;
  // -Infinity so the very first press can never satisfy the exit window.
  let lastBackAt = Number.NEGATIVE_INFINITY;

  return function handleBack() {
    // 1. Topmost overlay.
    if (closeOverlay()) return;
    // 2 + 3. Wizard steps and dirty-form guards, topmost first.
    if (deps.consumeIntent()) return;
    // 4. Normal in-app history.
    if (deps.canGoBack()) {
      deps.goBack();
      return;
    }
    // 5. Landing route: confirm before leaving the app.
    const t = now();
    if (t - lastBackAt < EXIT_WINDOW_MS) {
      deps.exitApp();
      return;
    }
    lastBackAt = t;
    deps.notifyExitHint();
  };
}

export function AndroidBackHandler() {
  const router = useRouter();
  const intents = useBackIntentStack();
  const routerRef = useRef(router);
  routerRef.current = router;
  const intentsRef = useRef(intents);
  intentsRef.current = intents;

  useEffect(() => {
    if (!isNativeApp()) return;
    let remove: (() => void) | undefined;
    let cancelled = false;

    const handleBack = createBackHandler({
      consumeIntent: () => intentsRef.current?.consume() ?? false,
      canGoBack: () => {
        const r = routerRef.current;
        return (
          typeof window !== "undefined" &&
          window.history.length > 1 &&
          (r.history.canGoBack?.() ?? true)
        );
      },
      goBack: () => routerRef.current.history.back(),
      exitApp: () => {
        void import("@capacitor/app").then(({ App }) => App.exitApp());
      },
      notifyExitHint: () => toast("Press back again to exit"),
    });

    void import("@capacitor/app").then(({ App }) => {
      if (cancelled) return;
      void App.addListener("backButton", handleBack).then((listener) => {
        if (cancelled) void listener.remove();
        else remove = () => void listener.remove();
      });
    });

    return () => {
      cancelled = true;
      remove?.();
    };
  }, []);

  return null;
}