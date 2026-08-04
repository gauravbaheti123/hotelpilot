import { toast } from "sonner";

/**
 * Phase 73 — 10-second "Undo" toast for reversible (status-only) actions:
 * bill void, KOT void and booking cancel. Never use this for hard deletes.
 */
export function toastWithUndo(
  message: string,
  undo: () => Promise<void> | void,
  opts?: { undoingMessage?: string; undoneMessage?: string },
) {
  toast.success(message, {
    duration: 10_000,
    action: {
      label: "Undo",
      onClick: () => {
        void (async () => {
          const id = toast.loading(opts?.undoingMessage ?? "Undoing…");
          try {
            await undo();
            toast.success(opts?.undoneMessage ?? "Action undone", { id });
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Undo failed", { id });
          }
        })();
      },
    },
  });
}
