import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

/**
 * A back-intent handler returns true when it consumed the back action.
 * Returning false lets the next (lower) handler, and ultimately router
 * history, take over.
 */
export type BackIntentHandler = () => boolean;

interface Entry {
  id: number;
  handler: BackIntentHandler;
}

interface Ctx {
  push: (handler: BackIntentHandler) => () => void;
  /** Runs the stack top-down. True if something consumed the event. */
  consume: () => boolean;
}

const BackIntentContext = createContext<Ctx | null>(null);

let nextId = 1;

/**
 * Holds the stack of things that should absorb an Android back press before
 * it becomes a route navigation: open sheets, wizard steps, dirty forms.
 * Last registered wins, which matches "close the topmost thing first".
 */
export function BackIntentProvider({ children }: { children: ReactNode }) {
  const stackRef = useRef<Entry[]>([]);

  const push = useCallback((handler: BackIntentHandler) => {
    const entry: Entry = { id: nextId++, handler };
    stackRef.current.push(entry);
    return () => {
      stackRef.current = stackRef.current.filter((e) => e.id !== entry.id);
    };
  }, []);

  const consume = useCallback(() => {
    // Copy + reverse so a handler that unregisters itself can't corrupt
    // the iteration.
    const snapshot = [...stackRef.current].reverse();
    for (const entry of snapshot) {
      try {
        if (entry.handler()) return true;
      } catch {
        /* a broken handler must not trap the user on the screen */
      }
    }
    return false;
  }, []);

  const value = useMemo<Ctx>(() => ({ push, consume }), [push, consume]);
  return <BackIntentContext.Provider value={value}>{children}</BackIntentContext.Provider>;
}

export function useBackIntentStack(): Ctx | null {
  return useContext(BackIntentContext);
}

/**
 * Register a back-intent handler while `active` is true.
 *
 * @example
 *   // wizard: swallow back to step back instead of leaving the page
 *   useBackIntent(step > 1, () => { setStep(step - 1); return true; });
 */
export function useBackIntent(active: boolean, handler: BackIntentHandler) {
  const ctx = useBackIntentStack();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!ctx || !active) return;
    return ctx.push(() => handlerRef.current());
  }, [ctx, active]);
}