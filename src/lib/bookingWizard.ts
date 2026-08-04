// Part 2 — New Booking wizard state shape, defaults and per-step validation.
// Shared by the wizard shell and its steps so later parts (3-5) can extend the
// same object without touching the shell.
import { DEFAULT_NATION } from "@/lib/indiaGeo";
import { isValidMobile } from "@/lib/mobile";

export type BookingKind = "lodge" | "banquet";

export interface WizardGuest {
  /** Existing guest id when an existing profile was picked. */
  guestId: string | null;
  name: string;
  mobile: string;
  email: string;
  dob: string;
  city: string;
  state: string;
  nation: string;
  address: string;
  pincode: string;
  idProofType: string;
  idProofNumber: string;
  /** Foreign-national fields (nation !== India). */
  passportNumber: string;
  visaNumber: string;
  visaExpiry: string;
  company: string;
  gstNumber: string;
  /** Uploaded ID document (already persisted to Drive). */
  idDocFileId: string | null;
  idDocViewUrl: string | null;
  idDocName: string | null;
}

export interface WizardState {
  kind: BookingKind;
  reservation: boolean;
  guest: WizardGuest;
}

export const WIZARD_DRAFT_KEY = "front-desk-new-wizard";

export const DEFAULT_CITY = "Latur";
export const DEFAULT_STATE = "Maharashtra";

export function emptyGuest(): WizardGuest {
  return {
    guestId: null,
    name: "",
    mobile: "",
    email: "",
    dob: "",
    city: DEFAULT_CITY,
    state: DEFAULT_STATE,
    nation: DEFAULT_NATION,
    address: "",
    pincode: "",
    idProofType: "aadhaar",
    idProofNumber: "",
    passportNumber: "",
    visaNumber: "",
    visaExpiry: "",
    company: "",
    gstNumber: "",
    idDocFileId: null,
    idDocViewUrl: null,
    idDocName: null,
  };
}

export function emptyWizardState(): WizardState {
  return { kind: "lodge", reservation: false, guest: emptyGuest() };
}

export function isForeign(nation: string) {
  return (nation || "").trim().toLowerCase() !== DEFAULT_NATION.toLowerCase();
}

/** True when the state still equals a fresh wizard (nothing worth saving). */
export function isPristine(s: WizardState) {
  const g = s.guest;
  return (
    s.kind === "lodge" &&
    !s.reservation &&
    !g.name && !g.mobile && !g.email && !g.dob && !g.address && !g.pincode &&
    !g.idProofNumber && !g.passportNumber && !g.visaNumber && !g.visaExpiry &&
    !g.company && !g.gstNumber && !g.idDocFileId && !g.guestId
  );
}

/** Step 0 is always satisfiable; Step 1 needs a name and a valid mobile. */
export function isStepValid(step: number, s: WizardState): boolean {
  if (step === 0) return s.kind === "lodge" || s.kind === "banquet";
  if (step === 1) return s.guest.name.trim().length > 0 && isValidMobile(s.guest.mobile);
  return true;
}

export const WIZARD_STEPS = [
  "Booking Type",
  "Guest Details",
  "Rooms & Stay",
  "Additional Guests",
  "Charges",
  "Bill To",
  "Review",
];