// Phase 57 — structured address inputs (City / State / Nation) shared by
// Guest Details and Billing Companies.
// Phase 67 — City & State are searchable comboboxes; City supports free-typed
// new entries which are saved to the city master for future suggestions.
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { INDIAN_STATES, NATIONS, DEFAULT_NATION, titleCase } from "@/lib/indiaGeo";
import { useCities } from "@/hooks/use-cities";
import { usePincodeSuggestions } from "@/hooks/use-pincodes";

interface Ctl {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}

/** Search + dropdown over the city master, with free-entry "Add" for new towns. */
export function CityInput({ value, onChange, className }: Ctl) {
  const { cities, addCity } = useCities();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => { if (!open) setQuery(""); }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? cities.filter((c) => c.name.toLowerCase().includes(q)) : cities;
    return base.slice(0, 200);
  }, [cities, query]);

  const typed = titleCase(query);
  const canAdd = typed.length > 1 && !cities.some((c) => c.name.toLowerCase() === typed.toLowerCase());

  const commit = (raw: string) => {
    const name = titleCase(raw);
    onChange(name);
    setOpen(false);
    if (name && !cities.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      addCity.mutate(name);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("h-9 w-full justify-between font-normal", !value && "text-muted-foreground", className)}
        >
          <span className="truncate">{value || "Search or type city…"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" style={{ width: "var(--radix-popover-trigger-width)", minWidth: 240 }} align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search or type new city…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {!canAdd && filtered.length === 0 && <CommandEmpty>No matching city</CommandEmpty>}
            {canAdd && (
              <CommandGroup>
                <CommandItem value={`__add__${typed}`} onSelect={() => commit(typed)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add "{typed}"
                </CommandItem>
              </CommandGroup>
            )}
            {filtered.length > 0 && (
              <CommandGroup>
                {filtered.map((c) => (
                  <CommandItem key={c.id} value={c.id} onSelect={() => commit(c.name)}>
                    <Check className={cn("mr-2 h-4 w-4", value.toLowerCase() === c.name.toLowerCase() ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{c.name}</span>
                    {c.state && <span className="ml-auto text-xs text-muted-foreground">{c.state}</span>}
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

export function StateSelect({ value, onChange, className }: Ctl) {
  const options = useMemo(
    () => INDIAN_STATES.map((s) => ({ value: s, label: s })),
    [],
  );
  return (
    <SearchableSelect
      value={value || ""}
      onChange={(v) => onChange(titleCase(v))}
      options={options}
      placeholder="Search state / UT"
      searchPlaceholder="Type to filter states…"
      emptyText="No matching state"
      searchThreshold={0}
      className={className}
    />
  );
}

interface PincodeCtl extends Ctl {
  /** City used to look up suggested pincodes. */
  city?: string | null;
  id?: string;
  readOnly?: boolean;
}

/**
 * Pincode input with city-driven suggestions from the pincode directory.
 * When the city resolves to pincodes, the most common one is prefilled if the
 * field is empty, and all matches are offered as quick-pick chips. The field
 * always stays fully editable.
 */
export function PincodeInput({ value, onChange, city, className, id, readOnly }: PincodeCtl) {
  const { data: suggestions = [] } = usePincodeSuggestions(readOnly ? null : city);

  // Prefill the most common pincode only while the field is untouched/empty.
  useEffect(() => {
    if (!readOnly && !value.trim() && suggestions.length > 0) {
      onChange(suggestions[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions, readOnly]);

  return (
    <div className="space-y-1">
      <Input
        id={id}
        inputMode="numeric"
        maxLength={12}
        readOnly={readOnly}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\dA-Za-z -]/g, ""))}
        className={className}
      />
      {!readOnly && suggestions.length > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-muted-foreground">Suggested:</span>
          {suggestions.slice(0, 8).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              className={cn(
                "rounded border px-1.5 py-0.5 text-[11px] leading-none transition-colors",
                p === value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
              )}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function NationInput({ value, onChange, className }: Ctl) {
  return (
    <>
      <Input
        list="hp-nation-list"
        value={value || DEFAULT_NATION}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onChange(titleCase(e.target.value))}
        maxLength={60}
        className={className}
      />
      <datalist id="hp-nation-list">
        {NATIONS.map((n) => <option key={n} value={n} />)}
      </datalist>
    </>
  );
}
