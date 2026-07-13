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
  const label = ok
    ? "Printer: Connected"
    : "Printer: Not Connected — check QZ Tray is running";
  return (
    <div
      className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground"
      title={status.error ?? label}
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : "bg-rose-500"}`}
        aria-hidden="true"
      />
      <span className="truncate max-w-[220px]">{label}</span>
    </div>
  );
}