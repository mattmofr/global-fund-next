/**
 * Board geometry in world units (one edge cell ≈ 1 unit). Presentation only:
 * nothing here participates in rules. The camera looks from +Z (front) towards
 * −Z; cells run clockwise from Départ at the front-left corner.
 */
import { isMarketId, legacyStartingMarket, type Player, type ZoneId } from "@global-fund/shared";

export const CELL_COUNT = 52;
export const BOARD_SIZE = 16;
export const FRAME_W = 0.42;
/** Half size of the playable track (inside the brass frame). */
export const TRACK_HALF = BOARD_SIZE / 2 - FRAME_W;
export const CORNER = 1.86;
export const EDGE_W = (TRACK_HALF * 2 - CORNER * 2) / 12;
/** Half size of the central panel (inside the track). */
export const INNER_HALF = TRACK_HALF - CORNER;
export const SLAB_H = 0.45;
export const PLAQUE_H = 0.07;
export const PLAQUE_GAP = 0.05;
export const PLAQUE_BEVEL = 0.028;
export const PLAQUE_TOP = SLAB_H + PLAQUE_H;
export const FRAME_TOP = PLAQUE_TOP + 0.05;

export type CellSide = "corner" | "left" | "back" | "right" | "front";
export type CellShape = "portrait" | "landscape" | "square";

export interface CellRect {
  index: number;
  side: CellSide;
  shape: CellShape;
  /** World rectangle on the slab (x0 < x1, z0 < z1; z0 is the far edge). */
  x0: number; z0: number; x1: number; z1: number;
  cx: number; cz: number;
  /** Unit vector of travel at this cell (x, z). */
  along: [number, number];
  /** Unit vector pointing towards the board centre (x, z). */
  inward: [number, number];
}

const DIAG = Math.SQRT1_2;

function rect(index: number, side: CellSide, x0: number, z0: number, x1: number, z1: number, along: [number, number], inward: [number, number]): CellRect {
  const shape: CellShape = side === "corner" ? "square" : side === "left" || side === "right" ? "landscape" : "portrait";
  return { index, side, shape, x0, z0, x1, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, along, inward };
}

function buildCell(index: number): CellRect {
  const h = TRACK_HALF, ih = INNER_HALF, w = EDGE_W;
  if (index === 0) return rect(0, "corner", -h, ih, -ih, h, [0, -1], [DIAG, -DIAG]);
  if (index === 13) return rect(13, "corner", -h, -h, -ih, -ih, [1, 0], [DIAG, DIAG]);
  if (index === 26) return rect(26, "corner", ih, -h, h, -ih, [0, 1], [-DIAG, DIAG]);
  if (index === 39) return rect(39, "corner", ih, ih, h, h, [-1, 0], [-DIAG, -DIAG]);
  if (index < 13) {
    const z1 = ih - (index - 1) * w;
    return rect(index, "left", -h, z1 - w, -ih, z1, [0, -1], [1, 0]);
  }
  if (index < 26) {
    const x0 = -ih + (index - 14) * w;
    return rect(index, "back", x0, -h, x0 + w, -ih, [1, 0], [0, 1]);
  }
  if (index < 39) {
    const z0 = -ih + (index - 27) * w;
    return rect(index, "right", ih, z0, h, z0 + w, [0, 1], [-1, 0]);
  }
  const x1 = ih - (index - 40) * w;
  return rect(index, "front", x1 - w, ih, x1, h, [-1, 0], [0, -1]);
}

export const CELLS: readonly CellRect[] = Array.from({ length: CELL_COUNT }, (_, index) => buildCell(index));
export const wrapCell = (index: number) => ((Math.round(index) % CELL_COUNT) + CELL_COUNT) % CELL_COUNT;
export const cellAt = (index: number) => CELLS[wrapCell(index)]!;

/**
 * Where a lone figurine stands on its cell: on the glyph, so that the engraved
 * title (drawn nearer to the camera) stays visible in front of it.
 */
export function standOffset(cell: CellRect): { x: number; z: number } {
  switch (cell.side) {
    case "front": return { x: 0, z: -0.3 };
    case "back": return { x: 0, z: -0.3 };
    case "left": return { x: -0.5, z: 0 };
    case "right": return { x: 0.5, z: 0 };
    default: return { x: 0, z: -0.28 };
  }
}

/**
 * Small ellipse arrangement when several figurines share a cell.
 * Returns the world offset (x, z) and a scale for the figurine.
 */
export function stackSlot(cell: CellRect, count: number, slot: number): { x: number; z: number; scale: number } {
  if (count <= 1) return { ...standOffset(cell), scale: 1 };
  const corner = cell.side === "corner";
  const ra = corner ? 0.46 : 0.2;
  const rb = corner ? 0.46 : count > 4 ? 0.62 : 0.52;
  const angle = Math.PI / 2 + (slot / count) * Math.PI * 2;
  const a = Math.cos(angle) * ra;
  const b = Math.sin(angle) * rb;
  const [ax, az] = corner ? [1, 0] : cell.along;
  const [ix, iz] = corner ? [0, 1] : cell.inward;
  const scale = count === 2 ? 0.88 : count === 3 ? 0.8 : count === 4 ? 0.72 : 0.62;
  return { x: ax * a + ix * b, z: az * a + iz * b, scale };
}

// ---------------------------------------------------------------- centre --
/** Central panel composition (world x, z on the slab). */
export const CENTRE = {
  globe: { x: 0, z: -0.95 },
  globeRadius: 1.72,
  contextDeck: { x: -3.6, z: 2.55, yaw: 0.1 },
  eventDeck: { x: 3.6, z: 2.55, yaw: -0.1 },
  tray: { x: 0, z: 3.55, radius: 1.12 },
  brand: { x: 0, z: 5.12 },
} as const;

/** Card size (world units) and full stack heights. */
export const CARD = { w: 1.38, d: 1.96, contextFull: 0.5, eventFull: 0.34 } as const;
export const DIE_SIZE = 0.5;

// ------------------------------------------------------------ fund market --
/** The market a fund is shown in on the globe (jailed funds keep their last market). */
export function playerRegion(player: Player): ZoneId {
  const home = legacyStartingMarket(player);
  const region = player.jailed || player.zone === "prison"
    ? player.previousZone || home
    : player.currentMarket || player.zone || home;
  return isMarketId(region) ? region : home;
}
