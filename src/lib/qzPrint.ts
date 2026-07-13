// QZ Tray silent-print bridge.
//
// Connects to the QZ Tray desktop agent over its local websocket (ports
// 8181/8182) and sends HTML print jobs directly to a Windows printer by
// exact name — no browser print dialog.
//
// Unsigned mode: we bypass certificate signing so the app runs without a
// private key on the client. QZ Tray shows a one-time "Action Required"
// prompt the first time; users tick "Remember this decision" and Allow.
import qz from "qz-tray";

export type QZPaperSize = "58mm" | "80mm" | "A4" | string;

export type QZStatus = {
  connected: boolean;
  error?: string;
};

let connectingPromise: Promise<QZStatus> | null = null;
let unsignedConfigured = false;
const listeners = new Set<(s: QZStatus) => void>();
let lastStatus: QZStatus = { connected: false };

function setStatus(next: QZStatus) {
  lastStatus = next;
  listeners.forEach((fn) => {
    try { fn(next); } catch { /* ignore */ }
  });
}

export function getQZStatus(): QZStatus {
  return lastStatus;
}

export function subscribeQZStatus(fn: (s: QZStatus) => void): () => void {
  listeners.add(fn);
  fn(lastStatus);
  return () => listeners.delete(fn);
}

function configureUnsigned() {
  if (unsignedConfigured) return;
  unsignedConfigured = true;
  try {
    // No certificate — QZ Tray will prompt the user once.
    qz.security.setCertificatePromise((resolve: any) => resolve());
    // Reject signing — again, QZ prompts the user for permission.
    qz.security.setSignaturePromise(() => (resolve: any) => resolve());
  } catch (err) {
    console.warn("[qz] security config failed", err);
  }
}

export function isQZConnected(): boolean {
  try { return qz.websocket.isActive(); } catch { return false; }
}

export async function connectQZ(): Promise<QZStatus> {
  if (isQZConnected()) {
    const s = { connected: true };
    setStatus(s);
    return s;
  }
  if (connectingPromise) return connectingPromise;
  configureUnsigned();
  connectingPromise = (async () => {
    try {
      await qz.websocket.connect({ retries: 0, delay: 0 });
      const s = { connected: true };
      setStatus(s);
      return s;
    } catch (err: any) {
      const s = { connected: false, error: String(err?.message ?? err) };
      setStatus(s);
      return s;
    } finally {
      connectingPromise = null;
    }
  })();
  return connectingPromise;
}

export async function disconnectQZ(): Promise<void> {
  if (!isQZConnected()) return;
  try { await qz.websocket.disconnect(); } catch { /* ignore */ }
  setStatus({ connected: false });
}

function paperSizeToConfig(paperSize: QZPaperSize) {
  // Pixel/HTML print type: units are mm; QZ scales HTML content into the
  // printable area. Height 0 lets thermal drivers cut after content.
  if (paperSize === "A4") {
    return {
      units: "mm" as const,
      size: { width: 210, height: 297 },
      margins: 10,
      density: 203,
      scaleContent: true,
      rasterize: true,
    };
  }
  if (paperSize === "58mm") {
    return {
      units: "mm" as const,
      size: { width: 58, height: 0 },
      margins: 2,
      density: 203,
      scaleContent: false,
      rasterize: true,
    };
  }
  // Default 80mm thermal.
  return {
    units: "mm" as const,
    size: { width: 80, height: 0 },
    margins: 2,
    density: 203,
    scaleContent: false,
    rasterize: true,
  };
}

/**
 * Silently prints HTML content to a named Windows printer via QZ Tray.
 * Rejects with a descriptive error (including the requested printer name)
 * if the connection is not live or the printer isn't found.
 */
export async function printToPrinter(
  printerName: string,
  htmlContent: string,
  paperSize: QZPaperSize,
): Promise<void> {
  if (!isQZConnected()) {
    const status = await connectQZ();
    if (!status.connected) {
      throw new Error(
        `QZ Tray not connected (target: "${printerName}"): ${status.error ?? "unknown error"}`,
      );
    }
  }
  let found: any;
  try {
    found = await qz.printers.find(printerName);
  } catch (err: any) {
    throw new Error(
      `Printer "${printerName}" not found via QZ Tray. Check the Windows printer name matches exactly (case-sensitive). (${err?.message ?? err})`,
    );
  }
  if (!found) {
    throw new Error(`Printer "${printerName}" not found via QZ Tray.`);
  }
  const cfg = qz.configs.create(found, paperSizeToConfig(paperSize));
  await qz.print(cfg, [
    { type: "pixel", format: "html", flavor: "plain", data: htmlContent },
  ]);
}

/** Poll connection state; used by the header indicator. */
export async function refreshQZStatus(): Promise<QZStatus> {
  if (isQZConnected()) {
    const s = { connected: true };
    setStatus(s);
    return s;
  }
  return connectQZ();
}