/**
 * Single source of truth for room-status colours.
 *
 * Every surface that paints a room by its status (dashboard room grid,
 * housekeeping board, room detail page, legends) reads from here so the
 * palette stays consistent app-wide.
 *
 * Hex values are used directly in inline styles, so they never depend on
 * Tailwind utility generation.
 */
export type RoomStatusKind =
  | "vacant"
  | "occupied"
  | "dirty"
  | "maintenance"
  | "overdue"
  | "blocked"
  | "event_in"
  | "occupied_dirty"
  // Food / Laundry segment tiles on the dashboard.
  | "segment_pending";

export interface RoomStatusColor {
  label: string;
  /** Card / tile background. */
  bg: string;
  /** Primary text + icon colour with readable contrast on `bg`. */
  fg: string;
  /** Secondary text colour (dimmed but still legible). */
  fgMuted: string;
  /** Border — mainly needed for the white Vacant tile. */
  border: string;
  /** Background for small inverted action buttons sitting on the tile. */
  btnBg: string;
  /** Text colour for those buttons. */
  btnFg: string;
}

const DARK = "#111827";
const WHITE = "#ffffff";

/**
 * Build a full tile colour set from a soft background + its paired text colour.
 * Muted text, border and button colours are derived so the tile stays coherent.
 */
function tile(label: string, bg: string, fg: string): RoomStatusColor {
  return {
    label,
    bg,
    fg,
    fgMuted: mix(fg, bg, 30),
    border: mix(bg, fg, 20),
    btnBg: fg,
    btnFg: bg,
  };
}

/**
 * Built-in palette — soft pastel tiles with dark paired text.
 * Used whenever a property has no override saved, and as the
 * "Reset to default" values in Masters → Room Status Colours.
 */
export const DEFAULT_ROOM_STATUS_COLORS: Record<RoomStatusKind, RoomStatusColor> = {
  vacant: tile("Vacant", "#F0F9FF", "#0C4A6E"),
  occupied: tile("Occupied", "#DCFCE7", "#166534"),
  dirty: tile("Dirty", "#FEF9C3", "#854D0E"),
  maintenance: tile("Maintenance", "#F1F5F9", "#334155"),
  overdue: tile("OVERDUE", "#FED7AA", "#7C2D12"),
  blocked: tile("Event", "#FCE7F3", "#9D174D"),
  event_in: tile("Event·In", "#FBCFE8", "#831843"),
  // Housekeeping board composite tile — shares the Dirty palette.
  occupied_dirty: tile("Occupied · Dirty", "#FEF9C3", "#854D0E"),
  // Food / Laundry tabs — room has an open segment bill with a balance.
  segment_pending: tile("Pending", "#FEF3C7", "#92400E"),
};

export function roomStatusColor(kind: string): RoomStatusColor {
  return ROOM_STATUS_COLORS[kind as RoomStatusKind] ?? ROOM_STATUS_COLORS.vacant;
}

/**
 * Live palette. This object is mutated in place by
 * `applyRoomStatusColorOverrides` so every module that already imported it
 * (dashboard grid, housekeeping board, room detail, rooms master) picks up
 * the property-level override without any call-site change.
 */
export const ROOM_STATUS_COLORS: Record<RoomStatusKind, RoomStatusColor> =
  Object.fromEntries(
    Object.entries(DEFAULT_ROOM_STATUS_COLORS).map(([k, v]) => [k, { ...v }]),
  ) as Record<RoomStatusKind, RoomStatusColor>;

/** Status keys that are user-customisable (persisted per property). */
export type CustomizableStatus =
  | "vacant" | "occupied" | "dirty" | "maintenance" | "overdue" | "event" | "event_in"
  | "segment_pending";

export const CUSTOMIZABLE_STATUSES: CustomizableStatus[] = [
  "vacant", "occupied", "dirty", "maintenance", "overdue", "event", "event_in",
  "segment_pending",
];

/** DB status key -> palette key(s) it drives. */
const STATUS_TO_KINDS: Record<CustomizableStatus, RoomStatusKind[]> = {
  vacant: ["vacant"],
  occupied: ["occupied"],
  dirty: ["dirty", "occupied_dirty"],
  maintenance: ["maintenance"],
  overdue: ["overdue"],
  event: ["blocked"],
  event_in: ["event_in"],
  segment_pending: ["segment_pending"],
};

function mix(color: string, other: string, pct: number) {
  return `color-mix(in srgb, ${color} ${100 - pct}%, ${other} ${pct}%)`;
}

/** Parse #rgb / #rrggbb into [r,g,b]; null for anything else. */
function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * Pick dark or light text for a given background using relative luminance,
 * so a custom colour never ends up with unreadable text.
 */
export function readableTextOn(bg: string): string {
  const rgb = parseHex(bg);
  if (!rgb) return WHITE;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.45 ? DARK : WHITE;
}

/** Derive a full tile colour set from just a background + text colour. */
export function deriveRoomStatusColor(
  base: RoomStatusColor,
  bg?: string | null,
  fg?: string | null,
): RoomStatusColor {
  if (!bg && !fg) return { ...base };
  const nextBg = bg || base.bg;
  // No explicit text colour: auto-pick one that stays readable on `nextBg`.
  const nextFg = fg || (bg ? readableTextOn(nextBg) : base.fg);
  return {
    label: base.label,
    bg: nextBg,
    fg: nextFg,
    fgMuted: mix(nextFg, nextBg, 25),
    border: mix(nextBg, nextFg, 18),
    btnBg: nextFg,
    btnFg: nextBg,
  };
}

export interface RoomStatusColorOverride {
  status: string;
  bg_color: string | null;
  fg_color: string | null;
}

/** Replace the live palette with defaults + the given property overrides. */
export function applyRoomStatusColorOverrides(rows: RoomStatusColorOverride[]) {
  for (const [k, v] of Object.entries(DEFAULT_ROOM_STATUS_COLORS)) {
    Object.assign(ROOM_STATUS_COLORS[k as RoomStatusKind], v);
  }
  for (const row of rows) {
    const kinds = STATUS_TO_KINDS[row.status as CustomizableStatus];
    if (!kinds) continue;
    for (const kind of kinds) {
      Object.assign(
        ROOM_STATUS_COLORS[kind],
        deriveRoomStatusColor(DEFAULT_ROOM_STATUS_COLORS[kind], row.bg_color, row.fg_color),
      );
    }
  }
}

/** Pending-food overlay badge — unchanged amber pill, kept here for reuse. */
export const PENDING_FOOD_BADGE = { bg: "#fbbf24", fg: "#78350f" };
