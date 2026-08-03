import * as React from "react";
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

export interface SearchableOption {
  value: string;
  label: string;
  /** Optional extra string used for filtering (e.g. category, mobile). */
  keywords?: string;
  /** Optional secondary text shown muted next to the label. */
  hint?: string;
  /** Optional section heading; options sharing a group render together. */
  group?: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  /** Only show the search input when there are more than this many options (default 5). */
  searchThreshold?: number;
  /** Notified as the user types — lets the caller load remote matches (e.g. guests). */
  onSearchChange?: (query: string) => void;
  /** Force the search box on even when there are few options. */
  alwaysShowSearch?: boolean;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  disabled,
  className,
  searchThreshold = 5,
  onSearchChange,
  alwaysShowSearch,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const selected = options.find((o) => o.value === value);
  const showSearch = alwaysShowSearch || options.length > searchThreshold;

  // Preserve first-appearance order of groups; ungrouped options come first.
  const groups = React.useMemo(() => {
    const map = new Map<string, SearchableOption[]>();
    for (const opt of options) {
      const key = opt.group ?? "";
      const list = map.get(key);
      if (list) list.push(opt);
      else map.set(key, [opt]);
    }
    return Array.from(map.entries());
  }, [options]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-9 w-full justify-between font-normal",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">
            {selected ? (
              <>
                {selected.label}
                {selected.hint && (
                  <span className="text-muted-foreground"> · {selected.hint}</span>
                )}
              </>
            ) : (
              placeholder
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0"
        style={{ width: "var(--radix-popover-trigger-width)" }}
        align="start"
      >
        <Command
          filter={(value, search, keywords) => {
            const haystack = [value, ...(keywords ?? [])].join(" ").toLowerCase();
            return haystack.includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          {showSearch && (
            <CommandInput
              placeholder={searchPlaceholder}
              value={query}
              onValueChange={(v) => {
                setQuery(v);
                onSearchChange?.(v);
              }}
            />
          )}
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {groups.map(([heading, opts]) => (
              <CommandGroup key={heading || "__none__"} heading={heading || undefined}>
              {opts.map((opt) => (
                <CommandItem
                  key={opt.value}
                  value={`${opt.label} ${opt.keywords ?? ""} ${opt.hint ?? ""}`}
                  keywords={[opt.label, opt.keywords ?? "", opt.hint ?? ""]}
                  onSelect={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === opt.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{opt.label}</span>
                  {opt.hint && (
                    <span className="ml-auto text-xs text-muted-foreground">{opt.hint}</span>
                  )}
                </CommandItem>
              ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}