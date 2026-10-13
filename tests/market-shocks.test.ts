import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import type { GameState, PendingSettlement, SeatConfig } from "@global-fund/shared";
import { createGame, executeCommand, fundValue, getGameView, priceFor } from "@global-fund/game-engine";
import currentCatalog from "../packages/game-engine/legacy/data/gameData.json";

const require = createRequire(import.meta.url);
const versionTwoBoard = require("../packages/game-engine/legacy/data/board-layout-v2.json") as GameState["board"];

const seats: SeatConfig[] = [
  { name: "A", kind: "local", startingMarket: "europe", pawn: "lion", difficulty: "normal" },
  { name: "B", kind: "local", startingMarket: "asia", pawn: "bull", difficulty: "normal" },
];
const clone = <T>(value: T): T => structuredClone(value);
const versionOneBoard = clone(versionTwoBoard);
[versionOneBoard[38], versionOneBoard[39]] = [versionOneBoard[39]!, versionOneBoard[38]!];
const active = (state: GameState) => state.players[state.activeIndex]!;
const run = (state: GameState, command: Parameters<typeof executeCommand>[2]) =>
  executeCommand(state, active(state).id, command);

function landMarket(state: GameState, label: "Bull Market" | "Bear Market" | "Market Crash"): GameState {
  const index = state.board.findIndex((cell) => cell.label === label);
  if (index < 0) throw new Error(`Missing ${label} board cell`);
  state.phase = "sector";
  state.stage = "sector";
  active(state).sectorPosition = (index - 1 + state.board.length) % state.board.length;
  vi.spyOn(Math, "random").mockReturnValue(0); // die=1; seeded shock effects must not need another draw
  return run(state, { type: "ROLL" });
}

afterEach(() => vi.restoreAllMocks());

describe("global market shocks", () => {
  it("keeps the canonical board positions and applies a deterministic Bull move to zones only", () => {
    const state = createGame(seats);
    expect(state.board[13]?.label).toBe("Bull Market");
    expect(state.board).toEqual(currentCatalog.board);
    expect(state.board[25]).toMatchObject({ kind: "sector", sector: "realestate" });
    expect(state.board.some((cell) => cell.label === "Market Crash")).toBe(false);
    expect(state.board[38]?.kind).toBe("event");
    expect(state.board[39]?.label).toMatch(/Bear/i);
    const beforeZones = clone(state.zoneGrades);
    const beforeSectors = clone(state.sectorGrades);
    const contextDeck = clone(state.deck);
    const eventDeck = clone(state.boardEventDeck);
    const activeZone = active(state).zone!;
    const holdings = clone(state.companies.map(({ holdings, costBasis }) => ({ holdings, costBasis })));
    const cash = state.players.map((player) => player.cash);
    const next = landMarket(state, "Bull Market");
    for (const [zone, grade] of Object.entries(beforeZones)) {
      const steps = zone === activeZone ? 2 : 1;
      expect("ABCDE"[Math.min(4, Math.max(0, "ABCDE".indexOf(grade) - steps))]).toBe(next.zoneGrades[zone]);
    }
    expect(next.sectorGrades).toEqual(beforeSectors);
    expect(next.deck).toEqual(contextDeck);
    expect(next.boardEventDeck).toEqual(eventDeck);
    expect(next.companies.map(({ holdings, costBasis }) => ({ holdings, costBasis }))).toEqual(holdings);
    expect(next.players.map((player) => player.cash)).toEqual(cash);
    expect(next.marketHistory.at(-1)?.zoneGrades).toEqual(next.zoneGrades);
  });

  it("moves every company price monotonically by the global 25% or active zone 50% shock", () => {
    const state = createGame(seats);
    const zone = active(state).zone!;
    const oldPrices = new Map(state.companies.map((company) => [company.id, priceFor(company, state)]));
    const next = landMarket(state, "Bull Market");
    for (const company of state.companies) {
      const before = oldPrices.get(company.id)!;
      const multiplier = company.zone === zone ? 1.5 : 1.25;
      const after = priceFor(next.companies.find((item) => item.id === company.id)!, next);
      expect(Math.abs(after - before * multiplier)).toBeLessThanOrEqual(0.011);
      expect(after).toBeGreaterThanOrEqual(before);
    }
    expect(next.companies.every((company) => priceFor(company, next) >= 1)).toBe(true);
  });

  it("applies the mirrored Bear movement from C, leaves sectors and decks alone, and uses only the die", () => {
    const state = createGame(seats);
    const zone = active(state).zone!;
    const sectors = clone(state.sectorGrades);
    const contextDeck = clone(state.deck);
    const eventDeck = clone(state.boardEventDeck);
    const beforePrices = new Map(state.companies.map((company) => [company.id, priceFor(company, state)]));
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const next = landMarket(state, "Bear Market");
    expect(random).toHaveBeenCalledTimes(1);
    expect(next.zoneGrades[zone]).toBe("E");
    for (const id of Object.keys(next.zoneGrades)) if (id !== zone) expect(next.zoneGrades[id]).toBe("D");
    expect(next.sectorGrades).toEqual(sectors);
    expect(next.deck).toEqual(contextDeck);
    expect(next.boardEventDeck).toEqual(eventDeck);
    for (const company of next.companies) {
      const before = beforePrices.get(company.id)!;
      const after = priceFor(company, next);
      const multiplier = company.zone === zone ? 0.5 : 0.75;
      expect(Math.abs(after - before * multiplier)).toBeLessThanOrEqual(0.011);
      expect(after).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps Bull and Bear prices monotonic for every starting zone and sector grade pair", () => {
    const grades = ["A", "B", "C", "D", "E"] as const;
    for (const zoneGrade of grades) {
      for (const sectorGrade of grades) {
        vi.restoreAllMocks();
        const state = createGame(seats);
        const focusZone = active(state).zone!;
        for (const zone of Object.keys(state.zoneGrades)) state.zoneGrades[zone] = zoneGrade;
        for (const sector of Object.keys(state.sectorGrades)) state.sectorGrades[sector] = sectorGrade;
        const before = new Map(state.companies.map((company) => [company.id, priceFor(company, state)]));
        const bull = landMarket(clone(state), "Bull Market");
        const bear = landMarket(clone(state), "Bear Market");
        for (const company of state.companies) {
          const oldPrice = before.get(company.id)!;
          expect(priceFor(bull.companies.find((item) => item.id === company.id)!, bull)).toBeGreaterThanOrEqual(oldPrice);
          expect(priceFor(bear.companies.find((item) => item.id === company.id)!, bear)).toBeLessThanOrEqual(oldPrice);
          expect(priceFor(bull.companies.find((item) => item.id === company.id)!, bull)).toBeGreaterThanOrEqual(1);
          expect(priceFor(bear.companies.find((item) => item.id === company.id)!, bear)).toBeGreaterThanOrEqual(1);
        }
        expect(bull.zoneGrades[focusZone]).toBe(grades[Math.max(0, grades.indexOf(zoneGrade) - 2)]);
        expect(bear.zoneGrades[focusZone]).toBe(grades[Math.min(4, grades.indexOf(zoneGrade) + 2)]);
      }
    }
  });

  it("keeps the Bull movement RNG-free beyond the die and does not mutate its input", () => {
    const state = createGame(seats);
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    random.mockReturnValue(0);
    const index = state.board.findIndex((cell) => cell.label === "Bull Market");
    state.phase = "sector";
    state.stage = "sector";
    active(state).sectorPosition = (index - 1 + state.board.length) % state.board.length;
    const snapshot = clone(state);
    run(state, { type: "ROLL" });
    expect(random).toHaveBeenCalledTimes(1);
    expect(state).toEqual(snapshot);
    expect(state.players.map((player) => player.cash)).toEqual([100, 100]);
  });

  it("retains the Crash rule on a clearly custom board", () => {
    const state = createGame(seats);
    state.board[30] = { kind: "market", label: "Market Crash", marketEffect: "crash" };
    const zones = clone(state.zoneGrades);
    const sectors = clone(state.sectorGrades);
    state.phase = "sector";
    state.stage = "sector";
    active(state).sectorPosition = 29;
    const random = vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0);
    const next = run(state, { type: "ROLL" });
    expect(random).toHaveBeenCalledTimes(2);
    for (const zone of Object.keys(zones)) expect(next.zoneGrades[zone]).toBe("E");
    expect(next.sectorGrades).toEqual(sectors);
  });

  it("turns two distinct portfolios into a NAV rank flip while preserving fund cash", () => {
    const state = createGame(seats);
    const zone = active(state).zone!;
    let inZone = state.companies.find((company) => company.zone === zone)!;
    let elsewhere = state.companies.find((company) => company.zone !== zone)!;
    const [first, second] = state.players;
    let firstQuantity = 0;
    let secondQuantity = 0;
    for (const candidateA of state.companies.filter((company) => company.zone === zone)) {
      for (const candidateB of state.companies.filter((company) => company.zone !== zone)) {
        for (let qa = 1; qa <= 5 && !firstQuantity; qa += 1) {
          for (let qb = 1; qb <= 5; qb += 1) {
            const firstValue = priceFor(candidateA, state) * qa;
            const otherValue = priceFor(candidateB, state) * qb;
            if (firstValue < otherValue && otherValue < firstValue * 1.2) {
              inZone = candidateA;
              elsewhere = candidateB;
              firstQuantity = qa;
              secondQuantity = qb;
              break;
            }
          }
        }
        if (firstQuantity) break;
      }
      if (firstQuantity) break;
    }
    expect(firstQuantity).toBeGreaterThan(0);
    const a = priceFor(inZone, state);
    const b = priceFor(elsewhere, state);
    inZone.holdings[first!.id] = firstQuantity;
    inZone.costBasis = { [first!.id]: firstQuantity * a };
    elsewhere.holdings[second!.id] = secondQuantity;
    elsewhere.costBasis = { [second!.id]: secondQuantity * b };
    first!.cash = 0;
    second!.cash = 0;
    expect(fundValue(state, first!)).toBeLessThan(fundValue(state, second!));
    const cash = state.players.map((player) => player.cash);
    const next = landMarket(state, "Bull Market");
    expect(fundValue(next, next.players[0]!)).toBeGreaterThan(fundValue(next, next.players[1]!));
    expect(next.players.map((player) => player.cash)).toEqual(cash);
  });

  it("clamps both ends and never pushes an index outside A through E", () => {
    const state = createGame(seats);
    for (const zone of Object.keys(state.zoneGrades)) state.zoneGrades[zone] = "A";
    const index = state.board.findIndex((cell) => cell.label === "Bull Market");
    state.phase = "sector";
    state.stage = "sector";
    active(state).sectorPosition = (index - 1 + state.board.length) % state.board.length;
    const next = landMarket(state, "Bull Market");
    expect(next.notices.at(-1)?.position).toBe(13);
    expect(Object.values(next.zoneGrades).every((grade) => grade === "A")).toBe(true);
    for (const zone of Object.keys(next.zoneGrades)) next.zoneGrades[zone] = "E";
    const bearIndex = next.board.findIndex((cell) => /Bear/i.test(cell.label));
    expect(bearIndex).toBe(39);
    const fallen = landMarket(next, "Bear Market");
    expect(fallen.notices.at(-1)?.position).toBe(39);
    expect(Object.values(fallen.zoneGrades).every((grade) => grade === "E")).toBe(true);
    expect(Object.values(fallen.zoneGrades).every((grade) => "ABCDE".includes(grade))).toBe(true);
  });

  it("liquidates E/E holdings once at the exact price, then a Bull reopens the company", () => {
    const state = createGame(seats);
    const player = active(state);
    const company = state.companies.find((item) => item.zone === player.zone)!;
    for (const zone of Object.keys(state.zoneGrades)) state.zoneGrades[zone] = "E";
    state.sectorGrades[company.sector] = "E";
    company.holdings[player.id] = 2;
    company.costBasis = { [player.id]: 44 };
    const cashBefore = player.cash;
    const expectedLiquidation = company.basePrice / 20;
    const next = landMarket(state, "Bear Market");
    expect(next.companies.find((item) => item.id === company.id)).toMatchObject({ available: false, holdings: {}, costBasis: {} });
    expect(next.players.find((item) => item.id === player.id)!.cash).toBeCloseTo(cashBefore + 2 * expectedLiquidation, 2);
    expect(next.players.every((item) => item.solvent)).toBe(true);
    const cashAfterLiquidation = next.players.find((item) => item.id === player.id)!.cash;

    const repeatedBear = landMarket(next, "Bear Market");
    expect(repeatedBear.players.find((item) => item.id === player.id)!.cash).toBe(cashAfterLiquidation);
    expect(repeatedBear.companies.find((item) => item.id === company.id)!.available).toBe(false);

    const reopened = landMarket(repeatedBear, "Bull Market");
    expect(reopened.zoneGrades[company.zone]).toBe("C");
    expect(reopened.companies.find((item) => item.id === company.id)!.available).toBe(true);
  });

  it.each([
    [1, versionOneBoard],
    [2, versionTwoBoard],
  ] as const)("migrates historical layout version %i without changing live/history indices or settlement", (version, oldBoard) => {
    const state = createGame(seats);
    state.board = clone(oldBoard);
    state.boardLayoutVersion = version;
    state.marketRulesVersion = 1;
    state.players[0]!.sectorPosition = 38;
    state.players[1]!.sectorPosition = 25;
    const positions = state.players.map((player) => player.sectorPosition);
    const historicalPositions = clone(state.marketHistory);
    state.notices.push({ id: 999, cycle: state.cycle, kind: "event", source: "board", title: "Market Crash", position: 25 });
    const debt: PendingSettlement = {
      id: 41, debtorId: "p1", creditorId: null, amount: 7, reason: "fixture", remainingAmount: 7,
      resumePhase: "market", decisionActorId: "p1", status: "selectAssets", debts: [], completed: [], creditorOrder: [],
    };
    state.pendingSettlement = debt;
    const frozen = clone(state);
    const view = getGameView(state);
    expect(state).toEqual(frozen);
    expect(view.board).toEqual(currentCatalog.board);
    expect(view.players.map((player) => player.sectorPosition)).toEqual(positions);
    expect(view.notices.find((notice) => notice.id === 999)).toMatchObject({ position: 25, cell: { kind: "market", label: "Market Crash" } });
    expect(view.pendingSettlement).toEqual(debt);
    expect(view.marketHistory).toEqual(historicalPositions);
    expect(view.boardLayoutVersion).toBe(3);
    expect(view.marketRulesVersion).toBe(2);
    expect(getGameView(state)).toEqual(view);
    expect(state.board).toEqual(oldBoard);
    expect(state.pendingSettlement).toEqual(debt);
  });

  it("lands an old case 26 roll on the new real-estate sector without a Crash", () => {
    const state = createGame(seats);
    state.board = clone(versionTwoBoard);
    state.boardLayoutVersion = 2;
    state.marketRulesVersion = 1;
    state.phase = "sector";
    state.stage = "sector";
    active(state).sectorPosition = 24;
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const next = run(state, { type: "ROLL" });
    expect(random).toHaveBeenCalledTimes(1);
    expect(next.players[next.activeIndex]?.sectorPosition).toBe(25);
    expect(next.board[25]).toMatchObject({ kind: "sector", sector: "realestate" });
    expect(next.notices.some((notice) => notice.title === "Market Crash")).toBe(false);
    expect(next.zoneGrades).toEqual(state.zoneGrades);
    expect(next.sectorGrades).toEqual(state.sectorGrades);
  });

  it("leaves a custom board layout in place during legacy adaptation", () => {
    const state = createGame(seats);
    state.board = clone(state.board);
    [state.board[38], state.board[39]] = [state.board[39]!, state.board[38]!];
    state.board[10] = { ...state.board[10]!, label: "Custom house rule" };
    const custom = clone(state.board);
    expect(getGameView(state).board).toEqual(custom);
    expect(state.board).toEqual(custom);
  });

  it("keeps an untagged local market cell playable with the legacy local effect", () => {
    const state = createGame(seats);
    state.board[13] = { ...state.board[13]!, label: "Local market shock", marketEffect: undefined };
    const layout = clone(state.board);
    const sectors = clone(state.sectorGrades);
    state.phase = "sector";
    state.stage = "sector";
    active(state).sectorPosition = 12;
    const random = vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0);
    const next = run(state, { type: "ROLL" });
    expect(random).toHaveBeenCalledTimes(2);
    expect(next.board).toEqual(layout);
    expect(Object.values(next.zoneGrades).every((grade) => grade === "D")).toBe(true);
    expect(next.sectorGrades).toEqual(sectors);
    expect(next.notices.find((notice) => notice.title === "Local market shock")).toMatchObject({ title: "Local market shock", position: 13 });
  });

  it("does not reinterpret future market versions in snapshots or commands", () => {
    const state = createGame(seats);
    [state.board[38], state.board[39]] = [state.board[39]!, state.board[38]!];
    state.boardLayoutVersion = 3;
    state.marketRulesVersion = 3;
    const before = clone(state);
    const view = getGameView(state);
    expect(view.board).toEqual(before.board);
    expect(view.boardLayoutVersion).toBe(3);
    expect(view.marketRulesVersion).toBe(3);
    expect(state).toEqual(before);
    expect(() => executeCommand(state, active(state).id, { type: "ROLL" })).toThrow();
    expect(state).toEqual(before);
  });
});
