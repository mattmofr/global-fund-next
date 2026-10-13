import { describe, expect, it } from "vitest";
import { createGame, getGameView, executeCommand, priceFor } from "@global-fund/game-engine";
import { normalizeEconomy } from "../packages/game-engine/src/economy";
import baseline from "../docs/evolve-economy-v3-catalog.json";
import catalog from "../packages/game-engine/legacy/data/gameData.json";
import type { Company, SeatConfig } from "@global-fund/shared";

const seats: SeatConfig[] = [
  { name: "Alice", kind: "local", startingMarket: "europe", pawn: "lion", difficulty: "normal" },
  { name: "Bob", kind: "local", startingMarket: "americas", pawn: "bull", difficulty: "normal" },
];

describe("continuous economic progression", () => {
  it("does not jump in price or income at either category boundary", () => {
    for (const threshold of [40e9, 200e9]) {
      const pair = normalizeEconomy([
        { id: "below", marketCapUSD: threshold - 1 },
        { id: "at", marketCapUSD: threshold },
      ]);
      expect(pair[0].capCategory).not.toBe(pair[1].capCategory);
      expect(pair[0].basePrice).toBe(pair[1].basePrice);
      expect(pair[0].baseIncome).toBe(pair[1].baseIncome);
    }
  });

  it("adding a cheaper or larger company cannot reprice existing companies", () => {
    const existing = [{ id: "one", marketCapUSD: 12e9 }, { id: "two", marketCapUSD: 100e9 }];
    expect(normalizeEconomy([...existing, { id: "cheap", marketCapUSD: 1e8 }, { id: "large", marketCapUSD: 8e12 }]).slice(0, 2))
      .toEqual(normalizeEconomy(existing));
    expect(normalizeEconomy([{ id: "cheap", marketCapUSD: 1e8 }])[0].basePrice).toBe(25);
    expect(normalizeEconomy([{ id: "huge", marketCapUSD: 8e12 }])[0].basePrice).toBe(1500);
  });

  it("overlaps traded prices across categories when market conditions differ", () => {
    const game = createGame(seats);
    const [small, medium] = normalizeEconomy([
      { id: "small", marketCapUSD: 39e9, zone: "europe", sector: "technology" },
      { id: "medium", marketCapUSD: 41e9, zone: "americas", sector: "finance" },
    ]);
    game.zoneGrades.europe = "A"; game.sectorGrades.technology = "A";
    game.zoneGrades.americas = "D"; game.sectorGrades.finance = "D";
    expect(priceFor(small as Company, game)).toBeGreaterThan(priceFor(medium as Company, game));
  });

  it("preserves version 3 company identities, prices and holdings on read and command", () => {
    const state = createGame(seats);
    state.companies = baseline.companies.map(company => ({ ...company, holdings: {}, costBasis: {}, available: true })) as Company[];
    const old = state.companies.find(company => company.id === "pfizer-inc")!;
    old.holdings[state.players[0].id] = 2;
    old.costBasis![state.players[0].id] = 47;
    const before = structuredClone(old);
    const view = getGameView(state);
    expect(view.companies.find(company => company.id === old.id)).toMatchObject({ name: before.name, basePrice: before.basePrice, baseIncome: before.baseIncome, economyVersion: 3, holdings: before.holdings });
    const actor = state.players[state.activeIndex];
    const after = executeCommand(state, actor.id, { type: "ROLL" });
    expect(after.companies.find(company => company.id === old.id)).toMatchObject({ name: before.name, basePrice: before.basePrice, baseIncome: before.baseIncome, economyVersion: 3 });
    expect(state.companies.find(company => company.id === old.id)).toEqual(before);
  });

  it("keeps 91 companies and affordable Small choices in every market and sector", () => {
    expect(catalog.companies).toHaveLength(91);
    const small = catalog.companies.filter(company => company.capCategory === "small");
    for (const zone of catalog.zones) {
      const choices = small.filter(company => company.zone === zone.id);
      expect(choices.length, zone.id).toBeGreaterThanOrEqual(5);
      expect(choices.some(company => company.basePrice / 5 <= 15), zone.id).toBe(true);
    }
    for (const sector of catalog.sectors)
      expect(small.some(company => company.sector === sector.id), sector.id).toBe(true);
    // Travel and monopoly scarcity survive: catalogue coverage is not universal.
    expect(new Set(catalog.companies.map(company => `${company.zone}:${company.sector}`)).size).toBeLessThan(45);
  });
});
