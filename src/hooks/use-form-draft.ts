import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Namespaced localStorage form-draft persistence with debounced writes.
 *
 * Part 1 infrastructure for the New Booking wizard — built and exported here,
 * not yet wired into any form.
 *
 *   const draft = useFormDraft<WizardState>("front-desk-new");
 *   draft.load();          // restore on mount (returns T | null)
 *   draft.save(state);     // debounced write (~500ms)
 *   draft.clear();         // delete the stored draft
 */
export interface FormDraft<T> {
  /** Read the stored draft, or null when absent/corrupt. */
  load: () => T | null;
  /** Debounced persist. Repeated calls within the window collapse into one write. */
  save: (value: T) => void;
  /** Persist immediately, bypassing the debounce. */
  flush: (value?: T) => void;
  /** Remove the stored draft. */
  clear: () => void;
  /** True when a draft existed in storage at mount time. */
  hasDraft: boolean;
  /** Timestamp (ms) of the last successful write, or null. */
  savedAt: number | null;
}

const PREFIX = "draft:";

function storageKey(key: string) {
  return `${PREFIX}${key}`;
}

export function useFormDraft<T>(key: string, debounceMs = 500): FormDraft<T> {
  const fullKey = storageKey(key);
  const timerRef = useRef<number | null>(null);
  const pendingRef = useRef<T | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [hasDraft, setHasDraft] = useState(false);

  const load = useCallback((): T | null => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(fullKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { v: T; at: number };
      return (parsed && typeof parsed === "object" && "v" in parsed ? parsed.v : (parsed as unknown as T)) ?? null;
    } catch {
      return null;
    }
  }, [fullKey]);

  // Detect an existing draft once, on mount (client only).
  useEffect(() => {
    if (typeof window === "undefined") return;
    setHasDraft(window.localStorage.getItem(fullKey) != null);
  }, [fullKey]);

  const write = useCallback(
    (value: T) => {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(fullKey, JSON.stringify({ v: value, at: Date.now() }));
        setSavedAt(Date.now());
        setHasDraft(true);
      } catch {
        /* quota / private mode — drafts are best-effort */
      }
    },
    [fullKey],
  );

  const save = useCallback(
    (value: T) => {
      if (typeof window === "undefined") return;
      pendingRef.current = value;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        if (pendingRef.current !== null) write(pendingRef.current);
        pendingRef.current = null;
      }, debounceMs);
    },
    [write, debounceMs],
  );

  const flush = useCallback(
    (value?: T) => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const v = value !== undefined ? value : pendingRef.current;
      pendingRef.current = null;
      if (v !== null && v !== undefined) write(v as T);
    },
    [write],
  );

  const clear = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(fullKey);
    } catch {
      /* ignore */
    }
    setHasDraft(false);
    setSavedAt(null);
  }, [fullKey]);

  // Flush any pending write when the component unmounts.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
        if (pendingRef.current !== null && typeof window !== "undefined") {
          try {
            window.localStorage.setItem(
              fullKey,
              JSON.stringify({ v: pendingRef.current, at: Date.now() }),
            );
          } catch {
            /* ignore */
          }
        }
      }
    };
  }, [fullKey]);

  return { load, save, flush, clear, hasDraft, savedAt };
}