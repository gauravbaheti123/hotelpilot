// QZ Tray silent-print bridge.
//
// Connects to the QZ Tray desktop agent over its local websocket (ports
// 8181/8182) and sends HTML print jobs directly to a Windows printer by
// exact name — no browser print dialog.
//
// Signed mode: the public certificate is embedded client-side; each
// signing challenge is forwarded to the `qz-sign` Supabase edge function
// which signs it with the private key (never exposed to the browser).
// With the certificate imported/trusted in QZ Tray, the "Untrusted
// website" popup disappears.
import qz from "qz-tray";
import { supabase } from "@/integrations/supabase/client";
import { QZ_PUBLIC_CERTIFICATE } from "./qzCertificate";

export type QZPaperSize = "58mm" | "80mm" | "A4" | string;

export type QZStatus = {
  connected: boolean;
  error?: string;
};

let connectingPromise: Promise<QZStatus> | null = null;
let securityConfigured = false;
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

function configureSecurity() {
  if (securityConfigured) return;
  securityConfigured = true;
  try {
    console.log(
      "[qz] configuring security — cert length:",
      QZ_PUBLIC_CERTIFICATE?.length ?? 0,
    );
    // Serve our public certificate to QZ Tray on handshake.
    qz.security.setCertificatePromise((resolve: any, _reject: any) => {
      resolve(QZ_PUBLIC_CERTIFICATE);
    });
    // Sign each challenge via the qz-sign edge function using SHA-512
    // (qz-tray 2.1+ default). The private key never leaves the server.
    qz.security.setSignaturePromise((toSign: string) => {
      return (resolve: any, reject: any) => {
        supabase.functions
          .invoke("qz-sign", { body: { toSign } })
          .then(({ data, error }) => {
            if (error) return reject(error);
            const sig = (data as { signature?: string } | null)?.signature;
            if (!sig) return reject(new Error("qz-sign returned no signature"));
            resolve(sig);
          })
          .catch(reject);
      };
    });
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
  configureSecurity();
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