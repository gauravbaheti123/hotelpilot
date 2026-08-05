/**
 * Shared "which folios of this booking are actually live?" logic.
 *
 * After a Split Bill the original (parent) folio is meant to be voided by
 * `void_folio_safe`, leaving only the child portions. When that void does not
 * land (RLS, a failed payment re-home, an interrupted split), the parent
 * survives as an `open` folio that still carries a FULL copy of every charge
 * that was cloned onto the children. Any code that then sums a single folio
 * — Check-out most importantly — double-counts the bill and shows a phantom
 * balance.
 *
 * A parent that has at least one live (non-void, non-deleted) child is
 * "superseded": its charges live on in the portions and it must never be
 * treated as a payable bill again.
 */

export interface FolioLike {
  id: string;
  parent_folio_id?: string | null;
  status?: string | null;
  is_deleted?: boolean | null;
}

/** Non-deleted, non-void, non-refunded folios. */
export function liveFolios<T extends FolioLike>(rows: T[]): T[] {
  return (rows ?? []).filter(
    (f) => !f?.is_deleted && !["void", "refunded"].includes(String(f?.status ?? "")),
  );
}

/** Ids of live folios that have been split into live child portions. */
export function supersededParentIds<T extends FolioLike>(rows: T[]): Set<string> {
  const live = liveFolios(rows);
  const ids = new Set<string>();
  for (const f of live) if (f.parent_folio_id) ids.add(String(f.parent_folio_id));
  return ids;
}

/**
 * Live folios with superseded parents removed — the true set of bills that
 * represent this booking's money.
 */
export function payableFolios<T extends FolioLike>(rows: T[]): T[] {
  const superseded = supersededParentIds(rows);
  return liveFolios(rows).filter((f) => !superseded.has(String(f.id)));
}
