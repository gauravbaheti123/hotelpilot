import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export interface PickerItem {
  id: string;
  name: string;
  rate: number;
  gst_rate: number | null;
  short_code?: string | null;
  category?: string | null;
}

interface Props {
  items: PickerItem[];
  value: string;                       // current description text
  selectedId?: string | null;
  onSelect: (item: PickerItem) => void;
  onTextChange: (text: string) => void; // for free-typed descriptions
  placeholder?: string;
  disabled?: boolean;
}

export function ItemPickerCombobox({
  items, value, selectedId, onSelect, onTextChange, placeholder, disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (!open) setQuery(""); }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const hay = `${it.name} ${it.short_code ?? ""} ${it.category ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal h-10", !value && "text-muted-foreground")}
        >
          <span className="truncate">{value || placeholder || "Select item"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[--radix-popover-trigger-width] min-w-[280px]"
        align="start"
        onOpenAutoFocus={(e) => { /* keep default focus on input */ void e; }}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search or type custom..."
            value={query}
            onValueChange={(v) => { setQuery(v); onTextChange(v); }}
          />
          <CommandList>
            <CommandEmpty>
              <div className="px-2 py-3 text-sm text-muted-foreground">
                No match. Press Enter to use "{query.trim() || "…"}" as custom item.
              </div>
            </CommandEmpty>
            {filtered.length > 0 && (
              <CommandGroup>
                {filtered.slice(0, 200).map((it) => (
                  <CommandItem
                    key={it.id}
                    value={it.id}
                    onSelect={() => { onSelect(it); setOpen(false); }}
                    className="flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Check className={cn("h-3.5 w-3.5", selectedId === it.id ? "opacity-100" : "opacity-0")} />
                      <span className="truncate">
                        {it.short_code ? <span className="text-xs text-muted-foreground mr-1">{it.short_code}</span> : null}
                        {it.name}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      ₹{Number(it.rate ?? 0).toFixed(2)}
                      {it.gst_rate != null ? ` · ${it.gst_rate}%` : ""}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}