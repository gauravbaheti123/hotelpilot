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
 * Inline every remote <img> as a data URL BEFORE html2canvas runs.
 *
 * Branded documents (Food/Laundry bills, invoices) carry the property logo as
 * a Supabase signed URL. That is a cross-origin image: html2canvas draws it
 * onto the canvas, the canvas becomes tainted, and `toDataURL()` then throws
 * SecurityError — the whole raster path fails and the caller silently falls
 * back to QZ Tray's own HTML renderer, which produces the truncated /
 * missing-column thermal prints. KOT tickets have no logo, which is why they
 * always printed fine.
 *
 * Fetching the bytes ourselves keeps the canvas clean; any image that can't be
 * fetched is dropped rather than allowed to break the whole bill.
 */
async function inlineImages(doc: Document): Promise<void> {
  const imgs = Array.from(doc.images ?? []);
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute("src") ?? "";
      if (!src || src.startsWith("data:")) return;
      try {
        const res = await fetch(src, { mode: "cors", credentials: "omit" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.onerror = () => reject(fr.error ?? new Error("read failed"));
          fr.readAsDataURL(blob);
        });
        await new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
          img.setAttribute("src", dataUrl);
          setTimeout(resolve, 2000);
        });
      } catch (err) {
        console.warn("[raster] dropping un-inlinable image", src.slice(0, 80), err);
        img.remove();
      }
    }),
  );
}

/**
 * Render a self-contained HTML document to a PNG.
 *
 * `cssWidthPx` is the CSS layout width the template expects (e.g. 72mm ≈ 272
 * CSS px) — the templates size themselves in mm, so laying out at the raw dot
 * width would leave the content stranded in a corner. `targetWidthPx` is the
 * printer's real dot width; the difference is applied as a render scale, so
 * the bitmap comes out at exactly `targetWidthPx` pixels with crisp text.
 */
export async function rasterizeHtmlToPng(
  html: string,
  cssWidthPx: number,
  targetWidthPx: number,
  gutter?: { leftPx?: number; rightPx?: number },
): Promise<RasterResult> {
  const widthPx = Math.max(1, Math.round(cssWidthPx));
  const scale = targetWidthPx / widthPx;
  // Physical safe area: thermal heads (and their drivers) lose the first
  // couple of millimetres at the left edge of the roll, which clipped the
  // first 1-2 characters of every line. Content is inset inside the bitmap so
  // nothing ever sits at pixel column 0.
  const padLeft = Math.max(0, Math.round(gutter?.leftPx ?? 0));
  const padRight = Math.max(0, Math.round(gutter?.rightPx ?? 0));
  const contentWidthPx = Math.max(1, widthPx - padLeft - padRight);
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
    html{margin:0!important;padding:0!important;background:#fff!important;width:${widthPx}px!important;}
    body{margin:0!important;background:#fff!important;width:${widthPx}px!important;
         padding:0 ${padRight}px 0 ${padLeft}px!important;box-sizing:border-box!important;}
    body>*{max-width:${contentWidthPx}px!important;width:auto!important;}
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
    await inlineImages(doc);
    await waitForAssets(doc);
    // Let layout settle before measuring.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    // scrollHeight never drops below the iframe viewport, so collapse the frame
    // first — otherwise short tickets get padded with blank roll. The few extra
    // px guard against font-metric differences during rasterization clipping
    // the final line.
    iframe.style.height = "1px";
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const heightPx =
      Math.max(
        1,
        Math.ceil(
          Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight),
        ),
      ) + 12;
    iframe.style.height = `${heightPx}px`;
    const html2canvas = (await import("html2canvas")).default;
    const shoot = () =>
      html2canvas(doc.body, {
        backgroundColor: "#ffffff",
        width: widthPx,
        height: heightPx,
        windowWidth: widthPx,
        windowHeight: heightPx,
        scale,
        useCORS: true,
        logging: false,
      });
    let canvas = await shoot();
    let dataUrl: string;
    try {
      dataUrl = canvas.toDataURL("image/png");
    } catch (err) {
      // Last-resort: a tainted canvas means an image slipped through. Drop
      // every image and re-shoot — a logo-less bill beats a garbled one.
      console.warn("[raster] canvas tainted, retrying without images", err);
      Array.from(doc.images ?? []).forEach((img) => img.remove());
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      canvas = await shoot();
      dataUrl = canvas.toDataURL("image/png");
    }
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    console.info("[raster] html→png", {
      cssWidthPx: widthPx,
      measuredHeightCssPx: heightPx,
      targetWidthPx,
      scale: Math.round(scale * 1000) / 1000,
      canvasWidthPx: canvas.width,
      canvasHeightPx: canvas.height,
      pngBytes: Math.round((base64.length * 3) / 4),
    });
    return { base64, widthPx: canvas.width, heightPx: canvas.height };
  } finally {
    setTimeout(() => iframe.remove(), 100);
  }
}