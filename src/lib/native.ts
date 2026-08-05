/**
 * Native-shell detection.
 *
 * The web build is served both in a plain browser (desktop staff, published
 * site) and inside the Capacitor Android WebView which live-loads the same
 * URL. Native-only affordances (pull-to-refresh, hardware back handling) must
 * be gated on this so browser users keep normal scroll + F5 behaviour.
 *
 * Import is static but every call is SSR-safe: during prerender there is no
 * `window`, so we report "not native" without touching Capacitor internals.
 */
import { Capacitor } from "@capacitor/core";

export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function nativePlatform(): string {
  if (typeof window === "undefined") return "web";
  try {
    return Capacitor.getPlatform();
  } catch {
    return "web";
  }
}