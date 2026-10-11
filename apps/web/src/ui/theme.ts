import type { Grade, PawnId, ZoneId } from "@global-fund/shared";

/**
 * Shared art direction constants for the HTML interface and the 3D scene.
 * Presentation only: nothing here participates in rules, prices or commands.
 */

export const PALETTE = {
  bg: "#0e0e0f",
  surface: "#18181a",
  surface2: "#202023",
  text: "#f5f3ef",
  text2: "#b4b0a8",
  accent: "#e3b860",
  up: "#4cc38d",
  down: "#ec6b5f",
  // Aliases used by existing charts.
  text100: "#f5f3ef",
  text500: "#b4b0a8",
  gold300: "#ecca85",
  gold500: "#e3b860",
} as const;

export const GRADES: Grade[] = ["A", "B", "C", "D", "E"];
export const GRADE_META: Record<Grade, { label: string; color: string; level: number }> = {
  A: { label: "Très favorable", color: "#3fae7d", level: 5 },
  B: { label: "Favorable", color: "#7cb86c", level: 4 },
  C: { label: "Neutre", color: "#c9a557", level: 3 },
  D: { label: "Dégradé", color: "#d9823f", level: 2 },
  E: { label: "Critique", color: "#d9534b", level: 1 },
};
/** Positive when the grade improves (E → A). */
export const gradeDelta = (before: Grade, after: Grade) => GRADE_META[after].level - GRADE_META[before].level;

export type SectorId = "technology" | "finance" | "industry" | "health" | "energy" | "realestate" | "agrifood" | "media" | "transport";
export const SECTOR_META: Record<SectorId, { short: string; label: string; color: string; icon: "cpu" | "landmark" | "factory" | "heart" | "flame" | "building" | "wheat" | "radio" | "plane" }> = {
  technology: { short: "TECH", label: "Technologie", color: "#4a7fd0", icon: "cpu" },
  finance: { short: "FINANCE", label: "Finance", color: "#d6ad55", icon: "landmark" },
  industry: { short: "INDUSTRIE", label: "Industrie", color: "#9aa3ae", icon: "factory" },
  health: { short: "SANTÉ", label: "Santé", color: "#34a88f", icon: "heart" },
  energy: { short: "ÉNERGIE", label: "Énergie", color: "#e07a3a", icon: "flame" },
  realestate: { short: "IMMO", label: "Immobilier", color: "#9b72d6", icon: "building" },
  agrifood: { short: "AGRO", label: "Agroalimentaire", color: "#8db354", icon: "wheat" },
  media: { short: "MÉDIAS", label: "Médias", color: "#d65b86", icon: "radio" },
  transport: { short: "TRANSPORT", label: "Transports", color: "#3fa6c4", icon: "plane" },
};
export const sectorMeta = (id: string | undefined) => SECTOR_META[(id ?? "") as SectorId];

/** One stable financial city per economic zone, as used by the offices. */
export const ZONE_META: Record<ZoneId, { short: string; label: string; city: string; lat: number; lon: number }> = {
  americas: { short: "AMÉR.", label: "Amériques", city: "New York", lat: 40.71, lon: -74.01 },
  europe: { short: "EUROPE", label: "Europe", city: "Londres", lat: 51.51, lon: -0.13 },
  asia: { short: "ASIE", label: "Asie", city: "Hong Kong", lat: 22.32, lon: 114.17 },
  africa: { short: "AF. & M.-O.", label: "Afrique & Moyen-Orient", city: "Dubaï", lat: 25.2, lon: 55.27 },
  oceania: { short: "OCÉANIE", label: "Océanie", city: "Sydney", lat: -33.87, lon: 151.21 },
};
export const ZONE_IDS = Object.keys(ZONE_META) as ZoneId[];

/** Figurine materials follow the chosen piece; rings and halos use the seat colour. */
export const PAWN_META: Record<PawnId, { name: string; material: string; tint: string; accent: string }> = {
  lion: { name: "Lion", material: "Or", tint: "#d8b25f", accent: "#f7e3ae" },
  bull: { name: "Taureau", material: "Saphir", tint: "#2d6fd6", accent: "#d8b25f" },
  globe: { name: "Globe", material: "Platine", tint: "#c9ccd1", accent: "#e8d29a" },
  crystal: { name: "Cristal", material: "Améthyste", tint: "#8e5fd6", accent: "#e6d6ff" },
  tower: { name: "Tour", material: "Rubis", tint: "#b3343f", accent: "#d8b25f" },
  leaf: { name: "Feuille", material: "Émeraude", tint: "#1f8a5c", accent: "#d8b25f" },
};

/** Rendered figurine portraits (transparent PNG), with the earlier sprite as fallback. */
export const pawnPortrait = (id: PawnId) => `/assets/pawns/render/${id}.png`;
export const pawnLegacyPortrait = (id: PawnId) => `/assets/pawns/premium/${id}.webp`;
