import { describe, expect, it } from "vitest";
import type { GameNotice, GameView, SeatConfig } from "@global-fund/shared";
import { createGame, getGameView } from "@global-fund/game-engine";
import { createIndustrySettlement } from "./fixtures/settlement";
import { PresentationSequence, PRESENTATION_TIMING as T, reverseNotice } from "../apps/web/src/presentation/sequence";

const seats: SeatConfig[] = [
  { name: "Alice", kind: "local", startingMarket: "europe" as const, pawn: "lion", difficulty: "normal" },
  { name: "Bob", kind: "local", startingMarket: "asia" as const, pawn: "bull", difficulty: "normal" },
];
const clone = <V,>(value: V): V => structuredClone(value);
function fixture(): GameView {
  const game = getGameView(createGame(seats));
  game.notices = [];
  game.players[0] = { ...game.players[0], cash: 10, fundValue: 50, valuation: 50, zone: "europe", currentMarket: "europe", position: 5, sectorPosition: 5, jailed: false, prisonStage: -1, prisonWait: false };
  game.players[1] = { ...game.players[1], cash: 30, fundValue: 30, valuation: 30 };
  game.companies[0] = { ...game.companies[0], price: 10, income: 1, holdings: { p1: 4 }, totalHeld: 4, sharesAvailable: 1, averageBuyPrice: { p1: 8 }, costBasis: { p1: 32 }, available: true };
  game.phase = "sector";
  game.activePlayerId = "p1";
  game.activeIndex = 0;
  return game;
}
function eventCase() {
  const before = fixture();
  const after = clone(before);
  after.players[0] = { ...after.players[0], cash: 16, fundValue: 56, valuation: 56, sectorPosition: 8, jailed: true, prisonStage: 0, prisonWait: true, previousZone: "europe", zone: "prison", currentMarket: null };
  after.phase = "awaitNext";
  const notice: GameNotice = { id: 1, cycle: 2, kind: "event", playerId: "p1", roll: 3, position: 8, cardType: "event", playerImpacts: [{ playerId: "p1", playerName: "Alice", cash: 6, valuation: 6, prison: true }] };
  after.notices = [notice];
  return { before, after, notice };
}
const through = (sequence: PresentationSequence, now: number): number[] => {
  const completed: number[] = [];
  while (sequence.deadline != null && sequence.deadline <= now) completed.push(...sequence.advance(sequence.deadline));
  return completed;
};
const ready = (sequence: PresentationSequence) => { through(sequence, 100_000); expect(sequence.stage).toBe("CARD_READING"); };

const finishCurrentCard = (sequence: PresentationSequence, now: number): number[] => {
  const frameIndex = sequence.index;
  const completed = [...sequence.continueCard(now)];
  let guard = 0;
  while (sequence.busy && sequence.index === frameIndex) {
    const deadline = sequence.deadline;
    if (deadline == null) return completed;
    completed.push(...sequence.advance(deadline));
    if (++guard > 20) throw new Error("card did not complete");
  }
  return completed;
};

describe("server result presentation", () => {
  it("restores pre-roll cash on reconnect when one creditor was already paid before a choice", () => {
    const state = createIndustrySettlement({ playerCount: 3, assetQuantity: 2, creditorCash: 100, debtorCash: 12 });
    const view = getGameView(state);
    expect(view.players[0].cash).toBe(2); // 12 starting cash minus first creditor's 10
    expect(view.pendingSettlement!.completed).toHaveLength(1);
    const sequence = new PresentationSequence(view, view.notices, undefined, 0);
    expect(sequence.frames[0].before.players[0].cash).toBe(12);
    expect(sequence.frames[0].before.players[2].cash).toBe(12);
    through(sequence, 100_000);
    expect(sequence.busy).toBe(false);
    expect(sequence.view().viewGame.players[0].cash).toBe(2);
    expect(sequence.view().viewGame.players[2].cash).toBe(22);
  });
  it.each([false, true])("keeps consequential card details readable until Continue, then completes without a financial panel (reduced motion: %s)", reducedMotion => {
    const { before, after, notice } = eventCase();
    const original = clone(after);
    const sequence = new PresentationSequence(after, [notice], before, 0, reducedMotion);
    ready(sequence);
    expect(sequence.stage).toBe("CARD_READING");
    expect(sequence.view().viewGame.players[0].cash).toBe(10);
    const acknowledged = sequence.continueCard(100_000);
    if (reducedMotion) expect(acknowledged).toEqual([1]);
    else {
      expect(acknowledged).toEqual([]);
      expect(sequence.stage).toBe("CARD_DISMISS");
      expect(through(sequence, 100_000 + T.dismiss)).toEqual([1]);
    }
    expect(sequence.view().viewGame.players[0].fundValue).toBe(56);
    expect(sequence.busy).toBe(false);
    expect(sequence.view().viewGame).toBe(after);
    expect(after).toEqual(original);
  });

  it.each([false, true])("acknowledges a small payment when its card closes, with no additional confirmation (reduced motion: %s)", reducedMotion => {
    const before = fixture();
    const after = clone(before);
    after.players[0].cash += 1; after.players[0].fundValue += 1;
    const notice: GameNotice = { id: 1, cycle: 2, kind: "payments", payments: [{ fromId: null, toId: "p1", amount: 1 }] };
    const sequence = new PresentationSequence(after, [notice], before, 0, reducedMotion);
    ready(sequence);
    const acknowledged = sequence.continueCard(100_000);
    if (reducedMotion) expect(acknowledged).toEqual([1]);
    else expect(through(sequence, 100_000 + T.dismiss)).toEqual([1]);
    expect(sequence.busy).toBe(false);
    expect(sequence.view().viewGame).toEqual(after);
  });

  it("keeps an unfunded obligation readable and completes its notice on Continue", () => {
    const before = fixture();
    const notice: GameNotice = {
      id: 3, cycle: 2, kind: "payments", title: "Case Industrie",
      obligations: [{ debtorId: "p1", creditorId: "p2", amount: 20, reason: "Case Industrie", sectorId: "industry", sectorLabel: "Industrie" }], payments: [],
    };
    const sequence = new PresentationSequence(clone(before), [notice], before, 0, true);
    ready(sequence);
    expect(sequence.currentCard?.obligations).toHaveLength(1);
    expect(sequence.continueCard(100_000)).toEqual([3]);
    expect(sequence.busy).toBe(false);
  });

  it("routes pending obligations to the settlement desk after motion without an extra announcement card", () => {
    const makePending = (reducedMotion: boolean) => {
      const before = fixture();
      const after = clone(before);
      after.players[0] = { ...after.players[0], position: 8, sectorPosition: 8 };
      after.phase = "settlement";
      after.pendingSettlement = {
        id: 7, debtorId: "p1", creditorId: "p2", amount: 20, reason: "Case Industrie",
        remainingAmount: 20, resumePhase: "sector", decisionActorId: "p1", status: "selectAssets",
        debts: [{ debtorId: "p1", creditorId: "p2", amount: 20, reason: "Case Industrie" }], completed: [], creditorOrder: ["p2"],
      };
      const notice: GameNotice = { id: 30, cycle: 2, kind: "payments", playerId: "p1", roll: 3, position: 8,
        obligations: [{ debtorId: "p1", creditorId: "p2", amount: 20, reason: "Case Industrie" }], payments: [] };
      const sequence = new PresentationSequence(after, [notice], before, 0, reducedMotion);
      return { sequence, notice };
    };

    const full = makePending(false);
    const sequence = full.sequence;
    expect(sequence.stage).toBe("BOARD_FOCUS");
    expect(sequence.currentCard).toBeNull();
    let acknowledged: number[] = [];
    let reachedReveal = false;
    let guard = 0;
    while (sequence.busy && sequence.deadline != null) {
      const deadline = sequence.deadline;
      acknowledged.push(...sequence.advance(deadline));
      expect(sequence.currentCard).toBeNull();
      if (sequence.stage === "SPACE_REVEAL") {
        reachedReveal = true;
        expect(acknowledged).toEqual([]);
        expect(sequence.busy).toBe(true);
      }
      if (++guard > 12) throw new Error("pending settlement did not finish its board motion");
    }
    expect(reachedReveal).toBe(true);
    expect(acknowledged).toEqual([full.notice.id]);
    expect(sequence.busy).toBe(false);
    expect(sequence.stage).toBe("TURN_END");

    const reduced = makePending(true);
    expect(reduced.sequence.stage).toBe("SPACE_REVEAL");
    expect(reduced.sequence.currentCard).toBeNull();
    expect(reduced.sequence.advance(0)).toEqual([reduced.notice.id]);
    expect(reduced.sequence.busy).toBe(false);
    expect(reduced.sequence.stage).toBe("TURN_END");

    const changed = makePending(false);
    expect(changed.sequence.advance(T.focus)).toEqual([]);
    expect(changed.sequence.stage).toBe("DICE_ROLLING");
    expect(changed.sequence.setReducedMotion(true, T.focus + 1)).toEqual([changed.notice.id]);
    expect(changed.sequence.currentCard).toBeNull();
    expect(changed.sequence.busy).toBe(false);
    expect(changed.sequence.stage).toBe("TURN_END");
  });

  it("shows one funded settlement receipt and acknowledges both source notices together", () => {
    const before = fixture();
    const after = clone(before);
    after.players[0] = { ...after.players[0], cash: 8, fundValue: 48, valuation: 48 };
    after.players[1] = { ...after.players[1], cash: 32, fundValue: 32, valuation: 32 };
    const debt = { debtorId: "p1", creditorId: "p2", amount: 2, reason: "Case Industrie" };
    const obligation: GameNotice = { id: 20, cycle: 2, kind: "payments", obligations: [debt], payments: [] };
    const receipt: GameNotice = { id: 21, cycle: 2, kind: "payments", settlements: [{ ...debt, cashAmount: 2, assets: [], marketSales: [] }], payments: [{ fromId: "p1", toId: "p2", amount: 2 }] };
    after.notices = [obligation, receipt];
    const sequence = new PresentationSequence(after, after.notices, before, 0, true);
    expect(sequence.frames).toHaveLength(1);
    expect(sequence.notice?.settlements).toHaveLength(1);
    expect(sequence.notice?.obligations).toBeUndefined();
    expect(sequence.view().viewGame.players[0].cash).toBe(10);
    expect(sequence.view().viewGame.players[1].cash).toBe(30);
    expect(sequence.continueCard(100_000)).toEqual([20, 21]);
    expect(sequence.busy).toBe(false);
    expect(sequence.view().viewGame).toBe(after);
  });

  it("automatically completes changed grades and prices, then exposes the exact server target", () => {
    const before = fixture();
    const after = clone(before);
    const company = after.companies[1];
    const zone = company.zone;
    const sector = company.sector;
    after.players[1] = { ...after.players[1], bot: true, fundValue: 37, cash: 37, valuation: 37 };
    after.zoneGrades[zone] = "B"; after.sectorGrades[sector] = "D";
    after.companies[1] = { ...company, price: company.price + 7 };
    const notice: GameNotice = { id: 17, cycle: 4, kind: "event", cardType: "context", playerId: "p2",
      gradeChanges: [{ scope: "zone", id: zone, before: "C", after: "B" }, { scope: "sector", id: sector, before: "C", after: "D" }],
      companyImpacts: [{ companyId: company.id, companyName: company.name, beforePrice: company.price, afterPrice: company.price + 7, bankruptcy: false, returned: false }] };
    after.notices = [notice];
    const exactTarget = clone(after);
    const sequence = new PresentationSequence(after, [notice], before, 0);
    ready(sequence); sequence.continueCard(100_000);
    through(sequence, 100_000 + T.dismiss);
    expect(sequence.stage).toBe("MARKET_IMPACT");
    expect(sequence.gradeImpact?.id).toBe(zone);
    through(sequence, 100_000 + T.dismiss + T.grade);
    expect(sequence.gradeImpact?.id).toBe(sector);
    through(sequence, 100_000 + T.dismiss + 2 * T.grade);
    expect(sequence.gradeImpact).toBeNull();
    expect(sequence.deadline).toBe(100_000 + T.dismiss + 2 * T.grade + T.prices);
    expect(sequence.view().viewGame.zoneGrades[zone]).toBe("B");
    expect(sequence.view().viewGame.sectorGrades[sector]).toBe("D");
    expect(sequence.view().viewGame.companies[1].price).toBe(company.price + 7);
    expect(through(sequence, sequence.deadline!)).toEqual([notice.id]);
    expect(sequence.busy).toBe(false);
    expect(sequence.view().viewGame).toEqual(exactTarget);
    expect(sequence.advance(1_000_000_000)).toEqual([]);
  });

  it.each([false, true])("automatically completes price-only impacts without a market notice (reduced motion: %s)", reducedMotion => {
    const before = fixture();
    const after = clone(before);
    const company = after.companies[0];
    after.companies[0] = { ...company, price: company.price + 3 };
    const notice: GameNotice = {
      id: 18,
      cycle: 4,
      kind: "event",
      companyImpacts: [{
        companyId: company.id,
        companyName: company.name,
        beforePrice: company.price,
        afterPrice: company.price + 3,
        bankruptcy: false,
        returned: false,
      }],
    };
    const sequence = new PresentationSequence(after, [notice], before, 0, reducedMotion);
    ready(sequence);
    const immediate = sequence.continueCard(100_000);
    if (reducedMotion) {
      expect(immediate).toEqual([notice.id]);
    } else {
      expect(immediate).toEqual([]);
      expect(through(sequence, 100_000 + T.dismiss)).toEqual([]);
      expect(sequence.stage).toBe("MARKET_IMPACT");
      expect(sequence.gradeImpact).toBeNull();
      expect(sequence.deadline).toBe(100_000 + T.dismiss + T.prices);
      expect(sequence.view().viewGame.companies[0].price).toBe(company.price + 3);
      expect(sequence.advance(sequence.deadline! - 1)).toEqual([]);
      expect(sequence.advance(sequence.deadline!)).toEqual([notice.id]);
    }
    expect(sequence.busy).toBe(false);
    expect(sequence.view().viewGame).toBe(after);
    expect(sequence.advance(1_000_000)).toEqual([]);
  });

  it("finishes grade and price reveals when reduced motion is enabled", () => {
    const { before, after, notice } = eventCase();
    notice.gradeChanges = [{ scope: "zone", id: "europe", before: "C", after: "B" }];
    const sequence = new PresentationSequence(after, [notice], before, 0);
    ready(sequence); sequence.continueCard(100_000);
    through(sequence, 100_000 + T.dismiss);
    expect(sequence.stage).toBe("MARKET_IMPACT");
    expect(sequence.gradeImpact?.id).toBe("europe");
    expect(sequence.setReducedMotion(true, 1_000_000)).toEqual([1]);
    expect(sequence.busy).toBe(false);
  });

  it("does not prolong a committed stage when fractional timers wake just before its deadline", () => {
    const { before, after, notice } = eventCase();
    notice.gradeChanges = [{ scope: "zone", id: "europe", before: "C", after: "B" }, { scope: "sector", id: "industry", before: "C", after: "D" }];
    const sequence = new PresentationSequence(after, [notice], before, 0);
    sequence.advance(T.focus);
    sequence.commit(200);
    const rollingDeadline = sequence.deadline!;
    const rollingEpoch = sequence.timeline!.diceStartedAt;
    sequence.advance(rollingDeadline - 0.5);
    sequence.commit(rollingDeadline - 0.4);
    expect(sequence.deadline).toBe(rollingDeadline);
    expect(sequence.timeline!.diceStartedAt).toBe(rollingEpoch);
    sequence.advance(rollingDeadline);
    expect(sequence.stage).toBe("DICE_RESULT");
    sequence.commit(rollingDeadline + 20);
    const resultDeadline = sequence.deadline!;
    sequence.advance(resultDeadline - 0.5);
    sequence.commit(resultDeadline - 0.4);
    expect(sequence.deadline).toBe(resultDeadline);
    sequence.advance(resultDeadline);
    expect(sequence.stage).toBe("PAWN_MOVING");
    ready(sequence);
    sequence.continueCard(100_000);
    sequence.advance(100_000 + T.dismiss);
    sequence.commit(100_000 + T.dismiss + 20);
    const gradeDeadline = sequence.deadline!;
    sequence.advance(gradeDeadline - 0.5);
    sequence.commit(gradeDeadline - 0.4);
    expect(sequence.deadline).toBe(gradeDeadline);
    sequence.advance(gradeDeadline);
    expect(sequence.gradeIndex).toBe(1);
    sequence.commit(gradeDeadline + 20);
    expect(sequence.deadline).toBe(gradeDeadline + 20 + T.grade);
    sequence.advance(gradeDeadline + 20 + T.grade);
    expect(sequence.gradeImpact).toBeNull();
    const priceDeadline = gradeDeadline + 20 + T.grade + T.prices;
    expect(sequence.deadline).toBe(priceDeadline);
    expect(sequence.advance(priceDeadline - 0.5)).toEqual([]);
    expect(sequence.deadline).toBe(priceDeadline);
    expect(sequence.advance(priceDeadline)).toEqual([notice.id]);
    expect(sequence.busy).toBe(false);
  });
  it("preserves each observable phase after late callbacks and rebases the board clock", () => {
    const { before, after, notice } = eventCase();
    const sequence = new PresentationSequence(after, [notice], before, 0);
    expect(sequence.advance(100_000)).toEqual([]);
    expect(sequence.stage).toBe("DICE_ROLLING");
    expect(sequence.timeline?.diceStartedAt).toBe(100_000);
    expect(sequence.deadline).toBe(100_000 + T.dice);
    sequence.advance(200_000);
    expect(sequence.stage).toBe("DICE_RESULT");
    expect(sequence.deadline).toBe(200_000 + T.result);
    sequence.advance(300_000);
    expect(sequence.stage).toBe("PAWN_MOVING");
    expect(sequence.timeline?.motionStartedAt).toBe(300_000);
    expect(sequence.deadline).toBe(300_000 + 3 * T.step);
    sequence.commit(350_000);
    expect(sequence.timeline?.motionStartedAt).toBe(350_000);
    expect(sequence.deadline).toBe(350_000 + 3 * T.step);
    sequence.advance(400_000);
    expect(sequence.stage).toBe("PAWN_ARRIVAL");
    expect(sequence.currentCard).toBeNull();
    sequence.advance(500_000);
    expect(sequence.stage).toBe("SPACE_REVEAL");
    sequence.advance(600_000);
    expect(sequence.stage).toBe("CARD_READING");
  });
  it("announces a new turn before exposing its idle decision stage", () => {
    const before = fixture();
    const after = clone(before);
    after.activePlayerId = "p2"; after.phase = "geography";
    const sequence = new PresentationSequence(after, [], before, 0);
    expect(sequence.stage).toBe("TURN_START");
    expect(through(sequence, T.focus)).toEqual([]);
    expect(sequence.stage).toBe("TRAVEL_DECISION");
  });
  it("keeps travel finances and the prior market history visible through the full flight", () => {
    const before = fixture();
    before.log = ["Prior turn"];
    before.marketHistory = [{ cycle: 1, label: "Prior", zoneGrades: clone(before.zoneGrades), sectorGrades: clone(before.sectorGrades), prices: {}, funds: {} }];
    const after = clone(before);
    after.players[0].zone = "asia"; after.players[0].currentMarket = "asia"; after.players[0].cash = 9; after.players[0].fundValue = 49;
    after.log.push("Flight completed");
    after.marketHistory.push({ ...clone(before.marketHistory[0]), cycle: 2, label: "Future" });
    const notice: GameNotice = { id: 1, cycle: 2, kind: "payments", action: "move", playerId: "p1", fromZoneId: "europe", zoneId: "asia", payments: [{ fromId: "p1", toId: null, amount: 1 }] };
    const sequence = new PresentationSequence(after, [notice], before, 0);
    expect(sequence.stage).toBe("TRAVEL_RESOLUTION");
    expect(sequence.view().boardGame.players[0].zone).toBe("asia");
    expect(sequence.view().boardGame.players[0].currentMarket).toBe("asia");
    expect(sequence.view().viewGame.players[0].zone).toBe("europe");
    expect(sequence.view().viewGame.players[0].currentMarket).toBe("europe");
    expect(sequence.view().boardGame.players[0].cash).toBe(10);
    through(sequence, T.travel - 1);
    expect(sequence.currentCard).toBeNull();
    expect(sequence.view().viewGame.players[0].zone).toBe("europe");
    expect(sequence.view().viewGame.players[0].cash).toBe(10);
    expect(sequence.view().viewGame.marketHistory).toEqual(before.marketHistory);
    expect(sequence.view().viewGame.log).toEqual(before.log);
    through(sequence, T.travel);
    expect(sequence.currentCard?.id).toBe(1);
    expect(sequence.view().boardGame.players[0].zone).toBe("asia");
    expect(sequence.view().viewGame.players[0].zone).toBe("europe");
    expect(sequence.view().viewGame.players[0].cash).toBe(10);
    const resumed = reverseNotice(after, notice);
    expect(resumed.players[0].zone).toBe("europe");
    expect(resumed.players[0].currentMarket).toBe("europe");
    expect(resumed.players[0].cash).toBe(10);
  });

  it("switches motion off without bypassing reading or acknowledging effects early", () => {
    const { before, after, notice } = eventCase();
    const sequence = new PresentationSequence(after, [notice], before, 0);
    through(sequence, T.focus);
    expect(sequence.setReducedMotion(true, T.focus + 1)).toEqual([]);
    expect(sequence.stage).toBe("CARD_READING");
    expect(sequence.view().viewGame.players[0].cash).toBe(10);
    expect(sequence.continueCard(T.focus + 2)).toEqual([1]);
    expect(sequence.busy).toBe(false);
    expect(sequence.deadline).toBeNull();
    expect(sequence.advance(T.focus + 100_000)).toEqual([]);
    expect(sequence.view().viewGame).toBe(after);
  });

  it("ends the die before movement and preserves the authoritative snapshot", () => {
    const { before, after, notice } = eventCase();
    const original = clone(after);
    const sequence = new PresentationSequence(after, [notice], before, 0);
    expect(sequence.stage).toBe("BOARD_FOCUS");
    through(sequence, T.focus);
    expect(sequence.stage).toBe("DICE_ROLLING");
    expect(sequence.view().boardGame.players[0].sectorPosition).toBe(5);
    through(sequence, T.focus + T.dice);
    expect(sequence.stage).toBe("DICE_RESULT");
    expect(sequence.view().boardGame.players[0].sectorPosition).toBe(5);
    through(sequence, T.focus + T.dice + T.result - 1);
    expect(sequence.stage).toBe("DICE_RESULT");
    through(sequence, T.focus + T.dice + T.result);
    expect(sequence.stage).toBe("PAWN_MOVING");
    expect(sequence.view().boardGame.players[0].sectorPosition).toBe(8);
    expect(sequence.view().viewGame.players[0].cash).toBe(10);
    through(sequence, T.focus + T.dice + T.result + 3 * T.step);
    expect(sequence.stage).toBe("PAWN_ARRIVAL");
    through(sequence, T.focus + T.dice + T.result + 3 * T.step + T.arrival);
    expect(sequence.stage).toBe("SPACE_REVEAL");
    expect(sequence.timeline?.motionStartedAt).toBe(T.focus + T.dice + T.result);
    expect(after).toEqual(original);
  });

  it("holds exact live finances, purchase averages and prison flags throughout reading, then exposes the exact server view", () => {
    const { before, after, notice } = eventCase();
    const sequence = new PresentationSequence(after, [notice], before, 0);
    ready(sequence);
    const view = sequence.view().viewGame;
    expect(view.players[0]).toEqual({ ...before.players[0], position: 8, sectorPosition: 8 });
    expect(view.companies).toEqual(before.companies);
    expect(view.zoneGrades).toEqual(before.zoneGrades);
    expect(view.marketHistory).toEqual(before.marketHistory);
    expect(through(sequence, 200_000)).toEqual([]);
    expect(sequence.continueCard(200_000)).toEqual([]);
    expect(sequence.stage).toBe("CARD_DISMISS");
    expect(sequence.view().viewGame.players[0].cash).toBe(10);
    expect(through(sequence, 200_000 + T.dismiss)).toEqual([1]);
    expect(sequence.view().viewGame.players[0].cash).toBe(16);
    expect(sequence.view().viewGame).toBe(after);
    expect(sequence.busy).toBe(false);
  });

  it("animates received notes one by one, then prices, then fund values", () => {
    const before = fixture();
    const after = clone(before);
    const zone = after.companies[0].zone;
    const sector = after.companies[0].sector;
    const notice: GameNotice = { id: 9, cycle: 2, kind: "event", cardType: "context", gradeChanges: [{ scope: "zone", id: zone, before: "C", after: "B" }, { scope: "sector", id: sector, before: "C", after: "D" }], companyImpacts: [{ companyId: after.companies[0].id, companyName: "Company", beforePrice: 10, afterPrice: 12, bankruptcy: false, returned: false }], playerImpacts: [{ playerId: "p1", playerName: "Alice", cash: 0, valuation: 8, prison: null }] };
    before.zoneGrades[zone] = "C"; before.sectorGrades[sector] = "C";
    after.zoneGrades[zone] = "B"; after.sectorGrades[sector] = "D";
    after.companies[0].price = 12;
    after.players[0].fundValue = 58;
    const sequence = new PresentationSequence(after, [notice], before, 0);
    ready(sequence); sequence.continueCard(100_000);
    through(sequence, 100_000 + T.dismiss);
    expect(sequence.gradeImpact?.id).toBe(zone);
    expect(sequence.view().viewGame.sectorGrades[sector]).toBe("C");
    expect(sequence.view().viewGame.companies[0].price).toBe(10);
    through(sequence, 100_000 + T.dismiss + T.grade);
    expect(sequence.gradeImpact?.id).toBe(sector);
    expect(sequence.view().viewGame.sectorGrades[sector]).toBe("D");
    through(sequence, 100_000 + T.dismiss + 2 * T.grade);
    expect(sequence.view().viewGame.companies[0].price).toBe(12);
    expect(sequence.view().viewGame.players[0].fundValue).toBe(58);
    expect(through(sequence, 100_000 + T.dismiss + 2 * T.grade + T.prices)).toEqual([notice.id]);
    expect(sequence.busy).toBe(false);
    expect(sequence.view().viewGame.players[0].fundValue).toBe(58);
  });

  it("does not invent note changes for an event and acknowledges only at the end", () => {
    const { before, after, notice } = eventCase();
    const sequence = new PresentationSequence(after, [notice], before, 0);
    ready(sequence); sequence.continueCard(100_000);
    expect(through(sequence, 100_000 + T.dismiss)).toEqual([notice.id]);
    expect(sequence.gradeImpact).toBeNull();
    expect(sequence.view().viewGame.zoneGrades).toEqual(before.zoneGrades);
    expect(sequence.busy).toBe(false);
    expect(sequence.view().viewGame).toBe(after);
  });

  it("reads multiple notices from one roll without replaying die or movement", () => {
    const { before, after, notice } = eventCase();
    const payment: GameNotice = { id: 2, cycle: 2, kind: "payments", roll: 3, position: 8, playerId: "p1", payments: [{ fromId: "p1", toId: "p2", amount: 2 }] };
    after.players[0].cash -= 2; after.players[0].fundValue -= 2; after.players[0].valuation! -= 2;
    after.players[1].cash += 2; after.players[1].fundValue += 2; after.players[1].valuation! += 2;
    after.notices = [notice, payment];
    const sequence = new PresentationSequence(after, after.notices, before, 0);
    ready(sequence);
    expect(finishCurrentCard(sequence, 100_000)).toEqual([1]);
    expect(sequence.stage).toBe("SPACE_REVEAL");
    const nextAt = sequence.deadline!;
    through(sequence, nextAt);
    expect(sequence.stage).toBe("CARD_READING");
    expect(sequence.view().viewGame.players[0].cash).toBe(16);
    expect(finishCurrentCard(sequence, nextAt)).toEqual([2]);
    expect(sequence.view().viewGame).toBe(after);
  });

  it("replays distinct reconnect rolls with their actors, while duplicate payment signatures share one die", () => {
    const before = fixture();
    before.players[1].position = before.players[1].sectorPosition = 20;
    const after = clone(before);
    after.players[0].position = after.players[0].sectorPosition = 8;
    after.players[1].position = after.players[1].sectorPosition = 22;
    after.activePlayerId = "p2";
    const notices: GameNotice[] = [
      { id: 1, cycle: 2, kind: "event", roll: 3, position: 8 },
      { id: 2, cycle: 2, kind: "payments", playerId: "p1", roll: 3, position: 8, payments: [] },
      { id: 3, cycle: 2, kind: "payments", playerId: "p1", roll: 3, position: 8, payments: [] },
      { id: 4, cycle: 2, kind: "event", playerId: "p2", roll: 2, position: 22 },
      { id: 5, cycle: 2, kind: "payments", playerId: "p2", roll: 2, position: 22, payments: [] },
    ];
    const sequence = new PresentationSequence(after, notices, undefined, 0);
    expect(sequence.timeline?.playerId).toBe("p1");
    expect(sequence.notice?.playerId).toBe("p1");
    expect(sequence.view().boardGame.players[1].sectorPosition).toBe(20);
    ready(sequence);
    let now = 100_000;
    const finish = () => finishCurrentCard(sequence, now);
    expect(finish()).toEqual([1]);
    expect(sequence.stage).toBe("SPACE_REVEAL");
    now = sequence.deadline!; through(sequence, now);
    expect(sequence.timeline?.noticeId).toBe(1);
    expect(finish()).toEqual([2]);
    expect(sequence.stage).toBe("SPACE_REVEAL");
    now = sequence.deadline!; through(sequence, now);
    expect(finish()).toEqual([3]);
    expect(sequence.stage).toBe("BOARD_FOCUS");
    expect(sequence.timeline).toMatchObject({ noticeId: 4, playerId: "p2", fromPosition: 20, toPosition: 22, roll: 2 });
    expect(sequence.view().boardGame.players[0].sectorPosition).toBe(8);
    expect(sequence.view().boardGame.players[1].sectorPosition).toBe(20);
    now = sequence.deadline!; through(sequence, now);
    expect(sequence.stage).toBe("DICE_ROLLING");
    now = sequence.deadline!; through(sequence, now);
    expect(sequence.stage).toBe("DICE_RESULT");
    now = sequence.deadline!; through(sequence, now);
    expect(sequence.stage).toBe("PAWN_MOVING");
    expect(sequence.view().boardGame.players[1].sectorPosition).toBe(22);
  });

  it("restores forced sale holdings and subtracts sale proceeds when reversing a payment", () => {
    const before = fixture();
    const after = clone(before);
    after.players[0].cash = 5; after.players[0].fundValue = 25; after.players[0].valuation = 25;
    after.companies[0].holdings.p1 = 2; after.companies[0].totalHeld = 2; after.companies[0].sharesAvailable = 3; after.companies[0].costBasis!.p1 = 16;
    const notice: GameNotice = { id: 1, cycle: 2, kind: "payments", payments: [{ fromId: "p1", toId: null, amount: 25, forcedSales: [{ companyId: after.companies[0].id, companyName: "Company", quantity: 2, perShare: 10, amount: 20 }] }] };
    const restored = reverseNotice(after, notice, before);
    expect(restored.players[0].cash).toBe(10);
    expect(restored.players[0].fundValue).toBe(50);
    expect(restored.companies[0].holdings.p1).toBe(4);
    expect(restored.companies[0].averageBuyPrice.p1).toBe(8);
    expect(restored.companies[0].costBasis!.p1).toBe(32);
  });

  it("reconstructs bankruptcy and return prices and shares from unread notices on reconnect", () => {
    const after = fixture();
    const id = after.companies[0].id;
    after.companies[0] = { ...after.companies[0], available: false, price: 0, income: 0, holdings: {}, averageBuyPrice: {}, costBasis: {}, totalHeld: 0, sharesAvailable: 0 };
    after.players[0].fundValue = 10;
    const notice: GameNotice = { id: 1, cycle: 2, kind: "event", companyImpacts: [{ companyId: id, companyName: "Company", beforePrice: 10, afterPrice: 0, bankruptcy: true, returned: false, sharesChanged: [{ playerId: "p1", playerName: "Alice", before: 4, after: 0 }] }], playerImpacts: [{ playerId: "p1", playerName: "Alice", cash: 0, valuation: -40, prison: null, sharesSold: [{ companyId: id, companyName: "Company", quantity: 4 }] }] };
    const sequence = new PresentationSequence(after, [notice], undefined, 0, true);
    const company = sequence.view().viewGame.companies[0];
    expect(company.price).toBe(10); expect(company.available).toBe(true); expect(company.holdings.p1).toBe(4);
    expect(company.averageBuyPrice.p1).toBeNull();
    expect(sequence.view().viewGame.players[0].fundValue).toBe(50);
    expect(finishCurrentCard(sequence, 0)).toEqual([1]);
    expect(sequence.view().viewGame).toBe(after);
    const returned = reverseNotice(fixture(), { id: 2, cycle: 2, kind: "event", companyImpacts: [{ companyId: id, companyName: "Company", beforePrice: 0, afterPrice: 10, bankruptcy: false, returned: true }] });
    expect(returned.companies[0].available).toBe(false);
    expect(returned.companies[0].price).toBe(0);
  });

  it("uses an exact previous prison snapshot even when the trial has no ledger", () => {
    const before = fixture();
    before.players[0] = { ...before.players[0], jailed: true, prisonStage: 2, prisonWait: true, previousZone: "europe", zone: "prison", currentMarket: null, cash: 3, fundValue: 43, valuation: 43 };
    const after = clone(before);
    after.players[0] = { ...after.players[0], jailed: false, prisonStage: -1, prisonWait: false, zone: "europe", currentMarket: "europe", previousZone: undefined, cash: 8, fundValue: 38, valuation: 38 };
    after.companies[0].holdings.p1 = 3;
    const notice: GameNotice = { id: 1, cycle: 2, kind: "event", action: "prisonRoll", playerId: "p1", roll: 1 };
    const sequence = new PresentationSequence(after, [notice], before, 0, true);
    expect(sequence.view().viewGame.players[0]).toEqual(before.players[0]);
    expect(sequence.view().viewGame.companies).toEqual(before.companies);
    expect(finishCurrentCard(sequence, 0)).toEqual([1]);
    expect(sequence.view().viewGame).toBe(after);
  });

  it("attributes lap capital once, before the event, without duplicating its delayed payment", () => {
    const before = fixture();
    const after = clone(before);
    after.players[0].cash = 35; after.players[0].fundValue = 75; after.players[0].valuation = 75;
    const notices: GameNotice[] = [
      { id: 1, cycle: 2, kind: "event", action: "lap", playerId: "p1" },
      { id: 2, cycle: 2, kind: "event", playerId: "p1", roll: 6, position: 3, playerImpacts: [{ playerId: "p1", playerName: "Alice", cash: 5, valuation: 5, prison: null }] },
      { id: 3, cycle: 2, kind: "payments", playerId: "p1", roll: 6, position: 3, payments: [{ fromId: null, toId: "p1", amount: 20, reason: "Performance au Départ" }] },
    ];
    const sequence = new PresentationSequence(after, notices, before, 0, true);
    expect(sequence.notice?.payments).toEqual(notices[2].payments);
    expect(notices[0].payments).toBeUndefined();
    expect(notices[2].payments).toHaveLength(1);
    expect(sequence.view().viewGame.players[0].cash).toBe(10);
    expect(finishCurrentCard(sequence, 0)).toEqual([1]);
    expect(sequence.view().viewGame.players[0].cash).toBe(30);
    expect(finishCurrentCard(sequence, 0)).toEqual([2]);
    expect(sequence.view().viewGame.players[0].cash).toBe(35);
    expect(sequence.notice?.payments).toEqual([]);
    expect(notices[2].payments).toHaveLength(1);
    expect(finishCurrentCard(sequence, 0)).toEqual([3]);
    expect(sequence.view().viewGame).toBe(after);
  });

  it("assigns each historical lap its own capital payment rather than combining different cycles", () => {
    const after = fixture();
    const notices: GameNotice[] = [
      { id: 1, cycle: 2, kind: "event", action: "lap", playerId: "p1" },
      { id: 2, cycle: 2, kind: "event", playerId: "p1", roll: 6, position: 3 },
      { id: 3, cycle: 2, kind: "payments", playerId: "p1", roll: 6, position: 3, payments: [{ fromId: null, toId: "p1", amount: 20, reason: "Performance au Départ" }] },
      { id: 4, cycle: 3, kind: "event", action: "lap", playerId: "p1" },
      { id: 5, cycle: 3, kind: "event", playerId: "p1", roll: 5, position: 2 },
      { id: 6, cycle: 3, kind: "payments", playerId: "p1", roll: 5, position: 2, payments: [{ fromId: "p1", toId: null, amount: 20, reason: "Performance au Départ" }] },
    ];
    const sequence = new PresentationSequence(after, notices, undefined, 0, true);
    expect(sequence.view().viewGame.players[0].cash).toBe(10);
    expect(finishCurrentCard(sequence, 0)).toEqual([1]);
    expect(sequence.view().viewGame.players[0].cash).toBe(30);
    finishCurrentCard(sequence, 0); finishCurrentCard(sequence, 0);
    expect(sequence.notice?.id).toBe(4);
    expect(sequence.view().viewGame.players[0].cash).toBe(30);
    expect(finishCurrentCard(sequence, 0)).toEqual([4]);
    expect(sequence.view().viewGame.players[0].cash).toBe(10);
  });
});
