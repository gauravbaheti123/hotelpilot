import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, UserPlus } from "lucide-react";
import { searchGuests, createGuestQuick, type GuestSearchHit } from "@/lib/guestIdLookup";
import { isValidMobile, MOBILE_ERROR } from "@/lib/mobile";
import { toast } from "sonner";

interface Props {
  propertyId: string;
  value: string;
  mobile?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Free-typed name changes (not committed). */
  onChange: (name: string) => void;
  /** Existing guest picked, or a newly created one. */
  onSelect: (guest: GuestSearchHit) => void;
  /** Called on blur when nothing was picked, so the caller can persist. */
  onCommit?: () => void;
  /** Set false to hide the inline "create new guest" action (Banquet: no auto-create). */
  allowCreate?: boolean;
}

/**
 * Debounced guest search (name / mobile) with inline "create new guest".
 * Same match behaviour as the Phase 21 guest lookup, reusable in tables.
 */
export function GuestSearchInput({
  propertyId, value, mobile, disabled, placeholder, className, onChange, onSelect, onCommit,
  allowCreate = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<GuestSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const touched = useRef(false);

  useEffect(() => {
    if (!touched.current || !propertyId) return;
    const q = value.trim();
    if (q.length < 2) { setHits([]); setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      const rows = await searchGuests(propertyId, q);
      setHits(rows);
      setLoading(false);
      setOpen(true);
    }, 350);
    return () => clearTimeout(t);
  }, [value, propertyId]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(g: GuestSearchHit) {
    touched.current = false;
    setOpen(false);
    onSelect(g);
  }

  async function createNew() {
    const name = value.trim();
    if (!name) return toast.error("Enter a guest name first");
    if (!isValidMobile(mobile ?? "")) return toast.error(MOBILE_ERROR);
    setCreating(true);
    try {
      const g = await createGuestQuick(propertyId, name, (mobile ?? "").trim());
      toast.success("Guest created");
      pick(g);
    } catch (e) {
      toast.error((e as Error)?.message ?? "Could not create guest");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <Input
        value={value}
        disabled={disabled}
        placeholder={placeholder ?? "Search or add guest"}
        className={className}
        autoComplete="off"
        onChange={(e) => { touched.current = true; onChange(e.target.value); }}
        onFocus={() => { if (hits.length) setOpen(true); }}
        onBlur={() => { setTimeout(() => { if (!open) onCommit?.(); }, 150); }}
      />
      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-72 max-w-[90vw] rounded-md border bg-popover p-1 shadow-md">
          {loading && (
            <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
            </div>
          )}
          {!loading && hits.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">No matching guest</div>
          )}
          {hits.map((g) => (
            <button
              key={g.id}
              type="button"
              className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
              onClick={() => pick(g)}
            >
              <span className="font-medium">{g.name}</span>
              {g.mobile ? <span className="text-muted-foreground"> · {g.mobile}</span> : null}
              {g.company ? <div className="text-[11px] text-muted-foreground">{g.company}</div> : null}
            </button>
          ))}
          {allowCreate && (
          <div className="mt-1 border-t pt-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 w-full justify-start text-xs"
              disabled={creating}
              onClick={createNew}
            >
              <UserPlus className="mr-1 h-3.5 w-3.5" />
              {creating ? "Creating…" : `+ New guest${value.trim() ? ` “${value.trim()}”` : ""}`}
            </Button>
          </div>
          )}
        </div>
      )}
    </div>
  );
}