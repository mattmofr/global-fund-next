import type { Company, GameView, Grade } from "@global-fund/shared";

// Read-only projection of legacy/game.cjs valuation rules. Parity tests cover
// every grade pair, saved company bases and both ownership income guarantees.
const FACTOR: Record<Grade, number> = { A: 1.5, B: 1.25, C: 1, D: 0.75, E: 0.5 };
const round = (value: number) => Math.round(value * 100) / 100;

function ownershipFloor(company: Company, game: GameView, viewerId: string) {
  const group = game.companies.filter((item) => item.zone === company.zone && item.sector === company.sector);
  const monopoly = game.players.some((player) => player.id === viewerId) && group.length > 0 &&
    group.every((item) => Number(item.holdings[viewerId] ?? 0) === 5);
  if (monopoly) return "monopoly" as const;
  return Object.values(company.holdings).some((held) => Number(held) >= 5) ? "control" as const : "none" as const;
}

export interface CompanyGradeQuote {
  price: number;
  income: number;
  liquidated: boolean;
  incomeFloor: "none" | "control" | "monopoly";
}

/** Hypothetical price and holder income per 20% share, without changing game state. */
export function companyQuoteAtGrades(
  company: Company, game: GameView, viewerId: string, zoneGrade: Grade, sectorGrade: Grade,
): CompanyGradeQuote {
  const zoneFactor = FACTOR[zoneGrade] ?? FACTOR.C, sectorFactor = FACTOR[sectorGrade] ?? FACTOR.C;
  const price = round(Number(company.basePrice) / 5 * zoneFactor * sectorFactor);
  // E/E liquidates the position, including a controlled company or monopoly.
  // The displayed price is its indicative liquidation value, not a tradable quote.
  if (zoneGrade === "E" && sectorGrade === "E")
    return { price, income: 0, liquidated: true, incomeFloor: "none" };
  const incomeFloor = ownershipFloor(company, game, viewerId);
  const baseIncome = Number(company.baseIncome) / 5;
  const corporateIncome = round(Math.max(baseIncome * zoneFactor * sectorFactor, incomeFloor === "none" ? 0 : baseIncome));
  // The engine rounds corporate income before applying the holder's A/A floor.
  const income = round(Math.max(corporateIncome, incomeFloor === "monopoly" ? baseIncome * FACTOR.A * FACTOR.A : 0));
  return { price, income, liquidated: false, incomeFloor };
}

/** Prefer the server's current income; add only the holder-specific monopoly floor. */
export function companyCurrentIncome(company: Company, game: GameView, viewerId: string): number {
  if (!company.available || (game.zoneGrades[company.zone] === "E" && game.sectorGrades[company.sector] === "E")) return 0;
  const income = Number.isFinite(company.income) ? company.income : companyQuoteAtGrades(
    company, game, viewerId, game.zoneGrades[company.zone] ?? "C", game.sectorGrades[company.sector] ?? "C",
  ).income;
  return round(Math.max(income, ownershipFloor(company, game, viewerId) === "monopoly" ? Number(company.baseIncome) / 5 * FACTOR.A * FACTOR.A : 0));
}
