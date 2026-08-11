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
import { rasterizeHtmlToPng } from "./htmlRaster";

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

/**
 * Thermal DPI. EPSON TM-m30 (and virtually every 80mm thermal head) is a
 * 203 DPI device: 72mm printable width x 203 DPI = 576 dots, the standard
 * TM-m30 raster width.
 */
const THERMAL_DPI = 203;

/**
 * PRINTABLE width (not roll width) in millimetres. An 80mm roll only has
 * ~72mm of printable area; 58mm rolls have ~48mm. Rendering at the full roll
 * width makes the driver shrink-to-fit the printable area.
 */
function printableWidthMm(paperSize: QZPaperSize): number {
  if (paperSize === "A4") return 190;
  if (paperSize === "58mm") return 48;
  return 72;
}

function printableWidthInches(paperSize: QZPaperSize): number {
  return Math.round((printableWidthMm(paperSize) / 25.4) * 10000) / 10000;
}

/**
 * Exact dot width of the print head for this roll: printable mm → dots at the
 * head's native 203 DPI. 72mm → 576 dots (EPSON TM-m30), 48mm → 384 dots.
 */
export function thermalDotWidth(paperSize: QZPaperSize): number {
  return Math.round((printableWidthMm(paperSize) / 25.4) * THERMAL_DPI);
}

// Everything below is expressed in INCHES on purpose.
//
// QZ interprets `size`, `margins`, `density` AND `options.pageWidth` in the
// unit declared by the config's `units`. Mixing them is what produced the
// tiny raster:
//   - `units:"mm"` + `density:203`  → 203 dots per MM (~5156 DPI)
//   - `units:"mm"` + `pageWidth:3.1496` (an inch value) → a 3.1 MM wide HTML
//     canvas, rasterized to a few dozen pixels, then dropped on an 80mm page
//     → the exact unreadable fragment reported.
// With `units:"in"` a single unit governs every number, and density 203 is a
// genuine 203 DPI.
function paperSizeToConfig(paperSize: QZPaperSize) {
  if (paperSize === "A4") {
    return {
      units: "in" as const,
      size: { width: 8.27, height: 11.69 },
      margins: 0.4,
      density: 300,
      scaleContent: true,
      rasterize: true,
    };
  }
  // Thermal rolls: no `size` — the Windows driver's own roll page
  // ("Roll Paper 80 x 297 mm", verified correct on this printer) defines the
  // page and handles the cut. Forcing a size here previously fought the
  // driver. 1:1 raster (scaleContent:false) at the head's native 203 DPI.
  return {
    units: "in" as const,
    margins: 0,
    density: THERMAL_DPI,
    scaleContent: false,
    rasterize: true,
    colorType: "blackwhite" as const,
    interpolation: "nearest-neighbor" as const,
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
  const printConfig = paperSizeToConfig(paperSize);
  const cfg = qz.configs.create(found, printConfig);
  // QZ's embedded webkit renders the HTML at its own default viewport width
  // unless options.pageWidth is supplied, then rasterizes that render onto
  // the page. pageWidth is in the CONFIG'S UNITS — inches here — and must be
  // the printable width, matching the CSS container width used by the
  // templates (see getPrintContainerWidth in printStyles.ts).
  const widthInches = printableWidthInches(paperSize);
  const density = (printConfig as { density?: number }).density ?? THERMAL_DPI;
  const expectedRasterPx = Math.round(widthInches * density);
  const itemRows = (htmlContent.match(/class=["']item["']/g) ?? []).length;
  console.info("[qz/print-job]", {
    printer: printerName,
    paperSize,
    htmlBytes: new Blob([htmlContent]).size,
    itemRows,
    hasDocument: /<body[\s>]/i.test(htmlContent) && /<\/html>/i.test(htmlContent),
    config: printConfig,
    options: { pageWidth: widthInches },
    units: "in",
    printableWidthMm: printableWidthMm(paperSize),
    densityDpi: density,
    expectedRasterWidthPx: expectedRasterPx,
  });
  // Phase 59 — thermal rolls: pre-rasterize in the browser at the head's exact
  // dot width and hand QZ a finished bitmap. QZ's own HTML renderer stays out
  // of the sizing path (three config-level fixes failed on real hardware).
  if (paperSize !== "A4") {
    const dots = thermalDotWidth(paperSize);
    // Templates lay out in mm; convert the printable width to CSS px so the
    // content fills the sheet, then scale up to the head's dot width.
    const cssWidth = (printableWidthMm(paperSize) * 96) / 25.4;
    try {
      const png = await rasterizeHtmlToPng(htmlContent, cssWidth, dots);
      console.info("[qz/print-job] image path", {
        printer: printerName,
        dotWidth: dots,
        pngWidthPx: png.widthPx,
        pngHeightPx: png.heightPx,
      });
      await qz.print(cfg, [
        {
          type: "pixel",
          format: "image",
          flavor: "base64",
          data: png.base64,
        },
      ]);
      return;
    } catch (err) {
      // No HTML fallback for thermal: QZ's own HTML renderer produces the
      // truncated / missing-column tickets this raster path exists to avoid.
      // Surfacing the error lets the caller fall back to the browser dialog.
      console.error("[qz/print-job] raster path failed", err);
      throw new Error(
        `Thermal rasterization failed for "${printerName}": ${(err as Error)?.message ?? err}`,
      );
    }
  }
  await qz.print(cfg, [
    {
      type: "pixel",
      format: "html",
      flavor: "plain",
      data: htmlContent,
      options: { pageWidth: widthInches },
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