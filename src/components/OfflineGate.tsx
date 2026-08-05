import { useEffect, useState, type ReactNode } from "react";
import { WifiOff, RefreshCw } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";

function useOnlineStatus() {
  const [online, setOnline] = useState(true);
  // True only if the app was already offline when it first mounted.
  const [offlineAtStart, setOfflineAtStart] = useState(false);

  useEffect(() => {
    const initial = navigator.onLine;
    setOnline(initial);
    setOfflineAtStart(!initial);
    const up = () => {
      setOnline(true);
      setOfflineAtStart(false);
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  return { online, offlineAtStart };
}

function FullScreenOffline({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <div className="safe-top safe-bottom flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <Logo size={64} />
      <div className="flex flex-col items-center gap-2">
        <WifiOff className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-lg font-semibold text-foreground">No internet connection</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Please check your network and try again.
        </p>
      </div>
      <Button onClick={onRetry} disabled={retrying}>
        <RefreshCw className={retrying ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden="true" />
        Retry
      </Button>
    </div>
  );
}

function OfflineBanner() {
  return (
    <div
      role="status"
      className="safe-x fixed inset-x-0 bottom-0 z-[100] flex items-center justify-center gap-2 bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground shadow-lg"
    >
      <WifiOff className="h-4 w-4" aria-hidden="true" />
      You&apos;re offline — changes may not save until the connection is back.
    </div>
  );
}

/**
 * Full-screen takeover only when the app is opened with no connectivity;
 * a non-blocking bottom banner when the connection drops mid-use so
 * in-progress work stays visible.
 */
export function OfflineGate({ children }: { children: ReactNode }) {
  const { online, offlineAtStart } = useOnlineStatus();
  const [retrying, setRetrying] = useState(false);

  const retry = () => {
    setRetrying(true);
    if (navigator.onLine) window.location.reload();
    else setTimeout(() => setRetrying(false), 800);
  };

  if (!online && offlineAtStart) {
    return <FullScreenOffline onRetry={retry} retrying={retrying} />;
  }

  return (
    <>
      {children}
      {!online && <OfflineBanner />}
    </>
  );
}
