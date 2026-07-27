import { useEffect, useState } from "react";
import {
  connectQZ,
  isQZConnected,
  subscribeQZStatus,
  type QZStatus,
} from "@/lib/qzPrint";

export function QZStatusIndicator() {
  const [status, setStatus] = useState<QZStatus>({ connected: isQZConnected() });

  useEffect(() => {
    const unsub = subscribeQZStatus(setStatus);
    // Kick off an initial connect attempt; QZ Tray may show a one-time
    // permission prompt the very first time.
    connectQZ().catch(() => { /* handled in status */ });
    const iv = setInterval(() => {
      connectQZ().catch(() => { /* handled */ });
    }, 30000);
    return () => { unsub(); clearInterval(iv); };
  }, []);

  const ok = status.connected;
  const warn = !ok && !!status.error && /reconnect|retry/i.test(status.error);
  const color = ok ? "bg-emerald-500" : warn ? "bg-amber-500" : "bg-rose-500";
  const label = ok
    ? "Printer connected (QZ Tray)"
    : warn
      ? "Printer reconnecting…"
      : "Printer not connected — click to retry / check QZ Tray";
  return (
    <button
      type="button"
      onClick={() => { connectQZ().catch(() => { /* handled */ }); }}
      className="inline-flex items-center justify-center h-8 w-8 rounded-full hover:bg-muted/60"
      title={status.error ?? label}
      aria-label={label}
    >
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full ring-2 ring-background ${color}`}
        aria-hidden="true"
      />
    </button>
  );
}