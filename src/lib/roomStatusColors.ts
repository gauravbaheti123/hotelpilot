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
  | "occupied_dirty";

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

export const ROOM_STATUS_COLORS: Record<RoomStatusKind, RoomStatusColor> = {
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
};

export function roomStatusColor(kind: string): RoomStatusColor {
  return ROOM_STATUS_COLORS[kind as RoomStatusKind] ?? ROOM_STATUS_COLORS.vacant;
}

/** Pending-food overlay badge — unchanged amber pill, kept here for reuse. */
export const PENDING_FOOD_BADGE = { bg: "#fbbf24", fg: "#78350f" };
