/** French financial formatting shared by every screen. Display only. */
const money2 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent1 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** 1234.5 → "1 234,50 M€" (same output as @global-fund/ui formatMoney). */
export const money = (value: number) => `${money2.format(Number.isFinite(value) ? value : 0)} M€`;
/** Signed amount with a true minus sign: "+15,00 M€", "−3,20 M€", "0,00 M€". */
export const signedMoney = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${money2.format(Math.abs(Number.isFinite(value) ? value : 0))} M€`;
/** Unsigned magnitude, for flows whose direction is shown separately. */
export const absMoney = (value: number) => money(Math.abs(value));
/** "+4,2 %" / "−1,0 %". */
export const signedPercent = (value: number) => `${value >= 0 ? "+" : "−"}${percent1.format(Math.abs(value))} %`;
/** Tone class for a signed number. */
export const tone = (value: number) => (value > 0 ? "is-up" : value < 0 ? "is-down" : "is-flat");
/** "07" style two-digit counters. */
export const pad2 = (value: number) => String(value).padStart(2, "0");
