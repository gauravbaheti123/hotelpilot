/**
 * Folio navigation that understands split bills.
 *
 * A booking normally has exactly one live folio, and every "Folio" button in
 * the app used to link straight to `/billing/folio/$bookingId`, letting the
 * `get_or_create_folio` RPC resolve it. After a Split Bill that booking has
 * several sibling folios (`parent_folio_id` set) — the RPC returns only one of
 * them, so the other portions had no navigable path at all.
 *
 * This module is the single implementation of the "how many folios does this
 * booking have?" check:
 *   - 0 or 1 folio  -> navigate immediately (identical to the old behaviour)
 *   - 2+ folios     -> show a small picker, each row deep-linking to
 *                      `?folio=<id>` (a route capability that already exists)
 */
import { useCallback, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { VariantProps } from "class-variance-authority";

import { supabase } from "@/integrations/supabase/client";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { inr } from "@/lib/billing";
import { billNo, isProvisional } from "@/lib/billNumber";
import { reportQueryError } from "@/lib/queryError";
import { cn } from "@/lib/utils";

interface FolioRow {
  id: string;
  invoice_number: string | null;
  status: string;
  total_amount: number | null;
  balance_amount: number | null;
  parent_folio_id: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  open: "Provisional",
  settled: "Settled",
  due: "Due",
  refunded: "Refunded",
};

function statusLabel(f: FolioRow): string {
  return STATUS_LABEL[f.status] ?? f.status;
}

/** "BRIJ-LDG-0206" for a numbered folio, "Provisional" while it is still open. */
function folioLabel(f: FolioRow): string {
  return isProvisional(f.invoice_number, f.status) ? "Provisional" : billNo(f.invoice_number);
}

/**
 * Shared opener. Returns a click handler plus the picker element that callers
 * must render. Use this directly for imperative call sites (menus, modals);
 * use `<FolioOpenButton>` for ordinary buttons.
 */
export function useFolioOpener() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [choices, setChoices] = useState<FolioRow[]>([]);

  const go = useCallback(
    (bId: string, folioId?: string) => {
      navigate({
        to: "/billing/folio/$bookingId",
        params: { bookingId: bId },
        ...(folioId ? { search: { folio: folioId } } : {}),
      } as never);
    },
    [navigate],
  );

  const openFolio = useCallback(
    async (bId: string) => {
      if (!bId || busy) return;
      setBusy(true);
      try {
        const { data, error } = await supabase
          .from("folios")
          .select("id,invoice_number,status,total_amount,balance_amount,parent_folio_id,created_at")
          .eq("booking_id", bId)
          .eq("is_deleted", false)
          .neq("status", "void")
          .order("created_at", { ascending: true });
        if (error) reportQueryError("folios", error);
        const rows = ((data ?? []) as unknown as FolioRow[]);
        // 0 folios -> let the folio page create one (unchanged behaviour).
        // 1 folio  -> straight through, zero extra clicks.
        if (rows.length <= 1) {
          go(bId, rows[0]?.id);
          return;
        }
        setChoices(rows);
        setBookingId(bId);
      } finally {
        setBusy(false);
      }
    },
    [busy, go],
  );

  const picker = (
    <Dialog open={bookingId !== null} onOpenChange={(o) => { if (!o) setBookingId(null); }}>
      <DialogContent className="w-[95vw] max-w-md">
        <DialogHeader>
          <DialogTitle>Which bill?</DialogTitle>
          <DialogDescription>
            This booking was split into {choices.length} portions. Pick the one to open.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {choices.map((f, i) => (
            <button
              key={f.id}
              type="button"
              className="w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => {
                const bId = bookingId;
                setBookingId(null);
                if (bId) go(bId, f.id);
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium truncate">
                  Portion {i + 1} — {folioLabel(f)}
                </span>
                <span className="font-medium tabular-nums">{inr(f.total_amount ?? 0)}</span>
              </div>
              <div className={cn(
                "text-xs",
                f.status === "open" ? "text-amber-700" : "text-muted-foreground",
              )}>
                {statusLabel(f)}
                {Number(f.balance_amount ?? 0) > 0 ? ` · Balance ${inr(f.balance_amount)}` : ""}
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );

  return { openFolio, picker, busy };
}

type NativeButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

interface FolioOpenButtonProps extends Omit<NativeButtonProps, "onClick"> {
  bookingId: string;
  /** Render a bare element (no Button chrome) — for list rows and menu items. */
  unstyled?: boolean;
}

/** Drop-in replacement for a `<Link to="/billing/folio/$bookingId">` button. */
export function FolioOpenButton({
  bookingId, unstyled, className, children, variant, size, ...rest
}: FolioOpenButtonProps) {
  const { openFolio, picker, busy } = useFolioOpener();
  const onClick = () => { void openFolio(bookingId); };
  return (
    <>
      {unstyled ? (
        <button type="button" className={className} onClick={onClick} disabled={busy} {...rest}>
          {children}
        </button>
      ) : (
        <Button className={className} variant={variant} size={size} onClick={onClick} disabled={busy} {...rest}>
          {children}
        </Button>
      )}
      {picker}
    </>
  );
}
