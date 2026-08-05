import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { logClientError, installGlobalErrorLogging } from "@/lib/client-error-log";
import { Toaster } from "@/components/ui/sonner";
import { OfflineGate } from "@/components/OfflineGate";
import { BackIntentProvider } from "@/hooks/use-back-intent";
import { AndroidBackHandler } from "@/components/AndroidBackHandler";
import { useSessionTimeout } from "@/hooks/use-session-timeout";
import { supabase } from "@/integrations/supabase/client";
import { AUTH_QUERY_KEY } from "@/hooks/use-auth";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
    void logClientError(error, {
      boundary: "tanstack_root_error_component",
      componentStack: (error as unknown as { componentStack?: string })?.componentStack ?? null,
    });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "HotelPilot — Hotel Management Platform" },
      { name: "description", content: "HotelPilot is an end-to-end hotel management platform: front desk, rooms, billing, kitchen, housekeeping and reports. Powered by Growth Story Company." },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "HotelPilot — Hotel Management Platform" },
      { property: "og:description", content: "HotelPilot is an end-to-end hotel management platform: front desk, rooms, billing, kitchen, housekeeping and reports. Powered by Growth Story Company." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "theme-color", content: "#0f172a" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "twitter:title", content: "HotelPilot — Hotel Management Platform" },
      { name: "twitter:description", content: "HotelPilot is an end-to-end hotel management platform: front desk, rooms, billing, kitchen, housekeeping and reports. Powered by Growth Story Company." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/95e2f2b6-e28f-4fde-b5e3-f8889e4a916e/id-preview-15a4fe0c--3f4fe97d-5ab4-40d5-be69-12090784ea98.lovable.app-1782305178897.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/95e2f2b6-e28f-4fde-b5e3-f8889e4a916e/id-preview-15a4fe0c--3f4fe97d-5ab4-40d5-be69-12090784ea98.lovable.app-1782305178897.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/favicon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useSessionTimeout();
  useEffect(() => {
    installGlobalErrorLogging();
  }, []);
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      // Ignore token refreshes (hourly + tab focus) and INITIAL_SESSION;
      // only identity transitions should bust caches.
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["permissions"] });
      queryClient.invalidateQueries({ queryKey: ["user-assigned-properties"] });
      if (event === "SIGNED_OUT") {
        queryClient.clear();
        try { window.sessionStorage.removeItem("hp_authed_user"); } catch { /* ignore */ }
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <BackIntentProvider>
        <OfflineGate>
          {/* Android hardware/gesture back. No-op outside the native shell. */}
          <AndroidBackHandler />
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
          <Toaster richColors position="top-right" />
        </OfflineGate>
      </BackIntentProvider>
    </QueryClientProvider>
  );
}
