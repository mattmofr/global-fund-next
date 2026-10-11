import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Check, CircleAlert, Landmark, Minus, Plus, ShieldCheck } from "lucide-react";
import type { GameCommand, GameView, PendingSettlement, Player } from "@global-fund/shared";
import AnimatedMoney from "../presentation/AnimatedMoney";
import { usePresentationSettings } from "../presentation/settings";
import { money, pad2 } from "../ui/format";
import { Money } from "../ui/Money";
import { SectorIcon } from "../ui/SectorIcon";
import Pawn from "./Pawn";
import "./settlement-desk.css";

type Props = {
  game: GameView;
  settlement: PendingSettlement;
  viewerId: string;
  canAct: boolean;
  onCommand: (command: GameCommand) => void;
};

const quantity = (value: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value);
const roundCent = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
const nameOf = (players: Player[], id: string | null) => id ? players.find(player => player.id === id)?.name ?? "Fonds" : "Banque / marché";
const percent = (ratio: number) => `${Math.round(Math.max(0, ratio) * 100)} %`;
const EASE = [0.22, 1, 0.36, 1] as const;
const NO_PICKS: Readonly<Record<string, number>> = {};
const ESTIMATE_NOTE = "Estimation au cours affiché. Le serveur fixe les cours à l’envoi de la proposition.";

/** One side of the ledger: figurine, role, name and live cash. The rail draws the payment direction. */
function Party({ side, player, name, isViewer }: { side: "debtor" | "creditor"; player?: Player; name: string; isViewer: boolean }) {
  return <div className={`sd-party sd-party-${side}`}>
    <span className={`sd-seat${player ? "" : " is-bank"}`} style={player ? { "--seat": player.color } as CSSProperties : undefined} aria-hidden="true">
      {player ? <Pawn id={player.pawn} color={player.color} /> : <Landmark size={22} strokeWidth={1.5} />}
    </span>
    <span className="sd-party-text">
      <small className="sd-role">{side === "debtor" ? "Débiteur" : "Créancier"}{isViewer && <em>Vous</em>}</small>
      <strong title={player?.name ?? name}>{player?.name ?? name}</strong>
      <span className="sd-cash">{player ? <><span>Liquidités</span><AnimatedMoney value={player.cash} /></> : "Règlement au marché"}</span>
    </span>
    <i className="sd-rail" aria-hidden="true" />
  </div>;
}

/** Waiting state: the decision belongs to another fund. */
function Waiting({ name, action }: { name: string; action: string }) {
  return <p className="sd-waiting" role="status"><i className="sd-orbit" aria-hidden="true" /><span><b>{name}</b> {action}</span></p>;
}

export default function SettlementDesk({ game, settlement, viewerId, canAct, onCommand }: Props) {
  const { reducedMotion } = usePresentationSettings();
  const systemReduced = useReducedMotion();
  const calm = reducedMotion || Boolean(systemReduced);

  // A selection belongs to one server step: a new creditor, a partial sale or a status change clears it.
  const scope = `${settlement.id}:${settlement.debtorId}:${settlement.creditorId ?? "bank"}:${settlement.completed.length}:${settlement.status}:${settlement.marketSales?.length ?? 0}`;
  const [draft, setDraft] = useState<{ scope: string; picks: Readonly<Record<string, number>> }>(() => ({ scope, picks: NO_PICKS }));
  const selected = draft.scope === scope ? draft.picks : NO_PICKS;

  const debtor = game.players.find(player => player.id === settlement.debtorId);
  const creditor = game.players.find(player => player.id === settlement.creditorId);
  const isActor = viewerId === settlement.decisionActorId;
  const editable = canAct && isActor;
  const offer = settlement.offer;
  const selectedAssets = useMemo(() => game.companies.flatMap(company => {
    const held = company.holdings[settlement.debtorId] ?? 0;
    const count = Math.min(selected[company.id] ?? 0, held);
    const perShare = roundCent(company.price);
    if (count <= 0 || !company.available || perShare <= 0) return [];
    return [{ companyId: company.id, companyName: company.name, quantity: count, perShare, value: roundCent(count * perShare) }];
  }), [game.companies, selected, settlement.debtorId]);
  const selectedValue = selectedAssets.reduce((sum, item) => sum + item.value, 0);
  const isSelecting = settlement.status === "selectAssets";
  const isCreditorDecision = settlement.status === "awaitingCreditor";
  const currentDebt = roundCent(settlement.remainingAmount);
  const debtorCash = debtor?.cash ?? 0;
  const cashGap = roundCent(Math.max(0, currentDebt - debtorCash));
  const proposedCashDelta = roundCent(currentDebt - selectedValue);
  const cashAvailableForCreditor = creditor?.cash ?? 0;
  const offerAssets = offer?.assets ?? [];
  const offerDelta = offer?.cashDelta ?? 0;
  const offerExact = Math.abs(offerDelta) < 1e-9;
  const creditorPays = offerDelta < 0;
  const creditorCanPay = !creditorPays || roundCent(cashAvailableForCreditor) >= roundCent(Math.abs(offerDelta));
  const hasSelection = selectedAssets.length > 0;
  const selectionCovers = hasSelection && roundCent(selectedValue + debtorCash) >= currentDebt;

  const setCount = (companyId: string, held: number, next: number) => {
    setDraft(current => {
      const picks = { ...(current.scope === scope ? current.picks : NO_PICKS) };
      if (next <= 0) delete picks[companyId];
      else picks[companyId] = Math.min(held, next);
      return { scope, picks };
    });
  };
  const submit = (type: "LIQUIDATE_ASSETS" | "PROPOSE_SETTLEMENT") => {
    if (!editable || (type === "PROPOSE_SETTLEMENT" && !selectionCovers) || (type === "LIQUIDATE_ASSETS" && !hasSelection)) return;
    onCommand({ type, assets: selectedAssets.map(({ companyId, quantity: count }) => ({ companyId, quantity: count })) });
  };

  // Fade the bottom edge of the asset list while more rows sit below the fold.
  const tableRef = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  const assets = game.companies
    .filter(company => (company.holdings[settlement.debtorId] ?? 0) > 0 && company.available && company.price > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  useEffect(() => {
    const element = tableRef.current;
    if (!element) return;
    const update = () => setClipped(element.scrollTop + element.clientHeight < element.scrollHeight - 2);
    update();
    element.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => { element.removeEventListener("scroll", update); observer?.disconnect(); };
  }, [assets.length, isActor, isSelecting]);
  const cause = settlement.sectorLabel ?? (settlement.sectorId ? game.sectors.find(sector => sector.id === settlement.sectorId)?.name : undefined);
  const order = settlement.creditorOrder.map(id => game.players.find(player => player.id === id)).filter((player): player is Player => Boolean(player));
  const frozenPriorities = new Map((settlement.creditorPriorities ?? []).map(priority => [priority.playerId, priority.value]));
  const priorityLabel = settlement.priorityMetric === "cash" ? "Liquidités au début du règlement" : "Valorisation au début du règlement";
  const priorityRule = settlement.priorityMetric === "cash" ? "Le fonds aux plus faibles liquidités est servi en premier." : "Le fonds le moins valorisé est servi en premier.";
  const settled = new Map(settlement.completed.filter(result => result.creditorId).map(result => [result.creditorId!, result.unpaidAmount ?? 0]));
  const debtorName = nameOf(game.players, settlement.debtorId);
  const creditorName = nameOf(game.players, settlement.creditorId);
  const actorName = nameOf(game.players, settlement.decisionActorId);
  const docket = String(settlement.id).padStart(4, "0");

  // Live coverage of the debt by the debtor's cash plus the current selection.
  const coverCash = Math.max(0, debtorCash);
  const cashShare = currentDebt > 0 ? Math.min(1, coverCash / currentDebt) : 1;
  const pickShare = currentDebt > 0 ? Math.min(1 - cashShare, selectedValue / currentDebt) : 0;
  const coverage = currentDebt > 0 ? (coverCash + selectedValue) / currentDebt : 1;
  const missing = roundCent(Math.max(0, currentDebt - debtorCash - selectedValue));
  const outcomeLabel = proposedCashDelta > 0 ? "Vous complétez en cash"
    : proposedCashDelta < 0 ? (settlement.creditorId ? `${creditorName} vous verse` : "Excédent conservé")
      : "Couverture exacte";
  // The creditor must hold enough cash to pay back an over-covering transfer, or it can only refuse.
  const creditorShort = Boolean(creditor) && proposedCashDelta < 0 && roundCent(cashAvailableForCreditor) < roundCent(-proposedCashDelta);
  // "Revenus du secteur Industrie" next to "CASE INDUSTRIE" says the sector twice: name the mechanism instead.
  const preferMarket = !settlement.creditorId || (hasSelection && selectionCovers && creditorShort);
  const reason = cause && settlement.reason === `Revenus du secteur ${cause}` ? "Revenus dus aux détenteurs" : settlement.reason;
  const netNote = offerExact ? "Les parts couvrent exactement le montant à régler." : creditorPays ? "Vous recevez les parts et payez la différence." : "Vous recevez les parts et le complément en cash.";
  const balanceAfter = roundCent(cashAvailableForCreditor + offerDelta);

  return <main className={`settlement-desk${editable ? " is-live" : ""}`} aria-label="Desk de règlement" data-status={settlement.status}>
    <motion.div
      className="sd-sheet"
      initial={calm ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: calm ? 0.2 : 0.42, ease: EASE }}
    >
      <header className="sd-head">
        <p className="sd-cause" title={cause ? "Arrivée sur la case, revenus dus aux détenteurs, puis règlement." : undefined}>
          <strong>{settlement.sectorId && <SectorIcon id={settlement.sectorId} size={14} />}{cause ? `CASE ${cause.toLocaleUpperCase("fr-FR")}` : "RÈGLEMENT FINANCIER"}</strong>
          <span title={reason === settlement.reason ? undefined : settlement.reason}>{reason}</span>
        </p>
        <span className="sd-docket" title={`Cycle ${pad2(game.cycle)} · dossier ${docket}`}>Nº {docket}</span>
      </header>

      <section className="sd-ledger" aria-label="Synthèse de l'obligation">
        <Party side="debtor" player={debtor} name={debtorName} isViewer={viewerId === settlement.debtorId} />
        <div className="sd-due">
          <small>Reste à régler</small>
          <Money value={currentDebt} className="sd-due-amount" />
          {cashGap <= 0
            ? <span className="sd-gap is-ok"><Check size={13} strokeWidth={2.4} aria-hidden="true" />Liquidités suffisantes</span>
            : <span className="sd-gap" title={`Liquidités du débiteur : ${money(debtorCash)}`}>{debtorCash > 0 ? `Manque ${money(cashGap)}` : "À couvrir en actifs"}</span>}
        </div>
        <Party side="creditor" player={creditor} name={creditorName} isViewer={Boolean(settlement.creditorId) && viewerId === settlement.creditorId} />
      </section>

      {order.length > 1 && <section className="sd-priority" aria-label="Ordre des créanciers">
        <p className="sd-priority-title" title={priorityRule}>Ordre de paiement</p>
        <div>{order.map((player, index) => {
          const current = player.id === settlement.creditorId;
          const done = !current && settled.has(player.id);
          const unpaid = settled.get(player.id) ?? 0;
          return <span key={player.id} className={current ? "is-current" : done ? "is-done" : ""} title={done ? (unpaid > 0 ? `Impayé : ${money(unpaid)}` : "Réglé") : current ? "En cours" : undefined}>
            <b>{done ? <><Check size={11} strokeWidth={2.6} aria-hidden="true" /><i className="sr-only">Réglé</i></> : index + 1}</b>{player.name}<small>{money(frozenPriorities.get(player.id) ?? player.fundValue)}</small>
          </span>;
        })}</div>
        <p className="sd-priority-note">{priorityLabel}</p>
      </section>}

      {isSelecting && <section className="sd-main sd-select" aria-label="Sélection des actifs">
        {isActor ? <>
          <div className="sd-main-head">
            <div>
              <h2 className="sd-title">Choisissez les actifs à céder</h2>
              <p className="sd-sub">{settlement.creditorId
                ? "Couvrez la dette pour proposer, ou vendez au marché, même en partie."
                : "Les parts choisies sont vendues au marché pour payer la dette."}</p>
            </div>
            {!editable && <span className="sd-sync" role="status"><i className="sd-orbit" aria-hidden="true" />Synchronisation…</span>}
          </div>
          <div className={`sd-table-wrap${clipped ? " is-clipped" : ""}`} ref={tableRef}>
            <table className="sd-assets-table">
              <caption className="sr-only">Participations cessibles, tous marchés confondus</caption>
              <thead><tr>
                <th scope="col">Société</th>
                <th scope="col" title="Toutes places de marché confondues">Marché · secteur</th>
                <th scope="col" className="is-num">Détenues</th>
                <th scope="col" className="is-num">Cours</th>
                <th scope="col" className="is-center">À céder</th>
                <th scope="col" className="is-num">Valeur</th>
              </tr></thead>
              <tbody>{assets.map((company, index) => {
                const held = company.holdings[settlement.debtorId] ?? 0;
                const count = Math.min(selected[company.id] ?? 0, held);
                const zone = game.zones.find(item => item.id === company.zone)?.name ?? company.zone;
                const sector = game.sectors.find(item => item.id === company.sector)?.name ?? company.sector;
                return <tr key={company.id} className={count > 0 ? "is-selected" : ""} style={{ "--i": index } as CSSProperties}>
                  <td title={company.ticker ? undefined : company.id}><span className="sd-company"><strong>{company.name}</strong>{company.ticker && <small>{company.ticker}</small>}<em className="sd-folded">{zone} · {sector}<span> · {quantity(held)} {held > 1 ? "détenues" : "détenue"}</span><span> · {money(company.price)}</span></em></span></td>
                  <td><span className="sd-market"><span>{zone}</span><span className="sd-sector"><SectorIcon id={company.sector} size={13} />{sector}</span></span></td>
                  <td className="is-num"><span className="sd-held" title={`${quantity(held)} ${held > 1 ? "parts détenues" : "part détenue"}${count > 0 ? `, ${quantity(count)} à céder` : ""}`}>
                    <span className="sd-pips" aria-hidden="true">{Array.from({ length: Math.max(5, held) }, (_, slot) => <i key={slot} className={slot < held - count ? "is-kept" : slot < held ? "is-out" : "is-free"} />)}</span>
                    {quantity(held)}
                  </span></td>
                  <td className="is-num">{money(company.price)}</td>
                  <td className="is-center"><div className="sd-quantity">
                    <button type="button" aria-label={`Retirer une part de ${company.name}`} disabled={!editable || count === 0} onClick={() => setCount(company.id, held, count - 1)}><Minus size={14} strokeWidth={2.2} aria-hidden="true" /></button>
                    <b>{quantity(count)}</b>
                    <button type="button" aria-label={`Ajouter une part de ${company.name}`} disabled={!editable || count >= held} onClick={() => setCount(company.id, held, count + 1)}><Plus size={14} strokeWidth={2.2} aria-hidden="true" /></button>
                  </div></td>
                  <td className="is-num">{count > 0 ? <span className="sd-value">{money(count * company.price)}</span> : <span className="sd-nil" aria-label="Aucune part">—</span>}</td>
                </tr>;
              })}{assets.length === 0 && <tr><td colSpan={6} className="sd-empty">Aucune participation cessible.</td></tr>}</tbody>
            </table>
          </div>
          <footer className="sd-totals">
            <div className={`sd-meter${selectionCovers ? " is-covered" : ""}`} role="meter" aria-label="Couverture de la dette" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(coverage * 100))} aria-valuetext={percent(coverage)} title={`Couverture ${percent(coverage)}`}>
              <i className="is-cash" style={{ width: `${cashShare * 100}%` }} />
              <i className="is-pick" style={{ width: `${pickShare * 100}%` }} />
            </div>
            <div className="sd-readout">
              <dl className="sd-figures" aria-live="polite">
                <div><dt>Sélection</dt><dd className={hasSelection ? "" : "is-nil"}><AnimatedMoney value={roundCent(selectedValue)} /></dd></div>
                {hasSelection && (selectionCovers
                  ? <div className={creditorShort ? "is-warn" : "is-ok"} title={ESTIMATE_NOTE}>
                      <dt>{creditorShort ? <CircleAlert size={13} aria-hidden="true" /> : <Check size={13} strokeWidth={2.4} aria-hidden="true" />}{outcomeLabel}</dt>
                      <dd>{proposedCashDelta !== 0 ? `≈ ${money(Math.abs(proposedCashDelta))}` : "Aucun complément"}</dd>
                    </div>
                  : <div className="is-short"><dt><CircleAlert size={13} aria-hidden="true" />Il manque</dt><dd>{money(missing)}</dd></div>)}
              </dl>
              {hasSelection && selectionCovers && creditorShort && <p className="sd-figure-note" role="status">Au-delà de sa trésorerie : préférez la vente au marché.</p>}
            </div>
            <div className="sd-actions">
              <button type="button" className={`gf-btn ${preferMarket ? "gf-btn--primary sd-cta" : "gf-btn--ghost"}`} disabled={!editable || !hasSelection} onClick={() => submit("LIQUIDATE_ASSETS")} title="Vente immédiate au cours affiché ; le produit sert au paiement.">Vendre au marché</button>
              {settlement.creditorId && <button type="button" className={`gf-btn ${preferMarket ? "gf-btn--ghost" : "gf-btn--primary sd-cta"}`} disabled={!editable || !selectionCovers} onClick={() => submit("PROPOSE_SETTLEMENT")} title="Le créancier accepte, refuse ou exige du cash.">Proposer au créancier<ArrowRight size={16} aria-hidden="true" /></button>}
            </div>
          </footer>
        </> : <Waiting name={actorName} action="choisit les actifs à céder." />}
      </section>}

      {isCreditorDecision && <section className="sd-main sd-offer-main" aria-label="Offre de règlement">
        {isActor ? <>
          <div className="sd-main-head">
            <h2 className="sd-title">{debtorName} vous propose un règlement</h2>
            {!editable
              ? <span className="sd-sync" role="status"><i className="sd-orbit" aria-hidden="true" />Synchronisation…</span>
              : <span className="sd-frozen" title="Cours figés à la proposition"><ShieldCheck size={14} aria-hidden="true" />Cours figés</span>}
          </div>
          <motion.div
            className="sd-offer"
            initial={calm ? { opacity: 0 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: calm ? 0.2 : 0.4, delay: calm ? 0 : 0.12, ease: EASE }}
          >
            <p className="sd-label">Vous recevez</p>
            <div className="sd-offer-assets">
              {offerAssets.length ? <ul className="sd-certs">{offerAssets.map(asset => {
                const company = game.companies.find(item => item.id === asset.companyId);
                const zone = company ? game.zones.find(item => item.id === company.zone)?.name ?? company.zone : undefined;
                const sector = company ? game.sectors.find(item => item.id === company.sector)?.name ?? company.sector : undefined;
                return <li key={asset.companyId} className="sd-cert">
                  <span className="sd-cert-meta">{company && <SectorIcon id={company.sector} size={13} />}{[sector, zone].filter(Boolean).join(" · ")}{company?.ticker && <i>{company.ticker}</i>}</span>
                  <b>{asset.companyName ?? company?.name ?? asset.companyId}</b>
                  <span className="sd-cert-terms"><small>{quantity(asset.quantity)} {asset.quantity > 1 ? "parts" : "part"} × {money(asset.perShare)}</small><strong>{money(asset.value)}</strong></span>
                </li>;
              })}</ul> : <p className="sd-empty">Aucune participation proposée.</p>}
            </div>
            <dl className="sd-offer-math">
              <div><dt>Dette à régler</dt><dd>{money(currentDebt)}</dd></div>
              <div><dt>Valeur des parts</dt><dd>{money(offer?.value ?? 0)}</dd></div>
              <div className={`sd-net ${offerExact ? "is-exact" : creditorPays ? "is-out" : "is-in"}`} title={offerExact ? undefined : netNote}>
                <dt>{offerExact ? "Aucun complément en cash" : creditorPays ? "Vous versez au débiteur" : "Le débiteur vous verse"}</dt>
                {!offerExact && <dd><Money value={Math.abs(offerDelta)} /></dd>}
              </div>
              {offerExact && <p className="sd-net-note">{netNote}</p>}
            </dl>
          </motion.div>
          {creditorPays && !creditorCanPay && <p className="sd-cash-warning" role="alert"><CircleAlert size={15} aria-hidden="true" /><strong>Liquidités insuffisantes</strong>{" "}<span>Disponible : {money(cashAvailableForCreditor)} · requis : {money(Math.abs(offerDelta))}</span></p>}
          <footer className="sd-decision">
            <div className="sd-balance"><span>Trésorerie après acceptation</span><strong className={balanceAfter < 0 ? "is-down" : ""}>{balanceAfter < 0 ? `−${money(Math.abs(balanceAfter))}` : money(balanceAfter)}</strong></div>
            <div className="sd-actions">
              <button type="button" className="gf-btn gf-btn--quiet" disabled={!editable} onClick={() => onCommand({ type: "REJECT_SETTLEMENT" })} title="Le débiteur devra proposer d’autres actifs.">Refuser</button>
              <button type="button" className="gf-btn gf-btn--ghost" disabled={!editable} onClick={() => onCommand({ type: "REQUIRE_CASH" })} title="Les parts sont vendues au marché ; vous êtes payé en cash.">Exiger du cash</button>
              <button type="button" className="gf-btn gf-btn--primary sd-cta" disabled={!editable || !creditorCanPay} onClick={() => onCommand({ type: "ACCEPT_SETTLEMENT" })} title={netNote}><Check size={16} strokeWidth={2.4} aria-hidden="true" />{creditorPays ? `Accepter et payer ${money(Math.abs(offerDelta))}` : "Accepter le règlement"}</button>
            </div>
          </footer>
        </> : <Waiting name={actorName} action="examine l’offre." />}
      </section>}
    </motion.div>
  </main>;
}
