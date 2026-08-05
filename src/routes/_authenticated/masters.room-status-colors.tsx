import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { RequirePermission } from "@/components/RequirePermission";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { usePropertyId } from "@/hooks/use-property";
import {
  ROOM_STATUS_COLORS_QK,
  useInvalidateRoomStatusColors,
} from "@/hooks/use-room-status-colors";
import {
  CUSTOMIZABLE_STATUSES,
  DEFAULT_ROOM_STATUS_COLORS,
  deriveRoomStatusColor,
  type CustomizableStatus,
  type RoomStatusColor,
  type RoomStatusKind,
} from "@/lib/roomStatusColors";
import { BedDouble, RotateCcw, Save } from "lucide-react";

export const Route = createFileRoute("/_authenticated/masters/room-status-colors")({
  head: () => ({
    meta: [
      { title: "Room Status Colours — HotelPilot" },
      { name: "description", content: "Customize the colours used for each room status across the dashboard, housekeeping board and room screens." },
      { property: "og:title", content: "Room Status Colours — HotelPilot" },
      { property: "og:description", content: "Customize room status tile colours for your property." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <RequirePermission module="master_data">
      <RoomStatusColorsPage />
    </RequirePermission>
  ),
});

const STATUS_KIND: Record<CustomizableStatus, RoomStatusKind> = {
  vacant: "vacant",
  occupied: "occupied",
  dirty: "dirty",
  maintenance: "maintenance",
  overdue: "overdue",
  event: "blocked",
  event_in: "event_in",
  segment_pending: "segment_pending",
  segment_clear: "segment_clear",
};

const STATUS_LABEL: Record<CustomizableStatus, string> = {
  vacant: "Vacant / Ready",
  occupied: "Occupied",
  dirty: "Dirty",
  maintenance: "Maintenance",
  overdue: "Overdue",
  event: "Event (Blocked)",
  event_in: "Event · In",
  segment_pending: "Food/Laundry · Pending",
  segment_clear: "Food/Laundry · Clear",
};

type Draft = Record<CustomizableStatus, { bg: string; fg: string }>;

function defaultsDraft(): Draft {
  return Object.fromEntries(
    CUSTOMIZABLE_STATUSES.map((s) => {
      const d = DEFAULT_ROOM_STATUS_COLORS[STATUS_KIND[s]];
      return [s, { bg: d.bg, fg: d.fg }];
    }),
  ) as Draft;
}

function RoomStatusColorsPage() {
  const propertyId = usePropertyId();
  const invalidate = useInvalidateRoomStatusColors();
  const [draft, setDraft] = useState<Draft>(defaultsDraft);
  const [saving, setSaving] = useState(false);

  const { data: rows, isLoading } = useQuery({
    queryKey: [ROOM_STATUS_COLORS_QK, "editor", propertyId],
    enabled: !!propertyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("room_status_color_settings")
        .select("status,bg_color,fg_color")
        .eq("property_id", propertyId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!rows) return;
    const next = defaultsDraft();
    for (const r of rows as Array<{ status: string; bg_color: string | null; fg_color: string | null }>) {
      const s = r.status as CustomizableStatus;
      if (!next[s]) continue;
      if (r.bg_color) next[s].bg = r.bg_color;
      if (r.fg_color) next[s].fg = r.fg_color;
    }
    setDraft(next);
  }, [rows]);

  const previews = useMemo(() => {
    const out = {} as Record<CustomizableStatus, RoomStatusColor>;
    for (const s of CUSTOMIZABLE_STATUSES) {
      out[s] = deriveRoomStatusColor(
        DEFAULT_ROOM_STATUS_COLORS[STATUS_KIND[s]],
        draft[s].bg,
        draft[s].fg,
      );
    }
    return out;
  }, [draft]);

  function setColor(s: CustomizableStatus, key: "bg" | "fg", value: string) {
    setDraft((d) => ({ ...d, [s]: { ...d[s], [key]: value } }));
  }

  function resetRow(s: CustomizableStatus) {
    const d = DEFAULT_ROOM_STATUS_COLORS[STATUS_KIND[s]];
    setDraft((prev) => ({ ...prev, [s]: { bg: d.bg, fg: d.fg } }));
  }

  async function save() {
    if (!propertyId) return;
    setSaving(true);
    try {
      const payload = CUSTOMIZABLE_STATUSES.map((s) => ({
        property_id: propertyId,
        status: s,
        bg_color: draft[s].bg,
        fg_color: draft[s].fg,
      }));
      const { error } = await supabase
        .from("room_status_color_settings")
        .upsert(payload, { onConflict: "property_id,status" });
      if (error) throw error;
      await invalidate();
      toast.success("Room status colours saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save colours");
    } finally {
      setSaving(false);
    }
  }

  async function resetAll() {
    if (!propertyId) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("room_status_color_settings")
        .delete()
        .eq("property_id", propertyId);
      if (error) throw error;
      setDraft(defaultsDraft());
      await invalidate();
      toast.success("Restored default colours");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not reset colours");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title="Room Status Colours">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground max-w-2xl">
            These colours are used for room tiles on the Dashboard, the Housekeeping
            board, room detail pages and the rooms master list for this property.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={resetAll} disabled={saving || isLoading}>
              <RotateCcw className="h-4 w-4" /> Restore all defaults
            </Button>
            <Button onClick={save} disabled={saving || isLoading}>
              <Save className="h-4 w-4" /> Save
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {CUSTOMIZABLE_STATUSES.map((s) => {
            const c = previews[s];
            return (
              <Card key={s}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">{STATUS_LABEL[s]}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Live preview tile */}
                  <div
                    className="rounded-lg p-3 border"
                    style={{ backgroundColor: c.bg, color: c.fg, borderColor: c.border }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-semibold">
                        <BedDouble className="h-4 w-4" /> 101
                      </div>
                      <span
                        className="text-[10px] px-2 py-0.5 rounded"
                        style={{ backgroundColor: c.btnBg, color: c.btnFg }}
                      >
                        {c.label}
                      </span>
                    </div>
                    <div className="text-xs mt-1" style={{ color: c.fgMuted }}>
                      Deluxe · Sample tile
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <ColorField
                      label="Background"
                      value={draft[s].bg}
                      onChange={(v) => setColor(s, "bg", v)}
                    />
                    <ColorField
                      label="Text"
                      value={draft[s].fg}
                      onChange={(v) => setColor(s, "fg", v)}
                    />
                  </div>

                  <Button variant="ghost" size="sm" onClick={() => resetRow(s)}>
                    <RotateCcw className="h-3.5 w-3.5" /> Reset to default
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}

function ColorField({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : "#ffffff";
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} colour`}
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 cursor-pointer rounded border bg-transparent p-0.5"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 font-mono text-xs"
        />
      </div>
    </div>
  );
}
