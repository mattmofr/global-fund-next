import { money, signedMoney } from "./format";

/**
 * A static amount: Didone figures + a legible "M€" unit. Text content is
 * exactly money(value) (e.g. "1 234,50 M€"), so text lookups keep working.
 */
export function Money({ value, signed = false, className = "" }: { value: number; signed?: boolean; className?: string }) {
  const text = signed ? signedMoney(value) : money(value);
  const figures = text.slice(0, -" M€".length);
  return <span className={`gf-amount ${className}`}>{figures}<span className="money-unit"> M€</span></span>;
}
