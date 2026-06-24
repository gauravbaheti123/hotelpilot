import { useCurrentProperty } from "@/hooks/use-property";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2 } from "lucide-react";

export function PropertySelector() {
  const { properties, currentId, setCurrentId, loading, canSwitch, current } =
    useCurrentProperty();

  if (loading) return null;

  if (properties.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Building2 className="h-3.5 w-3.5" />
        No property — create one in Properties
      </div>
    );
  }

  // Non-superadmin: lock display to their property, no switcher
  if (!canSwitch) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{current?.name ?? "—"}</span>
        {current?.city && (
          <span className="text-muted-foreground text-xs">· {current.city}</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Building2 className="h-4 w-4 text-muted-foreground" />
      <Select value={currentId ?? undefined} onValueChange={setCurrentId}>
        <SelectTrigger className="h-8 w-[200px] text-sm">
          <SelectValue placeholder="Select property" />
        </SelectTrigger>
        <SelectContent>
          {properties.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
              {p.city ? ` · ${p.city}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}