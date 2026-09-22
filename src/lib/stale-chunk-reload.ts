/**
 * After a new version is published, the old page in a user's browser still
 * asks for JS chunks whose hashed filenames no longer exist on the server.
 * The import then rejects with "Failed to fetch dynamically imported module"
 * and the router shows the generic crash screen.
 *
 * Instead of showing that screen, reload once to pick up the fresh build.
 * The reload is guarded by a sessionStorage marker so a genuinely broken
 * deploy can never turn into an infinite reload loop.
 */

const MARKER = "hp.staleChunkReloadAt";
const COOLDOWN_MS = 30_000;

const PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /'text\/html' is not a valid javascript mime type/i,
  /unable to preload css/i,
  /ChunkLoadError/i,
];

export function isStaleChunkError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : "";
  if (!message) return false;
  return PATTERNS.some((re) => re.test(message));
}

/**
 * Returns true when a reload was triggered (caller should render nothing
 * useful, the page is about to go away).
 */
export function reloadIfStaleChunk(error: unknown): boolean {
  if (typeof window === "undefined") return false;
  if (!isStaleChunkError(error)) return false;

  try {
    const last = Number(window.sessionStorage.getItem(MARKER) ?? 0);
    if (last && Date.now() - last < COOLDOWN_MS) return false;
    window.sessionStorage.setItem(MARKER, String(Date.now()));
  } catch {
    /* private mode — still worth one reload attempt */
  }

  window.location.reload();
  return true;
}

/** Catch stale-chunk failures that never reach a React error boundary. */
export function installStaleChunkReload(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("unhandledrejection", (event) => {
    reloadIfStaleChunk((event as PromiseRejectionEvent).reason);
  });
  window.addEventListener("error", (event) => {
    reloadIfStaleChunk((event as ErrorEvent).error ?? (event as ErrorEvent).message);
  });
}
