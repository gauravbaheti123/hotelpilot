// Part 3 — Step 2: occupancy + accompanying guests (booking_guests rows).
// Skipped entirely for reservations (handled by the wizard shell).
import { useEffect, useState } from "react";
import { Plus, Trash2, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { IdDocUploadPair } from "@/components/booking-wizard/IdDocUploadPair";
import { NATIONS, titleCase } from "@/lib/indiaGeo";
import { ID_PROOF_TYPES, ID_PROOF_LABELS } from "@/lib/guests";
import { isValidMobile, sanitizeMobile, MOBILE_ERROR } from "@/lib/mobile";
import { lookupExistingGuestId } from "@/lib/guestIdLookup";
import {
  emptyExtraGuest, isForeign, RELATION_OPTIONS,
  type WizardExtraGuest,
} from "@/lib/bookingWizard";

interface Props {
  propertyId: string;
  adults: number;
  children: number;
  guests: WizardExtraGuest[];
  onCountsChange: (patch: { adults?: number; children?: number }) => void;
  onGuestsChange: (next: WizardExtraGuest[]) => void;
}

export function StepAdditionalGuests({
  propertyId, adults, children, guests, onCountsChange, onGuestsChange,
}: Props) {
  // Keep the row count in sync with the adult/child counts.
  useEffect(() => {
    const adultsNeeded = Math.max(0, adults - 1);
    const childrenNeeded = Math.max(0, children);
    const prevAdults = guests.filter((g) => g.kind === "adult");
    const prevChildren = guests.filter((g) => g.kind === "child");
    if (prevAdults.length === adultsNeeded && prevChildren.length === childrenNeeded) return;
    const adultRows = [...prevAdults];
    while (adultRows.length < adultsNeeded) adultRows.push(emptyExtraGuest("adult"));
    adultRows.length = adultsNeeded;
    const childRows = [...prevChildren];
    while (childRows.length < childrenNeeded) childRows.push(emptyExtraGuest("child"));
    childRows.length = childrenNeeded;
    onGuestsChange([...adultRows, ...childRows]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adults, children]);

  function patch(key: string, p: Partial<WizardExtraGuest>) {
    onGuestsChange(guests.map((g) => (g.key === key ? { ...g, ...p } : g)));
  }

  function addAdult() {
    onCountsChange({ adults: adults + 1 });
  }

  function remove(g: WizardExtraGuest) {
    onGuestsChange(guests.filter((x) => x.key !== g.key));
    if (g.kind === "adult") onCountsChange({ adults: Math.max(1, adults - 1) });
    else onCountsChange({ children: Math.max(0, children - 1) });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:max-w-sm sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="wiz-adults">No. of Adults</Label>
          <Input
            id="wiz-adults" type="number" min={1} max={20} value={adults}
            onChange={(e) => onCountsChange({ adults: Math.max(1, Number(e.target.value) || 1) })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="wiz-children">No. of Children</Label>
          <Input
            id="wiz-children" type="number" min={0} max={20} value={children}
            onChange={(e) => onCountsChange({ children: Math.max(0, Number(e.target.value) || 0) })}
          />
        </div>
      </div>

      {guests.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Only the primary guest so far. Increase adults or children above to add accompanying guests.
        </p>
      ) : (
        <div className="space-y-4">
          {guests.map((g, i) => (
            <ExtraGuestCard
              key={g.key}
              index={i}
              propertyId={propertyId}
              guest={g}
              onChange={(p) => patch(g.key, p)}
              onRemove={() => remove(g)}
            />
          ))}
        </div>
      )}

      <Button type="button" variant="outline" size="sm" onClick={addAdult}>
        <Plus className="mr-2 h-4 w-4" /> Add another adult
      </Button>
    </div>
  );
}

function ExtraGuestCard({
  index, propertyId, guest, onChange, onRemove,
}: {
  index: number;
  propertyId: string;
  guest: WizardExtraGuest;
  onChange: (p: Partial<WizardExtraGuest>) => void;
  onRemove: () => void;
}) {
  const foreign = isForeign(guest.nation);
  const [dupe, setDupe] = useState<{ id: string; name: string | null; mobile: string | null } | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  // Same consolidated lookup as Step 1, per accompanying guest.
  useEffect(() => {
    const m = guest.mobile.trim();
    if (!isValidMobile(m) || guest.guestId || dismissed === m) { setDupe(null); return; }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const hit = await lookupExistingGuestId(propertyId, m, guest.idProofNumber);
      if (!cancelled) setDupe(hit ? { id: hit.guest.id, name: hit.guest.name, mobile: hit.guest.mobile } : null);
    }, 400);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [guest.mobile, guest.idProofNumber, guest.guestId, propertyId, dismissed]);

  async function useExisting() {
    if (!dupe) return;
    const hit = await lookupExistingGuestId(propertyId, guest.mobile, guest.idProofNumber);
    onChange({
      guestId: dupe.id,
      name: dupe.name ?? guest.name,
      idProofNumber: hit?.guest.idProofNumber ?? guest.idProofNumber,
      ...(hit?.doc
        ? {
            idDocFileId: hit.doc.driveFileId,
            idDocViewUrl: hit.doc.driveViewUrl,
            idDocName: hit.doc.documentName ?? "Existing ID on file",
          }
        : {}),
      ...(hit?.docBack
        ? {
            idDocBackFileId: hit.docBack.driveFileId,
            idDocBackViewUrl: hit.docBack.driveViewUrl,
            idDocBackName: hit.docBack.documentName ?? "Existing ID (back) on file",
          }
        : {}),
    });
    setDupe(null);
  }

  const idTypeOptions = (foreign ? (["passport", "other"] as const) : ID_PROOF_TYPES).map((t) => ({
    value: t,
    label: ID_PROOF_LABELS[t as keyof typeof ID_PROOF_LABELS] ?? t,
  }));

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">
          {guest.kind === "adult" ? `Adult ${index + 2}` : "Child"}
        </h4>
        <Button type="button" size="icon" variant="ghost" onClick={onRemove} aria-label="Remove guest">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {dupe && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs dark:bg-amber-950/30">
          <UserCheck className="h-3.5 w-3.5" />
          <span className="flex-1">Guest already exists — {dupe.name ?? "Unnamed"}. Use existing profile?</span>
          <Button type="button" size="sm" onClick={() => void useExisting()}>Use existing</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { setDismissed(guest.mobile.trim()); setDupe(null); }}>
            Keep new
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label>Name *</Label>
          <Input
            value={guest.name} maxLength={120}
            onChange={(e) => onChange({ name: e.target.value })}
            onBlur={(e) => onChange({ name: titleCase(e.target.value) })}
          />
        </div>
        <div className="grid gap-2">
          <Label>Relation to primary guest</Label>
          <SearchableSelect
            value={guest.relation}
            onChange={(v) => onChange({ relation: v })}
            options={RELATION_OPTIONS.map((r) => ({ value: r, label: r }))}
            placeholder="Select relation"
            searchPlaceholder="Type to filter…"
            alwaysShowSearch
          />
        </div>
        <div className="grid gap-2">
          <Label>Mobile</Label>
          <Input
            inputMode="numeric" value={guest.mobile} placeholder="10-digit number"
            onChange={(e) => onChange({ mobile: sanitizeMobile(e.target.value) })}
          />
          {guest.mobile.length > 0 && !isValidMobile(guest.mobile) && (
            <p className="text-xs text-destructive">{MOBILE_ERROR}</p>
          )}
        </div>
        <div className="grid gap-2">
          <Label>Age</Label>
          <Input
            type="number" min={0} max={120} value={guest.age}
            onChange={(e) => onChange({ age: e.target.value })}
          />
        </div>
        <div className="grid gap-2">
          <Label>Nation</Label>
          <SearchableSelect
            value={guest.nation}
            onChange={(v) => onChange({ nation: v, idProofType: isForeign(v) ? "passport" : "aadhaar" })}
            options={NATIONS.map((n) => ({ value: n, label: n }))}
            placeholder="Select nation"
            searchPlaceholder="Type to filter nations…"
            alwaysShowSearch
          />
        </div>
        <div className="grid gap-2">
          <Label>ID Type</Label>
          <SearchableSelect
            value={guest.idProofType}
            onChange={(v) => onChange({ idProofType: v })}
            options={idTypeOptions}
            placeholder="Select ID type"
            searchPlaceholder="Type to filter…"
            alwaysShowSearch
          />
        </div>

        {foreign && guest.idProofType === "passport" ? (
          <>
            <div className="grid gap-2">
              <Label>Passport Number</Label>
              <Input
                value={guest.passportNumber} maxLength={40}
                onChange={(e) => onChange({ passportNumber: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Visa Number</Label>
              <Input
                value={guest.visaNumber} maxLength={40}
                onChange={(e) => onChange({ visaNumber: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Visa Expiry</Label>
              <Input
                type="date" value={guest.visaExpiry}
                onChange={(e) => onChange({ visaExpiry: e.target.value })}
              />
            </div>
          </>
        ) : (
          <div className="grid gap-2">
            <Label>ID Number</Label>
            <Input
              value={guest.idProofNumber} maxLength={40}
              onChange={(e) => onChange({ idProofNumber: e.target.value })}
            />
          </div>
        )}

        <div className="sm:col-span-2">
          <IdDocUploadPair
            guestName={guest.name}
            value={{
              front: { fileId: guest.idDocFileId, viewUrl: guest.idDocViewUrl, name: guest.idDocName },
              back: { fileId: guest.idDocBackFileId, viewUrl: guest.idDocBackViewUrl, name: guest.idDocBackName },
            }}
            onChange={(d) => onChange({
              idDocFileId: d.front.fileId, idDocViewUrl: d.front.viewUrl, idDocName: d.front.name,
              idDocBackFileId: d.back.fileId, idDocBackViewUrl: d.back.viewUrl, idDocBackName: d.back.name,
            })}
          />
        </div>
      </div>
    </div>
  );
}