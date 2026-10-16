import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { Company, GameView, Grade } from "@global-fund/shared";
import { useDialogFocus } from "../presentation/useDialogFocus";
import { GradeJewel } from "../ui/GradeJewel";
import { money } from "../ui/format";
import { companyQuoteAtGrades } from "./companyValuation";
import "./company-valuation-dialog.css";

type Props = {
  company: Company;
  game: GameView;
  viewerId: string;
  zoneGrade: Grade;
  sectorGrade: Grade;
  onClose: () => void;
};

const GRADES: Grade[] = ["A", "B", "C", "D", "E"];
const floorLabel = (floor: "none" | "control" | "monopoly") => floor === "control"
  ? "Plancher C/C · contrôle"
  : floor === "monopoly" ? "Plancher A/A · monopole" : null;

/** Read-only valuation matrix; the dialog is portalled outside the animated trading terminal. */
export default function CompanyValuationDialog({ company, game, viewerId, zoneGrade, sectorGrade, onClose }: Props) {
  const dialog = useDialogFocus(onClose);
  const currentQuote = companyQuoteAtGrades(company, game, viewerId, zoneGrade, sectorGrade);
  const cells = GRADES.flatMap((zone) => GRADES.map((sector) => ({
    zone,
    sector,
    quote: companyQuoteAtGrades(company, game, viewerId, zone, sector),
    current: zone === zoneGrade && sector === sectorGrade,
  })));

  return createPortal(
    <div className="shell-modal-backdrop company-valuation-backdrop" role="dialog" aria-modal="true" aria-label="Abaque prix/revenu">
      <section ref={dialog} tabIndex={-1} className="shell-modal company-valuation-modal gf-glass" aria-label="Abaque prix/revenu">
        <header className="shell-modal__head company-valuation-head">
          <div>
            <span className="gf-kicker">Fiche valeur · {company.name}</span>
            <h2>Abaque prix/revenu</h2>
            <p className="company-valuation-subtitle">Prix et revenu par part selon les notes de zone et de secteur.</p>
          </div>
          <button type="button" className="gf-icon-btn shell-modal__close" aria-label="Fermer l’abaque prix/revenu" onClick={onClose}>
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <div className="company-valuation-current" role="status">
          <span>Notes actuelles</span>
          <span className="company-valuation-grade"><GradeJewel grade={zoneGrade} size="sm" label="Zone actuelle" /> Zone</span>
          <span className="company-valuation-grade"><GradeJewel grade={sectorGrade} size="sm" label="Secteur actuel" /> Secteur</span>
          {currentQuote.liquidated
            ? <strong>Liquidation · valeur {money(currentQuote.price)} · revenu/part {money(0)}</strong>
            : <strong>{money(currentQuote.price)} / part · revenu/part {money(currentQuote.income)}</strong>}
          {floorLabel(currentQuote.incomeFloor) && <small>{floorLabel(currentQuote.incomeFloor)}</small>}
        </div>

        <p className="company-valuation-note">Chaque cellule indique le prix d’une part et le revenu potentiel lorsqu’un autre fonds arrive sur ce secteur. Ce revenu n’est pas périodique par cycle; en prison, il est versé à la banque. Le tableau est consultatif et ne passe aucun ordre.</p>

        <div className="company-valuation-scroll" role="region" aria-label="Matrice des notes de zone et de secteur" tabIndex={0}>
          <table className="company-valuation-grid" role="grid" aria-label="Zone par secteur, notes A à E" data-testid="company-valuation-grid">
            <thead>
              <tr role="row">
                <th className="company-valuation-axis" scope="col">Zone ↓<br /><span>Secteur →</span></th>
                {GRADES.map((grade) => <th key={grade} role="columnheader" scope="col" aria-label={`Secteur ${grade}`}><GradeJewel grade={grade} size="sm" label={`Secteur ${grade}`} /></th>)}
              </tr>
            </thead>
            <tbody>
              {GRADES.map((zone) => (
                <tr key={zone} role="row">
                  <th role="rowheader" scope="row" aria-label={`Zone ${zone}`}><GradeJewel grade={zone} size="sm" label={`Zone ${zone}`} /></th>
                  {cells.filter((cell) => cell.zone === zone).map(({ sector, quote, current }) => (
                    <td
                      key={sector}
                      role="gridcell"
                      aria-current={current ? "true" : undefined}
                      aria-label={`Zone ${zone}, Secteur ${sector}: ${quote.liquidated ? `liquidation, valeur indicative par part ${money(quote.price)}, revenu par part zéro, prix non négociable` : `cours par part ${money(quote.price)}, revenu par part ${money(quote.income)}`}${floorLabel(quote.incomeFloor) ? `, ${floorLabel(quote.incomeFloor)}` : ""}`}
                      className={`${current ? "is-current" : ""} ${quote.liquidated ? "is-liquidated" : ""}`.trim()}
                      data-current-cell={current ? "true" : undefined}
                      data-zone-grade={zone}
                      data-sector-grade={sector}
                    >
                      {quote.liquidated ? (
                        <>
                          <strong className="company-valuation-liquidation">Liquidation</strong>
                          <span>Valeur indicative / part : {money(quote.price)}</span>
                          <span>Revenu / part : {money(0)}</span>
                          <small>Zone E + secteur E · prix non négociable</small>
                        </>
                      ) : (
                        <>
                          <strong>{money(quote.price)}<small> / part</small></strong>
                          <span>Revenu {money(quote.income)}<small> / part</small></span>
                          {floorLabel(quote.incomeFloor) && <small className="company-valuation-floor">{floorLabel(quote.incomeFloor)}</small>}
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="shell-modal__foot company-valuation-foot">
          <span>Notes actuelles : {zoneGrade} / {sectorGrade}</span>
          <button type="button" className="gf-btn gf-btn--primary gf-btn--sm" onClick={onClose}>Fermer</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
