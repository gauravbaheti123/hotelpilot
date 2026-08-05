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
  /** Step 3 (banquet) — event details, extras and room blocks. */
  event: WizardEvent;
}

/** Banquet — how rooms are attached to the event. */
export type RoomBlockMode = "none" | "single" | "bulk";

/** Banquet — one named extra-charge line on the event bill. */
export interface WizardEventExtra {
  key: string;
  pointName: string;
  amount: string;
}

/** Banquet — one physical room attached to the event. */
export interface WizardEventRoomRow {
  key: string;
  roomId: string;
  guestName: string;
  guestMobile: string;
  checkIn: string;
  checkInTime: string;
  checkOut: string;
  checkOutTime: string;
  specialRate: string;
}

/** Banquet — everything the event form collects. */
export interface WizardEvent {
  hallId: string;
  functionType: string;
  eventName: string;
  eventDate: string;
  startTime: string;
  eventEndDate: string;
  endTime: string;
  pax: string;
  eventPrice: string;
  discount: string;
  extras: WizardEventExtra[];
  roomMode: RoomBlockMode;
  roomRows: WizardEventRoomRow[];
}

/** Part 4 — Bill To (billing_companies row, or none). */
export interface WizardBillTo {
  enabled: boolean;
  /** Existing billing_companies id, or "" when adding a new one. */
  companyId: string;
  name: string;
  gstin: string;
  /** Manually recorded GST registration status: "" | "active" | "cancelled". */
  gstStatus: string;
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
  /** Step 4 — optional extra bed for this room line. */
  extraBedEnabled: boolean;
  extraBedQty: number;
  extraBedRate: number;
  /** Step 4 — optional early check-in charge for this room line. */
  earlyCheckinEnabled: boolean;
  earlyCheckinAmount: number;
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
    event: emptyEvent(),
  };
}

export function emptyEvent(): WizardEvent {
  const today = todayIso();
  return {
    hallId: "",
    functionType: "Wedding",
    eventName: "",
    eventDate: today,
    startTime: "18:00",
    eventEndDate: today,
    endTime: "23:00",
    pax: "100",
    eventPrice: "0",
    discount: "0",
    extras: [],
    roomMode: "none",
    roomRows: [],
  };
}

export function emptyEventExtra(): WizardEventExtra {
  return { key: nextKey("x"), pointName: "", amount: "" };
}

export function emptyEventRoomRow(from?: Partial<WizardEventRoomRow>): WizardEventRoomRow {
  const today = todayIso();
  const base: WizardEventRoomRow = {
    key: from?.key || nextKey("blk"),
    roomId: "",
    guestName: "",
    guestMobile: "",
    checkIn: today,
    checkInTime: "12:00",
    checkOut: addDaysIso(today, 1),
    checkOutTime: "11:00",
    specialRate: "",
  };
  return { ...base, ...from, key: base.key };
}

export function emptyBillTo(): WizardBillTo {
  return {
    enabled: false,
    companyId: "",
    name: "",
    gstin: "",
    gstStatus: "",
    address: "",
    email: "",
    city: DEFAULT_CITY,
    state: DEFAULT_STATE,
    nation: DEFAULT_NATION,
  };
}

/**
 * Merge a persisted (possibly older / partial / corrupt) draft into a complete
 * WizardState. Drafts saved by earlier versions of the wizard can be missing
 * whole sections (rooms, extraGuests, billTo…), which used to crash the page
 * on load. Returns null when the input is not a usable object.
 */
export function normalizeWizardState(raw: unknown): WizardState | null {
  if (!raw || typeof raw !== "object") return null;
  const base = emptyWizardState();
  const s = raw as Partial<WizardState>;
  const rooms = Array.isArray(s.rooms) && s.rooms.length > 0
    ? s.rooms.map((r) => ({ ...emptyRoom(), ...r, key: r?.key || emptyRoom().key }))
    : base.rooms;
  return {
    ...base,
    ...s,
    kind: s.kind === "banquet" ? "banquet" : "lodge",
    reservation: !!s.reservation,
    guest: { ...base.guest, ...(s.guest ?? {}) },
    adults: Number(s.adults) > 0 ? Number(s.adults) : 1,
    children: Number(s.children) > 0 ? Number(s.children) : 0,
    extraGuests: Array.isArray(s.extraGuests)
      ? s.extraGuests.map((g) => ({ ...emptyExtraGuest(), ...g, key: g?.key || emptyExtraGuest().key }))
      : [],
    rooms,
    billTo: { ...base.billTo, ...(s.billTo ?? {}) },
    payment: { ...base.payment, ...(s.payment ?? {}) },
    customRemark: typeof s.customRemark === "string" ? s.customRemark : "",
    event: normalizeWizardEvent(s.event),
  };
}

/** Older drafts predate the banquet section entirely — fill in safe defaults. */
export function normalizeWizardEvent(raw: unknown): WizardEvent {
  const base = emptyEvent();
  if (!raw || typeof raw !== "object") return base;
  const e = raw as Partial<WizardEvent>;
  return {
    ...base,
    ...e,
    roomMode: e.roomMode === "single" || e.roomMode === "bulk" ? e.roomMode : "none",
    extras: Array.isArray(e.extras)
      ? e.extras.map((x) => ({ ...emptyEventExtra(), ...x, key: x?.key || emptyEventExtra().key }))
      : [],
    roomRows: Array.isArray(e.roomRows)
      ? e.roomRows.map((r) => emptyEventRoomRow({ ...r, key: r?.key || undefined }))
      : [],
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
  if (!s || typeof s !== "object") return true;
  const g = s.guest ?? emptyGuest();
  const rooms = Array.isArray(s.rooms) ? s.rooms : [];
  const extraGuests = Array.isArray(s.extraGuests) ? s.extraGuests : [];
  const ev = s.event;
  const eventPristine =
    !ev ||
    (!ev.hallId && !ev.eventName && ev.roomMode === "none" &&
      (ev.extras ?? []).length === 0 && (ev.roomRows ?? []).length === 0 &&
      !(Number(ev.eventPrice) > 0) && !(Number(ev.discount) > 0));
  return (
    (s.kind ?? "lodge") === "lodge" &&
    !s.reservation &&
    eventPristine &&
    extraGuests.length === 0 &&
    (s.adults ?? 1) === 1 && (s.children ?? 0) === 0 &&
    rooms.length <= 1 &&
    !rooms.some((r) => r?.categoryId || r?.roomId || Number(r?.rate) > 0) &&
    !s.billTo?.enabled && !s.customRemark && !(Number(s.payment?.advance) > 0) &&
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
  if (!s || typeof s !== "object") return false;
  const banquet = s.kind === "banquet";
  if (step === STEP.TYPE) return s.kind === "lodge" || s.kind === "banquet";
  if (step === STEP.GUEST) {
    return (s.guest?.name ?? "").trim().length > 0 && isValidMobile(s.guest?.mobile ?? "");
  }
  if (step === STEP.EXTRA_GUESTS) {
    if (banquet) return true;
    if ((s.adults ?? 0) < 1) return false;
    return (s.extraGuests ?? []).every(
      (g) => g.name.trim().length > 0 && g.relation.trim().length > 0 &&
        (g.mobile.length === 0 || isValidMobile(g.mobile)),
    );
  }
  if (step === STEP.STAY) {
    if (banquet) return isEventStepValid(s.event);
    const rooms = Array.isArray(s.rooms) ? s.rooms : [];
    return rooms.length > 0 && rooms.every((r) => isRoomValid(r, s.reservation));
  }
  if (step === STEP.BILL_TO) {
    if (!s.billTo?.enabled) return true;
    if (s.billTo.companyId) return true;
    return s.billTo.name.trim().length > 0 && isValidOrEmptyGSTIN(s.billTo.gstin);
  }
  if (step === STEP.PAYMENT) {
    return Number(s.payment?.advance ?? 0) >= 0;
  }
  return true;
}

/** Banquet Step 3 — event window, room-block completeness. */
export function isEventStepValid(ev: WizardEvent | undefined): boolean {
  if (!ev) return false;
  if (!ev.eventDate || !ev.startTime || !ev.eventEndDate || !ev.endTime) return false;
  if (!isValidStayRange(ev.eventDate, ev.eventEndDate, ev.startTime, ev.endTime)) return false;
  // Pax and event price are optional — a banquet booking may be a pure
  // bulk room-block for a group with no hall/pax/pricing involved.
  if (ev.roomMode === "none") return true;
  if (!ev.eventName.trim()) return false;
  const rows = ev.roomRows ?? [];
  if (rows.length === 0) return false;
  if (ev.roomMode === "single") {
    const r = rows[0];
    return !!r.roomId && isValidStayRange(r.checkIn, r.checkOut);
  }
  const ids = rows.map((r) => r.roomId);
  if (ids.some((id, i) => !id || ids.indexOf(id) !== i)) return false;
  return rows.every(
    (r) =>
      r.guestName.trim().length > 0 &&
      isValidMobile(r.guestMobile) &&
      isValidStayRange(r.checkIn, r.checkOut, r.checkInTime || "12:00", r.checkOutTime || "11:00"),
  );
}

/** Banquet — extras subtotal. */
export function eventExtrasTotal(ev: WizardEvent): number {
  return (ev.extras ?? []).reduce((sum, x) => sum + (Number(x.amount) || 0), 0);
}

/**
 * Banquet money model: event price + extras − discount, plus the room
 * revenue produced by the attached room blocks.
 */
export function eventTotals(ev: WizardEvent, roomRevenue: number) {
  const extras = eventExtrasTotal(ev);
  const price = Number(ev.eventPrice) || 0;
  const discount = Number(ev.discount) || 0;
  const eventTotal = Math.max(0, Math.round((price + extras - discount) * 100) / 100);
  return {
    price,
    extras,
    discount,
    eventTotal,
    roomRevenue,
    grandTotal: Math.round((eventTotal + roomRevenue) * 100) / 100,
  };
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

/** Step labels differ slightly for banquet (Step 3 is the event, not a stay). */
export function wizardStepLabels(kind: BookingKind): string[] {
  if (kind !== "banquet") return WIZARD_STEPS;
  const labels = [...WIZARD_STEPS];
  labels[STEP.GUEST] = "Host Details";
  labels[STEP.STAY] = "Event Details";
  return labels;
}

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

/** Reservations skip Additional Guests and Bill To; banquet skips Additional Guests. */
export function isStepSkipped(step: number, s: WizardState): boolean {
  if (s.kind === "banquet") return step === STEP.EXTRA_GUESTS;
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