import type { PawnId, SeatConfig, ZoneId } from "@global-fund/shared";
import { replaceLegacyFundPlaceholders } from "./fundNames";

const STORAGE_KEY = "global-fund.setup-draft.v1";
const markets: ZoneId[] = ["americas", "europe", "asia", "africa", "oceania"];
const pawns: PawnId[] = ["lion", "bull", "globe", "crystal", "tower", "leaf"];
const defaults: SeatConfig[] = [
  { name: "Apex Capital", kind: "local", startingMarket: "europe", pawn: "lion", difficulty: "normal" },
  { name: "Meridian Fund", kind: "ai", startingMarket: "americas", pawn: "bull", difficulty: "normal" },
];

export interface SetupDraft {
  seats: SeatConfig[];
  seatCount: number;
  createStep: "funds" | "markets";
  activeHuman: number;
  join: string;
  name: string;
  startingMarket: ZoneId;
  joinPawn: PawnId;
}

export const defaultSetupDraft = (): SetupDraft => ({
  seats: [...defaults], seatCount: defaults.length, createStep: "funds", activeHuman: 0,
  join: "", name: "", startingMarket: "europe", joinPawn: "globe",
});

function validSeat(value: unknown): value is SeatConfig {
  if (!value || typeof value !== "object") return false;
  const seat = value as Partial<SeatConfig>;
  return typeof seat.name === "string" && seat.name.length <= 40 &&
    ["local", "remote", "ai"].includes(seat.kind ?? "") &&
    markets.includes(seat.startingMarket as ZoneId) && pawns.includes(seat.pawn as PawnId) &&
    ["easy", "normal", "hard"].includes(seat.difficulty ?? "");
}

export function loadSetupDraft(): SetupDraft {
  const fallback = defaultSetupDraft();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== 1) return fallback;
    const draft = (value as { draft?: Partial<SetupDraft> }).draft;
    if (!draft || !Array.isArray(draft.seats) || draft.seats.length < 2 || draft.seats.length > 6 || !draft.seats.every(validSeat)) return fallback;
    const count = draft.seatCount;
    return {
      ...fallback,
      ...draft,
      seats: replaceLegacyFundPlaceholders(draft.seats),
      seatCount: Number.isInteger(count) && count! >= 2 && count! <= draft.seats.length ? count! : draft.seats.length,
      createStep: draft.createStep === "markets" ? "markets" : "funds",
      activeHuman: Number.isInteger(draft.activeHuman) && draft.activeHuman! >= 0 && draft.activeHuman! < 6 ? draft.activeHuman! : 0,
      join: typeof draft.join === "string" ? draft.join.slice(0, 8) : "",
      name: typeof draft.name === "string" ? draft.name.slice(0, 40) : "",
      startingMarket: markets.includes(draft.startingMarket as ZoneId) ? draft.startingMarket! : "europe",
      joinPawn: pawns.includes(draft.joinPawn as PawnId) ? draft.joinPawn! : "globe",
    };
  } catch {
    return fallback;
  }
}

export function saveSetupDraft(draft: SetupDraft): void {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, draft })); } catch { /* Storage may be disabled or full. */ }
}
