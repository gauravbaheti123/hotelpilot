import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TableCell, TableHead } from "@/components/ui/table";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toastError } from "@/lib/errorMessage";

/**
 * Bulk select + delete for hand-rolled master tables, mirroring the behaviour
 * baked into the shared CrudPage (checkbox column, select-all, batched delete).
 */
export function useBulkSelect<T extends { id: string }>(
  rows: T[],
  table: string,
  onDone: () => void,
) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const allSelected = useMemo(
    () => rows.length > 0 && rows.every((r) => selected.has(r.id)),
    [rows, selected],
  );

  function toggleAll(v: boolean) {
    setSelected(v ? new Set(rows.map((r) => r.id)) : new Set());
  }

  function toggleOne(id: string, v: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (v) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function confirmDelete() {
    setBusy(true);
    const ids = Array.from(selected);
    const { error } = await supabase.from(table as any).delete().in("id", ids);
    setBusy(false);
    if (error) return toastError(error);
    toast.success(`Deleted ${ids.length} record${ids.length === 1 ? "" : "s"}`);
    setSelected(new Set());
    setOpen(false);
    onDone();
  }

  return { selected, allSelected, toggleAll, toggleOne, open, setOpen, busy, confirmDelete, clear: () => setSelected(new Set()) };
}

type Bulk = ReturnType<typeof useBulkSelect<{ id: string }>>;

export function BulkSelectHead({ bulk }: { bulk: Bulk }) {
  return (
    <TableHead className="w-10">
      <Checkbox checked={bulk.allSelected} onCheckedChange={(v) => bulk.toggleAll(!!v)} aria-label="Select all" />
    </TableHead>
  );
}

export function BulkSelectCell({ bulk, id }: { bulk: Bulk; id: string }) {
  return (
    <TableCell className="w-10">
      <Checkbox
        checked={bulk.selected.has(id)}
        onCheckedChange={(v) => bulk.toggleOne(id, !!v)}
        aria-label="Select row"
      />
    </TableCell>
  );
}

export function BulkDeleteButton({ bulk }: { bulk: Bulk }) {
  if (bulk.selected.size === 0) return null;
  return (
    <Button variant="destructive" size="sm" onClick={() => bulk.setOpen(true)}>
      <Trash2 className="h-4 w-4 mr-1" /> Delete Selected ({bulk.selected.size})
    </Button>
  );
}

export function BulkDeleteDialog({ bulk }: { bulk: Bulk }) {
  return (
    <AlertDialog open={bulk.open} onOpenChange={bulk.setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {bulk.selected.size} selected record(s)?</AlertDialogTitle>
          <AlertDialogDescription>
            This cannot be undone. Records still linked to other data may fail to delete.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={bulk.busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={bulk.confirmDelete} disabled={bulk.busy}>
            {bulk.busy ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
