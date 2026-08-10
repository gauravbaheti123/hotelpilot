/**
 * Capture on-screen Recharts SVGs so dashboard-style reports can be exported
 * to a branded PDF that looks like what the user is seeing.
 *
 * Recharts writes theme tokens (`hsl(var(--primary))`) straight into SVG
 * attributes; those CSS variables do not exist in the print window, so they
 * are substituted with the report palette before serialising.
 */
const TOKEN_COLORS: Array<[RegExp, string]> = [
  [/hsl\(var\(--primary\)\)/g, "#0F6E56"],
  [/hsl\(var\(--secondary\)\)/g, "#2563eb"],
  [/hsl\(var\(--muted-foreground\)\)/g, "#666666"],
  [/hsl\(var\(--foreground\)\)/g, "#111111"],
  [/var\(--[a-z-]+\)/g, "#0F6E56"],
];

/** Serialised, print-safe copies of every chart inside `root`. */
export function captureChartSvgs(root: HTMLElement | null): string[] {
  if (!root || typeof window === "undefined") return [];
  const svgs = Array.from(root.querySelectorAll<SVGSVGElement>(".recharts-surface, svg.recharts-surface"));
  return svgs.map((svg) => {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const w = svg.clientWidth || Number(svg.getAttribute("width")) || 800;
    const h = svg.clientHeight || Number(svg.getAttribute("height")) || 260;
    if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${w} ${h}`);
    clone.removeAttribute("width");
    clone.removeAttribute("height");
    clone.setAttribute("preserveAspectRatio", "xMidYMid meet");
    let markup = new XMLSerializer().serializeToString(clone);
    for (const [re, color] of TOKEN_COLORS) markup = markup.replace(re, color);
    return markup;
  });
}
