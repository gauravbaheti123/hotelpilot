import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Horizontal-scroll container for wide tables.
 *
 * - Keeps the overflow inside the card instead of the whole page (critical on
 *   360-430px phones).
 * - Optional sticky first column so row identity (guest / room / item name)
 *   stays visible while scrolling sideways.
 * - Subtle right-edge fade that disappears once the user reaches the end, so
 *   it's discoverable that more columns exist.
 * - Print-safe: the wrapper collapses to plain flow when printing.
 */
export function ResponsiveTable({
  children,
  className,
  innerClassName,
  stickyFirstColumn = false,
  minWidth,
}: {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
  stickyFirstColumn?: boolean;
  /** Optional min-width (px) forced on the inner table so columns don't crush. */
  minWidth?: number;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = React.useState(true);

  const measure = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const overflowing = el.scrollWidth - el.clientWidth > 2;
    setAtEnd(!overflowing || el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
  }, []);

  React.useEffect(() => {
    measure();
    if (typeof ResizeObserver === "undefined" || !ref.current) return;
    const ro = new ResizeObserver(measure);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [measure, children]);

  return (
    <div className={cn("relative print:!static", className)}>
      <div
        ref={ref}
        onScroll={measure}
        className={cn(
          "overflow-x-auto print:overflow-visible",
          stickyFirstColumn && [
            "[&_tr>*:first-child]:sticky [&_tr>*:first-child]:left-0 [&_tr>*:first-child]:z-10",
            "[&_tbody_tr>*:first-child]:bg-background [&_thead_tr>*:first-child]:bg-muted",
            "[&_tr>*:first-child]:after:absolute [&_tr>*:first-child]:after:inset-y-0 [&_tr>*:first-child]:after:-right-px",
            "[&_tr>*:first-child]:after:w-px [&_tr>*:first-child]:after:bg-border [&_tr>*:first-child]:after:content-['']",
            "print:[&_tr>*:first-child]:static",
          ],
          innerClassName,
        )}
        style={minWidth ? { ["--rt-min" as string]: `${minWidth}px` } : undefined}
      >
        {minWidth ? (
          <div style={{ minWidth }} className="print:!min-w-0">
            {children}
          </div>
        ) : (
          children
        )}
      </div>
      {!atEnd && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background to-transparent print:hidden"
        />
      )}
    </div>
  );
}
