/** Game categories for this major-company universe; these are not exchange small-cap definitions. */
export type CapCategory = "small" | "medium" | "large";
export const ECONOMY_VERSION = 4;
export const CAP_THRESHOLDS_USD = { medium: 40_000_000_000, large: 200_000_000_000 } as const;
export interface EconomyBands {
  small: readonly [number, number];
  medium: readonly [number, number];
  large: readonly [number, number];
  /** Full-company income / full-company price at C/C, per matching sector landing. */
  yields: Record<CapCategory, number>;
  /** Fixed continuous curve; category boundaries never introduce price jumps. */
  pricing?: "continuous";
}
export const ECONOMY_SCENARIOS: Record<string, EconomyBands> = {
  "continuous-progression": { small: [25, 183], medium: [183, 500], large: [500, 1500], yields: { small: .10, medium: .12, large: .14 }, pricing: "continuous" },
  "progression-growth": { small: [25, 100], medium: [180, 450], large: [550, 1500], yields: { small: .10, medium: .12, large: .14 } },
  progression: { small: [25, 100], medium: [180, 450], large: [550, 1500], yields: { small: .06, medium: .07, large: .08 } },
  conservative: { small: [25, 150], medium: [200, 600], large: [750, 2500], yields: { small: .06, medium: .05, large: .04 } },
  growth: { small: [25, 120], medium: [180, 500], large: [650, 2000], yields: { small: .1, medium: .08, large: .06 } },
  accessible: { small: [25, 100], medium: [150, 400], large: [500, 1500], yields: { small: .14, medium: .1, large: .08 } },
};
export const SELECTED_ECONOMY_SCENARIO = "continuous-progression";
export const SELECTED_ECONOMY_BANDS = ECONOMY_SCENARIOS[SELECTED_ECONOMY_SCENARIO];

export function capCategoryFor(marketCapUSD: number): CapCategory {
  if (!Number.isFinite(marketCapUSD) || marketCapUSD <= 0) throw new Error("Capitalisation positive requise.");
  return marketCapUSD < CAP_THRESHOLDS_USD.medium ? "small" : marketCapUSD < CAP_THRESHOLDS_USD.large ? "medium" : "large";
}
const round = (value: number) => Math.round(value * 100) / 100;

/** New games use a fixed curve; older band scenarios remain available for research. */
export function normalizeEconomy<T extends { id: string; marketCapUSD: number }>(companies: T[], bands: EconomyBands = SELECTED_ECONOMY_BANDS) {
  if (bands.pricing === "continuous") {
    return companies.map(company => {
      const capCategory = capCategoryFor(company.marketCapUSD);
      // 200 B USD -> 500 M€ for all five shares. Fixed anchors make adding a
      // company independent of prices already assigned to other companies.
      const basePrice = round(Math.max(25, Math.min(1500,
        500 * Math.log1p(company.marketCapUSD / 50_000_000_000) / Math.log(5))));
      const incomeYield = .10 + .04 * -Math.expm1(-company.marketCapUSD / 200_000_000_000);
      return { ...company, capCategory, basePrice, baseIncome: round(basePrice * incomeYield), economyVersion: ECONOMY_VERSION };
    });
  }
  const logs = Object.fromEntries((["small", "medium", "large"] as const).map(category => {
    const values = companies.filter(company => capCategoryFor(company.marketCapUSD) === category).map(company => Math.log10(company.marketCapUSD));
    return [category, values.length ? [Math.min(...values), Math.max(...values)] : [0, 0]];
  })) as Record<CapCategory, [number, number]>;
  return companies.map(company => {
    const capCategory = capCategoryFor(company.marketCapUSD);
    const [minimum, maximum] = logs[capCategory];
    const position = maximum === minimum ? .5 : Math.max(0, Math.min(1, (Math.log10(company.marketCapUSD) - minimum) / (maximum - minimum)));
    const [low, high] = bands[capCategory];
    const basePrice = Math.round((low + (high - low) * position) * 100) / 100;
    const baseIncome = Math.round(basePrice * bands.yields[capCategory] * 100) / 100;
    return { ...company, capCategory, basePrice, baseIncome, economyVersion: ECONOMY_VERSION };
  });
}
