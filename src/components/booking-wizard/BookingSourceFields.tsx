// Shared "Source" picker for the new-booking and edit-booking wizards.
//
// `bookings.source` is free text (no enum / check constraint), but the app
// treats it as a fixed vocabulary so reports can group on it. "Other
// (specify)" keeps `source = 'other'` as the bucket and stores the typed
// channel name in `bookings.ota_partner_name`, the existing free-text
// partner/channel field that invoices already print as "Booking via: X".
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SOURCES } from "@/lib/front-desk";

/** True when this source keeps a free-text channel/partner name. */
export const sourceHasDetail = (source: string) =>
  source === "ota" || source === "agent" || source === "other";

export function sourceDetailLabel(source: string) {
  if (source === "other") return "Source name";
  if (source === "agent") return "Agent name";
  return "OTA Partner";
}

interface Props {
  source: string;
  detail: string;
  onChange: (p: { source?: string; otaPartnerName?: string }) => void;
}

export function BookingSourceFields({ source, detail, onChange }: Props) {
  return (
    <div className="grid gap-4 sm:max-w-md sm:grid-cols-2">
      <div className="grid gap-2">
        <Label>Source</Label>
        <SearchableSelect
          value={source}
          onChange={(v) => onChange({ source: v })}
          options={SOURCES.map((s) => ({ value: s.value, label: s.label }))}
          placeholder="Select source"
          searchPlaceholder="Type to filter…"
          alwaysShowSearch
        />
      </div>
      {sourceHasDetail(source) && (
        <div className="grid gap-2">
          <Label>{sourceDetailLabel(source)}</Label>
          <Input
            value={detail}
            maxLength={80}
            placeholder={source === "other" ? "e.g. Referral - Local Travel Agent" : undefined}
            onChange={(e) => onChange({ otaPartnerName: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}