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
let certificatePromiseConfigured = false;
let signaturePromiseConfigured = false;
let lastConnectedWithSecurity = false;
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

function getQZSigningAlgorithm(): string {
  try { return qz.security.getSignatureAlgorithm?.() ?? "unknown"; } catch { return "unknown"; }
}

function qzSecurityState() {
  return `securityConfigured=${securityConfigured}, certificatePromiseConfigured=${certificatePromiseConfigured}, signaturePromiseConfigured=${signaturePromiseConfigured}, algorithm=${getQZSigningAlgorithm()}`;
}

function configureSecurity(): boolean {
  if (securityConfigured && certificatePromiseConfigured && signaturePromiseConfigured) return true;
  try {
    console.log(
      "[qz] configuring security — cert length:",
      QZ_PUBLIC_CERTIFICATE?.length ?? 0,
    );
    // Serve our public certificate to QZ Tray on handshake.
    qz.security.setCertificatePromise((resolve: any, _reject: any) => {
      console.log("[qz] certificate promise invoked — cert length:", QZ_PUBLIC_CERTIFICATE?.length ?? 0);
      resolve(QZ_PUBLIC_CERTIFICATE);
    }, { rejectOnFailure: true });
    certificatePromiseConfigured = true;
    // QZ Tray's JS client defaults to SHA1; our qz-sign function signs
    // SHA-512, so explicitly advertise SHA512 before any websocket connect.
    qz.security.setSignatureAlgorithm?.("SHA512");
    // Sign each challenge via the qz-sign edge function using SHA-512
    // (declared above). The private key never leaves the server.
    qz.security.setSignaturePromise((toSign: string) => {
      console.log("[qz] signature promise invoked — payload length:", toSign?.length ?? 0);
      return (resolve: any, reject: any) => {
        supabase.functions
          .invoke("qz-sign", { body: { toSign } })
          .then(({ data, error }) => {
            if (error) {
              console.error("[qz] qz-sign returned error", error);
              return reject(error);
            }
            const sig = (data as { signature?: string } | null)?.signature;
            if (!sig) {
              console.error("[qz] qz-sign returned no signature", data);
              return reject(new Error("qz-sign returned no signature"));
            }
            console.log("[qz] signature received — length:", sig.length);
            resolve(sig);
          })
          .catch((err) => {
            console.error("[qz] qz-sign invoke failed", err);
            reject(err);
          });
      };
    });
    signaturePromiseConfigured = true;
    securityConfigured = true;
    console.log("[qz] security configured:", qzSecurityState());
    return true;
  } catch (err) {
    securityConfigured = false;
    console.warn("[qz] security config failed", err);
    return false;
  }
}

export function isQZConnected(): boolean {
  try { return qz.websocket.isActive(); } catch { return false; }
}

export async function connectQZ(): Promise<QZStatus> {
  console.log(`[qz] connectQZ start — ${qzSecurityState()}, active=${isQZConnected()}`);
  const configured = configureSecurity();
  if (!configured) {
    const s = { connected: false, error: "QZ security setup failed" };
    setStatus(s);
    return s;
  }
  if (isQZConnected()) {
    if (!lastConnectedWithSecurity) {
      // A websocket can survive a dev hot update or an older unsigned connect
      // in the same tab. Certificate/signature promises are only used during
      // connection setup, so an already-open unsigned socket must be replaced.
      console.warn("[qz] active websocket predates signed setup; reconnecting with certificate/signature promises");
      try { await qz.websocket.disconnect(); } catch { /* ignore */ }
    } else {
    const s = { connected: true };
    setStatus(s);
    return s;
    }
  }
  if (connectingPromise) return connectingPromise;
  console.log(`[qz] before qz.websocket.connect — ${qzSecurityState()}`);
  connectingPromise = (async () => {
    try {
      await qz.websocket.connect({ retries: 0, delay: 0 });
      lastConnectedWithSecurity = true;
      const s = { connected: true };
      setStatus(s);
      return s;
    } catch (err: any) {
      lastConnectedWithSecurity = false;
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
  lastConnectedWithSecurity = false;
  setStatus({ connected: false });
}

function paperSizeToConfig(paperSize: QZPaperSize) {
  // Pixel/HTML print type: dimensions are millimetres, but QZ's `density`
  // uses the same unit. Supplying density: 203 together with units: "mm"
  // means 203 dots/mm (~5156 DPI), not the intended 203 DPI, and causes the
  // Windows raster to be reduced to a tiny fragment. Let the printer driver
  // use its native DPI instead.
  // A4 is scaled to fit the sheet. Thermal rolls MUST print 1:1
  // (scaleContent: false): with an auto height (height 0) QZ has no fixed
  // page box to scale against, so scaleContent shrinks the raster to a tiny
  // unreadable fragment. Height 0 lets the driver cut after content.
  if (paperSize === "A4") {
    return {
      units: "mm" as const,
      size: { width: 210, height: 297 },
      margins: 10,
      scaleContent: true,
      rasterize: true,
    };
  }
  if (paperSize === "58mm") {
    return {
      units: "mm" as const,
      size: { width: 58, height: 0 },
      margins: 2,
      scaleContent: false,
      rasterize: true,
    };
  }
  // Default 80mm thermal.
  return {
    units: "mm" as const,
    size: { width: 80, height: 0 },
    margins: 2,
    scaleContent: false,
    rasterize: true,
  };
}

function paperWidthMm(paperSize: QZPaperSize): number {
  if (paperSize === "A4") return 210;
  if (paperSize === "58mm") return 58;
  return 80;
}

function isThermalPaper(paperSize: QZPaperSize): boolean {
  return paperSize !== "A4";
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
  const printConfig = paperSizeToConfig(paperSize);
  const cfg = qz.configs.create(found, printConfig);
  const widthMm = paperWidthMm(paperSize);
  // QZ's embedded webkit renders HTML at its own default viewport width
  // (nowhere close to 58/80mm) unless options.pageWidth is supplied, then
  // rasterizes that render onto the page. With scaleContent:false (required
  // for thermal so content isn't shrunk), an unset pageWidth produces a
  // render many times wider than the roll — the actual ticket content ends
  // up as a tiny fragment in a corner of an otherwise blank page. Always
  // pass pageWidth (mm, same units as the config) so the render width
  // matches the physical/printable width for every paper size.
  const itemRows = (htmlContent.match(/class=["']item["']/g) ?? []).length;
  console.info("[qz/print-job]", {
    printer: printerName,
    paperSize,
    htmlBytes: new Blob([htmlContent]).size,
    itemRows,
    hasDocument: /<body[\s>]/i.test(htmlContent) && /<\/html>/i.test(htmlContent),
    config: printConfig,
  });
  await qz.print(cfg, [
    {
      type: "pixel",
      format: "html",
      flavor: "plain",
      data: htmlContent,
      options: { pageWidth: widthMm, pageHeight: 0 },
    },
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