import type { SeatConfig } from "@global-fund/shared";
import { nextSuggestedFundName } from "@global-fund/shared";
export { nextSuggestedFundName } from "@global-fund/shared";

export const isLegacyFundPlaceholder = (name: string) => /^(?:Fonds|Fond) \d+$/.test(name);

/** Replace only old generated placeholders; custom and blank names remain untouched. */
export function replaceLegacyFundPlaceholders(seats: SeatConfig[]): SeatConfig[] {
  const used = seats.filter((seat) => !isLegacyFundPlaceholder(seat.name)).map((seat) => seat.name);
  return seats.map((seat) => {
    if (!isLegacyFundPlaceholder(seat.name)) return seat;
    const name = nextSuggestedFundName(used);
    used.push(name);
    return { ...seat, name };
  });
}
