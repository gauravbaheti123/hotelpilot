import { supabase } from "@/integrations/supabase/client";

export interface ClientErrorContext {
  route?: string;
  componentStack?: string | null;
  boundary?: string;
  extra?: Record<string, unknown>;
}

const LS_PROPERTY_KEY = "hp.currentPropertyId";

function safeRoute(): string {
  if (typeof window === "undefined") return "";
  return window.location.pathname + window.location.search;
}

function safeProperty(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LS_PROPERTY_KEY);
  } catch {
    return null;
  }
}

function serializeError(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return { message: error.message || String(error), stack: error.stack ?? null };
  }
  try {
    return { message: typeof error === "string" ? error : JSON.stringify(error), stack: null };
  } catch {
    return { message: String(error), stack: null };
  }
}

/**
 * Persist a client crash to `client_error_log` and echo full context to the
 * console. Never throws — logging must not itself cause a cascade.
 */
export async function logClientError(error: unknown, ctx: ClientErrorContext = {}): Promise<void> {
  const { message, stack } = serializeError(error);
  const route = ctx.route ?? safeRoute();
  const property_id = safeProperty();
  const user_agent = typeof navigator !== "undefined" ? navigator.userAgent : null;

  // Always dump full detail to console for dev-tools visibility.
  // eslint-disable-next-line no-console
  console.error("[client-error]", {
    message,
    stack,
    route,
    property_id,
    boundary: ctx.boundary,
    componentStack: ctx.componentStack,
    extra: ctx.extra,
    error,
  });

  try {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user ?? null;
    await supabase.from("client_error_log" as never).insert({
      user_id: user?.id ?? null,
      user_email: user?.email ?? null,
      property_id,
      route,
      message: message.slice(0, 2000),
      stack: stack ? stack.slice(0, 8000) : null,
      component_stack: ctx.componentStack ? ctx.componentStack.slice(0, 8000) : null,
      user_agent,
      extra: {
        boundary: ctx.boundary ?? null,
        ...(ctx.extra ?? {}),
      },
    } as never);
  } catch (logErr) {
    // eslint-disable-next-line no-console
    console.warn("[client-error] failed to persist crash log", logErr);
  }
}

let globalHandlersInstalled = false;

/**
 * Install window-level error + unhandledrejection listeners so crashes that
 * bypass the React error boundary (async callbacks, Realtime handlers, etc.)
 * still land in `client_error_log`.
 */
export function installGlobalErrorLogging(): void {
  if (globalHandlersInstalled || typeof window === "undefined") return;
  globalHandlersInstalled = true;

  window.addEventListener("error", (event) => {
    void logClientError(event.error ?? event.message, {
      boundary: "window_onerror",
      extra: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    void logClientError(event.reason, { boundary: "unhandledrejection" });
  });
}