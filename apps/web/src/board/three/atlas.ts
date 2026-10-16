/**
 * One canvas atlas for every engraved surface of the board: the 52 enamel
 * plaques, both card backs, gilt card edges, die result medallions and the
 * engraved decals. A second, half-resolution canvas carries the material mask
 * in the same layout: R = height (engraving), G = roughness, B = metalness.
 * No bitmap asset is used: everything is typography and vector drawing.
 */
import type { BoardCell } from "@global-fund/shared";
import { SECTOR_META, type SectorId } from "../../ui/theme";
import type { FxTheme } from "./runtime";
import { CARD, CELLS, CELL_COUNT, PLAQUE_BEVEL, PLAQUE_GAP, type CellRect } from "./layout";
import { ICON_PATHS, ZAP_PATH } from "./icons";

// ------------------------------------------------------------- cell art --
export type CellArt =
  | { kind: "start" }
  | { kind: "event" }
  | { kind: "bull" }
  | { kind: "bear" }
  | { kind: "crash" }
  | { kind: "sector"; sector: SectorId | null; label: string };

export function cellArt(cell: BoardCell | undefined): CellArt {
  if (!cell) return { kind: "sector", sector: null, label: "" };
  if (cell.kind === "start") return { kind: "start" };
  if (cell.kind === "event") return { kind: "event" };
  const label = cell.label ?? "";
  if (cell.kind === "market" || /bull|bear|crash/i.test(label)) {
    if (/crash/i.test(label)) return { kind: "crash" };
    if (/bear/i.test(label)) return { kind: "bear" };
    if (/bull/i.test(label)) return { kind: "bull" };
  }
  const sector = cell.sector && cell.sector in SECTOR_META ? (cell.sector as SectorId) : null;
  return { kind: "sector", sector, label };
}

/** Accent colour of a cell (ripple, glow, inlay band). */
export function cellAccent(art: CellArt): string {
  switch (art.kind) {
    case "start": return "#e8c67e";
    case "event": return "#ead2a0";
    case "bull": return "#36d898";
    case "bear": return "#ff4458";
    case "crash": return "#ff4458";
    default: return art.sector ? SECTOR_META[art.sector].color : "#d2ad66";
  }
}

/** Arrival effect family of a cell (sector theme or special kind). */
export function cellTheme(art: CellArt): FxTheme {
  if (art.kind !== "sector") return art.kind;
  return art.sector ?? "neutral";
}

// ------------------------------------------------------------------ fonts --
let fontPromise: Promise<void> | null = null;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Cinzel must be ready before engraving; a missing font falls back to a serif. */
export function ensureBoardFonts(): Promise<void> {
  if (!fontPromise) {
    fontPromise = (async () => {
      try {
        if (typeof FontFace === "undefined" || !document.fonts) return;
        const face = new FontFace("Cinzel", "url('/assets/fonts/Cinzel[wght].ttf')", { weight: "400 900", style: "normal" });
        document.fonts.add(face);
        await Promise.race([face.load().then(() => undefined), wait(3500)]);
        await Promise.race([document.fonts.ready.then(() => undefined), wait(1500)]);
      } catch {
        /* The atlas still draws with the serif fallback. */
      }
    })();
  }
  return fontPromise;
}

// ----------------------------------------------------------------- layout --
export interface AtlasRect { x: number; y: number; w: number; h: number }
export interface BoardAtlas {
  color: HTMLCanvasElement;
  mask: HTMLCanvasElement | null;
  width: number;
  height: number;
  cells: AtlasRect[];
  contextBack: AtlasRect;
  eventBack: AtlasRect;
  edges: AtlasRect;
  badges: AtlasRect[];
  brand: AtlasRect;
  contextLabel: AtlasRect;
  eventLabel: AtlasRect;
  glint: AtlasRect;
  side: AtlasRect;
}

/** Normalised UV rectangle of an atlas region (three.js flipY convention). */
export function atlasUV(atlas: Pick<BoardAtlas, "width" | "height">, r: AtlasRect) {
  return { u0: r.x / atlas.width, u1: (r.x + r.w) / atlas.width, vTop: 1 - r.y / atlas.height, vBottom: 1 - (r.y + r.h) / atlas.height };
}

interface Item { key: string; w: number; h: number; rect?: AtlasRect }

function pack(items: Item[], width: number, pad: number) {
  const sorted = [...items].sort((a, b) => b.h - a.h);
  let x = 0, y = 0, shelf = 0;
  for (const item of sorted) {
    const w = item.w + pad * 2, h = item.h + pad * 2;
    if (x + w > width) { x = 0; y += shelf; shelf = 0; }
    item.rect = { x: x + pad, y: y + pad, w: item.w, h: item.h };
    x += w;
    shelf = Math.max(shelf, h);
  }
  return Math.ceil((y + shelf) / 4) * 4;
}

const tileSize = (cell: CellRect, s: number) => ({
  w: Math.round((cell.x1 - cell.x0 - PLAQUE_GAP) * s),
  h: Math.round((cell.z1 - cell.z0 - PLAQUE_GAP) * s),
});

// ------------------------------------------------------------ the painter --
type Role = "enamel" | "gloss" | "gold" | "goldFlat" | "brass" | "engrave" | "guilloche" | "paper" | "ink" | "side";
/** Mask encoding: R height, G roughness factor, B metalness. */
const MASK: Record<Role, string> = {
  enamel: "rgb(255,255,0)",
  gloss: "rgb(255,175,0)",
  gold: "rgb(150,100,255)",
  goldFlat: "rgb(255,110,255)",
  brass: "rgb(255,150,255)",
  engrave: "rgb(130,255,40)",
  guilloche: "rgb(238,205,0)",
  paper: "rgb(255,255,0)",
  ink: "rgb(200,215,0)",
  side: "rgb(255,200,60)",
};

interface Pen {
  ctx: CanvasRenderingContext2D;
  mask: boolean;
  s: number;
}

const GOLD_STOPS: [number, string][] = [[0, "#fbf0d2"], [0.38, "#e8c88a"], [0.72, "#c9a05a"], [1, "#94703a"]];

function gradient(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [at, color] of stops) g.addColorStop(at, color);
  return g;
}
const goldGradient = (ctx: CanvasRenderingContext2D, y0: number, y1: number) => gradient(ctx, 0, y0, 0, y1, GOLD_STOPS);

function fill(p: Pen, role: Role, style: string | CanvasGradient | CanvasPattern) {
  p.ctx.fillStyle = p.mask ? MASK[role] : style;
}
function stroke(p: Pen, role: Role, style: string | CanvasGradient) {
  p.ctx.strokeStyle = p.mask ? MASK[role] : style;
}

function font(size: number, weight = 600) {
  return `${weight} ${Math.max(4, size).toFixed(2)}px Cinzel, "Cormorant Garamond", Georgia, serif`;
}

/** Width of a letter-spaced string. */
function spacedWidth(ctx: CanvasRenderingContext2D, text: string, spacing: number) {
  let width = 0;
  for (const ch of text) width += ctx.measureText(ch).width + spacing;
  return Math.max(0, width - spacing);
}

function drawSpaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number) {
  let cursor = x;
  for (const ch of text) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + spacing;
  }
}

interface TextOptions { size: number; weight?: number; tracking?: number; maxWidth?: number; align?: "center" | "left" | "right"; role?: "gold" | "engrave" | "ink" | "ivory" }

/** Engraved gold-leaf lettering (centred on x, baseline-middle on y). Returns the size used. */
function engraveText(p: Pen, text: string, x: number, y: number, o: TextOptions) {
  const { ctx } = p;
  let size = o.size;
  const tracking = o.tracking ?? 0.08;
  ctx.font = font(size, o.weight);
  let width = spacedWidth(ctx, text, size * tracking);
  if (o.maxWidth && width > o.maxWidth) {
    size *= o.maxWidth / width;
    ctx.font = font(size, o.weight);
    width = spacedWidth(ctx, text, size * tracking);
  }
  const left = o.align === "left" ? x : o.align === "right" ? x - width : x - width / 2;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const spacing = size * tracking;
  const role = o.role ?? "gold";
  if (p.mask) {
    ctx.fillStyle = MASK[role === "gold" ? "gold" : role === "ink" ? "ink" : role === "ivory" ? "goldFlat" : "engrave"];
    drawSpaced(ctx, text, left, y, spacing);
    return size;
  }
  const lift = Math.max(0.6, size * 0.045);
  if (role === "gold") {
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    drawSpaced(ctx, text, left, y - lift, spacing);
    ctx.fillStyle = "rgba(255,232,180,0.22)";
    drawSpaced(ctx, text, left, y + lift * 0.8, spacing);
    ctx.fillStyle = goldGradient(ctx, y - size * 0.45, y + size * 0.45);
    drawSpaced(ctx, text, left, y, spacing);
  } else if (role === "engrave") {
    ctx.fillStyle = "rgba(255,240,200,0.55)";
    drawSpaced(ctx, text, left, y + lift, spacing);
    ctx.fillStyle = "#2a1c0b";
    drawSpaced(ctx, text, left, y, spacing);
  } else if (role === "ivory") {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    drawSpaced(ctx, text, left, y - lift, spacing);
    ctx.fillStyle = "#efe4cc";
    drawSpaced(ctx, text, left, y, spacing);
  } else {
    ctx.fillStyle = "#1e1b17";
    drawSpaced(ctx, text, left, y, spacing);
  }
  return size;
}

const pathCache = new Map<string, Path2D>();
const path2d = (d: string) => {
  let p = pathCache.get(d);
  if (!p) { p = new Path2D(d); pathCache.set(d, p); }
  return p;
};

/** Engraved stroked glyph (24×24 box) centred on (cx, cy). */
function engraveIcon(p: Pen, paths: string[], cx: number, cy: number, size: number, width = 1.55, role: "gold" | "ink" | "engrave" = "gold") {
  const { ctx } = p;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = width;
  const shapes = paths.map(path2d);
  if (p.mask) {
    ctx.strokeStyle = MASK[role === "gold" ? "gold" : role === "ink" ? "ink" : "engrave"];
    for (const s of shapes) ctx.stroke(s);
  } else if (role === "gold") {
    ctx.translate(0, -0.32);
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    for (const s of shapes) ctx.stroke(s);
    ctx.translate(0, 0.6);
    ctx.strokeStyle = "rgba(255,232,180,0.2)";
    for (const s of shapes) ctx.stroke(s);
    ctx.translate(0, -0.28);
    ctx.strokeStyle = goldGradient(ctx, 1, 23);
    for (const s of shapes) ctx.stroke(s);
  } else {
    ctx.strokeStyle = role === "ink" ? "#1e1b17" : "#2a1c0b";
    for (const s of shapes) ctx.stroke(s);
  }
  ctx.restore();
}

/** Watch-dial "soleil" guilloché: fine rays from a centre, clipped by the caller. */
function sunburst(p: Pen, cx: number, cy: number, r0: number, r1: number, rays: number, alpha: number, tint = "240,214,160", role: Role = "guilloche") {
  const { ctx } = p;
  ctx.save();
  ctx.lineWidth = Math.max(0.5, p.s / 300);
  stroke(p, role, `rgba(${tint},${alpha})`);
  ctx.beginPath();
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
  }
  ctx.stroke();
  ctx.restore();
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------- plaques --
type Inner = "top" | "bottom" | "left" | "right" | null;
const innerEdge = (cell: CellRect): Inner => cell.side === "front" ? "top" : cell.side === "back" ? "bottom" : cell.side === "left" ? "right" : cell.side === "right" ? "left" : null;

interface Palette { base: [string, string]; rays: string; raysAlpha: number; band: string | null; rim: [string, string] }

function palette(art: CellArt): Palette {
  const rim: [string, string] = ["#e3c486", "#7d5f2d"];
  switch (art.kind) {
    case "start": return { base: ["#dcbb7a", "#9c7a3e"], rays: "255,246,220", raysAlpha: 0.08, band: null, rim: ["#f4dfa8", "#8b6a33"] };
    case "event": return { base: ["#3a2f1f", "#140f0a"], rays: "255,226,170", raysAlpha: 0.05, band: "gold", rim };
    case "bull": return { base: ["#127052", "#063322"], rays: "160,255,210", raysAlpha: 0.06, band: "#2fd598", rim };
    case "bear": return { base: ["#7e1222", "#33050e"], rays: "255,150,160", raysAlpha: 0.06, band: "#ff3b52", rim };
    case "crash": return { base: ["#7e1222", "#33050e"], rays: "255,150,160", raysAlpha: 0.06, band: "#ff3b52", rim };
    default: return { base: ["#1b1916", "#0b0a09"], rays: "240,214,160", raysAlpha: 0.035, band: art.sector ? SECTOR_META[art.sector].color : "#d2ad66", rim };
  }
}

function shade(hex: string, amount: number) {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (c: number) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function drawPlaque(p: Pen, cell: CellRect, art: CellArt, r: AtlasRect, pad: number) {
  const { ctx, s } = p;
  const pal = palette(art);
  const W = r.w, H = r.h;
  const rim = PLAQUE_BEVEL * s;
  const inner = innerEdge(cell);
  ctx.save();
  ctx.translate(r.x, r.y);

  // Base enamel (extends into the padding so mipmaps never bleed).
  fill(p, art.kind === "start" ? "brass" : "enamel", gradient(ctx, 0, 0, W, H, [[0, pal.base[0]], [1, pal.base[1]]]));
  ctx.fillRect(-pad, -pad, W + pad * 2, H + pad * 2);
  if (!p.mask && art.kind === "start") {
    // Satin brushing on the brass plate.
    ctx.save();
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < H; i += Math.max(1, s / 128)) {
      ctx.fillStyle = (i * 7919) % 3 === 0 ? "#fff3d0" : "#5a4320";
      ctx.fillRect(0, i, W, Math.max(0.5, s / 512));
    }
    ctx.restore();
  }

  // Guilloché rays, clipped to the top face.
  const focus = iconCentre(cell, art, W, H, s);
  ctx.save();
  ctx.beginPath();
  ctx.rect(rim, rim, W - rim * 2, H - rim * 2);
  ctx.clip();
  sunburst(p, focus.x, focus.y, s * 0.05, Math.hypot(W, H), art.kind === "sector" ? 120 : 150, pal.raysAlpha, pal.rays, art.kind === "start" ? "brass" : "guilloche");
  ctx.restore();

  // Bevel rim (shows on the plaque's slopes) and a hairline on the top face.
  ctx.save();
  ctx.lineWidth = rim * 2;
  stroke(p, "gold", gradient(ctx, 0, 0, W, H, [[0, pal.rim[0]], [0.55, shade(pal.rim[0], -0.25)], [1, pal.rim[1]]]));
  ctx.strokeRect(0, 0, W, H);
  ctx.lineWidth = Math.max(0.8, s / 220);
  stroke(p, "gold", art.kind === "start" ? "rgba(60,40,12,0.55)" : "rgba(226,196,134,0.42)");
  const hl = rim + s * 0.035;
  ctx.strokeRect(hl, hl, W - hl * 2, H - hl * 2);
  ctx.restore();

  // Sector inlay band on the inner edge.
  if (pal.band && inner) {
    const bt = s * 0.15;
    const band = inner === "top" ? { x: rim, y: rim, w: W - rim * 2, h: bt }
      : inner === "bottom" ? { x: rim, y: H - rim - bt, w: W - rim * 2, h: bt }
      : inner === "left" ? { x: rim, y: rim, w: bt, h: H - rim * 2 }
      : { x: W - rim - bt, y: rim, w: bt, h: H - rim * 2 };
    if (pal.band === "gold") fill(p, "gold", goldGradient(ctx, band.y, band.y + band.h));
    else {
      const vertical = inner === "left" || inner === "right";
      fill(p, "gloss", vertical
        ? gradient(ctx, band.x, 0, band.x + band.w, 0, [[0, shade(pal.band, -0.18)], [0.5, pal.band], [1, shade(pal.band, -0.3)]])
        : gradient(ctx, 0, band.y, 0, band.y + band.h, [[0, shade(pal.band, 0.12)], [0.5, pal.band], [1, shade(pal.band, -0.32)]]));
    }
    ctx.fillRect(band.x, band.y, band.w, band.h);
    // Gold fillet separating the band from the enamel.
    ctx.lineWidth = Math.max(1, s / 110);
    stroke(p, "gold", "#e3c486");
    ctx.beginPath();
    if (inner === "top") { ctx.moveTo(rim, band.y + band.h); ctx.lineTo(W - rim, band.y + band.h); }
    if (inner === "bottom") { ctx.moveTo(rim, band.y); ctx.lineTo(W - rim, band.y); }
    if (inner === "left") { ctx.moveTo(band.x + band.w, rim); ctx.lineTo(band.x + band.w, H - rim); }
    if (inner === "right") { ctx.moveTo(band.x, rim); ctx.lineTo(band.x, H - rim); }
    ctx.stroke();
  }

  drawPlaqueContent(p, cell, art, W, H, inner);
  ctx.restore();
}

/**
 * Glyph position. Figurines stand on the glyph (see layout.standOffset), so the
 * title is always drawn between the glyph and the camera and stays readable.
 */
function iconCentre(cell: CellRect, art: CellArt, W: number, H: number, s: number) {
  if (cell.shape === "square") return { x: W / 2, y: art.kind === "start" ? H * 0.36 : H * 0.38 };
  const inner = innerEdge(cell);
  if (cell.shape === "portrait") return { x: W / 2, y: inner === "top" ? H * 0.42 : H * 0.36 };
  return { x: inner === "right" ? s * 0.36 + PLAQUE_BEVEL * s : W - s * 0.36 - PLAQUE_BEVEL * s, y: H / 2 };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function shortLabel(art: CellArt): { title: string; sub?: string } {
  switch (art.kind) {
    case "start": return { title: "DÉPART" };
    case "event": return { title: "ÉVÉNEMENT" };
    case "bull": return { title: "BULL", sub: "MARKET" };
    case "bear": return { title: "BEAR", sub: "MARKET" };
    case "crash": return { title: "CRASH", sub: "MARKET" };
    default: return { title: art.sector ? SECTOR_META[art.sector].short : (art.label.split(/\s*&\s*/)[0] ?? "").toLocaleUpperCase("fr-FR") };
  }
}

function drawSeal(p: Pen, cx: number, cy: number, radius: number) {
  const { ctx } = p;
  const teeth = 36;
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i <= teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2;
    const rr = i % 2 ? radius * 0.9 : radius;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  if (!p.mask) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.save(); ctx.translate(0, -radius * 0.03); ctx.fill(); ctx.restore();
  }
  fill(p, "gold", goldGradient(ctx, cy - radius, cy + radius));
  ctx.fill();
  // Enamel well, inner ring and an eight-point star.
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.76, 0, Math.PI * 2);
  fill(p, "enamel", gradient(ctx, cx - radius, cy - radius, cx + radius, cy + radius, [[0, "#26211a"], [1, "#080706"]]));
  ctx.fill();
  ctx.lineWidth = Math.max(1, radius * 0.05);
  stroke(p, "gold", goldGradient(ctx, cy - radius, cy + radius));
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.66, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i <= 16; i++) {
    const a = -Math.PI / 2 + (i / 16) * Math.PI * 2;
    const rr = i % 2 ? radius * 0.2 : radius * 0.5;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  fill(p, "gold", goldGradient(ctx, cy - radius * 0.5, cy + radius * 0.5));
  ctx.fill();
  ctx.restore();
}

function drawChevron(p: Pen, cx: number, cy: number, size: number, up: boolean) {
  const { ctx } = p;
  const dir = up ? -1 : 1;
  ctx.save();
  const tri = (scale: number) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy + dir * size * 0.55 * scale);
    ctx.lineTo(cx + size * 0.62 * scale, cy - dir * size * 0.42 * scale);
    ctx.lineTo(cx - size * 0.62 * scale, cy - dir * size * 0.42 * scale);
    ctx.closePath();
  };
  if (!p.mask) { ctx.save(); ctx.translate(0, -size * 0.03); tri(1); ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fill(); ctx.restore(); }
  tri(1);
  fill(p, "gold", goldGradient(ctx, cy - size * 0.55, cy + size * 0.55));
  ctx.fill();
  tri(0.56);
  ctx.lineWidth = Math.max(1, size * 0.035);
  stroke(p, "engrave", "rgba(40,24,6,0.75)");
  ctx.stroke();
  ctx.restore();
}

function drawArrow(p: Pen, cx: number, top: number, bottom: number, width: number) {
  const { ctx } = p;
  const head = width * 0.95;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx + head / 2, top + head * 0.7);
  ctx.lineTo(cx + width * 0.12, top + head * 0.58);
  ctx.lineTo(cx + width * 0.12, bottom - width * 0.22);
  ctx.lineTo(cx + width * 0.3, bottom);
  ctx.lineTo(cx, bottom - width * 0.14);
  ctx.lineTo(cx - width * 0.3, bottom);
  ctx.lineTo(cx - width * 0.12, bottom - width * 0.22);
  ctx.lineTo(cx - width * 0.12, top + head * 0.58);
  ctx.lineTo(cx - head / 2, top + head * 0.7);
  ctx.closePath();
  if (!p.mask) {
    ctx.save(); ctx.translate(0, width * 0.025); ctx.fillStyle = "rgba(255,244,210,0.6)"; ctx.fill(); ctx.restore();
  }
  fill(p, "engrave", "#2b1d0b");
  ctx.fill();
  ctx.restore();
}

function drawPlaqueContent(p: Pen, cell: CellRect, art: CellArt, W: number, H: number, inner: Inner) {
  const { ctx, s } = p;
  const rim = PLAQUE_BEVEL * s;
  const number = pad2(cell.index + 1);
  const label = shortLabel(art);
  const centre = iconCentre(cell, art, W, H, s);

  if (cell.shape === "square") {
    if (art.kind === "start") {
      drawArrow(p, W / 2, H * 0.12, H * 0.6, s * 0.4);
      engraveText(p, "DÉPART", W / 2, H * 0.76, { size: s * 0.25, weight: 700, tracking: 0.1, maxWidth: W * 0.76, role: "engrave" });
      engraveText(p, number, W / 2, H * 0.89, { size: s * 0.1, weight: 600, tracking: 0.1, role: "engrave" });
      ctx.lineWidth = Math.max(1, s / 120);
      stroke(p, "engrave", "rgba(43,29,11,0.7)");
      const inset = rim + s * 0.1;
      ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
      return;
    }
    if (art.kind === "event") drawSeal(p, centre.x, centre.y, s * 0.4);
    else if (art.kind === "bull") drawChevron(p, centre.x, centre.y, s * 0.58, true);
    else if (art.kind === "bear") drawChevron(p, centre.x, centre.y, s * 0.58, false);
    else if (art.kind === "crash") drawZap(p, centre.x, centre.y, s * 0.66);
    else if (art.kind === "sector" && art.sector) engraveIcon(p, ICON_PATHS[SECTOR_META[art.sector].icon], centre.x, centre.y, s * 0.6);
    engraveText(p, label.title, W / 2, H * (label.sub ? 0.72 : 0.76), { size: s * 0.2, weight: 700, tracking: 0.1, maxWidth: W * 0.8 });
    if (label.sub) engraveText(p, label.sub, W / 2, H * 0.82, { size: s * 0.085, weight: 600, tracking: 0.28, maxWidth: W * 0.6 });
    engraveText(p, number, W / 2, H - rim - s * 0.13, { size: s * 0.1, weight: 600, tracking: 0.1 });
    return;
  }

  const iconSize = s * 0.42;
  if (cell.shape === "portrait") {
    // Glyph up, title and week below it (nearer the camera on both rows).
    const front = inner === "top";
    const labelY = front ? H * 0.66 : H * 0.62;
    const numberY = front ? H - rim - s * 0.13 : rim + s * 0.14;
    drawGlyph(p, art, centre.x, centre.y, iconSize);
    engraveText(p, label.title, W / 2, labelY, { size: s * (label.sub ? 0.15 : 0.135), weight: 700, tracking: 0.07, maxWidth: W - rim * 2 - s * 0.1 });
    if (label.sub) engraveText(p, label.sub, W / 2, labelY + s * 0.12, { size: s * 0.065, weight: 600, tracking: 0.26, maxWidth: W * 0.7 });
    engraveText(p, number, W / 2, numberY, { size: s * 0.1, weight: 600, tracking: 0.1 });
    return;
  }

  // Landscape (left / right columns): glyph on the outer side, title and week beside it.
  const bt = s * 0.15;
  const left = inner === "right" ? rim + s * 0.7 : rim + bt + s * 0.12;
  const right = inner === "right" ? W - rim - bt - s * 0.1 : W - rim - s * 0.7;
  const mid = (left + right) / 2;
  drawGlyph(p, art, centre.x, centre.y, iconSize);
  engraveText(p, label.title, mid, H * (label.sub ? 0.36 : 0.42), { size: s * (label.sub ? 0.15 : 0.135), weight: 700, tracking: 0.07, maxWidth: right - left });
  if (label.sub) engraveText(p, label.sub, mid, H * 0.56, { size: s * 0.065, weight: 600, tracking: 0.26, maxWidth: (right - left) * 0.8 });
  engraveText(p, number, mid, H * (label.sub ? 0.77 : 0.73), { size: s * 0.1, weight: 600, tracking: 0.1 });
}

function drawZap(p: Pen, cx: number, cy: number, size: number) {
  const { ctx } = p;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 24, size / 24);
  const bolt = path2d(ZAP_PATH);
  if (!p.mask) { ctx.save(); ctx.translate(0, -0.4); ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fill(bolt); ctx.restore(); }
  fill(p, "gold", goldGradient(ctx, 2, 22));
  ctx.fill(bolt);
  ctx.restore();
}

function drawGlyph(p: Pen, art: CellArt, cx: number, cy: number, size: number) {
  if (art.kind === "event") drawSeal(p, cx, cy, size * 0.5);
  else if (art.kind === "bull") drawChevron(p, cx, cy, size * 0.8, true);
  else if (art.kind === "bear") drawChevron(p, cx, cy, size * 0.8, false);
  else if (art.kind === "crash") drawZap(p, cx, cy, size * 1.05);
  else if (art.kind === "sector" && art.sector) engraveIcon(p, ICON_PATHS[SECTOR_META[art.sector].icon], cx, cy, size);
}

// ------------------------------------------------------------ card backs --
function drawCardBack(p: Pen, r: AtlasRect, kind: "context" | "event", pad: number) {
  const { ctx, s } = p;
  const W = r.w, H = r.h;
  const lacquer = kind === "context";
  ctx.save();
  ctx.translate(r.x, r.y);
  fill(p, lacquer ? "enamel" : "paper", lacquer
    ? gradient(ctx, 0, 0, W, H, [[0, "#1f1c18"], [1, "#080706"]])
    : gradient(ctx, 0, 0, W, H, [[0, "#f6efdf"], [1, "#ddd0b4"]]));
  ctx.fillRect(-pad, -pad, W + pad * 2, H + pad * 2);
  const cx = W / 2, cy = H * 0.47;
  ctx.save();
  roundRectPath(ctx, W * 0.07, H * 0.05, W * 0.86, H * 0.9, s * 0.05);
  ctx.clip();
  sunburst(p, cx, cy, s * 0.03, Math.hypot(W, H), 160, lacquer ? 0.07 : 0.09, lacquer ? "226,196,134" : "60,50,40");
  ctx.restore();
  const ink = lacquer ? "gold" : "ink";
  const lineStyle = lacquer ? goldGradient(ctx, 0, H) : "#24211c";
  ctx.lineWidth = Math.max(1, s / 90);
  stroke(p, lacquer ? "gold" : "ink", lineStyle);
  roundRectPath(ctx, W * 0.05, H * 0.035, W * 0.9, H * 0.93, s * 0.06);
  ctx.stroke();
  ctx.lineWidth = Math.max(0.8, s / 200);
  roundRectPath(ctx, W * 0.085, H * 0.06, W * 0.83, H * 0.88, s * 0.04);
  ctx.stroke();
  // Corner diamonds.
  for (const [x, y] of [[W * 0.085, H * 0.06], [W * 0.915, H * 0.06], [W * 0.085, H * 0.94], [W * 0.915, H * 0.94]] as const) {
    ctx.beginPath();
    const d = s * 0.035;
    ctx.moveTo(x, y - d); ctx.lineTo(x + d, y); ctx.lineTo(x, y + d); ctx.lineTo(x - d, y); ctx.closePath();
    fill(p, lacquer ? "gold" : "ink", lineStyle);
    ctx.fill();
  }
  // Emblem.
  const R = W * 0.26;
  ctx.lineWidth = Math.max(1, s / 110);
  stroke(p, lacquer ? "gold" : "ink", lineStyle);
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(cx, cy, R * 0.45, R, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(cx, cy, R, R * 0.36, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(cx, cy, R * 1.18, R * 0.3, -0.42, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.09, 0, Math.PI * 2); fill(p, lacquer ? "gold" : "ink", lineStyle); ctx.fill();
  const role = lacquer ? "gold" : "ink";
  engraveText(p, lacquer ? "CONTEXTE" : "ÉVÉNEMENTS", cx, H * 0.8, { size: s * 0.15, weight: 700, tracking: 0.14, maxWidth: W * 0.74, role });
  engraveText(p, lacquer ? "GLOBAL FUND" : "FINANCIAL CHRONICLE", cx, H * 0.135, { size: s * 0.065, weight: 600, tracking: 0.3, maxWidth: W * 0.7, role });
  void ink;
  ctx.restore();
}

function drawEdges(p: Pen, r: AtlasRect) {
  const { ctx } = p;
  ctx.save();
  ctx.translate(r.x, r.y);
  const step = r.h / 100;
  for (let i = 0; i < 100; i++) {
    fill(p, "gold", i % 2 ? "#cfa95f" : "#e7cc8e");
    ctx.fillRect(0, i * step, r.w, step);
    fill(p, "engrave", "rgba(60,40,15,0.55)");
    ctx.fillRect(0, i * step + step * 0.82, r.w, step * 0.18);
  }
  ctx.restore();
}

function drawBadge(p: Pen, r: AtlasRect, value: number) {
  const { ctx } = p;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, R = r.w / 2 - 1;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
  fill(p, "gold", goldGradient(ctx, cy - R, cy + R));
  ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.86, 0, Math.PI * 2);
  fill(p, "enamel", gradient(ctx, cx - R, cy - R, cx + R, cy + R, [[0, "#1d1b18"], [1, "#060505"]]));
  ctx.fill();
  ctx.lineWidth = Math.max(1, R * 0.03);
  stroke(p, "gold", "rgba(232,200,138,0.7)");
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.78, 0, Math.PI * 2); ctx.stroke();
  engraveText(p, String(value), cx, cy + R * 0.04, { size: R * 1.05, weight: 700, tracking: 0 });
  ctx.restore();
}

function drawDecalText(p: Pen, r: AtlasRect, text: string, sizeRatio: number, tracking: number, ornament: boolean) {
  const { ctx } = p;
  ctx.save();
  ctx.translate(r.x, r.y);
  const y = ornament ? r.h * 0.4 : r.h / 2;
  engraveText(p, text, r.w / 2, y, { size: r.h * sizeRatio, weight: 600, tracking, maxWidth: r.w * 0.96 });
  if (ornament) {
    const ly = r.h * 0.82;
    ctx.lineWidth = Math.max(1, r.h / 60);
    stroke(p, "gold", gradient(ctx, 0, 0, r.w, 0, [[0, "rgba(226,196,134,0)"], [0.5, "rgba(226,196,134,0.9)"], [1, "rgba(226,196,134,0)"]]));
    ctx.beginPath(); ctx.moveTo(r.w * 0.18, ly); ctx.lineTo(r.w * 0.44, ly); ctx.moveTo(r.w * 0.56, ly); ctx.lineTo(r.w * 0.82, ly); ctx.stroke();
    const d = r.h * 0.07;
    ctx.beginPath(); ctx.moveTo(r.w / 2, ly - d); ctx.lineTo(r.w / 2 + d, ly); ctx.lineTo(r.w / 2, ly + d); ctx.lineTo(r.w / 2 - d, ly); ctx.closePath();
    fill(p, "gold", "#e3c486");
    ctx.fill();
  }
  ctx.restore();
}

function drawGlint(p: Pen, r: AtlasRect) {
  if (p.mask) return;
  const { ctx } = p;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, R = r.w / 2;
  ctx.save();
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  halo.addColorStop(0, "rgba(255,248,226,1)");
  halo.addColorStop(0.12, "rgba(255,226,160,0.65)");
  halo.addColorStop(0.4, "rgba(255,200,120,0.12)");
  halo.addColorStop(1, "rgba(255,200,120,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.globalCompositeOperation = "lighter";
  for (const [w, h] of [[R, R * 0.06], [R * 0.06, R]] as const) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, "rgba(255,246,220,0.95)");
    g.addColorStop(1, "rgba(255,246,220,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(cx, cy, w, h, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// ------------------------------------------------------------------ build --
/** Builds the atlas at `s` pixels per world unit. Requires `ensureBoardFonts()` first. */
export function buildBoardAtlas(board: BoardCell[], s: number, withMask: boolean): BoardAtlas {
  const pad = Math.max(4, Math.round(s * 0.03));
  const width = s >= 224 ? 2048 : s >= 160 ? 1536 : s >= 112 ? 1024 : 768;
  const items: Item[] = CELLS.map((cell) => ({ key: `c${cell.index}`, ...tileSize(cell, s) }));
  const cardW = Math.round(CARD.w * s * 0.92), cardH = Math.round(CARD.d * s * 0.92);
  const unit = s / 256;
  items.push(
    { key: "contextBack", w: cardW, h: cardH },
    { key: "eventBack", w: cardW, h: cardH },
    { key: "edges", w: Math.round(48 * unit), h: Math.round(400 * unit) },
    ...[1, 2, 3, 4, 5, 6].map((n) => ({ key: `badge${n}`, w: Math.round(112 * unit), h: Math.round(112 * unit) })),
    { key: "brand", w: Math.round(1000 * unit), h: Math.round(150 * unit) },
    { key: "contextLabel", w: Math.round(380 * unit), h: Math.round(64 * unit) },
    { key: "eventLabel", w: Math.round(380 * unit), h: Math.round(64 * unit) },
    { key: "glint", w: Math.round(128 * unit), h: Math.round(128 * unit) },
    { key: "side", w: 8, h: 8 },
  );
  const height = pack(items, width, pad);
  const at = (key: string) => items.find((item) => item.key === key)!.rect!;
  const atlas: BoardAtlas = {
    color: document.createElement("canvas"),
    mask: withMask ? document.createElement("canvas") : null,
    width,
    height,
    cells: CELLS.map((cell) => at(`c${cell.index}`)),
    contextBack: at("contextBack"),
    eventBack: at("eventBack"),
    edges: at("edges"),
    badges: [1, 2, 3, 4, 5, 6].map((n) => at(`badge${n}`)),
    brand: at("brand"),
    contextLabel: at("contextLabel"),
    eventLabel: at("eventLabel"),
    glint: at("glint"),
    side: at("side"),
  };
  const draw = (canvas: HTMLCanvasElement, mask: boolean) => {
    const scale = mask ? 0.5 : 1;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const p: Pen = { ctx, mask, s };
    for (let i = 0; i < CELL_COUNT; i++) drawPlaque(p, CELLS[i]!, cellArt(board[i]), atlas.cells[i]!, pad);
    drawCardBack(p, atlas.contextBack, "context", pad);
    drawCardBack(p, atlas.eventBack, "event", pad);
    drawEdges(p, atlas.edges);
    atlas.badges.forEach((r, i) => drawBadge(p, r, i + 1));
    drawDecalText(p, atlas.brand, "GLOBAL FUND", 0.42, 0.34, true);
    drawDecalText(p, atlas.contextLabel, "CONTEXTE", 0.62, 0.32, false);
    drawDecalText(p, atlas.eventLabel, "ÉVÉNEMENTS", 0.62, 0.32, false);
    drawGlint(p, atlas.glint);
    fill(p, "side", "#0c0b0a");
    ctx.fillRect(atlas.side.x - pad, atlas.side.y - pad, atlas.side.w + pad * 2, atlas.side.h + pad * 2);
  };
  draw(atlas.color, false);
  if (atlas.mask) draw(atlas.mask, true);
  return atlas;
}
