import { createFileRoute, useRouter } from "@tanstack/react-router";
import { CityInput, StateSelect, NationInput } from "@/components/AddressFields";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { Trash2, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentProperty } from "@/hooks/use-property";
import { useGstSlabs } from "@/hooks/use-gst-slabs";
import { resolveGstRate, resolveGstRateInclusive } from "@/lib/gst";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import { addDaysIso, isValidStayRange, nightsBetween, SOURCES, todayIso } from "@/lib/front-desk";
import {
  defaultMealPlanFor,
  extraBedRateFor,
  fetchTariffPlans,
  findPlanByNameAndMeal,
  mealPlansForPlanName,
  NO_TARIFF_PLAN_ERROR,
  pickTariffPlan,
  planNamesForCategory,
  type TariffPlan,
} from "@/lib/tariff";
import { GuestIdUploadField, type SelectedIdFile } from "@/components/GuestIdUploadField";
import { lookupExistingGuestId, searchGuestsDetailed, type GuestIdLookupResult } from "@/lib/guestIdLookup";
import { ID_PROOF_TYPES, ID_PROOF_LABELS } from "@/lib/guests";
import { uploadFileToDrive, safeName, driveFileExtension, logDriveUploadFailure } from "@/lib/driveUpload";
import { ACTIVITY, logActivity, userDisplayName } from "@/lib/activityLog";
import { isValidOrEmptyGSTIN, GSTIN_ERROR } from "@/lib/gstin";
import { isValidMobile, sanitizeMobile, MOBILE_ERROR } from "@/lib/mobile";
import { useDiscountLimit } from "@/hooks/use-discount-limit";
import { canApplyDiscount, describeLimit } from "@/lib/discountLimit";

import { RequirePermission } from "@/components/RequirePermission";
import { reportQueryError } from "@/lib/queryError";
import { toastError } from "@/lib/errorMessage";
export const Route = createFileRoute("/_authenticated/front-desk/new-legacy")({
  head: () => ({ meta: [{ title: "New Booking — HotelPilot" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    roomId: typeof s.roomId === "string" ? s.roomId : undefined,
    categoryId: typeof s.categoryId === "string" ? s.categoryId : undefined,
    eventId: typeof s.eventId === "string" ? s.eventId : undefined,
    blockId: typeof s.blockId === "string" ? s.blockId : undefined,
    eventName: typeof s.eventName === "string" ? s.eventName : undefined,
    checkIn: typeof s.checkIn === "string" ? s.checkIn : undefined,
    checkOut: typeof s.checkOut === "string" ? s.checkOut : undefined,
  }),
  component: () => (<RequirePermission module="bookings"><NewBookingPage /></RequirePermission>),
});

interface Category { id: string; name: string; max_occupancy: number; }
const MEAL_PLAN_LABELS: Record<string, string> = {
  EP: "EP — Room only",
  CP: "CP — Breakfast",
  MAP: "MAP — Breakfast + 1 meal",
  AP: "AP — All meals",
};
interface RoomRow { id: string; room_number: string; category_id: string | null; status: string; }
interface AdditionalGuest {
  key: string;
  kind: "adult" | "child";
  name: string;
  age: string;
  id_proof_type: string;
  id_proof_number: string;
  relation: string;
}
interface GuestMatch {
  id: string;
  name: string;
  mobile: string | null;
  email: string | null;
  id_proof_type: string | null;
  id_proof_number: string | null;
  address: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  gst_number: string | null;
  company: string | null;
  tags: string[] | null;
  notes: string | null;
  visit_count: number;
  last_stay: string | null;
}

function NewBookingPage() {
  const router = useRouter();
  const search = Route.useSearch();
  const { user, roles } = useAuth();
  const canBook = roles.some((r) =>
    ["superadmin", "owner", "manager", "receptionist"].includes(r),
  );
  const { current, loading: propLoading } = useCurrentProperty();
  const { slabs: gstSlabs } = useGstSlabs(current?.id ?? null);

  const [cats, setCats] = useState<Category[]>([]);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [tariffs, setTariffs] = useState<TariffPlan[]>([]);

  // Guest lookup
  const [searchOpen, setSearchOpen] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [matches, setMatches] = useState<GuestMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);
  const [returningInfo, setReturningInfo] = useState<{ visits: number; last: string | null } | null>(null);

  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [dob, setDob] = useState("");
  const [idType, setIdType] = useState("aadhaar");
  const [idNumber, setIdNumber] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [guestState, setGuestState] = useState("");
  const [nation, setNation] = useState("India");
  const [gstNumber, setGstNumber] = useState("");
  const [company, setCompany] = useState("");
  const [guestType, setGuestType] = useState<"regular" | "corporate">("regular");
  const [guestNotes, setGuestNotes] = useState("");
  const [idFile, setIdFile] = useState<SelectedIdFile | null>(null);
  // Phase 21 — existing ID document reuse for returning guests
  const [idLookup, setIdLookup] = useState<GuestIdLookupResult | null>(null);
  const [reuseExistingId, setReuseExistingId] = useState(false);
  const dupWarnedRef = useRef<string | null>(null);
  const [customRemark, setCustomRemark] = useState("");

  // Extra bed
  const [extraBed, setExtraBed] = useState(false);
  const [extraBedQty, setExtraBedQty] = useState(1);

  const [checkIn, setCheckIn] = useState(todayIso());
  const [checkOut, setCheckOut] = useState(addDaysIso(todayIso(), 1));
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [categoryId, setCategoryId] = useState<string>("");
  const [roomId, setRoomId] = useState<string>("");
  const [tariffId, setTariffId] = useState<string>("");
  // Phase 29 — the selector holds a distinct plan *name*; the concrete
  // tariff_plans row is resolved from Name + Meal Plan + Category.
  const [planName, setPlanName] = useState<string>("");
  const [rate, setRate] = useState(0);
  const [rateManuallySet, setRateManuallySet] = useState(false);
  const [rateType, setRateType] = useState<"exclusive" | "inclusive">("exclusive");
  const { limit: discountLimit } = useDiscountLimit();
  const [mealPlan, setMealPlan] = useState("CP");

  // Phase 27b — pricing resolves exclusively through Tariff Plans. There is no
  // room_categories.base_rate fallback: if nothing resolves, that is a data
  // problem and the booking is blocked.
  const resolvedPlan = useMemo(
    () =>
      findPlanByNameAndMeal(tariffs, categoryId, planName, mealPlan, checkIn) ??
      pickTariffPlan(tariffs, { categoryId, date: checkIn, mealPlan }),
    [tariffs, categoryId, planName, checkIn, mealPlan],
  );
  const activePlan = useMemo(
    () => tariffs.find((x) => x.id === tariffId) ?? resolvedPlan,
    [tariffs, tariffId, resolvedPlan],
  );
  // Standard rate = the applicable tariff plan's rate. Nothing else.
  const standardRate = useMemo(() => Number(activePlan?.rate) || 0, [activePlan]);

  const rateOverrideCheck = useMemo(() => {
    if (!standardRate || rate <= 0 || rate >= standardRate) {
      return { allowed: true, maxRupees: 0 } as { allowed: boolean; reason?: string; maxRupees: number };
    }
    return canApplyDiscount(discountLimit, {
      discountRupees: standardRate - rate,
      base: standardRate,
    });
  }, [standardRate, rate, discountLimit]);
  // Future reservations often don't have a specific room picked yet — only the
  // category. When true, room selection is bypassed and booking_rooms.room_id
  // is stored as NULL. See feature: "Room-less Future Reservations".
  const [assignLater, setAssignLater] = useState(false);
  const [source, setSource] = useState("walk_in");
  const [otaPartnerName, setOtaPartnerName] = useState("");
  // Bill To — optional company billing (Phase 13.3).
  const [billToOther, setBillToOther] = useState(false);
  const [billingCompanyId, setBillingCompanyId] = useState<string>("");
  const [billingCompanies, setBillingCompanies] = useState<Array<{ id: string; name: string; gstin: string | null }>>([]);
  const [advance, setAdvance] = useState(0);
  const [paymentMode, setPaymentMode] = useState<string>("cash");
  const [paymentRef, setPaymentRef] = useState("");
  const [nationality, setNationality] = useState("Indian");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Additional guests
  const [extras, setExtras] = useState<AdditionalGuest[]>([]);

  useEffect(() => {
    if (!current) return;
    (async () => {
      const [c, r, t, bc] = await Promise.all([
        supabase.from("room_categories").select("id,name,max_occupancy").eq("property_id", current.id).order("name"),
        supabase.from("rooms").select("id,room_number,category_id,status").eq("property_id", current.id).order("room_number"),
        fetchTariffPlans(current.id).catch(() => [] as TariffPlan[]),
        supabase.from("billing_companies").select("id,name,gstin").eq("property_id", current.id).eq("is_active", true).order("name"),
      ]);
      setCats((c.data ?? []) as Category[]);
      setRooms((r.data ?? []) as RoomRow[]);
      setTariffs(t);
      setBillingCompanies(((bc.data ?? []) as any[]).map((x) => ({ id: x.id, name: x.name, gstin: x.gstin ?? null })));
    })();
  }, [current?.id]);

  // Auto-fill from dashboard tile click (?roomId=…&categoryId=…)
  useEffect(() => {
    if (!search?.roomId || rooms.length === 0) return;
    const room = rooms.find((r) => r.id === search.roomId);
    if (!room) return;
    const catId = search.categoryId ?? room.category_id ?? "";
    if (catId && !categoryId) pickCategory(catId);
    setRoomId(room.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search?.roomId, rooms.length]);

  // Pre-fill stay dates from search params (event flow)
  useEffect(() => {
    if (search?.checkIn) setCheckIn(search.checkIn);
    if (search?.checkOut) setCheckOut(search.checkOut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search?.checkIn, search?.checkOut, search?.eventId]);

  // Debounced guest search
  const debounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!current || !searchOpen) return;
    if (searchTerm.trim().length < 2) { setMatches([]); setDropdownOpen(false); return; }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      setSearching(true);
      // Shared implementation — see src/lib/guestIdLookup.ts
      const enriched = await searchGuestsDetailed(current.id, searchTerm, 8);
      setMatches(enriched as unknown as GuestMatch[]);
      setDropdownOpen(true);
      setSearching(false);
    }, 250);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [searchTerm, current?.id, searchOpen]);

  function selectGuest(g: GuestMatch) {
    setSelectedGuestId(g.id);
    setName(g.name ?? "");
    setMobile(g.mobile ?? "");
    setEmail(g.email ?? "");
    setDob((g as any).dob ?? "");
    setIdType(g.id_proof_type ?? "aadhaar");
    setIdNumber(g.id_proof_number ?? "");
    setAddress(g.address ?? "");
    setCity((g as any).city ?? "");
    setGuestState((g as any).state ?? "");
    setNation((g as any).country ?? "India");
    setGstNumber(g.gst_number ?? "");
    setCompany((g as any).company ?? "");
    setGuestNotes(g.notes ?? "");
    // Phase 29.5 — only Regular/Corporate are offered now; legacy tags (VIP)
    // stay on the historical record but read back as Regular here.
    setGuestType((g.tags ?? []).includes("corporate") ? "corporate" : "regular");
    setReturningInfo({ visits: g.visit_count, last: g.last_stay });
    setDropdownOpen(false);
    setSearchOpen(false);
  }

  function startNewGuest() {
    setSelectedGuestId(null);
    setReturningInfo(null);
    setIdLookup(null);
    setReuseExistingId(false);
    setName(""); setMobile(""); setEmail(""); setDob(""); setIdNumber(""); setAddress("");
    setGstNumber(""); setCompany("");
    setGuestType("regular"); setGuestNotes(""); setIdType("aadhaar");
    setDropdownOpen(false);
    setSearchOpen(false);
  }

  // Phase 21 — debounced lookup of an existing guest by mobile (first) or ID
  // number, to surface their previously uploaded ID doc + a duplicate warning.
  const idLookupTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!current) return;
    const m = mobile.trim();
    const n = idNumber.trim();
    if (m.length !== 10 && n.length < 6) {
      setIdLookup(null);
      setReuseExistingId(false);
      dupWarnedRef.current = null;
      return;
    }
    if (idLookupTimer.current) window.clearTimeout(idLookupTimer.current);
    idLookupTimer.current = window.setTimeout(async () => {
      const res = await lookupExistingGuestId(current.id, m, n);
      setIdLookup(res);
      if (!res) { setReuseExistingId(false); dupWarnedRef.current = null; return; }
      // 29.6 — auto-fill guest type from the matched guest's last saved value.
      if (res.guest.guestType) setGuestType(res.guest.guestType);
      // 21.4 — non-blocking duplicate heads-up (once per matched guest)
      const key = `${res.guest.id}:${res.matchedOn}`;
      if (dupWarnedRef.current !== key) {
        dupWarnedRef.current = key;
        toast.info(
          `A guest with this ${res.matchedOn === "mobile" ? "mobile" : "ID"} already exists — ` +
          `${res.guest.name ?? "Unnamed"}${res.guest.idProofNumber ? `, ${res.guest.idProofNumber}` : ""}`,
        );
      }
    }, 500);
    return () => { if (idLookupTimer.current) window.clearTimeout(idLookupTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobile, idNumber, current?.id]);

  const nights = nightsBetween(checkIn, checkOut);
  // Extra bed price comes from the resolved tariff plan (Phase 27b). The form
  // has a single generic bed quantity, so the adult rate is the per-bed rate.
  const extraBedRate = useMemo(() => extraBedRateFor(activePlan), [activePlan]);
  const extraBedTotal = extraBed ? nights * extraBedRate * extraBedQty : 0;
  const total = nights * rate + extraBedTotal;
  const balance = Math.max(0, total - advance);
  const availableRooms = rooms.filter(
    (r) => (!categoryId || r.category_id === categoryId) && r.status === "vacant",
  );
  // Only offer plans that are actually applicable to this stay's check-in date.
  // Phase 29.1 — distinct plan names only (no duplicate per-meal-plan entries).
  const planNames = useMemo(
    () => planNamesForCategory(tariffs, categoryId, checkIn),
    [tariffs, categoryId, checkIn],
  );
  // Phase 29.2 — meal plans cascade from the selected plan name.
  const mealPlanOptions = useMemo(
    () => mealPlansForPlanName(tariffs, categoryId, planName, checkIn),
    [tariffs, categoryId, planName, checkIn],
  );

  // === Additional guests: auto-sync row count to adult/child counts ===
  useEffect(() => {
    setExtras((prev) => {
      const adultsNeeded = Math.max(0, adults - 1);
      const childrenNeeded = Math.max(0, children);
      const prevAdults = prev.filter((p) => p.kind === "adult");
      const prevChildren = prev.filter((p) => p.kind === "child");
      const adultRows = [...prevAdults];
      while (adultRows.length < adultsNeeded) adultRows.push(blankGuest("adult"));
      adultRows.length = adultsNeeded;
      const childRows = [...prevChildren];
      while (childRows.length < childrenNeeded) childRows.push(blankGuest("child"));
      childRows.length = childrenNeeded;
      return [...adultRows, ...childRows];
    });
  }, [adults, children]);

  function updateExtra(key: string, patch: Partial<AdditionalGuest>) {
    setExtras((prev) => prev.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  }

  // Phase 29 — keep the plan name valid for the current category/date, and
  // default it (Corporate guests → "Corporate", otherwise "Regular"/first).
  useEffect(() => {
    if (!categoryId || tariffs.length === 0) return;
    if (planNames.length === 0) {
      setPlanName("");
      setTariffId("");
      if (!rateManuallySet) setRate(0);
      return;
    }
    if (planName && planNames.includes(planName)) return;
    setPlanName(preferredPlanName(planNames));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId, tariffs, planNames.join("|")]);

  // Phase 29.7 — Corporate guest type forces the Corporate plan when it exists.
  useEffect(() => {
    if (guestType !== "corporate") return;
    const corp = planNames.find((n) => n.toLowerCase() === "corporate");
    if (corp && planName !== corp) setPlanName(corp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestType, planNames.join("|")]);

  // Phase 29.2 — meal plan cascades from the plan name, defaulting to CP.
  useEffect(() => {
    if (!planName) return;
    if (mealPlanOptions.length === 0) return;
    if (mealPlanOptions.includes(mealPlan)) return;
    setMealPlan(defaultMealPlanFor(mealPlanOptions));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planName, mealPlanOptions.join("|")]);

  // Phase 29.3 — once Name + Meal Plan resolve to one row, auto-fill the rate.
  useEffect(() => {
    if (!categoryId || !planName || !mealPlan) return;
    const t = findPlanByNameAndMeal(tariffs, categoryId, planName, mealPlan, checkIn);
    if (!t) { setTariffId(""); return; }
    setTariffId(t.id);
    if (!rateManuallySet) setRate(Number(t.rate) || 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId, planName, mealPlan, checkIn, tariffs]);

  function addManualExtra() {
    setExtras((prev) => [...prev, blankGuest("adult")]);
  }
  function removeExtra(key: string) {
    setExtras((prev) => prev.filter((g) => g.key !== key));
  }

  /** Corporate guests prefer the Corporate plan; otherwise Regular, else first. */
  function preferredPlanName(names: string[]): string {
    const byName = (want: string) => names.find((n) => n.toLowerCase() === want);
    if (guestType === "corporate") {
      const c = byName("corporate");
      if (c) return c;
    }
    return byName("regular") ?? names[0] ?? "";
  }

  // Phase 29.4 — changing category invalidates the downstream Name/Meal Plan.
  function pickCategory(id: string) {
    setCategoryId(id);
    setRoomId("");
    setPlanName("");
    setTariffId("");
    const names = planNamesForCategory(tariffs, id, checkIn);
    if (names.length === 0) {
      if (!rateManuallySet) setRate(0);
      toast.error(NO_TARIFF_PLAN_ERROR);
      return;
    }
    const next = preferredPlanName(names);
    setPlanName(next);
    const meals = mealPlansForPlanName(tariffs, id, next, checkIn);
    setMealPlan(defaultMealPlanFor(meals) || "CP");
  }

  function pickPlanName(nextName: string) {
    setPlanName(nextName);
    const meals = mealPlansForPlanName(tariffs, categoryId, nextName, checkIn);
    setMealPlan(defaultMealPlanFor(meals) || mealPlan);
  }

  async function save(checkInNow: boolean) {
    if (!current) return;
    if (!name.trim()) return toast.error("Guest name required");
    if (!isValidMobile(mobile)) return toast.error(MOBILE_ERROR);
    if (!categoryId) return toast.error("Pick a category");
    // Phase 27b — a booking must always carry a resolved tariff plan.
    if (!tariffId) return toast.error(NO_TARIFF_PLAN_ERROR);
    if (!assignLater && !roomId) return toast.error("Pick a room (or tick 'Assign room later')");
    if (assignLater && checkInNow)
      return toast.error("Assign a room before checking in — a room is required to check in a guest");
    if (!isValidStayRange(checkIn, checkOut)) return toast.error("Check-out must be after check-in");
    if (!isValidOrEmptyGSTIN(gstNumber)) {
      toast.error(GSTIN_ERROR);
      if (typeof document !== "undefined") {
        const el = document.getElementById("gstin-input") as HTMLInputElement | null;
        el?.focus();
        el?.select?.();
      }
      return;
    }
    if (!rateOverrideCheck.allowed) {
      toast.error(rateOverrideCheck.reason ?? "Rate below allowed limit for your role");
      return;
    }

    setSaving(true);
    try {
      // 1) Guest — update existing or create new
      const tags = guestType === "regular" ? [] : [guestType];
      let guestId = selectedGuestId;
      // Duplicate-mobile guard: when creating a brand-new guest, check whether
      // the mobile already belongs to a guest on this property. If so, ask
      // the user whether to reuse the existing guest record.
      if (!guestId && mobile.trim()) {
        const { data: dup, error: __qe1 } = await supabase
          .from("guests")
          .select("id,name,mobile")
          .eq("property_id", current.id)
          .eq("mobile", mobile.trim())
          .eq("is_wiped", false)
          .limit(1)
          .maybeSingle();
        if (__qe1) reportQueryError("guests", __qe1);
        if (dup) {
          const reuse = confirm(
            `A guest with mobile ${mobile} already exists: "${dup.name}".\n\n` +
              `OK   → Use the existing guest profile (recommended)\n` +
              `Cancel → Create a new guest anyway`,
          );
          if (reuse) {
            guestId = dup.id;
          }
        }
      }
      if (guestId) {
        const { error: uErr } = await supabase
          .from("guests")
          .update({
            name: name.trim(),
            mobile: mobile || null,
            email: email || null,
            dob: dob || null,
            id_proof_type: idType || null,
            id_proof_number: idNumber || null,
            address: address || null,
            city: city.trim() || null,
            state: guestState.trim() || null,
            country: nation.trim() || "India",
            gst_number: gstNumber.trim() || null,
            company: company.trim() || null,
            nationality: nationality || null,
            notes: guestNotes || null,
            tags,
          })
          .eq("id", guestId)
          .eq("property_id", current.id);
        if (uErr) throw uErr;
      } else {
        const { data: g, error: gErr } = await supabase
          .from("guests")
          .insert({
            property_id: current.id,
            name: name.trim(),
            mobile: mobile || null,
            email: email || null,
            dob: dob || null,
            id_proof_type: idType || null,
            id_proof_number: idNumber || null,
            address: address || null,
            city: city.trim() || null,
            state: guestState.trim() || null,
            country: nation.trim() || "India",
            gst_number: gstNumber.trim() || null,
            company: company.trim() || null,
            nationality: nationality || null,
            notes: guestNotes || null,
            tags,
          })
          .select("id")
          .single();
        if (gErr) throw gErr;
        guestId = g!.id;
      }

      // 2) Booking
      const { data: booking, error: bErr } = await supabase
        .from("bookings")
        .insert({
          property_id: current.id,
          booking_number: "",
          guest_id: guestId!,
          source,
          ota_partner_name:
            (source === "ota" || source === "agent") && otaPartnerName.trim()
              ? otaPartnerName.trim()
              : null,
          billing_company_id: billToOther && billingCompanyId ? billingCompanyId : null,
          status: checkInNow ? "checked_in" : "reserved",
          check_in: checkIn,
          check_out: checkOut,
          adults,
          children,
          total_amount: total,
          advance_amount: advance,
          balance_amount: balance,
          notes: search?.eventName
            ? `Event: ${search.eventName}${notes ? "\n" + notes : ""}`
            : (notes || null),
          custom_remark: customRemark.trim() || null,
          event_id: search?.eventId ?? null,
          created_by: user?.id ?? null,
          rate_type: rateType,
          checked_in_at: checkInNow ? new Date().toISOString() : null,
          checked_in_by: checkInNow ? (user?.id ?? null) : null,
        } as any)
        .select("id, booking_number")
        .single();
      if (bErr) throw bErr;

      // 3) Booking room — room_id may be NULL for future reservations that
      // will get their specific room assigned later via AssignRoomDialog.
      const effectiveRoomId = assignLater ? null : roomId;
      const { error: brErr } = await supabase.from("booking_rooms").insert({
        booking_id: booking!.id,
        property_id: current.id,
        room_id: effectiveRoomId,
        category_id: categoryId,
        tariff_id: tariffId || null,
        meal_plan: mealPlan,
        rate,
        adults,
        children,
        check_in: checkIn,
        check_out: checkOut,
        actual_check_in: checkInNow && effectiveRoomId ? new Date().toISOString() : null,
      } as any);
      if (brErr) throw brErr;

      // 3b) Extra bed — seeds one folio charge automatically via trigger.
      if (extraBed && extraBedRate > 0 && extraBedQty > 0) {
        const { error: ebErr } = await supabase.from("booking_extra_beds" as any).insert({
          property_id: current.id,
          booking_id: booking!.id,
          quantity: extraBedQty,
          rate_per_night: extraBedRate,
          added_from_date: checkIn,
          added_by: user?.id ?? null,
        } as any);
        if (ebErr) console.warn("extra bed insert failed", ebErr);
      }

      // 4) If checked in with an actual room, mark room occupied.
      if (checkInNow && effectiveRoomId) {
        await supabase.from("rooms").update({ status: "occupied" }).eq("id", effectiveRoomId);
      }

      // 4b) If this booking originated from an event block, sync that block.
      if (search?.blockId) {
        await supabase.from("event_room_blocks").update({
          status: checkInNow ? "checked_in" : "blocked",
          booking_id: booking!.id,
          guest_id: guestId!,
          guest_name: name.trim(),
          guest_mobile: mobile || null,
          checked_in_at: checkInNow ? new Date().toISOString() : null,
          checked_in_by: checkInNow ? (user?.id ?? null) : null,
          updated_at: new Date().toISOString(),
        } as any).eq("id", search.blockId);
      }

      // 5) Primary guest link
      await supabase.from("booking_guests").insert({
        property_id: current.id,
        booking_id: booking!.id,
        guest_id: guestId!,
        is_primary: true,
        relation_to_primary: "self",
      } as any);

      // 6) Additional guests — insert lightweight guest rows + link
      for (const ex of extras) {
        if (!ex.name.trim()) continue;
        const { data: ng, error: ngErr } = await supabase
          .from("guests")
          .insert({
            property_id: current.id,
            name: ex.name.trim(),
            id_proof_type: ex.id_proof_type || null,
            id_proof_number: ex.id_proof_number || null,
            nationality: nationality || null,
            notes: `Additional guest for booking ${booking!.booking_number}`,
          })
          .select("id")
          .single();
        if (ngErr) { console.warn("extra guest insert failed", ngErr); continue; }
        await supabase.from("booking_guests").insert({
          property_id: current.id,
          booking_id: booking!.id,
          guest_id: ng!.id,
          is_primary: false,
          age: ex.age ? Number(ex.age) : null,
          relation_to_primary: ex.relation || null,
        } as any);
      }

      // 7) Advance payment record (Issue #5)
      if (advance > 0) {
        const { data: folioId, error: __qe2 } = await supabase.rpc("get_or_create_folio", { _booking_id: booking!.id });
        if (__qe2) reportQueryError("get or create folio", __qe2);
        await supabase.from("payments").insert({
          property_id: current.id,
          booking_id: booking!.id,
          folio_id: (folioId as unknown as string) ?? null,
          amount: advance,
          mode: paymentMode,
          reference_no: paymentRef || null,
          notes: "Advance at check-in",
          paid_at: new Date().toISOString(),
          created_by: user?.id ?? null,
        } as any);
        logActivity({
          property_id: current.id,
          user_id: user?.id ?? "",
          user_name: userDisplayName(user as never),
          action_type: "PAYMENT_RECEIVED",
          module: "Billing",
          reference_id: booking!.id,
          reference_label: booking!.booking_number ?? null,
          details: {
            booking_id: booking!.id,
            folio_id: (folioId as unknown as string) ?? null,
            amount: advance,
            mode: paymentMode,
            source: "booking_advance",
          },
        });
      }

      toast.success(`Booking ${booking!.booking_number} created`);

      // Activity log — booking + (optional) checkin
      const actorName = userDisplayName(user as any);
      await logActivity({
        property_id: current.id,
        user_id: user?.id ?? "",
        user_name: actorName,
        ...ACTIVITY.BOOKING_CREATED,
        reference_id: booking!.id,
        reference_label: `${booking!.booking_number} — ${name}`,
        details: {
          check_in: checkIn,
          check_out: checkOut,
          room_id: effectiveRoomId,
          unassigned: effectiveRoomId === null,
          total,
        },
      });
      if (checkInNow) {
        await logActivity({
          property_id: current.id,
          user_id: user?.id ?? "",
          user_name: actorName,
          ...ACTIVITY.CHECKIN,
          reference_id: booking!.id,
          reference_label: `${booking!.booking_number} — ${name}`,
        });
      }

      // ID Document upload (best-effort, deferred to after booking save)
      if (!idFile && reuseExistingId && idLookup?.doc && guestId) {
        // Phase 21.3 — reuse the already-stored Drive file: link the same
        // file to this booking's document record, no re-upload.
        try {
          const doc = idLookup.doc;
          await supabase.from("guests").update({
            id_document_url: doc.driveViewUrl,
            id_document_name: doc.documentName,
            id_document_uploaded_at: doc.uploadedAt ?? new Date().toISOString(),
          } as any).eq("id", guestId);
          await supabase.from("guest_documents").insert({
            property_id: current.id,
            guest_id: guestId,
            booking_id: booking!.id,
            document_name: doc.documentName,
            drive_file_id: doc.driveFileId,
            drive_view_url: doc.driveViewUrl,
            drive_folder_path: doc.driveFolderPath,
          } as any);
          toast.success("✓ Existing ID document reused");
        } catch (e: any) {
          console.warn("ID reuse failed", e);
          toast.error("Could not attach existing ID document");
        }
      } else if (idFile && guestId) {
        try {
          const ts = Date.now();
          const ext = driveFileExtension(idFile.file);
          const fileName = `${safeName(name || "Guest")}_${safeName(booking!.booking_number || booking!.id.slice(0, 8))}_${ts}.${ext}`;
          const res = await uploadFileToDrive(idFile.file, "id_doc", fileName);
          await supabase.from("guests").update({
            id_document_url: res.viewUrl,
            id_document_name: idFile.file.name,
            id_document_uploaded_at: new Date().toISOString(),
          } as any).eq("id", guestId);
          await supabase.from("guest_documents").insert({
            property_id: current.id,
            guest_id: guestId,
            booking_id: booking!.id,
            document_name: idFile.file.name,
            drive_file_id: res.fileId,
            drive_view_url: res.viewUrl,
            drive_folder_path: null,
          } as any);
          toast.success("✓ ID document uploaded to Drive");
        } catch (e: any) {
          await logDriveUploadFailure(e, {
            stage: "persist",
            folderType: "id_doc",
            file: idFile.file,
            extra: { bookingId: booking!.id, guestId },
          });
          toast.error(errorMessage(e, "uploading the ID document"));
        }
      }

      // Fire WhatsApp triggers (best-effort, never blocks navigation)
      const { fireTrigger } = await import("@/lib/whatsapp");
      fireTrigger("booking_confirm", {
        property_id: current.id,
        booking_id: booking!.id,
        guest_id: guestId!,
        phone: mobile || null,
      });
      if (checkInNow) {
        fireTrigger("checkin_welcome", {
          property_id: current.id,
          booking_id: booking!.id,
          guest_id: guestId!,
          phone: mobile || null,
        });
      }
      router.navigate({ to: "/front-desk/booking/$id", params: { id: booking!.id } });
    } catch (e: any) {
      toastError(e, "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (propLoading) return <AppShell title="New Booking"><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (!current) return <AppShell title="New Booking"><EmptyPropertyState /></AppShell>;
  if (!canBook) return <AppShell title="New Booking"><p className="text-sm text-muted-foreground">You don't have permission to create bookings.</p></AppShell>;

  return (
    <AppShell title="New Booking">
      <div className="max-w-5xl space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Guest details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {/* Guest lookup */}
            <div className="space-y-2">
              <Label className="text-xs">Find existing guest</Label>
              <div className="relative">
                <Input
                  placeholder="Search by name, mobile, or email..."
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); setSearchOpen(true); }}
                  onFocus={() => { if (matches.length) setDropdownOpen(true); }}
                />
                {dropdownOpen && (
                  <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-md max-h-72 overflow-auto">
                    {searching && <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>}
                    {!searching && matches.length === 0 && (
                      <div className="p-3 space-y-2">
                        <div className="text-xs text-muted-foreground">No guest found</div>
                        <Button size="sm" variant="outline" onClick={startNewGuest}>+ Create new guest</Button>
                      </div>
                    )}
                    {!searching && matches.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => selectGuest(g)}
                        className="w-full text-left px-3 py-2 hover:bg-accent border-b last:border-b-0"
                      >
                        <div className="flex justify-between gap-2">
                          <span className="font-medium text-sm">{g.name}</span>
                          <span className="text-xs text-muted-foreground">{g.mobile ?? "—"}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {g.visit_count} visit{g.visit_count === 1 ? "" : "s"}
                          {g.last_stay ? ` · Last stayed ${fmtDate(g.last_stay)}` : ""}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button type="button" className="text-xs text-primary underline" onClick={startNewGuest}>
                Skip — enter details manually
              </button>
            </div>

            {returningInfo && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs">
                <Badge className="bg-green-600 hover:bg-green-600">Returning Guest ✓</Badge>
                <span className="text-green-900">
                  {returningInfo.visits} visit{returningInfo.visits === 1 ? "" : "s"}
                  {returningInfo.last ? ` · Last stayed ${fmtDate(returningInfo.last)}` : ""}
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
            <F label="Full name *"><Input autoTitleCase value={name} onChange={(e) => setName(e.target.value)} /></F>
            <F label="Mobile *">
              <Input
                value={mobile}
                onChange={(e) => setMobile(sanitizeMobile(e.target.value))}
                inputMode="numeric"
                pattern="\d{10}"
                maxLength={10}
                placeholder="10-digit mobile"
                className={mobile && !isValidMobile(mobile) ? "border-red-500 focus-visible:ring-red-500" : ""}
              />
              {mobile && !isValidMobile(mobile) && (
                <p className="mt-1 text-[11px] text-red-600">{MOBILE_ERROR}</p>
              )}
            </F>
            <F label="Date of Birth (optional)">
              <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
            </F>
            <F label="Email"><Input value={email} onChange={(e) => setEmail(e.target.value)} /></F>
            <F label="ID type">
              <Select value={idType} onValueChange={setIdType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ID_PROOF_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{ID_PROOF_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </F>
            <F label="ID number"><Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} /></F>
            <F label="Company (optional)"><Input autoTitleCase value={company} onChange={(e) => setCompany(e.target.value)} /></F>
            <F label="GSTIN (optional)">
              <Input
                id="gstin-input"
                value={gstNumber}
                onChange={(e) => setGstNumber(e.target.value.toUpperCase())}
                maxLength={15}
                placeholder="e.g. 27AASFB5351R1ZM"
                className={gstNumber && !isValidOrEmptyGSTIN(gstNumber) ? "border-red-500 focus-visible:ring-red-500" : ""}
              />
              {gstNumber && !isValidOrEmptyGSTIN(gstNumber) && (
                <p className="mt-1 text-[11px] text-red-600">{GSTIN_ERROR}</p>
              )}
            </F>
            <div className="col-span-2 rounded-md border p-3 bg-muted/20 space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={billToOther}
                  onChange={(e) => {
                    setBillToOther(e.target.checked);
                    if (!e.target.checked) setBillingCompanyId("");
                  }}
                />
                Bill to someone else?
              </label>
              {billToOther && (
                <div className="pl-6 space-y-1">
                  <Label className="text-xs">Billing Company</Label>
                  <SearchableSelect
                    className="max-w-md"
                    value={billingCompanyId}
                    onChange={setBillingCompanyId}
                    placeholder="Select company…"
                    searchPlaceholder="Type to search companies…"
                    emptyText="No company matches"
                    options={billingCompanies.map((co) => ({
                      value: co.id,
                      label: co.name,
                      hint: co.gstin ?? undefined,
                      keywords: co.gstin ?? "",
                    }))}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Manage companies in Billing → Billing Companies. If unset, bill goes to the guest.
                  </p>
                </div>
              )}
            </div>
            <F label="Guest type">
              <Select value={guestType} onValueChange={(v) => setGuestType(v as typeof guestType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="regular">Regular</SelectItem>
                  <SelectItem value="corporate">Corporate</SelectItem>
                </SelectContent>
              </Select>
            </F>
            <F label="Nationality">
              <Input value={nationality} onChange={(e) => setNationality(e.target.value)} placeholder="Indian" />
            </F>
            <div className="col-span-2">
              <F label="Address"><Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} /></F>
            </div>
            <F label="City"><CityInput value={city} onChange={setCity} /></F>
            <F label="State / UT"><StateSelect value={guestState} onChange={setGuestState} /></F>
            <F label="Nation"><NationInput value={nation} onChange={setNation} /></F>
            <div className="col-span-2">
              <F label="Guest notes"><Textarea rows={2} value={guestNotes} onChange={(e) => setGuestNotes(e.target.value)} /></F>
            </div>
            </div>

            <div className="pt-2 border-t">
              <GuestIdUploadField
                value={idFile}
                onChange={setIdFile}
                disabled={saving}
                existingDoc={idLookup?.doc ?? null}
                existingGuestName={idLookup?.guest.name ?? null}
                reuseExisting={reuseExistingId}
                onReuseChange={(v) => { setReuseExistingId(v); if (v) setIdFile(null); }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Additional guests (Issue #6) */}
        {extras.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Additional guests ({extras.length})</CardTitle>
              <Button size="sm" variant="outline" onClick={addManualExtra}>
                <UserPlus className="h-4 w-4 mr-1" /> Add guest manually
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {extras.map((g, idx) => (
                <div key={g.key} className="rounded-md border p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {g.kind === "adult" ? `Adult guest #${idx + 1}` : `Child #${idx + 1 - extras.filter((e) => e.kind === "adult").length}`}
                    </div>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeExtra(g.key)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <F label="Full name *">
                      <Input autoTitleCase value={g.name} onChange={(e) => updateExtra(g.key, { name: e.target.value })} />
                    </F>
                    <F label="Age *">
                      <Input type="number" value={g.age} onChange={(e) => updateExtra(g.key, { age: e.target.value })} />
                    </F>
                    {g.kind === "adult" && (
                      <>
                        <F label="ID proof type *">
                          <Select value={g.id_proof_type} onValueChange={(v) => updateExtra(g.key, { id_proof_type: v })}>
                            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                            <SelectContent>
                              {ID_PROOF_TYPES.map((t) => (
                                <SelectItem key={t} value={t}>{ID_PROOF_LABELS[t]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </F>
                        <F label="ID proof number *">
                          <Input value={g.id_proof_number} onChange={(e) => updateExtra(g.key, { id_proof_number: e.target.value })} />
                        </F>
                        <div className="col-span-2">
                          <F label="Relation to primary guest *">
                            <Select value={g.relation} onValueChange={(v) => updateExtra(g.key, { relation: v })}>
                              <SelectTrigger><SelectValue placeholder="Select relation" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Spouse">Spouse</SelectItem>
                                <SelectItem value="Child">Child</SelectItem>
                                <SelectItem value="Parent">Parent</SelectItem>
                                <SelectItem value="Sibling">Sibling</SelectItem>
                                <SelectItem value="Friend">Friend</SelectItem>
                                <SelectItem value="Colleague">Colleague</SelectItem>
                                <SelectItem value="Other">Other</SelectItem>
                              </SelectContent>
                            </Select>
                          </F>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
        {extras.length === 0 && (adults > 1 || children > 0) === false && (
          <div className="flex">
            <Button size="sm" variant="outline" onClick={addManualExtra}>
              <UserPlus className="h-4 w-4 mr-1" /> Add additional guest manually
            </Button>
          </div>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">Stay & room</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <F label="Check-in *"><Input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} /></F>
            <F label="Check-out *"><Input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} /></F>
            <F label="Adults"><Input type="number" min={1} value={adults} onChange={(e) => setAdults(Number(e.target.value))} /></F>
            <F label="Children"><Input type="number" min={0} value={children} onChange={(e) => setChildren(Number(e.target.value))} /></F>
            <F label="Category *">
              <SearchableSelect
                value={categoryId}
                onChange={pickCategory}
                placeholder="Select category"
                searchPlaceholder="Type to filter categories…"
                options={cats.map((c) => ({ value: c.id, label: c.name })) as SearchableOption[]}
              />
            </F>
            <F label="Room *">
              <SearchableSelect
                value={roomId}
                onChange={setRoomId}
                disabled={!categoryId || assignLater}
                placeholder={categoryId ? (availableRooms.length ? "Select vacant room" : "No vacant rooms") : "Pick category first"}
                searchPlaceholder="Type room number…"
                options={availableRooms.map((r) => ({
                  value: r.id,
                  label: r.room_number,
                  keywords: cats.find((c) => c.id === r.category_id)?.name ?? "",
                })) as SearchableOption[]}
              />
              <label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={assignLater}
                  onChange={(e) => {
                    setAssignLater(e.target.checked);
                    if (e.target.checked) setRoomId("");
                  }}
                />
                Assign room later (for future reservations — a specific room can
                be picked closer to check-in)
              </label>
            </F>
            <F label="Tariff plan">
              <SearchableSelect
                value={planName}
                onChange={pickPlanName}
                disabled={!categoryId}
                placeholder={categoryId ? "Select tariff plan" : "Pick category first"}
                searchPlaceholder="Search tariff plans…"
                options={planNames.map((n) => ({
                  value: n,
                  label: n,
                })) as SearchableOption[]}
              />
            </F>
            <F label="Meal plan">
              <Select value={mealPlan} onValueChange={setMealPlan} disabled={!planName}>
                <SelectTrigger><SelectValue placeholder={planName ? "Select meal plan" : "Pick tariff plan first"} /></SelectTrigger>
                <SelectContent>
                  {mealPlanOptions.map((m) => (
                    <SelectItem key={m} value={m}>{MEAL_PLAN_LABELS[m] ?? m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </F>
            <F label="Rate / night (₹)">
              <div className="space-y-1.5">
                <Input type="number" value={rate} onChange={(e) => { setRate(Number(e.target.value)); setRateManuallySet(true); }} />
                <div className="flex items-center gap-3 text-xs">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="radio" name="rateType" checked={rateType === "exclusive"} onChange={() => setRateType("exclusive")} />
                    <span>Exclusive of GST</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="radio" name="rateType" checked={rateType === "inclusive"} onChange={() => setRateType("inclusive")} />
                    <span>Inclusive of GST</span>
                  </label>
                </div>
                {!discountLimit.unlimited && standardRate > 0 && rate > 0 && rate < standardRate && (
                  <div className={`text-[11px] ${rateOverrideCheck.allowed ? "text-muted-foreground" : "text-destructive"}`}>
                    Standard rate ₹{standardRate.toLocaleString("en-IN")} — you are reducing by ₹{(standardRate - rate).toLocaleString("en-IN")}.
                    {" "}{rateOverrideCheck.allowed ? describeLimit(discountLimit) : (rateOverrideCheck.reason ?? "Not allowed.")}
                  </div>
                )}
                {rate > 0 && (() => {
                  const g = rateType === "inclusive"
                    ? resolveGstRateInclusive(gstSlabs, "room", rate)
                    : resolveGstRate(gstSlabs, "room", rate);
                  if (g == null) {
                    return (
                      <div className="text-[11px] text-destructive">
                        No GST slab configured for this room tariff. Configure it in Master Data → GST Slabs.
                      </div>
                    );
                  }
                  if (rateType === "inclusive") {
                    const taxable = rate / (1 + g / 100);
                    const gst = rate - taxable;
                    return (
                      <div className="text-[11px] text-muted-foreground">
                        Incl. GST {g}% → Taxable ₹{taxable.toFixed(2)} + GST ₹{gst.toFixed(2)} = ₹{rate.toFixed(2)}
                      </div>
                    );
                  }
                  const gst = rate * g / 100;
                  return (
                    <div className="text-[11px] text-muted-foreground">
                      Excl. GST {g}% → Taxable ₹{rate.toFixed(2)} + GST ₹{gst.toFixed(2)} = ₹{(rate + gst).toFixed(2)}
                    </div>
                  );
                })()}
              </div>
            </F>
            <F label="Source">
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => (<SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </F>
            {(source === "ota" || source === "agent") && (
              <F label="OTA / Travel Partner Name (optional)">
                <Input
                  value={otaPartnerName}
                  onChange={(e) => setOtaPartnerName(e.target.value)}
                  maxLength={80}
                  placeholder="e.g. MakeMyTrip, Goibibo, Agoda"
                />
              </F>
            )}
            <F label="Extra bed">
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={extraBed}
                    onChange={(e) => setExtraBed(e.target.checked)}
                    disabled={!categoryId || extraBedRate <= 0}
                  />
                  <span>Add extra bed</span>
                </label>
                {extraBed && (
                  <>
                    <Input
                      type="number"
                      min={1}
                      max={4}
                      value={extraBedQty}
                      onChange={(e) => setExtraBedQty(Math.max(1, Number(e.target.value) || 1))}
                    />
                    <div className="text-[11px] text-muted-foreground">
                      ₹{extraBedRate.toLocaleString("en-IN")}/night × {extraBedQty} bed{extraBedQty > 1 ? "s" : ""} × {nights} night{nights > 1 ? "s" : ""} = ₹{extraBedTotal.toLocaleString("en-IN")}
                    </div>
                  </>
                )}
                {categoryId && extraBedRate <= 0 && (
                  <div className="text-[11px] text-muted-foreground">
                    No extra bed rate on this tariff plan — set “Extra adult rate” in Master Data → Tariff Plans.
                  </div>
                )}
              </div>
            </F>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment at Check-in (Advance)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-4 gap-3 text-sm">
              <Stat label="Nights" value={String(nights)} />
              <Stat label="Room total" value={`₹${total.toLocaleString("en-IN")}`} />
              <F label="Advance ₹"><Input type="number" value={advance} onChange={(e) => setAdvance(Number(e.target.value))} /></F>
              <Stat label="Balance" value={`₹${balance.toLocaleString("en-IN")}`} highlight />
            </div>
            {advance > 0 && (
              <div className="grid grid-cols-2 gap-3">
                <F label="Payment mode *">
                  <Select value={paymentMode} onValueChange={setPaymentMode}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                      <SelectItem value="upi">UPI</SelectItem>
                      <SelectItem value="bank">Bank Transfer</SelectItem>
                    </SelectContent>
                  </Select>
                </F>
                <F label="Reference (txn id, last 4)">
                  <Input value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} placeholder="Optional" />
                </F>
              </div>
            )}
            <F label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></F>
            <F label="Custom remark (highlighted at checkout)">
              <Textarea
                rows={2}
                value={customRemark}
                onChange={(e) => setCustomRemark(e.target.value)}
                placeholder="e.g. ID proof pending, payment confirmation awaited, VIP — apply special rate"
              />
            </F>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={saving || (gstNumber ? !isValidOrEmptyGSTIN(gstNumber) : false)}
            onClick={() => save(false)}
            title={gstNumber && !isValidOrEmptyGSTIN(gstNumber) ? GSTIN_ERROR : undefined}
          >
            Save as reservation
          </Button>
          <Button
            disabled={saving || assignLater || (gstNumber ? !isValidOrEmptyGSTIN(gstNumber) : false)}
            onClick={() => save(true)}
            title={
              gstNumber && !isValidOrEmptyGSTIN(gstNumber)
                ? GSTIN_ERROR
                : assignLater
                  ? "Assign a room to enable check-in"
                  : undefined
            }
          >
            Save &amp; check-in now
          </Button>
        </div>
      </div>
    </AppShell>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs">{label}</Label>{children}</div>;
}
function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className={`h-9 px-3 flex items-center rounded-md border ${highlight ? "font-semibold bg-primary/5" : "bg-muted/30"}`}>{value}</div>
    </div>
  );
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

function blankGuest(kind: "adult" | "child"): AdditionalGuest {
  return {
    key: Math.random().toString(36).slice(2),
    kind,
    name: "",
    age: "",
    id_proof_type: kind === "adult" ? "aadhaar" : "",
    id_proof_number: "",
    relation: kind === "child" ? "Child" : "",
  };
}