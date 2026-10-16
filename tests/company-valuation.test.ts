import { describe, expect, it } from "vitest";
import { createGame, getGameView, incomeForHolder, priceFor } from "@global-fund/game-engine";
import type { Grade } from "@global-fund/shared";
import { companyCurrentIncome, companyQuoteAtGrades } from "../apps/web/src/trading/companyValuation";

const grades: Grade[] = ["A", "B", "C", "D", "E"];
function fixture() {
  const state = createGame([
    { name: "Test A", kind: "local", startingMarket: "europe", pawn: "lion", difficulty: "normal" },
    { name: "Test B", kind: "local", startingMarket: "asia", pawn: "bull", difficulty: "normal" },
  ]);
  const company = state.companies.find((item) => state.companies.filter((peer) => peer.zone === item.zone && peer.sector === item.sector).length > 1)!;
  return { state, company, viewerId: state.players[0].id, otherId: state.players[1].id };
}

describe("company valuation display", () => {
  for (const ownership of ["partial", "control", "monopoly", "otherOwner"] as const) {
    it(`matches engine prices and income for every grade pair with ${ownership}`, () => {
      const { state, company, viewerId, otherId } = fixture();
      // Include old/custom saved bases and a half-cent rounding boundary.
      company.basePrice = 123.456; company.baseIncome = 17.825;
      company.holdings = ownership === "otherOwner" ? { [otherId]: 5 } : { [viewerId]: ownership === "partial" ? 2 : 5 };
      if (ownership === "monopoly") for (const peer of state.companies.filter((item) => item.zone === company.zone && item.sector === company.sector)) peer.holdings = { [viewerId]: 5 };
      for (const zone of grades) for (const sector of grades) {
        state.zoneGrades[company.zone] = zone; state.sectorGrades[company.sector] = sector;
        const view = getGameView(state);
        const displayed = view.companies.find((item) => item.id === company.id)!;
        const before = structuredClone(view);
        const quote = companyQuoteAtGrades(displayed, view, viewerId, zone, sector);
        expect(quote.price).toBe(priceFor(company, state));
        if (zone === "E" && sector === "E") {
          expect(quote.liquidated).toBe(true); expect(quote.income).toBe(0);
          expect(quote.incomeFloor).toBe("none");
        } else {
          expect(quote.liquidated).toBe(false);
          expect(quote.income).toBe(incomeForHolder(company, state, viewerId));
          expect(companyCurrentIncome(displayed, view, viewerId)).toBe(incomeForHolder(company, state, viewerId));
        }
        expect(view).toEqual(before);
      }
    });
  }

  it("uses the authoritative current income and stops showing income for unavailable companies", () => {
    const { state, company, viewerId } = fixture();
    const view = getGameView(state), displayed = view.companies.find((item) => item.id === company.id)!;
    displayed.income = 7.89;
    expect(companyCurrentIncome(displayed, view, viewerId)).toBe(7.89);
    displayed.available = false;
    expect(companyCurrentIncome(displayed, view, viewerId)).toBe(0);
  });
});
