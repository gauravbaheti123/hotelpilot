// Phase 59 — Pre-rasterize print HTML to a PNG at an EXACT pixel width.
//
// Why: QZ Tray's own HTML→raster converter kept producing a tiny fragment on
// real hardware no matter how the config units/density/pageWidth were
// expressed (Phases 49/50/54), while the same HTML printed correctly through
// the browser dialog. Rendering to a PNG ourselves at the printer's real dot
// width (576 dots for an 80mm/203dpi head) removes QZ's sizing layer from the
// equation entirely: QZ just blits the bitmap 1:1.
//
// The HTML is rendered inside an isolated same-origin iframe (srcdoc), so the
// app's Tailwind stylesheet — which uses oklch() colours html2canvas cannot
// parse — never applies. Only the self-contained template CSS is in scope.

export interface RasterResult {
  /** Base64 PNG payload (no data: prefix). */
  base64: string;
  widthPx: number;
  heightPx: number;
}

function waitForAssets(doc: Document): Promise<void> {
  const imgs = Array.from(doc.images ?? []);
  const pending = imgs
    .filter((img) => !img.complete)
    .map(
      (img) =>
        new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
          setTimeout(resolve, 2000);
        }),
    );
  const fonts = (doc as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
  return Promise.all([...pending, fonts ?? Promise.resolve()]).then(() => undefined);
}

/**
 * Render a self-contained HTML document to a PNG of exactly `widthPx` pixels.
 * Height is whatever the content needs at that width.
 */
export async function rasterizeHtmlToPng(
  html: string,
  widthPx: number,
): Promise<RasterResult> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: `${widthPx}px`,
    height: "200px",
    border: "0",
    background: "#fff",
    visibility: "hidden",
  } as CSSStyleDeclaration);
  // Pin the layout viewport to the exact dot width so the template lays out
  // against the same width the bitmap will have.
  const shim = `<style>
    html,body{margin:0!important;padding:0!important;background:#fff!important;width:${widthPx}px!important;}
    body>*{max-width:${widthPx}px!important;}
    @page{margin:0}
  </style>`;
  const withShim = /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, `${shim}</head>`)
    : `${shim}${html}`;
  iframe.srcdoc = withShim;
  document.body.appendChild(iframe);
  try {
    await new Promise<void>((resolve) => {
      iframe.addEventListener("load", () => resolve(), { once: true });
      setTimeout(resolve, 3000);
    });
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) throw new Error("raster iframe unavailable");
    await waitForAssets(doc);
    // Let layout settle before measuring.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const heightPx = Math.max(
      1,
      Math.ceil(
        Math.max(
          doc.body.scrollHeight,
          doc.documentElement.scrollHeight,
          doc.body.getBoundingClientRect().height,
        ),
      ),
    );
    iframe.style.height = `${heightPx}px`;
    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(doc.body, {
      backgroundColor: "#ffffff",
      width: widthPx,
      height: heightPx,
      windowWidth: widthPx,
      windowHeight: heightPx,
      scale: 1,
      useCORS: true,
      logging: false,
    });
    const dataUrl = canvas.toDataURL("image/png");
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    console.info("[raster] html→png", {
      requestedWidthPx: widthPx,
      canvasWidthPx: canvas.width,
      canvasHeightPx: canvas.height,
      pngBytes: Math.round((base64.length * 3) / 4),
    });
    return { base64, widthPx: canvas.width, heightPx: canvas.height };
  } finally {
    setTimeout(() => iframe.remove(), 100);
  }
}