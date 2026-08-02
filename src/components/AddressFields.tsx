// Phase 57 — structured address inputs (City / State / Nation) shared by
// Guest Details and Billing Companies.
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INDIAN_STATES, INDIAN_CITIES, NATIONS, DEFAULT_NATION } from "@/lib/indiaGeo";

interface Ctl {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}

/** Free-entry with suggestions — covers towns that aren't in the shortlist. */
export function CityInput({ value, onChange, className }: Ctl) {
  return (
    <>
      <Input
        list="hp-city-list"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Start typing…"
        maxLength={80}
        className={className}
      />
      <datalist id="hp-city-list">
        {INDIAN_CITIES.map((c) => <option key={c} value={c} />)}
      </datalist>
    </>
  );
}

export function StateSelect({ value, onChange }: Ctl) {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="Select state / UT" /></SelectTrigger>
      <SelectContent className="max-h-72">
        {INDIAN_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function NationInput({ value, onChange }: Ctl) {
  return (
    <>
      <Input
        list="hp-nation-list"
        value={value || DEFAULT_NATION}
        onChange={(e) => onChange(e.target.value)}
        maxLength={60}
      />
      <datalist id="hp-nation-list">
        {NATIONS.map((n) => <option key={n} value={n} />)}
      </datalist>
    </>
  );
}
