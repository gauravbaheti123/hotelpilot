import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { Pencil, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/errorMessage";
import { reportQueryError } from "@/lib/queryError";

export interface OwnerEditStayRow {
  id: string;
  check_in: string;
  check_out: string;
  status?: string | null;
  rooms: { room_number: string } | null;
  room_categories: { name: string; gst_rate: number | null } | null;
}

/**
 * Owner/Superadmin inline correction panel for the invoice screen.
 *
 * Corrects the STAY RECORD only (guest name, room, category, dates) plus the
 * Bill-To header (company / GSTIN). It never touches folio_charges, GST or
 * invoice totals — charge amounts stay on their own pencil-edit flow.
 */
export function OwnerInlineEditCard({
  propertyId,
  guestId,
  guestName,
  stayRow,
  folioId,
  guestCompany,
  guestGstin,
  folioNotes,
  onSaved,
}: {
  propertyId: string;
  guestId: string | null;
  guestName: string;
  stayRow: OwnerEditStayRow | null;
  folioId: string;
  guestCompany: string | null;
  guestGstin: string | null;
  folioNotes: string | null;
  onSaved: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");

  const [name, setName] = useState(guestName);
  const [roomId, setRoomId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [checkIn, setCheckIn] = useState<string>("");
  const [checkOut, setCheckOut] = useState<string>("");
  const [actualIn, setActualIn] = useState<string>("");
  const [actualOut, setActualOut] = useState<string>("");
  const [company, setCompany] = useState(guestCompany ?? "");
  const [gstin, setGstin] = useState(guestGstin ?? "");

  const [rooms, setRooms] = useState<{ id: string; room_number: string; category_id: string | null }[]>([]);
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);
  const [origin, setOrigin] = useState<{ roomId: string; categoryId: string }>({ roomId: "", categoryId: "" });
  const [originActual, setOriginActual] = useState<{ in: string; out: string }>({ in: "", out: "" });

  const toLocalInput = (iso: string | null | undefined) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const resetFromProps = useCallback(async () => {
    setName(guestName);
    setCompany(guestCompany ?? "");
    setGstin(guestGstin ?? "");
    setCheckIn(String(stayRow?.check_in ?? "").slice(0, 10));
    setCheckOut(String(stayRow?.check_out ?? "").slice(0, 10));
    setReason("");
    if (!stayRow) return;
    const { data, error } = await supabase
      .from("booking_rooms")
      .select("room_id,category_id,actual_check_in,actual_check_out")
      .eq("id", stayRow.id)
      .maybeSingle();
    if (error) reportQueryError("booking room", error);
    const r = (data ?? {}) as {
      room_id?: string | null;
      category_id?: string | null;
      actual_check_in?: string | null;
      actual_check_out?: string | null;
    };
    setRoomId(r.room_id ?? "");
    setCategoryId(r.category_id ?? "");
    setOrigin({ roomId: r.room_id ?? "", categoryId: r.category_id ?? "" });
    setActualIn(toLocalInput(r.actual_check_in));
    setActualOut(toLocalInput(r.actual_check_out));
    setOriginActual({ in: toLocalInput(r.actual_check_in), out: toLocalInput(r.actual_check_out) });
  }, [guestName, guestCompany, guestGstin, stayRow]);

  useEffect(() => {
    if (!open) return;
    void resetFromProps();
    (async () => {
      const [{ data: rs, error: re }, { data: cs, error: ce }] = await Promise.all([
        supabase.from("rooms").select("id,room_number,category_id").eq("property_id", propertyId).order("room_number"),
        supabase.from("room_categories").select("id,name").eq("property_id", propertyId).order("name"),
      ]);
      if (re) reportQueryError("rooms", re);
      if (ce) reportQueryError("room categories", ce);
      setRooms((rs ?? []) as any);
      setCats((cs ?? []) as any);
    })();
  }, [open, propertyId, resetFromProps]);

  const dirtyName = name.trim() !== (guestName ?? "").trim();
  const dirtyStay = useMemo(
    () =>
      !!stayRow &&
      (roomId !== origin.roomId ||
        categoryId !== origin.categoryId ||
        checkIn !== String(stayRow.check_in ?? "").slice(0, 10) ||
        checkOut !== String(stayRow.check_out ?? "").slice(0, 10) ||
        actualIn !== originActual.in ||
        actualOut !== originActual.out),
    [stayRow, roomId, categoryId, checkIn, checkOut, origin, actualIn, actualOut, originActual],
  );
  const dirtyHeader =
    (company ?? "").trim() !== (guestCompany ?? "").trim() ||
    (gstin ?? "").trim().toUpperCase() !== (guestGstin ?? "").trim().toUpperCase();
  const dirty = dirtyName || dirtyStay || dirtyHeader;

  async function save() {
    if (!dirty) { toast.info("Nothing changed"); return; }
    if (reason.trim().length < 3) { toast.error("A reason (min 3 characters) is required"); return; }
    setBusy(true);
    try {
      if (dirtyName) {
        if (!guestId) throw new Error("Guest record not found for this booking");
        const { error } = await supabase.rpc("owner_update_guest_name" as any, {
          _guest_id: guestId, _name: name.trim(), _reason: reason.trim(),
        } as any);
        if (error) throw error;
      }
      if (dirtyStay && stayRow) {
        const { error } = await supabase.rpc("owner_update_booking_room_details" as any, {
          _booking_room_id: stayRow.id,
          _room_id: roomId || null,
          _category_id: categoryId || null,
          _check_in: checkIn || null,
          _check_out: checkOut || null,
          _actual_check_in: actualIn ? new Date(actualIn).toISOString() : null,
          _actual_check_out: actualOut ? new Date(actualOut).toISOString() : null,
          _reason: reason.trim(),
        } as any);
        if (error) throw error;
      }
      if (dirtyHeader) {
        const { error } = await supabase.rpc("owner_update_folio_header" as any, {
          _folio_id: folioId,
          _guest_company: company.trim() || null,
          _guest_gstin: gstin.trim().toUpperCase() || null,
          _notes: folioNotes ?? null,
          _reason: reason.trim(),
        } as any);
        if (error) throw error;
      }
      toast.success("Record corrected — charges and invoice amount unchanged");
      setOpen(false);
      await onSaved();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="h-4 w-4 mr-1" /> Edit
      </Button>
    );
  }

  return (
    <Card className="no-print print:hidden w-full border-amber-400 bg-amber-50/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 text-amber-900">
          <ShieldAlert className="h-5 w-5" /> Owner edit — record correction
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Guest Name</Label>
            <Input className="h-9" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Room</Label>
            <SearchableSelect
              className="h-9"
              value={roomId}
              onChange={(v: string) => {
                setRoomId(v);
                const r = rooms.find((x) => x.id === v);
                if (r?.category_id) setCategoryId(r.category_id);
              }}
              placeholder="Select room"
              searchPlaceholder="Search room…"
              options={rooms.map((r) => ({ value: r.id, label: r.room_number })) as SearchableOption[]}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Category</Label>
            <SearchableSelect
              className="h-9"
              value={categoryId}
              onChange={(v: string) => setCategoryId(v)}
              placeholder="Select category"
              searchPlaceholder="Search category…"
              options={cats.map((c) => ({ value: c.id, label: c.name })) as SearchableOption[]}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Check-in</Label>
              <Input type="date" className="h-9" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Check-out</Label>
              <Input type="date" className="h-9" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Bill-To company</Label>
            <Input className="h-9" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company name" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Guest GSTIN</Label>
            <Input
              className="h-9"
              value={gstin}
              maxLength={15}
              onChange={(e) => setGstin(e.target.value.toUpperCase())}
              placeholder="e.g. 27AASFB5351R1ZM"
            />
          </div>
        </div>

        <p className="rounded-md border border-amber-300 bg-amber-100/60 px-3 py-2 text-[12px] text-amber-900">
          This corrects the stay record only — it does not change already-posted charges or the
          invoice amount. Use the pencil edit on a charge line to change amounts.
        </p>

        <div className="space-y-1">
          <Label className="text-xs">Reason (required)</Label>
          <Input
            className="h-9"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Corrected guest name typo"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={save} disabled={busy || !dirty}>
            {busy ? "Saving…" : "Save Changes"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
