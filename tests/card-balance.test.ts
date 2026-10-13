import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventCard, GameState, SeatConfig } from "@global-fund/shared";
import { createGame, executeCommand, getGameView } from "@global-fund/game-engine";

const require = createRequire(import.meta.url);
const { BOARD_EVENT_CARDS } = require("../packages/game-engine/legacy/boardEventCards.cjs") as {
  BOARD_EVENT_CARDS: (EventCard & { balanceCategory?: string })[];
};
const contextCatalog = require("../packages/game-engine/legacy/data/gameData.json").events as {
  id: number | string;
  type?: string;
  title: string;
  changes: { scope: "zone" | "sector"; id: string; grade: "A" | "B" | "C" | "D" | "E" }[];
}[];
const sectors = ["industry", "technology", "transport", "realestate", "energy", "media", "finance", "agrifood", "health"];
const seats: SeatConfig[] = [
  { name: "Test", kind: "local", startingMarket: "europe", pawn: "lion", difficulty: "normal" },
  { name: "Peer", kind: "local", startingMarket: "asia", pawn: "bull", difficulty: "normal" },
];
const clone = <T,>(value: T): T => structuredClone(value);
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
const active = (state: GameState) => state.players[state.activeIndex]!;
const cardPairs = [
  ["board-01", "Contrat public inattendu"], ["board-02", "Prime de fidélité bancaire"], ["board-03", "Rachat stratégique"], ["board-04", "Crédit d’innovation"], ["board-05", "Dividende exceptionnel"],
  ["board-06", "Commande humanitaire"], ["board-07", "Offre de retrait"], ["board-08", "Brevet décisif"], ["board-09", "Amende de conformité"], ["board-10", "Rappel de sécurité"],
  ["board-11", "Taxe carbone accélérée"], ["board-12", "Frais de restructuration"], ["board-13", "Vente réglementaire"], ["board-14", "Désengagement d’un assureur"], ["board-15", "Audit des participations croisées"],
  ["board-16", "Liquidité sous surveillance"], ["board-17", "Garantie de rachat"], ["board-18", "Appel de marge"], ["board-19", "Collatéral déprécié"], ["board-20", "Risque de change"],
  ["board-21", "Convocation judiciaire"], ["board-22", "Soupçon de délit d’initié"], ["board-23", "Saisie préventive"], ["board-24", "Plafond de détention"], ["board-25", "Accès équitable au réseau"],
  ["board-26", "Fin du privilège exclusif"], ["board-27", "Indemnité de livraison"], ["board-28", "Récolte sous assurance"], ["board-29", "Accord de cybersécurité"], ["board-30", "Licence médicale"],
  ["board-31", "Révision des normes comptables"], ["board-32", "Conversion des entrepôts"], ["board-33", "Fret exceptionnel"], ["board-34", "Couverture agricole"], ["board-35", "Violation de données"],
  ["board-36", "Réparation du réseau"], ["board-37", "Autorisation de distribution"], ["board-38", "Simplification de la structure"], ["board-39", "Offre de coopérative"], ["board-40", "Chambre de compensation"],
  ["board-41", "Diversification imposée"], ["board-42", "Clause de transparence"], ["board-43", "Commercialisation d’un vaccin"], ["board-44", "Contrôle des loyers"], ["board-45", "Archives judiciaires"],
  ["board-46", "Redevances audiovisuelles"], ["board-47", "Garantie de chantier"], ["board-48", "Programme de recyclage"], ["board-49", "Ouverture des brevets"], ["board-50", "Rachat du réseau local"],
] as const;

function drawCard(card: EventCard, setup?: (state: GameState) => void, randomValues = [0, 0, 0]): GameState {
  vi.restoreAllMocks();
  const state = createGame(seats);
  const player = active(state);
  // The canonical board has an event at index 3, reachable by a one-step roll.
  player.sectorPosition = 2;
  state.boardEventDeck = [clone(card)];
  setup?.(state);
  let call = 0;
  vi.spyOn(Math, "random").mockImplementation(() => randomValues[call++] ?? 0);
  try {
    return executeCommand(state, player.id, { type: "ROLL" });
  } finally {
    vi.restoreAllMocks();
  }
}

afterEach(() => vi.restoreAllMocks());

describe("plateau event card balance", () => {
  it("keeps the 50 published event IDs and titles", () => {
    expect(BOARD_EVENT_CARDS.map(({ id, title }) => [id, title])).toEqual(cardPairs);
  });

  it("balances targets and impact categories across all 50 cards", () => {
    expect(BOARD_EVENT_CARDS).toHaveLength(50);
    const targeted = BOARD_EVENT_CARDS.filter((card) => card.targetSector);
    const sectorCounts = Object.fromEntries(sectors.map((sector) => [sector, targeted.filter((card) => card.targetSector === sector).length]));
    expect(targeted).toHaveLength(45);
    expect(sectorCounts).toEqual(Object.fromEntries(sectors.map((sector) => [sector, 5])));
    expect(BOARD_EVENT_CARDS.filter((card) => !card.targetSector)).toHaveLength(5);
    expect(Object.fromEntries(["favorable", "unfavorable", "mixed"].map((category) => [category, BOARD_EVENT_CARDS.filter((card) => card.balanceCategory === category).length])))
      .toEqual({ favorable: 19, unfavorable: 19, mixed: 12 });
    for (const sector of sectors) {
      const cards = targeted.filter((card) => card.targetSector === sector);
      expect(cards.filter((card) => card.balanceCategory === "favorable"), sector).toHaveLength(2);
      expect(cards.filter((card) => card.balanceCategory === "unfavorable"), sector).toHaveLength(2);
      expect(cards.filter((card) => card.balanceCategory === "mixed"), sector).toHaveLength(1);
    }
  });

  it("keeps cash and per-share amounts within bounds and quantities at one or two", () => {
    for (const card of BOARD_EVENT_CARDS) {
      expect(Math.abs(card.activeCash ?? 0), card.id).toBeLessThanOrEqual(3);
      if (card.amount !== undefined) expect(card.amount, card.id).toBeLessThanOrEqual(3);
      if (card.quantity !== undefined) expect(card.quantity, card.id).toBeLessThanOrEqual(2);
    }
  });

  it("uses company placeholders in targeted stories, while global neutral cards have no action", () => {
    for (const card of BOARD_EVENT_CARDS) {
      if (card.targetSector) expect(card.story, card.id).toContain("{company}");
    }
    const neutralGlobal = BOARD_EVENT_CARDS.filter((card) => !card.targetSector && card.balanceCategory === "mixed");
    expect(neutralGlobal).toHaveLength(3);
    for (const card of neutralGlobal) {
      expect(card.effect, card.id).toBe("cash");
      expect(card.activeCash ?? 0, card.id).toBe(0);
      expect(card.amount ?? 0, card.id).toBe(0);
      expect(card.quantity ?? 0, card.id).toBe(0);
    }
  });

  it("resolves every card through an actual board ROLL and preserves the intended sector", () => {
    for (const card of BOARD_EVENT_CARDS) {
      const after = drawCard(card);
      const notice = after.notices.find((item) => item.source === "board" && item.cardId === card.id);
      expect(notice, card.id).toBeDefined();
      if (card.targetSector) expect(notice?.targetedSector, card.id).toBe(card.targetSector);
    }
  });

  it("runs every targeted effect with two shares, five shares, and a sector monopoly at grade C", () => {
    const targeted = BOARD_EVENT_CARDS.filter((card) => card.targetSector);
    for (const card of targeted) {
      for (const holdingSize of [2, 5, "monopoly"] as const) {
        const candidates = createGame(seats).companies.filter((company) => company.sector === card.targetSector);
        const first = candidates[0]!;
        const firstId = first.id;
        const zone = first.zone;
        let contextDeckBefore: GameState["deck"] = [];
        const after = drawCard(card, (draft) => {
          contextDeckBefore = clone(draft.deck);
          const playerId = active(draft).id;
          for (const player of draft.players) player.cash = 10_000;
          const heldCompanies = holdingSize === "monopoly"
            ? draft.companies.filter((company) => company.zone === zone && company.sector === card.targetSector)
            : [draft.companies.find((company) => company.id === firstId)!];
          for (const company of heldCompanies) company.holdings[playerId] = holdingSize === "monopoly" ? 5 : holdingSize;
          draft.zoneGrades = Object.fromEntries(draft.zones.map((item) => [item.id, "C"]));
          draft.sectorGrades = Object.fromEntries(draft.sectors.map((item) => [item.id, "C"]));
        });
        const notice = after.notices.find((item) => item.cardId === card.id);
        expect(notice, `${card.id}, ${holdingSize}`).toBeDefined();
        expect(after.zoneGrades).toEqual(Object.fromEntries(after.zones.map((item) => [item.id, "C"])));
        expect(after.sectorGrades).toEqual(Object.fromEntries(after.sectors.map((item) => [item.id, "C"])));
        expect(after.pendingSettlement ?? null, `${card.id}, ${holdingSize}`).toBeNull();
        expect(after.deck).toEqual(contextDeckBefore);
      }
    }
  });

  it("chooses an owned active-player holding before other holdings, then an unheld company", () => {
    const card = BOARD_EVENT_CARDS.find((item) => item.targetSector)!;
    const candidates = createGame(seats).companies.filter((company) => company.sector === card.targetSector);
    expect(candidates.length).toBeGreaterThan(2);
    const ownedId = candidates[0]!.id;
    const otherHeldId = candidates[1]!.id;
    const freeId = candidates[2]!.id;
    const state = drawCard(card, (draft) => {
      draft.companies.find((company) => company.id === ownedId)!.holdings[active(draft).id] = 1;
      draft.companies.find((company) => company.id === otherHeldId)!.holdings[draft.players.find((player) => player.id !== active(draft).id)!.id] = 1;
      draft.companies.find((company) => company.id === freeId)!.holdings = {};
      draft.boardEventDeck = [clone(card)];
    });
    expect(state.notices.find((item) => item.cardId === card.id)?.targetCompanyId).toBe(ownedId);
  });

  it("draws a target zone uniformly even when sectors have different company counts", () => {
    const card = BOARD_EVENT_CARDS.find((item) => item.targetSector === "finance")!;
    const selectedZones = [0.01, 0.21, 0.41, 0.61, 0.81].map((zoneDraw) => {
      const state = drawCard(card, undefined, [0, zoneDraw, 0]);
      return state.notices.find((item) => item.cardId === card.id)?.targetedZone;
    });
    expect(new Set(selectedZones)).toEqual(new Set(["americas", "europe", "asia", "africa", "oceania"]));
  });

  it("avoids the last four targets inside the selected zone when a fresh local target exists", () => {
    const card = BOARD_EVENT_CARDS.find((item) => item.targetSector === "finance")!;
    const americasFinanceIds = createGame(seats).companies.filter((company) => company.sector === "finance" && company.zone === "americas").map((company) => company.id);
    expect(americasFinanceIds.length).toBeGreaterThanOrEqual(5);
    let state = createGame(seats);
    const recent: string[] = [];
    for (let draw = 0; draw < 9; draw += 1) {
      state.phase = "sector";
      state.stage = "sector";
      active(state).sectorPosition = 2;
      state.boardEventDeck = [clone(card)];
      let call = 0;
      // Finance candidate-zone order starts with Asia, Africa, Americas; .41 selects Americas (six companies).
      vi.spyOn(Math, "random").mockImplementation(() => [0, 0.41, 0][call++] ?? 0);
      try {
        state = executeCommand(state, active(state).id, { type: "ROLL" });
      } finally {
        vi.restoreAllMocks();
      }
      const target = [...state.notices].reverse().find((notice) => notice.cardId === card.id)?.targetCompanyId;
      expect(target).toBeDefined();
      expect(americasFinanceIds).toContain(target);
      expect(recent.slice(-4), `draw ${draw + 1}`).not.toContain(target);
      recent.push(target!);
      state = JSON.parse(JSON.stringify(state)) as GameState;
    }
  });

  it("falls back to a recent target when the selected zone has no fresh company", () => {
    const card = BOARD_EVENT_CARDS.find((item) => item.targetSector === "finance")!;
    let state = createGame(seats);
    const targets: string[] = [];
    for (let draw = 0; draw < 5; draw += 1) {
      state.phase = "sector";
      state.stage = "sector";
      active(state).sectorPosition = 2;
      state.boardEventDeck = [clone(card)];
      let call = 0;
      // .01 selects Asia, which has four finance companies.
      vi.spyOn(Math, "random").mockImplementation(() => [0, 0.01, 0][call++] ?? 0);
      try {
        state = executeCommand(state, active(state).id, { type: "ROLL" });
      } finally {
        vi.restoreAllMocks();
      }
      const target = [...state.notices].reverse().find((notice) => notice.cardId === card.id)?.targetCompanyId;
      expect(target).toBeDefined();
      expect(state.companies.find((company) => company.id === target)?.zone).toBe("asia");
      targets.push(target!);
      state = JSON.parse(JSON.stringify(state)) as GameState;
    }
    expect(new Set(targets.slice(0, 4)).size).toBe(4);
    expect(targets[4]).toBeDefined();
    expect(targets.slice(0, 4)).toContain(targets[4]);
  });

  it("uses no company target when every company in the target sector is unavailable", () => {
    const card = BOARD_EVENT_CARDS.find((item) => item.targetSector)!;
    const state = drawCard(card, (draft) => {
      for (const company of draft.companies.filter((item) => item.sector === card.targetSector)) company.available = false;
    });
    const notice = state.notices.find((item) => item.cardId === card.id);
    expect(notice?.targetCompanyId).toBeUndefined();
    expect(notice?.targetedSector).toBe(card.targetSector);
  });

  it("rotates context grades only through NEXT_TURN and keeps grades bounded", () => {
    const state = createGame(seats);
    // A neutral card exercises grade rotation and restoration without changing prices through a settlement.
    const initial = clone(state.zoneGrades);
    for (let cycle = 0; cycle < 8; cycle += 1) {
      state.phase = "awaitNext";
      state.completedPlayers = state.players.filter((player) => player.id !== active(state).id).map((player) => player.id);
      state.deck.unshift({ id: `balance-${cycle}`, title: "Rotation", changes: [{ scope: "zone", id: "europe", grade: cycle % 2 ? "C" : "D" }] });
      const current = executeCommand(state, active(state).id, { type: "NEXT_TURN" });
      expect(["A", "B", "C", "D", "E"]).toContain(current.zoneGrades.europe);
      Object.assign(state, current);
    }
    expect(state.zoneGrades.europe).toBe(initial.europe);
  });

  it("migrates known saved card payloads in place while preserving order and unknown fixtures", () => {
    const state = createGame(seats);
    state.cardRulesVersion = 2;
    state.phase = "sector";
    active(state).sectorPosition = 0;
    const knownContext = contextCatalog[0]!;
    const knownBoard = BOARD_EVENT_CARDS[0]!;
    const fixture = { id: "fixture-context", title: "Fixture", changes: [{ scope: "zone", id: "europe", grade: "C" }] } as GameState["deck"][number];
    const unknownEvent = { id: "fixture-event", title: "Fixture event", story: "fixture", effect: "fixture" } as EventCard;
    const staleContext = { id: knownContext.id, title: "obsolete title", changes: [{ scope: "zone", id: "missing-zone", grade: "A" }] } as unknown as GameState["deck"][number];
    const staleBoard = { ...knownBoard, title: "obsolete title", effect: "obsolete", activeCash: 99 } as EventCard;
    state.deck = [staleContext, fixture, { ...staleContext, id: contextCatalog[1]!.id }];
    state.boardEventDeck = [staleBoard, unknownEvent];
    state.boardEventDiscard = [{ ...staleBoard, id: BOARD_EVENT_CARDS[1]!.id }, { ...unknownEvent, id: "discard-fixture" }];
    const currentContext = { id: "current-context", title: "Displayed legacy card", changes: [{ scope: "zone" as const, id: "europe", grade: "E" as const }] };
    state.currentContext = currentContext;
    const existingNotice = { id: 55, cycle: 2, kind: "event" as const, cardType: "context" as const, title: "Existing" };
    state.notices = [existingNotice];
    const deckIds = state.deck.map((card) => String(card.id));
    let call = 0;
    vi.spyOn(Math, "random").mockImplementation(() => call++ === 0 ? 0 : 0);
    let migrated: GameState;
    try {
      migrated = executeCommand(state, active(state).id, { type: "ROLL" });
    } finally {
      vi.restoreAllMocks();
    }
    expect(migrated.cardRulesVersion).toBe(3);
    expect(migrated.deck.map((card) => String(card.id))).toEqual(deckIds);
    expect(migrated.deck[0]?.changes).toEqual(knownContext.changes);
    expect(migrated.deck[1]).toEqual(fixture);
    expect(migrated.boardEventDeck[0]).toEqual(knownBoard);
    expect(migrated.boardEventDeck[1]).toEqual(unknownEvent);
    expect(migrated.boardEventDiscard[0]).toEqual({ ...BOARD_EVENT_CARDS[1] });
    expect(migrated.boardEventDiscard[1]).toEqual({ ...unknownEvent, id: "discard-fixture" });
    expect(migrated.currentContext).toEqual(currentContext);
    expect(migrated.notices[0]).toEqual(existingNotice);
  });

  it("rejects a command on a save from a future card rules version without changing the input", () => {
    const state = createGame(seats);
    state.cardRulesVersion = 4;
    const before = clone(state);
    expect(() => executeCommand(state, active(state).id, { type: "ROLL" })).toThrow();
    expect(state).toEqual(before);
  });

  it("preserves frozen card payloads and notices when saved event text is from a future version", () => {
    const state = createGame(seats);
    state.cardRulesVersion = 2;
    state.eventTextVersion = 4;
    state.deck = [clone(contextCatalog[0]!) as GameState["deck"][number]];
    state.boardEventDeck = [clone(BOARD_EVENT_CARDS[0]!)];
    state.boardEventDiscard = [clone(BOARD_EVENT_CARDS[1]!)];
    state.notices = [{ id: 45, cycle: 2, kind: "event", cardType: "context", title: "Frozen notice" }];
    deepFreeze(state);
    const before = JSON.stringify(state);
    expect(() => getGameView(state)).not.toThrow();
    expect(JSON.stringify(state)).toBe(before);
    expect(() => executeCommand(state, active(state).id, { type: "ROLL" })).toThrow();
    expect(JSON.stringify(state)).toBe(before);
  });

  it("advances text version 2 to 3 without rewriting current version 3 card catalogs", () => {
    const state = createGame(seats);
    state.cardRulesVersion = 3;
    state.eventTextVersion = 2;
    state.phase = "sector";
    active(state).sectorPosition = 0;
    state.deck = [clone(contextCatalog[0]!) as GameState["deck"][number]];
    state.boardEventDeck = [clone(BOARD_EVENT_CARDS[0]!)];
    state.boardEventDiscard = [clone(BOARD_EVENT_CARDS[1]!)];
    state.notices = [{ id: 45, cycle: 2, kind: "event", cardType: "context", title: "Existing notice" }];
    const expectedDeck = clone(state.deck);
    const expectedBoard = clone(state.boardEventDeck);
    const expectedDiscard = clone(state.boardEventDiscard);
    const existingNotice = clone(state.notices[0]!);
    const view = getGameView(state) as ReturnType<typeof getGameView> & { eventTextVersion?: number };
    expect(view.eventTextVersion).toBe(3);
    let call = 0;
    vi.spyOn(Math, "random").mockImplementation(() => call++ === 0 ? 0 : 0);
    let next: GameState;
    try {
      next = executeCommand(state, active(state).id, { type: "ROLL" });
    } finally {
      vi.restoreAllMocks();
    }
    expect(next.eventTextVersion).toBe(3);
    expect(next.deck).toEqual(expectedDeck);
    expect(next.boardEventDeck).toEqual(expectedBoard);
    expect(next.boardEventDiscard).toEqual(expectedDiscard);
    expect(next.notices[0]).toEqual(existingNotice);
  });

  it("ships 100 absolute-grade context cards with the approved shape and grade marginals", () => {
    expect(contextCatalog).toHaveLength(100);
    expect(new Set(contextCatalog.map((card) => String(card.id))).size).toBe(100);
    expect(contextCatalog.filter((card) => card.changes.length === 2)).toHaveLength(20);
    expect(contextCatalog.filter((card) => card.changes.length === 2 && card.changes.every((change) => change.grade === "B" || change.grade === "D"))).toHaveLength(20);
    expect(contextCatalog.filter((card) => card.changes.length === 4)).toHaveLength(80);
    expect(contextCatalog.filter((card) => card.changes.length === 4 && card.changes.every((change) => change.grade === "C"))).toHaveLength(10);
    expect(contextCatalog.filter((card) => card.changes.length === 4 && card.changes.some((change) => change.grade !== "C"))).toHaveLength(70);
    const changesByAxis = new Map<string, number>();
    const gradeCounts = Object.fromEntries(["A", "B", "C", "D", "E"].map((grade) => [grade, 0]));
    for (const card of contextCatalog) {
      const axisKeys = card.changes.map((change) => `${change.scope}:${change.id}`);
      expect(new Set(axisKeys).size, String(card.id)).toBe(axisKeys.length);
      for (const change of card.changes) {
        expect(["A", "B", "C", "D", "E"], `${card.id}:${change.id}`).toContain(change.grade);
        gradeCounts[change.grade] += 1;
        const key = `${change.scope}:${change.id}`;
        changesByAxis.set(key, (changesByAxis.get(key) ?? 0) + 1);
      }
    }
    expect(Object.fromEntries(changesByAxis)).toEqual(Object.fromEntries([
      ...["americas", "europe", "asia", "africa", "oceania"].map((id) => [`zone:${id}`, 36]),
      ...sectors.map((id) => [`sector:${id}`, 20]),
    ]));
    expect(gradeCounts).toEqual({ A: 10, B: 80, C: 180, D: 80, E: 10 });
    const mirror = { A: "E", B: "D", C: "C", D: "B", E: "A" } as const;
    const signature = (card: (typeof contextCatalog)[number]) => card.changes.map((change) => `${change.scope}:${change.id}:${change.grade}`).sort().join("|");
    const signatures = new Set(contextCatalog.map(signature));
    for (const [start, end] of [[1, 36], [71, 76], [81, 86], [91, 96]]) {
      for (let offset = 0; offset < (start === 1 ? 35 : 5); offset += 1) {
        const card = contextCatalog.find((item) => Number(item.id) === start + offset)!;
        const counterpart = contextCatalog.find((item) => Number(item.id) === end + offset)!;
        const mirrored = card.changes.map((change) => `${change.scope}:${change.id}:${mirror[change.grade]}`).sort().join("|");
        expect(signature(counterpart), `${card.id} ↔ ${counterpart.id}`).toBe(mirrored);
      }
    }
    expect(signatures.size).toBeGreaterThan(1);
  });
});
