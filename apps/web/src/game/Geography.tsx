import { useEffect, useRef } from "react";
import { ArrowUpRight, Check, Dice5, MapPin, Scale, Search, X } from "lucide-react";
import type { GameView, GameCommand, Grade } from "@global-fund/shared";
import { GRADE_META, ZONE_META } from "../ui/theme";
import { pad2 } from "../ui/format";
import "./geography.css";

type Props = {
  game: GameView;
  destination: string;
  onDestination: (id: string) => void;
  onAnalyse: (id: string) => void;
  onCommand: (c: GameCommand) => void;
  onClose: () => void;
  disabled?: boolean;
};

const FLIGHT_COST = "1,00 M€";
const NO_COST = "0,00 M€";

/** Rating gem for the destination list. The letter is not a <b>: the radio keeps a single <b> (the zone name). */
function ZoneGem({ grade }: { grade: Grade }) {
  return <span className={`gf-jewel gf-jewel--lg grade-${grade} geo-gem`} aria-hidden="true"><em>{grade}</em></span>;
}

/** Consultations never submit a domain action. Only Stay/Move does. */
export default function Geography({ game, destination, onDestination, onAnalyse, onCommand, onClose, disabled = false }: Props) {
  const focus = useRef<HTMLElement>(null);
  const player = game.players.find(p => p.id === game.activePlayerId)!;
  const current = game.zones.find(z => z.id === player.zone)?.name ?? "Justice";
  const target = game.zones.find(z => z.id === destination)?.name ?? "";
  const moving = !!destination && destination !== player.zone;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focus.current?.focus();
    return () => {
      // A phase may open automatically: return to its persistent action control.
      const action = document.querySelector<HTMLButtonElement>(".action-travel");
      if (action && !action.disabled) action.focus();
      else if (previous?.isConnected) previous.focus();
    };
  }, []);
  return <div className="decision-backdrop central-decision" role="dialog" aria-modal="false" aria-labelledby="destination-title">
    <section ref={focus} tabIndex={-1} className={`geography-scene gf-glass ${player.jailed ? "justice-scene" : ""}`}>
      <button type="button" className="geography-close" aria-label="Consulter le plateau avant de décider" title="Consulter le plateau" onClick={onClose}><X size={16} strokeWidth={1.75} aria-hidden="true" /></button>
      <header className="geo-head">
        <span className="gf-kicker">{player.jailed ? "Justice · procès" : `Implantation · cycle ${pad2(game.cycle)}`}</span>
        <h2 id="destination-title" className="gf-display">{player.jailed ? "Votre procès" : "Votre prochain marché"}</h2>
        <p>{player.jailed ? "Trading et revenus suspendus ; vos participations restent valorisées." : `Rester est gratuit ; un vol coûte ${FLIGHT_COST}.`}</p>
      </header>
      {player.jailed ? <div className="geo-trial">
        <span className="geo-trial__seal" aria-hidden="true"><Scale size={30} strokeWidth={1.3} /></span>
        <button type="button" className="gf-btn gf-btn--primary gf-btn--lg geo-trial__roll" disabled={disabled} onClick={() => onCommand({ type: "PRISON_ROLL" })}>Lancer le dé du procès <Dice5 size={20} strokeWidth={1.6} aria-hidden="true" /></button>
        <small><span>Le dé décide de votre libération.</span><span>Sortie forcée à la 3e tentative : 5 M€.</span></small>
      </div> : <>
        <div className="travel-markets" role="radiogroup" aria-label="Destination du fonds">
          {game.zones.map(z => {
            const here = player.zone === z.id;
            const selected = destination === z.id;
            const grade = game.zoneGrades[z.id];
            const companies = game.companies.filter(c => c.zone === z.id).length;
            const meta = ZONE_META[z.id as keyof typeof ZONE_META];
            return <div className={`travel-market ${selected ? "selected" : ""} ${here ? "current-market" : ""}`} key={z.id}>
              <button type="button" className="travel-zone-select" role="radio" aria-checked={selected} onClick={() => onDestination(z.id)} aria-label={`Choisir ${z.name}`} aria-describedby={`travel-meta-${z.id} travel-cost-${z.id}`}>
                <span className="travel-gem"><ZoneGem grade={grade} /><span className="travel-check" aria-hidden="true"><Check size={10} strokeWidth={2.6} /></span></span>
                <span className="travel-zone-text">
                  <b>{z.name}</b>
                  <small id={`travel-meta-${z.id}`}><span className="sr-only">Note {grade}, {GRADE_META[grade].label} · </span>{meta?.city ?? z.name} · {companies} sociétés</small>
                </span>
                <span className={`travel-cost ${here ? "is-here" : ""}`} id={`travel-cost-${z.id}`}>{here ? <><MapPin size={11} strokeWidth={1.75} aria-hidden="true" />Position actuelle</> : `Vol · ${FLIGHT_COST}`}</span>
              </button>
              <button type="button" className="travel-analyse" onClick={() => onAnalyse(z.id)} aria-label={`Analyser le marché ${z.name}`} data-tip="Analyser"><Search size={14} strokeWidth={1.75} aria-hidden="true" /></button>
            </div>;
          })}
        </div>
        <div className="travel-choice-summary" aria-live="polite">
          <span><small>Destination</small><b>{target}</b></span>
          <span><small>Coût</small><b className="gf-num">{moving ? FLIGHT_COST : NO_COST}</b></span>
        </div>
        <div className="travel-confirm-actions">
          <button type="button" className={`gf-btn ${moving ? "gf-btn--ghost" : "gf-btn--primary"} stay-button`} disabled={disabled} onClick={() => onCommand({ type: "STAY" })}>Rester en {current}</button>
          <button type="button" className={`gf-btn ${moving ? "gf-btn--primary" : "gf-btn--ghost"} travel-go`} disabled={disabled || !destination || destination === player.zone} onClick={() => onCommand({ type: "MOVE", zoneId: destination })}>Voyager vers {target} <ArrowUpRight size={17} strokeWidth={1.75} aria-hidden="true" /></button>
        </div>
      </>}
    </section>
  </div>;
}
