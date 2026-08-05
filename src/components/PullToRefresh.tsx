import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Loader2, ArrowDown } from "lucide-react";
import { usePullToRefresh, PTR_THRESHOLD } from "@/hooks/use-pull-to-refresh";
import { isNativeApp } from "@/lib/native";

type RefreshFn = () => unknown | Promise<unknown>;

interface Ctx {
  /** Screens register their existing loader; returns an unregister fn. */
  register: (fn: RefreshFn) => () => void;
  /** True when at least one screen has registered a loader. */
  enabled: boolean;
}

const PullToRefreshContext = createContext<Ctx | null>(null);

/**
 * Lets a screen opt into pull-to-refresh by handing over its existing
 * `load()` / reload callback. Screens that never call this simply don't get
 * the gesture — that's how reports, forms and wizards stay excluded.
 */
export function useRegisterRefresh(fn: RefreshFn | null | undefined) {
  const ctx = useContext(PullToRefreshContext);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!ctx || !fn) return;
    // Stable indirection: re-registering on every render of the screen would
    // thrash the provider, so we register once and read the latest fn by ref.
    return ctx.register(() => fnRef.current?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, !!fn]);
}

/**
 * Wraps AppShell's scrollable <main> content. Owns the gesture and the
 * indicator; the actual data reload comes from whichever screen registered.
 */
export function PullToRefresh({ children }: { children: ReactNode }) {
  const scrollRef = useRef<HTMLElement | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const handlerRef = useRef<RefreshFn | null>(null);
  const [hasHandler, setHasHandler] = useState(false);
  // Resolved after mount so SSR and the first client render agree.
  const [native, setNative] = useState(false);
  useEffect(() => {
    setNative(isNativeApp());
  }, []);

  // The wrapper renders *inside* <main>, so resolve the scroller upward.
  useEffect(() => {
    scrollRef.current =
      anchorRef.current?.closest<HTMLElement>("[data-scroll-container]") ??
      anchorRef.current?.parentElement ??
      null;
  }, []);

  const register = useCallback((fn: RefreshFn) => {
    handlerRef.current = fn;
    setHasHandler(true);
    return () => {
      if (handlerRef.current === fn) {
        handlerRef.current = null;
        setHasHandler(false);
      }
    };
  }, []);

  const onRefresh = useCallback(() => handlerRef.current?.(), []);

  const { distance, phase } = usePullToRefresh({
    scrollRef,
    onRefresh,
    enabled: hasHandler,
  });

  const ctx = useMemo<Ctx>(() => ({ register, enabled: hasHandler }), [register, hasHandler]);
  const progress = Math.min(distance / PTR_THRESHOLD, 1);
  const active = phase !== "idle";

  // Plain web (desktop + mobile browser): no gesture, no extra wrappers, no
  // transforms — the page must scroll exactly as it did before PTR existed.
  if (!native) {
    return (
      <PullToRefreshContext.Provider value={ctx}>{children}</PullToRefreshContext.Provider>
    );
  }

  return (
    <PullToRefreshContext.Provider value={ctx}>
      <div ref={anchorRef} className="relative">
        {active && (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center"
            style={{ transform: `translateY(${Math.max(distance - 34, 0)}px)` }}
            aria-hidden="true"
          >
            <div
              className="flex h-9 w-9 items-center justify-center rounded-full border bg-card shadow-md"
              style={{ opacity: Math.max(progress, 0.35) }}
            >
              {phase === "refreshing" ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <ArrowDown
                  className={`h-4 w-4 transition-transform ${
                    phase === "armed" ? "rotate-180 text-primary" : "text-muted-foreground"
                  }`}
                  style={{ transform: phase === "armed" ? undefined : `rotate(${progress * 90}deg)` }}
                />
              )}
            </div>
          </div>
        )}
        <div
          style={{
            transform: distance > 0 ? `translateY(${distance}px)` : undefined,
            transition: phase === "pulling" || phase === "armed" ? undefined : "transform 200ms ease-out",
          }}
        >
          {children}
        </div>
      </div>
    </PullToRefreshContext.Provider>
  );
}