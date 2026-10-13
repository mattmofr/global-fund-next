import { createGame, executeCommand, getGameView, priceFor } from "@global-fund/game-engine";
import type { GameState, Player, SeatConfig } from "@global-fund/shared";

export const settlementSeats: SeatConfig[] = [
  { name: "Apex Capital", kind: "local", startingMarket: "europe", pawn: "lion", difficulty: "normal" },
  { name: "Meridian Fund", kind: "remote", startingMarket: "asia", pawn: "bull", difficulty: "normal" },
  { name: "Zenith Partners", kind: "local", startingMarket: "americas", pawn: "globe", difficulty: "normal" },
];

/**
 * A real engine-generated settlement fixture. The six-step roll lands on an
 * Industry cell: Meridian's one share earns 20 M€ from Apex, whose cash is 0.
 * Apex owns a second Industry share worth 27 M€, so the creditor must pay the
 * 7 M€ difference if it accepts the proposed transfer.
 */
export type SettlementFixtureOptions = { creditorCash?: number; playerCount?: 2 | 3; debtorCash?: number; assetValue?: 12 | 20 | 27; cashOnly?: boolean; assetQuantity?: 1 | 2 };

export function createIndustrySettlementReady(options: SettlementFixtureOptions = {}): GameState {
  const seats = settlementSeats.slice(0, options.playerCount ?? 2);
  const originalRandom = Math.random;
  let seed = 0x5e771e;
  Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x1_0000_0000; };
  let state: GameState;
  try { state = createGame(seats); } finally { Math.random = originalRandom; }

  state.activeIndex = 0;
  state.starterIndex = 0;
  state.completedPlayers = [];
  state.cycle = 4;
  state.phase = "sector";
  state.stage = "sector";
  state.players.forEach(player => {
    player.geoResolved = true;
    player.jailed = false;
  });
  state.players[0]!.cash = options.cashOnly ? 100 : options.debtorCash ?? 0;
  state.players[1]!.cash = options.creditorCash ?? (options.playerCount === 3 ? 5 : 100);
  if (state.players[2]) state.players[2].cash = 12;

  const companies = state.companies.filter(company => company.available && company.sector === "industry");
  if (companies.length < (options.playerCount === 3 ? 3 : 2)) throw new Error("Settlement fixture requires enough available Industry companies.");
  for (const company of companies) {
    company.holdings = {};
    company.costBasis = {};
  }

  const obligation = companies[0]!;
  obligation.baseIncome = 100; // one creditor share yields exactly 20 M€ at C/C
  // The three-player fixture deliberately makes the lowest-cash creditor the
  // highest-NAV creditor, so its priority test distinguishes the two rules.
  obligation.basePrice = options.playerCount === 3 ? 500 : 100;
  obligation.holdings.p2 = 1;
  obligation.costBasis!.p2 = 20;

  const debtorAsset = companies[1]!;
  debtorAsset.baseIncome = 30; // Apex receives no income from its own holdings on its active sector roll.
  const assetValue = options.assetValue ?? 27;
  debtorAsset.basePrice = assetValue * 5; // exactly assetValue M€ at C/C
  debtorAsset.holdings.p1 = options.assetQuantity ?? 1;
  debtorAsset.costBasis!.p1 = 18;

  if (state.players[2]) {
    const third = companies[2]!;
    third.baseIncome = 50;
    third.basePrice = 100;
    third.holdings.p3 = 1;
    third.costBasis!.p3 = 20;
  }

  // Keep this debt fixture away from Start: lap performance is a separate flow.
  const sectorCellIndex = state.board.findIndex((cell, index) => index >= 6 && cell.kind === "sector" && cell.sector === "industry");
  if (sectorCellIndex < 0) throw new Error("Settlement fixture requires an Industry board cell.");
  state.players[0]!.sectorPosition = (sectorCellIndex - 6 + state.board.length) % state.board.length;
  state.players[0]!.fundValue = state.players[0]!.cash;
  state.players[1]!.fundValue = state.players[1]!.cash;
  if (state.players[2]) state.players[2].fundValue = state.players[2].cash;

  const snapshot = getGameView(state);
  state.players = snapshot.players as Player[];
  return state;
}

export function createIndustrySettlement(options: SettlementFixtureOptions = {}): GameState {
  const state = createIndustrySettlementReady(options);
  const oldRandom = Math.random;
  Math.random = () => 0.999999; // six on the real ROLL command
  let settled: GameState;
  try { settled = executeCommand(state, "p1", { type: "ROLL" }); } finally { Math.random = oldRandom; }
  if (options.cashOnly ? !!settled.pendingSettlement : !settled.pendingSettlement) throw new Error("ROLL did not create the expected cash or pending settlement.");
  const asset = settled.companies.find(company => company.holdings.p1 === (options.assetQuantity ?? 1) && company.basePrice === (options.assetValue ?? 27) * 5 && company.sector === "industry");
  if (!asset || Math.abs(priceFor(asset, settled) - (options.assetValue ?? 27)) > 0.01) throw new Error("Settlement asset price does not match its fixture value.");
  return settled;
}
