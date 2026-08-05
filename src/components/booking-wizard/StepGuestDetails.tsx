// Part 2 — Step 1: main guest details (basic / address / doc) with existing
// guest search, duplicate detection and Drive document upload + thumbnail.
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { CityInput, StateSelect } from "@/components/AddressFields";
import { IdDocUploadPair } from "@/components/booking-wizard/IdDocUploadPair";
import { NATIONS, DEFAULT_NATION, titleCase } from "@/lib/indiaGeo";
import { ID_PROOF_TYPES, ID_PROOF_LABELS } from "@/lib/guests";
import { isValidMobile, sanitizeMobile, MOBILE_ERROR } from "@/lib/mobile";
import {
  searchGuestsDetailed, lookupExistingGuestId,
  type GuestSearchDetail, type GuestIdLookupResult,
} from "@/lib/guestIdLookup";
import { isForeign, type WizardGuest } from "@/lib/bookingWizard";

interface Props {
  propertyId: string;
  guest: WizardGuest;
  onChange: (patch: Partial<WizardGuest>) => void;
  /**
   * Banquet hosts are a trimmed variant: no ID proof / document capture,
   * since no one is checking in against this record.
   */
  variant?: "lodge" | "banquet";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

export function StepGuestDetails({ propertyId, guest, onChange, variant = "lodge" }: Props) {
  const banquet = variant === "banquet";
  const [term, setTerm] = useState("");
  const [matches, setMatches] = useState<GuestSearchDetail[]>([]);
  const [searching, setSearching] = useState(false);
  const [dupe, setDupe] = useState<GuestIdLookupResult | null>(null);
  const dismissedRef = useRef<string | null>(null);

  const foreign = isForeign(guest.nation);

  // Debounced "find existing guest" search (consolidated Part 1 helper).
  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) { setMatches([]); return; }
    setSearching(true);
    const t = window.setTimeout(async () => {
      const rows = await searchGuestsDetailed(propertyId, q, 8);
      setMatches(rows);
      setSearching(false);
    }, 350);
    return () => { window.clearTimeout(t); setSearching(false); };
  }, [term, propertyId]);

  // Duplicate detection once a full mobile number is typed.
  useEffect(() => {
    const m = guest.mobile.trim();
    if (!isValidMobile(m) || guest.guestId || dismissedRef.current === m) { setDupe(null); return; }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const hit = await lookupExistingGuestId(propertyId, m, guest.idProofNumber);
      if (!cancelled) setDupe(hit);
    }, 400);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [guest.mobile, guest.idProofNumber, guest.guestId, propertyId]);

  function applyGuest(g: GuestSearchDetail) {
    onChange({
      guestId: g.id,
      name: g.name ?? "",
      mobile: sanitizeMobile(g.mobile ?? ""),
      email: g.email ?? "",
      dob: g.dob ?? "",
      city: g.city ?? "",
      state: g.state ?? "",
      nation: g.country || DEFAULT_NATION,
      address: g.address ?? "",
      idProofType: g.id_proof_type || "aadhaar",
      idProofNumber: g.id_proof_number ?? "",
      company: g.company ?? "",
      gstNumber: g.gst_number ?? "",
    });
    setTerm("");
    setMatches([]);
    void attachExistingDoc(g.mobile ?? "", g.id_proof_number ?? "");
  }

  async function attachExistingDoc(mobile: string, idNumber: string) {
    const hit = await lookupExistingGuestId(propertyId, mobile, idNumber);
    if (hit?.doc || hit?.docBack) {
      onChange({
        ...(hit.doc ? {
          idDocFileId: hit.doc.driveFileId,
          idDocViewUrl: hit.doc.driveViewUrl,
          idDocName: hit.doc.documentName ?? "Existing ID on file",
        } : {}),
        ...(hit.docBack ? {
          idDocBackFileId: hit.docBack.driveFileId,
          idDocBackViewUrl: hit.docBack.driveViewUrl,
          idDocBackName: hit.docBack.documentName ?? "Existing ID (back) on file",
        } : {}),
      });
    }
  }

  function useDupe() {
    if (!dupe) return;
    onChange({
      guestId: dupe.guest.id,
      name: dupe.guest.name ?? guest.name,
      mobile: sanitizeMobile(dupe.guest.mobile ?? guest.mobile),
      idProofNumber: dupe.guest.idProofNumber ?? guest.idProofNumber,
      ...(dupe.doc
        ? {
            idDocFileId: dupe.doc.driveFileId,
            idDocViewUrl: dupe.doc.driveViewUrl,
            idDocName: dupe.doc.documentName ?? "Existing ID on file",
          }
        : {}),
      ...(dupe.docBack
        ? {
            idDocBackFileId: dupe.docBack.driveFileId,
            idDocBackViewUrl: dupe.docBack.driveViewUrl,
            idDocBackName: dupe.docBack.documentName ?? "Existing ID (back) on file",
          }
        : {}),
    });
    setDupe(null);
  }

  const idTypeOptions = useMemo(
    () =>
      (foreign
        ? (["passport", "other"] as const)
        : ID_PROOF_TYPES
      ).map((t) => ({ value: t, label: ID_PROOF_LABELS[t as keyof typeof ID_PROOF_LABELS] ?? t })),
    [foreign],
  );

  // Foreign guests default to Passport; Indian guests to Aadhaar.
  useEffect(() => {
    if (foreign && guest.idProofType !== "passport" && guest.idProofType !== "other") {
      onChange({ idProofType: "passport" });
    }
    if (!foreign && guest.idProofType === "passport" && !guest.passportNumber) {
      onChange({ idProofType: "aadhaar" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foreign]);

  const mobileError = guest.mobile.length > 0 && !isValidMobile(guest.mobile);

  return (
    <div className="space-y-8">
      {/* Find existing guest */}
      <div className="space-y-2">
        <Label htmlFor="wiz-guest-search">Find existing guest</Label>
        <div className="relative sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="wiz-guest-search"
            className="pl-9"
            placeholder="Search by name, mobile or email…"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          {searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>
        {matches.length > 0 && (
          <div className="divide-y rounded-md border sm:max-w-md">
            {matches.map((m) => (
              <button
                key={m.id}
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => applyGuest(m)}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{m.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {m.mobile ?? "—"}{m.company ? ` · ${m.company}` : ""}
                  </span>
                </span>
                <span className="ml-3 shrink-0 text-xs text-muted-foreground">
                  {m.visit_count} stay{m.visit_count === 1 ? "" : "s"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {dupe && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950/30">
          <UserCheck className="h-4 w-4" />
          <span className="flex-1">
            Guest already exists — {dupe.guest.name ?? "Unnamed"} ({dupe.guest.mobile ?? "—"}). Use existing profile?
          </span>
          <Button type="button" size="sm" onClick={useDupe}>Use existing</Button>
          <Button
            type="button" size="sm" variant="ghost"
            onClick={() => { dismissedRef.current = guest.mobile.trim(); setDupe(null); }}
          >
            Keep new
          </Button>
        </div>
      )}

      <Section title="Basic Details">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="wiz-name">Name *</Label>
            <Input
              id="wiz-name" value={guest.name} maxLength={120}
              onChange={(e) => onChange({ name: e.target.value })}
              onBlur={(e) => onChange({ name: titleCase(e.target.value) })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="wiz-mobile">Mobile *</Label>
            <Input
              id="wiz-mobile" inputMode="numeric" value={guest.mobile}
              onChange={(e) => onChange({ mobile: sanitizeMobile(e.target.value) })}
              placeholder="10-digit number"
            />
            {mobileError && <p className="text-xs text-destructive">{MOBILE_ERROR}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="wiz-email">Email</Label>
            <Input id="wiz-email" type="email" value={guest.email} onChange={(e) => onChange({ email: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="wiz-dob">Date of Birth</Label>
            <Input id="wiz-dob" type="date" value={guest.dob} onChange={(e) => onChange({ dob: e.target.value })} />
          </div>
        </div>
      </Section>

      <Section title="Address Details">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label>City</Label>
            <CityInput value={guest.city} onChange={(v) => onChange({ city: v })} />
          </div>
          <div className="grid gap-2">
            <Label>State</Label>
            <StateSelect value={guest.state} onChange={(v) => onChange({ state: v })} />
          </div>
          <div className="grid gap-2">
            <Label>Nation</Label>
            <SearchableSelect
              value={guest.nation}
              onChange={(v) => onChange({ nation: v })}
              options={NATIONS.map((n) => ({ value: n, label: n }))}
              placeholder="Select nation"
              searchPlaceholder="Type to filter nations…"
              alwaysShowSearch
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="wiz-pincode">Pincode</Label>
            <Input
              id="wiz-pincode" inputMode="numeric" maxLength={12}
              value={guest.pincode} onChange={(e) => onChange({ pincode: e.target.value })}
            />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="wiz-address">Address Line</Label>
            <Textarea
              id="wiz-address" rows={2} maxLength={500}
              value={guest.address} onChange={(e) => onChange({ address: e.target.value })}
            />
          </div>
        </div>
      </Section>

      {banquet ? null : (
      <Section title="Doc Details">
        <div className="grid gap-4 sm:grid-cols-2">
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
                <Label htmlFor="wiz-passport">Passport Number</Label>
                <Input
                  id="wiz-passport" value={guest.passportNumber} maxLength={40}
                  onChange={(e) => onChange({ passportNumber: e.target.value.toUpperCase() })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="wiz-visa">Visa Number</Label>
                <Input
                  id="wiz-visa" value={guest.visaNumber} maxLength={40}
                  onChange={(e) => onChange({ visaNumber: e.target.value.toUpperCase() })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="wiz-visa-exp">Visa Expiry</Label>
                <Input
                  id="wiz-visa-exp" type="date" value={guest.visaExpiry}
                  onChange={(e) => onChange({ visaExpiry: e.target.value })}
                />
              </div>
            </>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="wiz-idnum">ID Number</Label>
              <Input
                id="wiz-idnum" value={guest.idProofNumber} maxLength={40}
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
      </Section>
      )}

    </div>
  );
}