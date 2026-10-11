import type { Company, HistoryPoint } from "@global-fund/shared";
import { money } from "../ui/format";
import "./FinancialTicker.css";

interface FinancialTickerProps {
  companies: Company[];
  history: HistoryPoint[];
  /** Latest line of the financial wire (game log), shown as one discreet line. */
  wire?: string;
}

/** A low motion financial tape using live server quotes and recorded market history. */
export function FinancialTicker({ companies, history, wire }: FinancialTickerProps) {
  const available = companies.filter(company => company.available);
  const previous = history.at(-2)?.prices;
  const latest = history.at(-1)?.prices;
  const entries = available.map(company => {
    const before = previous?.[company.id];
    const after = latest?.[company.id];
    return { company, delta: before != null && after != null ? after - before : null };
  });

  if (!entries.length) return null;
  const tape = (copy: boolean) => <div className="financial-ticker__group" aria-hidden={copy || undefined}>
    {entries.map(({ company, delta }) => <span className="financial-ticker__quote" key={company.id}>
      <b>{company.ticker ?? company.name}</b>
      <strong>{money(company.price)}</strong>
      {delta != null && <i className={delta < 0 ? "negative" : delta > 0 ? "positive" : "flat"}>
        {delta < 0 ? "▼" : delta > 0 ? "▲" : "•"} {money(Math.abs(delta))}
      </i>}
    </span>)}
  </div>;

  return <section className="financial-ticker" aria-label="Cours du marché">
    <span className="financial-ticker__label">GLOBAL EXCHANGE</span>
    {wire && <p className="financial-ticker__wire" title={wire}><span className="sr-only">Fil financier : </span>{wire}</p>}
    <div className="financial-ticker__viewport">
      <div className="financial-ticker__track" tabIndex={0} style={{ animationDuration: `${Math.max(90, entries.length * 6)}s` }}>
        {tape(false)}
        {tape(true)}
      </div>
    </div>
  </section>;
}
