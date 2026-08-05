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
  | "segment_pending"
  | "segment_clear";

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
const DARK_MUTED = "#4b5563";
const WHITE = "#ffffff";
const WHITE_MUTED = "rgba(255,255,255,0.85)";

/** Built-in palette — used whenever a property has no override saved. */
export const DEFAULT_ROOM_STATUS_COLORS: Record<RoomStatusKind, RoomStatusColor> = {
  // Vacant / Ready — very light blue tile, dark text for contrast.
  vacant: {
    label: "Vacant", bg: "#e0f2fe", fg: DARK, fgMuted: DARK_MUTED,
    border: "#bae6fd", btnBg: DARK, btnFg: WHITE,
  },
  occupied: {
    label: "Occupied", bg: "#16a34a", fg: WHITE, fgMuted: WHITE_MUTED,
    border: "#15803d", btnBg: WHITE, btnFg: "#166534",
  },
  // Dirty — yellow tile, dark text for contrast.
  dirty: {
    label: "Dirty", bg: "#facc15", fg: "#3f2d00", fgMuted: "#6b5200",
    border: "#eab308", btnBg: "#3f2d00", btnFg: WHITE,
  },
  maintenance: {
    label: "Maintenance", bg: "#6b7280", fg: WHITE, fgMuted: WHITE_MUTED,
    border: "#4b5563", btnBg: WHITE, btnFg: "#374151",
  },
  // Overdue — unchanged from the previous palette.
  overdue: {
    label: "OVERDUE", bg: "#b45309", fg: WHITE, fgMuted: "#fed7aa",
    border: "#92400e", btnBg: "#dc2626", btnFg: WHITE,
  },
  blocked: {
    label: "Event", bg: "#ec4899", fg: WHITE, fgMuted: WHITE_MUTED,
    border: "#db2777", btnBg: WHITE, btnFg: "#9d174d",
  },
  event_in: {
    label: "Event·In", bg: "#db2777", fg: WHITE, fgMuted: WHITE_MUTED,
    border: "#be185d", btnBg: WHITE, btnFg: "#9d174d",
  },
  // Housekeeping board composite tile.
  occupied_dirty: {
    label: "Occupied · Dirty", bg: "#facc15", fg: "#3f2d00", fgMuted: "#6b5200",
    border: "#eab308", btnBg: "#3f2d00", btnFg: WHITE,
  },
  // Food / Laundry tabs — room has an open segment bill with a balance.
  segment_pending: {
    label: "Pending", bg: "#f59e0b", fg: WHITE, fgMuted: WHITE_MUTED,
    border: "#d97706", btnBg: WHITE, btnFg: "#b45309",
  },
  // Food / Laundry tabs — nothing outstanding.
  segment_clear: {
    label: "Clear", bg: "#0ea5e9", fg: WHITE, fgMuted: WHITE_MUTED,
    border: "#0284c7", btnBg: WHITE, btnFg: "#075985",
  },
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
  | "segment_pending" | "segment_clear";

export const CUSTOMIZABLE_STATUSES: CustomizableStatus[] = [
  "vacant", "occupied", "dirty", "maintenance", "overdue", "event", "event_in",
  "segment_pending", "segment_clear",
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
  segment_clear: ["segment_clear"],
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
