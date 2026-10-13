import { describe, expect, it } from "vitest";
import type { Company, SeatConfig } from "@global-fund/shared";
import { createGame, getGameView } from "@global-fund/game-engine";
import { existsSync, readFileSync } from "node:fs";
import { capCategoryFor, normalizeEconomy, ECONOMY_SCENARIOS, SELECTED_ECONOMY_BANDS, ECONOMY_VERSION } from "../packages/game-engine/src/economy";
import v1 from "../docs/company-catalog-v1.json";
import catalog from "../packages/game-engine/legacy/data/gameData.json";
import audit from "../docs/company-audit-all.json";

const seats: SeatConfig[] = [
  { name: "Alice", kind: "local" as const, startingMarket: "europe" as const, pawn: "lion", difficulty: "normal" as const },
  { name: "Bob", kind: "ai" as const, startingMarket: "asia" as const, pawn: "bull", difficulty: "normal" as const },
];

describe("versioned company catalog", () => {
  it("keeps all 91 IDs with verified identities and separate real-cap metadata", () => {
    expect(catalog.companies).toHaveLength(91);
    expect(catalog.zones).toHaveLength(5);
    expect(catalog.sectors).toHaveLength(9);
    expect(v1.companies).toHaveLength(91);
    expect(audit.companies).toHaveLength(91);
    expect(new Set(catalog.companies.map((company) => company.id)).size).toBe(91);
    const before = new Map(v1.companies.map((company) => [company.id, company]));
    for (const company of catalog.companies) {
      const old = before.get(company.id);
      expect(old, `legacy ID ${company.id}`).toBeDefined();
      expect(company.basePrice).toBeGreaterThan(0);
      expect(company.baseIncome).toBeGreaterThan(0);
      expect(company.capCategory).toBe(capCategoryFor(company.marketCapUSD));
      expect(company.marketCapSource).toMatch(/^https:\/\//);
      expect(company.marketCapAsOf).toMatch(/^\d{4}-\d\d(?:-\d\d)?$/);
      expect(catalog.zones.some((zone) => zone.id === company.zone)).toBe(true);
      expect(catalog.sectors.some((sector) => sector.id === company.sector)).toBe(true);
      const evidence = audit.companies.find((item) => item.id === company.id)!;
      expect(evidence.currentName).toBe(company.name);
      expect(evidence.verifiedSourceURL).toMatch(/^https:\/\//);
      expect(["direct_page_content_accessed", "official_search_result_excerpt_only"]).toContain(evidence.evidence.status);
      if (evidence.evidence.status === "official_search_result_excerpt_only") expect(evidence.evidence.sourceVerified).toBe(false);
    }
    expect(catalog.companies.find((company) => company.id === "total-sa")?.name).toBe("TotalEnergies SE");
    const logos = catalog.companies.filter(company => company.logoPath);
    expect(logos.length).toBeGreaterThan(0);
    for (const company of logos) {
      expect(company.logoSource).toMatch(/^https:\/\//);
      const relativePath = company.logoPath!.replace(/^\//, "");
      expect(existsSync(`apps/web/public/${relativePath}`)).toBe(true);
      const bytes = readFileSync(`apps/web/public/${relativePath}`);
      expect(bytes.equals(readFileSync(relativePath))).toBe(true);
      if (relativePath.endsWith(".svg")) {
        expect(bytes.toString("utf8")).not.toMatch(/<script|<foreignObject|(?:href|src)=["']https?:/i);
      } else {
        expect(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
      }
    }
  });

  it("keeps retail assignments and adds verified Asian industrial companies", () => {
    for (const id of ["wal-mart-stores-inc", "walmex"])
      expect(catalog.companies.find((company) => company.id === id)?.sector).toBe("agrifood");
    const currentIndustrialNames: Record<string, string> = { gazprom: "Mitsubishi Heavy Industries (MHI)", "china-construction-bank-corp": "NITTO KOGYO CORPORATION", "astra-international": "FANUC Corporation" };
    for (const id of Object.keys(currentIndustrialNames)) {
      const company = catalog.companies.find((item) => item.id === id)!;
      expect(company.name).toBe(currentIndustrialNames[id]);
      expect(company.zone).toBe("asia");
      expect(company.sector).toBe("industry");
      expect(company.catalogVersion).toBe(id === "china-construction-bank-corp" ? 4 : 2);
      expect(company.legacyIdAliases).toContain(id);
      const row = audit.companies.find((item) => item.id === id)!;
      expect(row.evidence.sourceVerified).toBe(true);
    }
    for (const id of ["pacifica-minerals", "southern-cross-energy", "coral-reef-health", "pacific-link", "harbour-infrastructure", "oceanic-air", "southpoint-finance", "reef-data-systems", "austral-manufacturing", "sabmiller-plc", "general-electric"])
      expect(catalog.companies.find((company) => company.id === id)?.catalogVersion).toBe(2);
  });

  it("does not rewrite embedded companies when an older saved room is viewed", () => {
    const state = createGame(seats);
    state.companies = v1.companies.map((company) => ({
      ...company,
      holdings: {},
      available: true,
      price: company.basePrice,
      income: company.baseIncome,
      totalHeld: 0,
      sharesAvailable: 5,
      averageBuyPrice: {},
    })) as Company[];
    const view = getGameView(state);
    const oldCompany = v1.companies.find((company) => company.id === "general-electric")!;
    const visible = view.companies.find((company) => company.id === oldCompany.id)!;
    expect(visible.name).toBe(oldCompany.name);
    expect(visible.sector).toBe(oldCompany.sector);
    expect(visible.zone).toBe(oldCompany.zone);
    expect(visible.basePrice).toBe(oldCompany.basePrice);
    expect(visible.baseIncome).toBe(oldCompany.baseIncome);
    expect(visible.price).toBe(oldCompany.basePrice / 5);
    expect(visible.income).toBe(oldCompany.baseIncome / 5);
    expect(visible.capCategory).toBeUndefined();
  });

  it("has two verified real-estate groups without enlarging the catalog", () => {
    for (const [id, name, zone] of [
      ["agricultural-bank-of-china", "Sun Hung Kai Properties Limited", "asia"],
      ["industries-qatar", "Emaar Properties PJSC", "africa"],
    ]) {
      const company = catalog.companies.find(item => item.id === id)!;
      expect(company.name).toBe(name);
      expect(company.zone).toBe(zone);
      expect(company.sector).toBe("realestate");
      expect(company.catalogVersion).toBe(3);
    }
  });

  it("normalizes game values monotonically without allowing a Large share at opening C/C", () => {
    for (const scenario of Object.values(ECONOMY_SCENARIOS)) {
      const normalized = normalizeEconomy(catalog.companies, scenario).sort((a, b) => a.marketCapUSD - b.marketCapUSD);
      for (let index = 0; index < normalized.length; index += 1) {
        const company = normalized[index];
        if (index) expect(company.basePrice).toBeGreaterThanOrEqual(normalized[index - 1].basePrice);
        expect(company.baseIncome).toBeGreaterThan(0);
        expect(company.baseIncome).toBeLessThan(company.basePrice);
        if (company.capCategory === "large") expect(company.basePrice / 5).toBeGreaterThanOrEqual(100);
      }
    }
    expect(() => capCategoryFor(0)).toThrow();
    expect(() => capCategoryFor(Number.NaN)).toThrow();
  });

  it("publishes the measured economy for new games while preserving embedded legacy values", () => {
    const measured = normalizeEconomy(catalog.companies, SELECTED_ECONOMY_BANDS);
    const fresh = createGame(seats);
    for (const company of measured) {
      const actual = fresh.companies.find(item => item.id === company.id)!;
      expect(actual.basePrice).toBe(company.basePrice);
      expect(actual.baseIncome).toBe(company.baseIncome);
      expect(actual.economyVersion).toBe(ECONOMY_VERSION);
    }
  });
});
