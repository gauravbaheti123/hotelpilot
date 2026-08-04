// Part 2 — New Booking wizard state shape, defaults and per-step validation.
// Shared by the wizard shell and its steps so later parts (3-5) can extend the
// same object without touching the shell.
import { DEFAULT_NATION } from "@/lib/indiaGeo";
import { isValidMobile } from "@/lib/mobile";
import { addDaysIso, isValidStayRange, nightsBetween, todayIso } from "@/lib/front-desk";
import { isValidOrEmptyGSTIN } from "@/lib/gstin";

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
  /** Step 2 — occupancy + accompanying guests. */
  adults: number;
  children: number;
  extraGuests: WizardExtraGuest[];
  /** Step 3 — one or more rooms sharing this guest set. */
  rooms: WizardRoom[];
  source: string;
  otaPartnerName: string;
  /** Step 4 — optional "bill to someone else". */
  billTo: WizardBillTo;
  /** Step 5 — advance payment at check-in. */
  payment: WizardPayment;
  /** Step 6 — remark highlighted at checkout. */
  customRemark: string;
}

/** Part 4 — Bill To (billing_companies row, or none). */
export interface WizardBillTo {
  enabled: boolean;
  /** Existing billing_companies id, or "" when adding a new one. */
  companyId: string;
  name: string;
  gstin: string;
  address: string;
  email: string;
  city: string;
  state: string;
  nation: string;
}

/** Part 4 — payment at check-in. */
export interface WizardPayment {
  advance: number;
  mode: string;
  reference: string;
  notes: string;
}

/** Part 3 — accompanying guest (booking_guests row). */
export interface WizardExtraGuest {
  key: string;
  kind: "adult" | "child";
  guestId: string | null;
  name: string;
  mobile: string;
  age: string;
  relation: string;
  nation: string;
  idProofType: string;
  idProofNumber: string;
  passportNumber: string;
  visaNumber: string;
  visaExpiry: string;
  idDocFileId: string | null;
  idDocViewUrl: string | null;
  idDocName: string | null;
}

/** Part 3 — one room line of the booking. */
export interface WizardRoom {
  key: string;
  categoryId: string;
  roomId: string;
  assignLater: boolean;
  checkIn: string;
  checkInTime: string;
  checkOut: string;
  checkOutTime: string;
  planName: string;
  mealPlan: string;
  tariffId: string;
  rate: number;
  rateType: "exclusive" | "inclusive";
}

export const RELATION_OPTIONS = [
  "Spouse", "Child", "Parent", "Sibling", "Friend", "Colleague", "Other",
];

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
  return {
    kind: "lodge",
    reservation: false,
    guest: emptyGuest(),
    adults: 1,
    children: 0,
    extraGuests: [],
    rooms: [emptyRoom()],
    source: "walk_in",
    otaPartnerName: "",
    billTo: emptyBillTo(),
    payment: { advance: 0, mode: "cash", reference: "", notes: "" },
    customRemark: "",
  };
}

export function emptyBillTo(): WizardBillTo {
  return {
    enabled: false,
    companyId: "",
    name: "",
    gstin: "",
    address: "",
    email: "",
    city: DEFAULT_CITY,
    state: DEFAULT_STATE,
    nation: DEFAULT_NATION,
  };
}

let keySeq = 0;
function nextKey(prefix: string) {
  keySeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${keySeq}`;
}

export function emptyRoom(from?: Partial<WizardRoom>): WizardRoom {
  return {
    key: nextKey("room"),
    categoryId: "",
    roomId: "",
    assignLater: false,
    checkIn: todayIso(),
    checkInTime: "12:00",
    checkOut: addDaysIso(todayIso(), 1),
    checkOutTime: "11:00",
    planName: "",
    mealPlan: "CP",
    tariffId: "",
    rate: 0,
    rateType: "exclusive",
    ...from,
    ...(from ? { key: nextKey("room") } : {}),
  };
}

export function emptyExtraGuest(kind: "adult" | "child" = "adult"): WizardExtraGuest {
  return {
    key: nextKey("g"),
    kind,
    guestId: null,
    name: "",
    mobile: "",
    age: "",
    relation: "",
    nation: DEFAULT_NATION,
    idProofType: kind === "adult" ? "aadhaar" : "",
    idProofNumber: "",
    passportNumber: "",
    visaNumber: "",
    visaExpiry: "",
    idDocFileId: null,
    idDocViewUrl: null,
    idDocName: null,
  };
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
    s.extraGuests.length === 0 &&
    s.adults === 1 && s.children === 0 &&
    s.rooms.length <= 1 &&
    !s.rooms.some((r) => r.categoryId || r.roomId || Number(r.rate) > 0) &&
    !s.billTo.enabled && !s.customRemark && !(Number(s.payment?.advance) > 0) &&
    !g.name && !g.mobile && !g.email && !g.dob && !g.address && !g.pincode &&
    !g.idProofNumber && !g.passportNumber && !g.visaNumber && !g.visaExpiry &&
    !g.company && !g.gstNumber && !g.idDocFileId && !g.guestId
  );
}

/** True when a room line is complete enough to move on. */
export function isRoomValid(r: WizardRoom, reservation: boolean): boolean {
  if (!r.categoryId) return false;
  if (!isValidStayRange(r.checkIn, r.checkOut)) return false;
  if (!(Number(r.rate) > 0)) return false;
  if (!reservation && !r.assignLater && !r.roomId) return false;
  return true;
}

export function isStepValid(step: number, s: WizardState): boolean {
  if (step === STEP.TYPE) return s.kind === "lodge" || s.kind === "banquet";
  if (step === STEP.GUEST) return s.guest.name.trim().length > 0 && isValidMobile(s.guest.mobile);
  if (step === STEP.EXTRA_GUESTS) {
    if (s.adults < 1) return false;
    return s.extraGuests.every(
      (g) => g.name.trim().length > 0 && g.relation.trim().length > 0 &&
        (g.mobile.length === 0 || isValidMobile(g.mobile)),
    );
  }
  if (step === STEP.STAY) {
    return s.rooms.length > 0 && s.rooms.every((r) => isRoomValid(r, s.reservation));
  }
  if (step === STEP.BILL_TO) {
    if (!s.billTo.enabled) return true;
    if (s.billTo.companyId) return true;
    return s.billTo.name.trim().length > 0 && isValidOrEmptyGSTIN(s.billTo.gstin);
  }
  if (step === STEP.PAYMENT) {
    return Number(s.payment.advance) >= 0;
  }
  return true;
}

export const WIZARD_STEPS = [
  "Booking Type",
  "Guest Details",
  "Additional Guests",
  "Stay & Room",
  "Bill To",
  "Payment",
  "Remarks",
  "Review",
];

export const STEP = {
  TYPE: 0,
  GUEST: 1,
  EXTRA_GUESTS: 2,
  STAY: 3,
  BILL_TO: 4,
  PAYMENT: 5,
  REMARKS: 6,
  REVIEW: 7,
} as const;

/** Total room charge across every room line (nights x rate). */
export function roomsTotal(rooms: WizardRoom[]): number {
  return rooms.reduce(
    (sum, r) => sum + nightsBetween(r.checkIn, r.checkOut) * (Number(r.rate) || 0),
    0,
  );
}

/** Earliest check-in / latest check-out across all rooms (booking-level dates). */
export function stayRange(rooms: WizardRoom[]): { checkIn: string; checkOut: string } {
  const ins = rooms.map((r) => r.checkIn).filter(Boolean).sort();
  const outs = rooms.map((r) => r.checkOut).filter(Boolean).sort();
  return {
    checkIn: ins[0] ?? todayIso(),
    checkOut: outs[outs.length - 1] ?? addDaysIso(todayIso(), 1),
  };
}

/** Reservations skip Additional Guests and Bill To. */
export function isStepSkipped(step: number, s: WizardState): boolean {
  if (!s.reservation) return false;
  return step === STEP.EXTRA_GUESTS || step === STEP.BILL_TO;
}

export function nextStepIndex(step: number, s: WizardState): number {
  let i = step + 1;
  while (i < WIZARD_STEPS.length - 1 && isStepSkipped(i, s)) i += 1;
  return Math.min(i, WIZARD_STEPS.length - 1);
}

export function prevStepIndex(step: number, s: WizardState): number {
  let i = step - 1;
  while (i > 0 && isStepSkipped(i, s)) i -= 1;
  return Math.max(i, 0);
}