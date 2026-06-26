import { createFileRoute, useRouter } from "@tanstack/react-router";
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
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import { addDaysIso, nightsBetween, SOURCES, todayIso } from "@/lib/front-desk";
import { GuestIdUploadField, type SelectedIdFile } from "@/components/GuestIdUploadField";
import { uploadToDrive, isDriveConfigured } from "@/lib/googleDrive";
import { ACTIVITY, logActivity, userDisplayName } from "@/lib/activityLog";

export const Route = createFileRoute("/_authenticated/front-desk/new")({
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
  component: NewBookingPage,
});

interface Category { id: string; name: string; base_rate: number; max_occupancy: number; }
interface RoomRow { id: string; room_number: string; category_id: string | null; status: string; }
interface Tariff { id: string; name: string; category_id: string | null; rate: number; meal_plan: string; }
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

  const [cats, setCats] = useState<Category[]>([]);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);

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
  const [guestType, setGuestType] = useState<"regular" | "corporate" | "vip">("regular");
  const [guestNotes, setGuestNotes] = useState("");
  const [idFile, setIdFile] = useState<SelectedIdFile | null>(null);

  const [checkIn, setCheckIn] = useState(todayIso());
  const [checkOut, setCheckOut] = useState(addDaysIso(todayIso(), 1));
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [categoryId, setCategoryId] = useState<string>("");
  const [roomId, setRoomId] = useState<string>("");
  const [tariffId, setTariffId] = useState<string>("");
  const [rate, setRate] = useState(0);
  const [rateManuallySet, setRateManuallySet] = useState(false);
  const [mealPlan, setMealPlan] = useState("EP");
  const [source, setSource] = useState("walk_in");
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
      const [c, r, t] = await Promise.all([
        supabase.from("room_categories").select("id,name,base_rate,max_occupancy").eq("property_id", current.id).order("name"),
        supabase.from("rooms").select("id,room_number,category_id,status").eq("property_id", current.id).order("room_number"),
        supabase.from("tariff_plans").select("id,name,category_id,rate,meal_plan").eq("property_id", current.id).eq("is_active", true).order("name"),
      ]);
      setCats((c.data ?? []) as Category[]);
      setRooms((r.data ?? []) as RoomRow[]);
      setTariffs((t.data ?? []) as Tariff[]);
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

  // Debounced guest search
  const debounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!current || !searchOpen) return;
    if (searchTerm.trim().length < 2) { setMatches([]); setDropdownOpen(false); return; }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      setSearching(true);
      const term = searchTerm.trim().replace(/[%,]/g, "");
      const like = `%${term}%`;
      const { data } = await supabase
        .from("guests")
        .select("id,name,mobile,email,dob,id_proof_type,id_proof_number,address,tags,notes")
        .eq("property_id", current.id)
        .or(`name.ilike.${like},mobile.ilike.${like},email.ilike.${like}`)
        .limit(8);
      const guests = (data ?? []) as any[];
      // Fetch visit stats per guest
      const enriched: GuestMatch[] = await Promise.all(guests.map(async (g) => {
        const { data: bks } = await supabase
          .from("bookings")
          .select("check_in")
          .eq("guest_id", g.id)
          .order("check_in", { ascending: false });
        const rows = bks ?? [];
        return { ...g, visit_count: rows.length, last_stay: rows[0]?.check_in ?? null };
      }));
      setMatches(enriched);
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
    setGuestNotes(g.notes ?? "");
    const tag = (g.tags ?? []).find((t) => ["corporate", "vip"].includes(t));
    setGuestType((tag as any) ?? "regular");
    setReturningInfo({ visits: g.visit_count, last: g.last_stay });
    setDropdownOpen(false);
    setSearchOpen(false);
  }

  function startNewGuest() {
    setSelectedGuestId(null);
    setReturningInfo(null);
    setName(""); setMobile(""); setEmail(""); setDob(""); setIdNumber(""); setAddress("");
    setGuestType("regular"); setGuestNotes(""); setIdType("aadhaar");
    setDropdownOpen(false);
    setSearchOpen(false);
  }

  const nights = nightsBetween(checkIn, checkOut);
  const total = nights * rate;
  const balance = Math.max(0, total - advance);
  const availableRooms = rooms.filter(
    (r) => (!categoryId || r.category_id === categoryId) && r.status === "vacant",
  );
  const categoryTariffs = tariffs.filter((t) => !categoryId || t.category_id === categoryId);

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
  function addManualExtra() {
    setExtras((prev) => [...prev, blankGuest("adult")]);
  }
  function removeExtra(key: string) {
    setExtras((prev) => prev.filter((g) => g.key !== key));
  }

  function pickCategory(id: string) {
    setCategoryId(id);
    setRoomId("");
    // Always refresh rate from category/tariff on category change unless the
    // user explicitly edited it (rateManuallySet).
    const cat = cats.find((c) => c.id === id);
    // Prefer "Rack Rate" tariff (case-insensitive name match), else first matching tariff.
    const catTariffs = tariffs.filter((t) => t.category_id === id);
    const t =
      catTariffs.find((t) => /rack/i.test(t.name)) ??
      catTariffs[0] ??
      tariffs.find((t) => /rack/i.test(t.name)) ??
      tariffs[0];
    if (t) {
      setTariffId(t.id);
      if (!rateManuallySet) setRate(t.rate);
      setMealPlan(t.meal_plan);
    } else {
      setTariffId("");
      if (!rateManuallySet && cat) setRate(cat.base_rate);
    }
  }

  function pickTariff(id: string) {
    setTariffId(id);
    const t = tariffs.find((t) => t.id === id);
    if (t) {
      if (!rateManuallySet) setRate(t.rate);
      setMealPlan(t.meal_plan);
    }
  }

  async function save(checkInNow: boolean) {
    if (!current) return;
    if (!name.trim()) return toast.error("Guest name required");
    if (!mobile.trim()) return toast.error("Mobile required");
    if (!categoryId) return toast.error("Pick a category");
    if (!roomId) return toast.error("Pick a room");
    if (nightsBetween(checkIn, checkOut) < 1) return toast.error("Check-out must be after check-in");

    setSaving(true);
    try {
      // 1) Guest — update existing or create new
      const tags = guestType === "regular" ? [] : [guestType];
      let guestId = selectedGuestId;
      // Duplicate-mobile guard: when creating a brand-new guest, check whether
      // the mobile already belongs to a guest on this property. If so, ask
      // the user whether to reuse the existing guest record.
      if (!guestId && mobile.trim()) {
        const { data: dup } = await supabase
          .from("guests")
          .select("id,name,mobile")
          .eq("property_id", current.id)
          .eq("mobile", mobile.trim())
          .eq("is_wiped", false)
          .limit(1)
          .maybeSingle();
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
          status: checkInNow ? "checked_in" : "reserved",
          check_in: checkIn,
          check_out: checkOut,
          adults,
          children,
          total_amount: total,
          advance_amount: advance,
          balance_amount: balance,
          notes: notes || null,
          created_by: user?.id ?? null,
          checked_in_at: checkInNow ? new Date().toISOString() : null,
          checked_in_by: checkInNow ? (user?.id ?? null) : null,
        } as any)
        .select("id, booking_number")
        .single();
      if (bErr) throw bErr;

      // 3) Booking room
      const { error: brErr } = await supabase.from("booking_rooms").insert({
        booking_id: booking!.id,
        property_id: current.id,
        room_id: roomId,
        category_id: categoryId,
        tariff_id: tariffId || null,
        meal_plan: mealPlan,
        rate,
        adults,
        children,
        check_in: checkIn,
        check_out: checkOut,
        actual_check_in: checkInNow ? new Date().toISOString() : null,
      } as any);
      if (brErr) throw brErr;

      // 4) If checked in, mark room occupied
      if (checkInNow) {
        await supabase.from("rooms").update({ status: "occupied" }).eq("id", roomId);
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
        const { data: folioId } = await supabase.rpc("get_or_create_folio", { _booking_id: booking!.id });
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
        details: { check_in: checkIn, check_out: checkOut, room_id: roomId, total },
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
      if (idFile && guestId) {
        try {
          if (!isDriveConfigured()) {
            await supabase.from("guests").update({
              id_document_name: idFile.file.name,
              notes: (guestNotes ? guestNotes + "\n" : "") + "ID document attached — Drive not configured",
            } as any).eq("id", guestId);
            toast.message("ID saved locally — Google Drive not configured");
          } else {
            const res = await uploadToDrive(idFile.file, current.name, name || "Guest", booking!.id);
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
              drive_folder_path: res.folderPath,
            } as any);
            toast.success(`✓ Saved to Drive: ${res.folderPath}`);
          }
        } catch (e: any) {
          console.warn("ID upload failed", e);
          toast.error(`ID upload failed: ${e.message ?? "unknown"}`);
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
      toast.error(e.message ?? "Failed to save");
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
            <F label="Full name *"><Input value={name} onChange={(e) => setName(e.target.value)} /></F>
            <F label="Mobile *"><Input value={mobile} onChange={(e) => setMobile(e.target.value)} /></F>
            <F label="Date of Birth (optional)">
              <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
            </F>
            <F label="Email"><Input value={email} onChange={(e) => setEmail(e.target.value)} /></F>
            <F label="ID type">
              <Select value={idType} onValueChange={setIdType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="aadhaar">Aadhaar</SelectItem>
                  <SelectItem value="passport">Passport</SelectItem>
                  <SelectItem value="driving_license">Driving License</SelectItem>
                  <SelectItem value="voter_id">Voter ID</SelectItem>
                  <SelectItem value="pan">PAN</SelectItem>
                </SelectContent>
              </Select>
            </F>
            <F label="ID number"><Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} /></F>
            <F label="Guest type">
              <Select value={guestType} onValueChange={(v) => setGuestType(v as typeof guestType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="regular">Regular</SelectItem>
                  <SelectItem value="corporate">Corporate</SelectItem>
                  <SelectItem value="vip">VIP</SelectItem>
                </SelectContent>
              </Select>
            </F>
            <F label="Nationality">
              <Input value={nationality} onChange={(e) => setNationality(e.target.value)} placeholder="Indian" />
            </F>
            <div className="col-span-2">
              <F label="Address"><Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} /></F>
            </div>
            <div className="col-span-2">
              <F label="Guest notes"><Textarea rows={2} value={guestNotes} onChange={(e) => setGuestNotes(e.target.value)} /></F>
            </div>
            </div>

            <div className="pt-2 border-t">
              <GuestIdUploadField value={idFile} onChange={setIdFile} disabled={saving} />
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
                      <Input value={g.name} onChange={(e) => updateExtra(g.key, { name: e.target.value })} />
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
                              <SelectItem value="aadhaar">Aadhaar</SelectItem>
                              <SelectItem value="passport">Passport</SelectItem>
                              <SelectItem value="driving_license">Driving License</SelectItem>
                              <SelectItem value="voter_id">Voter ID</SelectItem>
                              <SelectItem value="pan">PAN</SelectItem>
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
                disabled={!categoryId}
                placeholder={categoryId ? (availableRooms.length ? "Select vacant room" : "No vacant rooms") : "Pick category first"}
                searchPlaceholder="Type room number…"
                options={availableRooms.map((r) => ({
                  value: r.id,
                  label: r.room_number,
                  keywords: cats.find((c) => c.id === r.category_id)?.name ?? "",
                })) as SearchableOption[]}
              />
            </F>
            <F label="Tariff plan">
              <SearchableSelect
                value={tariffId}
                onChange={pickTariff}
                disabled={!categoryId}
                placeholder="Custom / none"
                searchPlaceholder="Search tariff plans…"
                options={categoryTariffs.map((t) => ({
                  value: t.id,
                  label: `${t.name} (${t.meal_plan})`,
                  hint: `₹${t.rate}`,
                })) as SearchableOption[]}
              />
            </F>
            <F label="Meal plan">
              <Select value={mealPlan} onValueChange={setMealPlan}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EP">EP — Room only</SelectItem>
                  <SelectItem value="CP">CP — Breakfast</SelectItem>
                  <SelectItem value="MAP">MAP — Breakfast + 1 meal</SelectItem>
                  <SelectItem value="AP">AP — All meals</SelectItem>
                </SelectContent>
              </Select>
            </F>
            <F label="Rate / night (₹)"><Input type="number" value={rate} onChange={(e) => { setRate(Number(e.target.value)); setRateManuallySet(true); }} /></F>
            <F label="Source">
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => (<SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>))}
                </SelectContent>
              </Select>
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
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={saving} onClick={() => save(false)}>Save as reservation</Button>
          <Button disabled={saving} onClick={() => save(true)}>Save & check-in now</Button>
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