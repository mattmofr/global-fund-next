import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight, BarChart3, BriefcaseBusiness, ChartNoAxesCombined, Check, Crown, Dice5, Globe2, MapPin, Maximize2,
  MessageSquare, Network, Plane, Scale, Wallet, X, type LucideIcon,
} from "lucide-react";
import type { GameCommand, GameNotice, GameView, GradeChange, RoomView } from "@global-fund/shared";
import { command, useGameStore } from "../store";
import { playCue, unlockAudio } from "../presentation/audio";
import { usePresentationSettings } from "../presentation/settings";
import AnimatedMoney from "../presentation/AnimatedMoney";
import { useDialogFocus } from "../presentation/useDialogFocus";
import CardScene from "../presentation/CardScene";
import { useGamePresentation } from "../presentation/useGamePresentation";
import { PRESENTATION_TIMING, type PresentationStage } from "../presentation/sequence";
import type { BoardInsets } from "../board/types";
import { GradeJewel, GradeShift } from "../ui/GradeJewel";
import { SectorIcon } from "../ui/SectorIcon";
import { GRADE_META, ZONE_META, gradeDelta, sectorMeta } from "../ui/theme";
import { money, pad2, signedMoney, signedPercent, tone } from "../ui/format";
import Pawn from "./Pawn";
import Chat from "./Chat";
import Geography from "./Geography";
import OfficeEnvironment from "./OfficeEnvironment";
import SettlementDesk from "./SettlementDesk";
import { FinancialTicker } from "./FinancialTicker";
import { SceneLoader } from "./SceneLoader";
import { playerOfficeMarket, marketPlaceVisuals } from "./marketPlaceVisuals";
import "./game-world.css";
import "./impact-ribbon.css";

const BoardScene = lazy(() => import("../board/BoardScene"));
const TradingDesk = lazy(() => import("../trading/TradingDesk"));
type Terminal = "market" | "portfolio" | "analysis" | "statistics";
/** Central surfaces that put the HUD in focus mode (see docs/REDESIGN.md §5). */
type StageKind = "terminal" | "card" | "travel" | "settlement";

/** Rail labels: the full zone name stays in the title and the accessible name. */
const ZONE_LABEL: Record<string, string> = { americas: "Amériques", europe: "Europe", asia: "Asie", africa: "Afrique & M.-O.", oceania: "Océanie" };
const TURN_STEPS = [{ phase: "geography", label: "Implantation" }, { phase: "sector", label: "Dé & case" }, { phase: "market", label: "Trading" }] as const;
const STEP_INDEX: Partial<Record<GameView["phase"], number>> = { geography: 0, sector: 1, settlement: 1, market: 2, awaitNext: 3, finished: 3 };

function stageLabel(stage: PresentationStage) {
  const labels: Partial<Record<PresentationStage, string>> = {
    BOARD_FOCUS: "Le plateau s’anime", DICE_ROLLING: "Le dé roule", DICE_RESULT: "Résultat du dé", PAWN_MOVING: "Le pion avance",
    PAWN_ARRIVAL: "Arrivée sur la case", SPACE_REVEAL: "La case se révèle", CARD_READING: "Lecture de la carte",
    CARD_DISMISS: "Application", MARKET_IMPACT: "Les cours s’ajustent", TRAVEL_RESOLUTION: "Vol en cours",
  };
  return labels[stage] ?? "Résolution";
}

function ConsequenceRibbon({ game, notice, gradeImpact, awaitingMarketConfirmation, onContinue }: { game: GameView; notice: GameNotice; gradeImpact: GradeChange | null; awaitingMarketConfirmation: boolean; onContinue: () => void }) {
  const company = notice.companyImpacts?.find(c => c.beforePrice !== c.afterPrice);
  const scopeName = gradeImpact ? (gradeImpact.scope === "zone" ? game.zones : game.sectors).find(x => x.id === gradeImpact.id)?.name ?? "" : "";
  const direction = gradeImpact ? gradeDelta(gradeImpact.before, gradeImpact.after) : company ? company.afterPrice - company.beforePrice : 0;
  const change = company && company.beforePrice > 0 ? (company.afterPrice - company.beforePrice) / company.beforePrice * 100 : null;
  const mood = direction > 0 ? "ribbon-up" : direction < 0 ? "ribbon-down" : "ribbon-flat";
  return <div className={`consequence-ribbon ${awaitingMarketConfirmation ? "major-consequence" : ""} ${mood}`} role="status" data-impact-notice={notice.id} data-awaiting-market-confirmation={awaitingMarketConfirmation}>
    <span className="ribbon-source"><i aria-hidden="true" />{notice.title ?? notice.cell?.label ?? "Marché"}</span>
    {gradeImpact
      ? <strong className="ribbon-change" key={`${gradeImpact.scope}-${gradeImpact.id}`}>
          <span className="ribbon-scope">{gradeImpact.scope === "zone" ? "Zone" : "Secteur"}</span>
          <span className="ribbon-name">{scopeName}</span>
          <GradeShift before={gradeImpact.before} after={gradeImpact.after} label={scopeName} />
        </strong>
      : <strong className="ribbon-change">
          {company ? <>
            <span className="ribbon-name">{company.companyName}</span>
            <span className="ribbon-price gf-num">{money(company.beforePrice)}<span aria-hidden="true"> → </span><span className="sr-only"> devient </span>{money(company.afterPrice)}</span>
            {change != null && <em className={`ribbon-delta ${tone(change)}`}>{signedPercent(change)}</em>}
          </> : <span className="ribbon-name">Nouvelles conditions de marché</span>}
        </strong>}
    {awaitingMarketConfirmation && <button type="button" className="gf-btn gf-btn--primary impact-continue" onClick={onContinue}>Valider les cours <ArrowRight size={15} strokeWidth={1.75} aria-hidden="true" /></button>}
  </div>;
}

type CityZone = keyof typeof ZONE_META;
const isCityZone = (id: string | null | undefined): id is CityZone => !!id && id in ZONE_META;
/** Latest flight between two market places (same rule as the board's globe flight). */
function latestFlight(notices: GameNotice[]) {
  for (let i = notices.length - 1; i >= 0; i--) {
    const n = notices[i]!;
    if (isCityZone(n.fromZoneId) && isCityZone(n.zoneId) && n.fromZoneId !== n.zoneId) return n;
  }
  return null;
}

/** Cinema mode while the board flies the plane: letterbox bars and the route, the HUD steps aside. */
function TravelCinema({ game, notice }: { game: GameView; notice: GameNotice }) {
  const traveller = game.players.find(p => p.id === notice.playerId);
  const from = ZONE_META[notice.fromZoneId as CityZone].city;
  const to = ZONE_META[notice.zoneId as CityZone].city;
  return <div className="travel-cinema" style={{ "--flight-ms": `${PRESENTATION_TIMING.travel}ms`, "--player-color": traveller?.color ?? "var(--accent)" } as CSSProperties}>
    <span className="travel-cinema__bar is-top" aria-hidden="true" />
    <span className="travel-cinema__bar is-bottom" aria-hidden="true" />
    <p className="travel-cinema__caption" role="status">
      <span className="sr-only">Vol de {traveller?.name ?? "l’investisseur"} : </span>
      <span className="travel-cinema__city">{from}</span>
      <span className="travel-cinema__route" aria-hidden="true"><i /><Plane className="travel-cinema__plane" size={15} strokeWidth={1.75} /></span>
      <span className="sr-only"> vers </span>
      <span className="travel-cinema__city is-destination">{to}</span>
      {traveller && <small aria-hidden="true"><b />{traveller.name}</small>}
    </p>
  </div>;
}

function TerminalWindow({ game, viewerId, canAct, tab, browseZone, onBrowseZone, onCommand, onClose }: {
  game: GameView; viewerId: string; canAct: boolean; tab: Terminal; browseZone: string; onBrowseZone: (id: string) => void; onCommand: (c: GameCommand) => void; onClose: () => void;
}) {
  const focus = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    focus.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector('[aria-modal="true"]')) { event.preventDefault(); close.current(); }
    };
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("keydown", escape); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="terminal-backdrop" role="dialog" aria-modal="false" aria-label="Terminal de trading">
    <section className="floating-terminal" ref={focus} tabIndex={-1}>
      <Suspense fallback={<div className="world-loading"><span className="resolution-orbit" aria-hidden="true" />Connexion aux places de marché…</div>}>
        <TradingDesk game={game} viewerId={viewerId} canAct={canAct} onCommand={onCommand} initialTab={tab} browseZone={browseZone} onBrowseZoneChange={onBrowseZone} onClose={onClose} onReturnTravel={onClose} onEndTurn={() => { onCommand({ type: "END_TURN" }); onClose(); }} />
      </Suspense>
    </section>
  </div>;
}

type Receipt = { id: number; title: string; name: string; detail: string; amount: number; kind: "buy" | "sell" | "control" | "monopoly" | "cash" };
/** Feed-back construit à partir de deux snapshots confirmés, jamais à partir du clic. */
function useFinancialFeedback(game: GameView, revision: number) {
  const before = useRef(game);
  const sequence = useRef(0);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  useEffect(() => {
    const previous = before.current;
    before.current = game;
    if (previous === game) return;
    let next: Receipt | null = null;
    for (const player of game.players) {
      const old = previous.players.find(p => p.id === player.id);
      if (!old) continue;
      for (const company of game.companies) {
        const prior = previous.companies.find(c => c.id === company.id);
        if (!prior || !prior.available || !company.available) continue;
        const held = company.holdings[player.id] ?? 0;
        const delta = held - (prior.holdings[player.id] ?? 0);
        if (!delta) continue;
        // Une carte montre elle-même ses ventes forcées et liquidations.
        if (game.notices.some(n => n.id > previous.noticeSeq)) continue;
        const group = game.companies.filter(c => c.zone === company.zone && c.sector === company.sector);
        const monopoly = held === 5 && group.every(c => c.holdings[player.id] === 5);
        next = { id: ++sequence.current, title: monopoly ? "MONOPOLE CONSTITUÉ" : held === 5 && delta > 0 ? "CONTRÔLE TOTAL" : delta > 0 ? "ACHAT VALIDÉ" : "VENTE VALIDÉE", name: company.name,
          detail: monopoly ? `${game.zones.find(z => z.id === company.zone)?.name} · ${game.sectors.find(s => s.id === company.sector)?.name} · revenu A/A` : held === 5 && delta > 0 ? "100 % du capital · revenu minimum C/C" : `${delta > 0 ? "+" : "−"}${Math.abs(delta)} ${Math.abs(delta) > 1 ? "parts" : "part"} · ${Math.abs(delta) * 20} % du capital · ${player.name}`,
          amount: player.cash - old.cash, kind: monopoly ? "monopoly" : held === 5 && delta > 0 ? "control" : delta > 0 ? "buy" : "sell" };
      }
    }
    if (next) { setReceipt(next); playCue(next.kind === "sell" ? "sell" : "buy"); }
  }, [game, revision]);
  useEffect(() => { if (!receipt) return; const timer = setTimeout(() => setReceipt(null), 3200); return () => clearTimeout(timer); }, [receipt?.id]);
  return receipt;
}

function wealthStage(value: number) {
  if (value < 50) return { id: "distressed", label: "Bureau en difficulté" };
  if (value < 500) return { id: "office", label: "Bureau d’investissement" };
  if (value < 1000) return { id: "desk", label: "Desk de trading" };
  if (value < 5000) return { id: "tower", label: "Bureau dans les hauteurs" };
  if (value < 10000) return { id: "floor", label: "Salle de marché mondiale" };
  if (value < 100000) return { id: "gold", label: "Empire financier" };
  return { id: "world", label: "Influence mondiale" };
}

function Victory({ game }: { game: GameView }) {
  const focus = useDialogFocus();
  const { reducedMotion } = usePresentationSettings();
  useEffect(() => { playCue("victory"); }, []);
  const winners = game.players.filter(p => game.winnerIds.includes(p.id));
  const ranking = [...game.players].sort((a, b) => b.fundValue - a.fundValue);
  const rise = (delay: number) => reducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.16 } }
    : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] as const } };
  return <div className="victory-stage" role="dialog" aria-modal="true" aria-labelledby="victory-title" ref={focus as RefObject<HTMLDivElement>} tabIndex={-1}>
    <div className="victory-card">
      <motion.div className="victory-hero" aria-hidden="true" {...rise(0.05)}>
        <span className="victory-crown"><Crown size={22} strokeWidth={1.5} /></span>
        <span className="victory-portraits">{winners.map(p => <span key={p.id} className="victory-portrait" style={{ "--player-color": p.color } as CSSProperties}><Pawn id={p.pawn} color={p.color} /></span>)}</span>
      </motion.div>
      <motion.span className="gf-kicker" {...rise(0.15)}>Séance clôturée</motion.span>
      <motion.h2 id="victory-title" className="gf-display" {...rise(0.25)}>{winners.map(p => p.name).join(" & ")}</motion.h2>
      <motion.p className="victory-lede" {...rise(0.35)}>Première puissance financière de la séance.</motion.p>
      <ol className="victory-ranking" aria-label="Classement final">
        {ranking.map((p, i) => <motion.li key={p.id} className={game.winnerIds.includes(p.id) ? "is-winner" : ""} style={{ "--player-color": p.color } as CSSProperties} {...rise(0.45 + i * 0.07)}>
          <span className="victory-rank gf-num">{pad2(i + 1)}</span>
          <Pawn id={p.pawn} color={p.color} />
          <b>{p.name}</b>
          <strong className="gf-num">{money(p.fundValue)}</strong>
        </motion.li>)}
      </ol>
      <motion.div {...rise(0.5 + ranking.length * 0.07)}>
        <button type="button" className="gf-btn gf-btn--primary gf-btn--lg" onClick={() => useGameStore.getState().reset()}>Nouvelle partie <ArrowRight size={18} strokeWidth={1.75} aria-hidden="true" /></button>
      </motion.div>
    </div>
  </div>;
}

function marketPresentation(notice: GameNotice | null): "context" | "event" | "bull" | "bear" | "crash" | null {
  if (!notice) return null;
  const title = `${notice.title ?? ""} ${notice.cell?.label ?? ""}`.toLowerCase();
  if (title.includes("crash")) return "crash";
  if (title.includes("bull")) return "bull";
  if (title.includes("bear")) return "bear";
  return notice.cardType === "context" ? "context" : notice.cardType === "event" ? "event" : null;
}

const DEFAULT_INSETS: BoardInsets = { top: 96, right: 24, bottom: 156, left: 228 };
/**
 * Measures the screen margins covered by the HUD so the 3D camera frames the
 * table in the free area: status + players on top, ratings on the left, the
 * turn bar and tools at the bottom. Focus surfaces that cover the centre
 * (terminal, card, settlement) keep the previous framing; the travel panel
 * reframes the table.
 */
function useHudInsets(world: RefObject<HTMLElement | null>, layoutKey: string) {
  const [insets, setInsets] = useState<BoardInsets>(DEFAULT_INSETS);
  useLayoutEffect(() => {
    const root = world.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const box = (selector: string) => {
      const element = root.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? rect : null;
    };
    const measure = () => {
      frame = 0;
      const focus = root.dataset.stageOpen;
      if (focus && focus !== "travel") return;
      const width = window.innerWidth;
      const height = window.innerHeight;
      const gap = 12;
      const status = box(".world-status");
      const rail = focus ? null : box(".world-ratings");
      const dock = box(".fund-dock");
      const consoleBox = box(".command-console");
      const tools = box(".world-tools");
      const panel = focus === "travel" ? box(".geography-scene") : null;
      const top = Math.max(64, status?.bottom ?? 0, dock?.bottom ?? 0) + gap;
      const lowest = (rects: (DOMRect | null)[]) => Math.min(height, ...rects.flatMap(rect => (rect ? [rect.top] : [])));
      let next: BoardInsets;
      if (width <= 900) {
        // Phone/tablet: the ratings strip sits right above the turn bar.
        next = { top, right: 0, bottom: height - lowest([rail, consoleBox]) + gap, left: 0 };
      } else {
        next = {
          top,
          right: gap,
          bottom: height - lowest([consoleBox, tools]) + gap,
          left: Math.max(rail?.right ?? 0, panel?.right ?? 0) + gap,
        };
      }
      const rounded: BoardInsets = { top: Math.round(next.top), right: Math.round(Math.max(0, next.right)), bottom: Math.round(Math.max(0, next.bottom)), left: Math.round(Math.max(0, next.left)) };
      setInsets(prev => (Math.abs(prev.top - rounded.top) < 2 && Math.abs(prev.right - rounded.right) < 2 && Math.abs(prev.bottom - rounded.bottom) < 2 && Math.abs(prev.left - rounded.left) < 2 ? prev : rounded));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    root.querySelectorAll(".world-status, .world-ratings, .fund-dock, .command-console, .world-tools, .geography-scene").forEach(element => observer.observe(element));
    window.addEventListener("resize", schedule);
    // Focus-mode rails move with a short transition: measure once they settle.
    const settle = window.setTimeout(schedule, 480);
    schedule();
    return () => { observer.disconnect(); window.removeEventListener("resize", schedule); window.clearTimeout(settle); if (frame) cancelAnimationFrame(frame); };
  }, [world, layoutKey]);
  return insets;
}

function ToolButton({ icon: Icon, label, shortcut, pressed, badge, onClick }: { icon: LucideIcon; label: string; shortcut?: string; pressed: boolean; badge?: number; onClick: () => void }) {
  return <button type="button" className="world-tool" aria-pressed={pressed} aria-keyshortcuts={shortcut} data-tip={shortcut ? `${label} · ${shortcut}` : label} onClick={onClick}>
    <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
    <span className="world-tool__label">{label}</span>
    {shortcut && <kbd aria-hidden="true">{shortcut}</kbd>}
    {!!badge && <b className="world-tool__badge" aria-label={`${badge} nouveaux messages`}>{badge}</b>}
  </button>;
}

export default function GameWorld({ room }: { room: RoomView }) {
  const authoritativeGame = room.game!;
  const { session, connected, pending, queue, acknowledged, acknowledge } = useGameStore();
  const { reducedMotion, quality } = usePresentationSettings();
  const visual = useGamePresentation(room, acknowledged, acknowledge, reducedMotion);
  const game = visual.viewGame!;
  const active = game.players.find(p => p.id === game.activePlayerId)!;
  const slot = room.players.find(p => p.id === active.id)!;
  const { notice, currentCard: current, stage: presentationStage } = visual;
  const controls = !active.bot && (active.id === session?.playerId || (session?.playerId === room.hostId && slot.kind === "local"));
  const canAct = controls && connected && !pending && !visual.busy && !queue.length && authoritativeGame.phase !== "settlement";
  const settlement = authoritativeGame.pendingSettlement;
  const decisionId = settlement?.decisionActorId ?? active.id;
  const decisionSlot = room.players.find(p => p.id === decisionId);
  const decisionControls = !!decisionSlot && !decisionSlot.bot && (decisionId === session?.playerId || (session?.playerId === room.hostId && decisionSlot.kind === "local"));
  const canSettle = decisionControls && connected && !pending && !visual.busy && !queue.length;
  const [viewerId, setViewerId] = useState(session?.playerId ?? active.id);
  const [officeViewerId, setOfficeViewerId] = useState(session?.playerId ?? active.id);
  useEffect(() => {
    if (controls) setOfficeViewerId(active.id);
    else if (session?.playerId !== room.hostId && session?.playerId) setOfficeViewerId(session.playerId);
  }, [controls, active.id, session?.playerId, room.hostId]);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [lastReadMessage, setLastReadMessage] = useState<string | null>(room.messages.at(-1)?.id ?? null);
  const [geographyOpen, setGeographyOpen] = useState(true);
  const [destination, setDestination] = useState(active.zone ?? game.zones[0].id);
  const [browseZone, setBrowseZone] = useState(active.zone ?? game.zones[0].id);
  const [overview, setOverview] = useState(false);
  const [focusedZone, setFocusedZone] = useState<string | null>(null);
  /** What the pointer rests on in the HUD; the 3D table answers with light only. */
  const [hover, setHover] = useState<{ sector?: string; zone?: string; player?: string }>({});
  const receipt = useFinancialFeedback(authoritativeGame, room.revision);
  useEffect(() => {
    setViewerId(controls ? active.id : session?.playerId ?? active.id);
    setTerminal(null);
    setOverview(false);
    setFocusedZone(null);
    setDestination(active.zone ?? game.zones[0].id);
    setBrowseZone(active.zone ?? game.zones[0].id);
    setGeographyOpen(true);
  }, [active.id, controls, session?.playerId]);
  useEffect(() => {
    if (!visual.busy && authoritativeGame.phase === "market" && controls) setTerminal("market");
    if (visual.busy) setTerminal(null);
    if (!visual.busy && authoritativeGame.phase === "geography") setGeographyOpen(true);
  }, [authoritativeGame.phase, visual.busy, active.id, controls]);
  useEffect(() => { if (chatOpen) setLastReadMessage(room.messages.at(-1)?.id ?? null); }, [chatOpen, room.messages]);
  const lastReadIndex = room.messages.findIndex(m => m.id === lastReadMessage);
  const unreadMessages = chatOpen ? 0 : room.messages.length - (lastReadIndex + 1);
  const viewer = game.players.find(p => p.id === viewerId) ?? active;
  const holdings = game.companies.filter(c => (c.holdings[viewerId] ?? 0) > 0);
  const controlled = holdings.filter(c => c.holdings[viewerId] === 5);
  const officePlayer = visual.boardGame!.players.find(p => p.id === officeViewerId) ?? game.players.find(p => p.id === session?.playerId) ?? active;
  const officeMarket = playerOfficeMarket(officePlayer);
  const stage = wealthStage((game.players.find(p => p.id === officePlayer.id) ?? officePlayer).fundValue);
  const phaseTitle = game.phase === "settlement" ? "Règlement en cours" : game.phase === "geography" ? "Choisir son marché" : game.phase === "sector" ? "Le circuit des marchés" : game.phase === "market" ? "Composer son portefeuille" : game.phase === "finished" ? "Clôture de la séance" : "Passage de relais";
  const zoneName = (id: string | null) => game.zones.find(z => z.id === id)?.name ?? "Place de marché";
  const send = (c: GameCommand) => { if (!canAct) return; void unlockAudio(); playCue("ui_click"); void command(c, active.id); };
  const sendSettlement = (c: GameCommand) => { if (!canSettle) return; void unlockAudio(); playCue("ui_click"); void command(c, decisionId); };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
      if (e.target instanceof Element && e.target.closest("input,select,textarea,a,summary,.floating-terminal,.world-chat") || document.querySelector('[aria-modal="true"]')) return;
      if (e.key === " " && e.target instanceof Element && e.target.closest("button")) return;
      if (e.key.toLowerCase() === "p") { setTerminal("portfolio"); playCue("ui_click"); }
      if (e.key.toLowerCase() === "m") { setTerminal("market"); playCue("ui_click"); }
      if (e.key === " " && game.phase === "sector" && canAct) { e.preventDefault(); send({ type: "ROLL" }); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [game.phase, canAct, active.id]);
  // Commandes interdites côté présentation pendant une scène ; le serveur vérifie aussi.
  const presentation = presentationStage === "MARKET_IMPACT" ? marketPresentation(notice) : null;
  useEffect(() => {
    if (presentationStage === "MARKET_IMPACT") {
      if (visual.gradeImpact) playCue("ABCDE".indexOf(visual.gradeImpact.after) < "ABCDE".indexOf(visual.gradeImpact.before) ? "market-up" : "market-down");
      else if (presentation === "bull" || presentation === "bear" || presentation === "crash") playCue(presentation);
    }
    if (presentationStage === "CARD_DISMISS") playCue("confirm");
    if (presentationStage === "DICE_RESULT") playCue("confirm");
    if (presentationStage === "CARD_DISMISS") {
      const delta = notice?.playerImpacts?.find(p => p.playerId === active.id)?.cash ?? 0;
      if (delta) playCue(delta > 0 ? "money_gain" : "loss");
      if (notice?.playerImpacts?.some(p => p.prison === true)) playCue("prison");
    }
  }, [presentationStage, visual.gradeImpact?.id, visual.gradeImpact?.after, notice?.id]);

  // ---------------------------------------------------------------- layout --
  const geographyVisible = !terminal && geographyOpen && canAct && game.phase === "geography";
  const cardVisible = !!current && !terminal;
  const settlementVisible = !!settlement && !visual.busy;
  const stageKind: StageKind | null = terminal ? "terminal" : cardVisible ? "card" : settlementVisible ? "settlement" : geographyVisible ? "travel" : null;
  const travelPreview = geographyVisible && !active.jailed && active.zone ? { from: destination === active.zone ? null : active.zone, to: destination } : null;
  const worldRef = useRef<HTMLElement>(null);
  const insets = useHudInsets(worldRef, `${stageKind ?? "board"}:${game.players.length}`);
  const impact = visual.gradeImpact;
  const impactClass = (scope: "zone" | "sector", id: string) => impact && impact.scope === scope && impact.id === id ? `is-impacted ${gradeDelta(impact.before, impact.after) >= 0 ? "impact-up" : "impact-down"}` : "";
  const stepIndex = STEP_INDEX[game.phase] ?? -1;
  // The card and the ribbon already name the notice; before the reveal the title would spoil the roll.
  const showNoticeTitle = !!notice?.title && !cardVisible && !["BOARD_FOCUS", "DICE_ROLLING", "DICE_RESULT", "PAWN_MOVING", "PAWN_ARRIVAL", "MARKET_IMPACT"].includes(presentationStage);
  const status = active.bot ? { kind: "bot", text: "IA en réflexion…" } : controls ? { kind: "local", text: "À vous" } : { kind: "remote", text: "Joue à distance" };
  const city = marketPlaceVisuals[officeMarket].city;
  const tool = (id: Terminal) => () => { setTerminal(id); playCue("ui_click"); };
  const hoverOn = (key: "sector" | "zone" | "player", id: string) => {
    const enter = () => setHover({ [key]: id });
    const leave = () => setHover(h => (h[key] === id ? {} : h));
    return { onPointerEnter: enter, onPointerLeave: leave, onFocus: enter, onBlur: leave };
  };
  // A surface opening under the pointer must not leave a highlight behind.
  useEffect(() => { setHover({}); }, [stageKind]);
  const flight = presentationStage === "TRAVEL_RESOLUTION" && !reducedMotion ? latestFlight(visual.boardGame!.notices) : null;

  return <main ref={worldRef} className={`game-world wealth-${stage.id} ${reducedMotion ? "motion-reduced" : ""} ${active.jailed ? "world-detained" : ""}`}
    data-quality={quality} data-presentation-stage={presentationStage} data-effects-started={presentationStage === "MARKET_IMPACT"}
    data-stage-open={stageKind ?? undefined} data-turn={controls ? "local" : "remote"} data-cinematic={flight ? "travel" : undefined}>
    <OfficeEnvironment market={officeMarket} playerId={officePlayer.id} travelling={presentationStage === "TRAVEL_RESOLUTION"} reducedMotion={reducedMotion} />
    <div className="board-world">
      {/* The SceneLoader curtain covers the table while its code and assets load. */}
      <Suspense fallback={null}>
        <BoardScene game={visual.boardGame!} timeline={visual.timeline} stage={presentationStage} onRoll={() => send({ type: "ROLL" })} disabled={!canAct || game.phase !== "sector"} reducedMotion={reducedMotion} quality={quality}
          focusZone={overview ? null : focusedZone ?? (terminal ? browseZone : undefined)} overview={overview} presentation={presentation}
          insets={insets} travelPreview={travelPreview} marketImpact={impact} viewerId={viewerId}
          highlightSector={hover.sector ?? null} highlightZone={hover.zone ?? null} highlightPlayerId={hover.player ?? null} />
      </Suspense>
    </div>
    <div className="world-scrim" aria-hidden="true" />
    <div className="stage-scrim" aria-hidden="true" />

    <header className="world-status">
      <span className="cycle-plate"><small>Cycle</small><b className="gf-num">{pad2(game.cycle)}</b><i>/ 101</i></span>
      <div className="world-phase">
        <span className="gf-kicker">{game.cycle === 1 ? "OUVERTURE À C/C" : `${100 - game.contextsRemaining} / 100 CONTEXTES`}</span>
        <h1>{phaseTitle}</h1>
      </div>
    </header>
    <div className="world-session" title={`Bureau de ${city} · ${stage.label}`}>
      <span>Salon <b className="gf-mono">{room.roomId}</b></span>
    </div>

    <section className="world-ratings gf-glass" aria-label="Notations économiques">
      <div className="rating-group">
        <span className="gf-kicker">Zones</span>
        <div className="world-zones">{game.zones.map(z => {
          const grade = game.zoneGrades[z.id];
          const isCurrent = active.zone === z.id;
          return <button key={z.id} type="button" className={`economic-zone ${isCurrent ? "is-current zone-selected" : ""} ${focusedZone === z.id ? "is-focused" : ""} ${impactClass("zone", z.id)}`}
            onClick={() => { setOverview(false); setFocusedZone(focusedZone === z.id ? null : z.id); }} aria-pressed={focusedZone === z.id}
            aria-label={`${z.name}, note ${grade} (${GRADE_META[grade].label}) — centrer le plateau`} title={`${z.name} — ${GRADE_META[grade].label}${isCurrent ? ` · ${active.name}` : ""}`}
            style={isCurrent ? { "--player-color": active.color } as CSSProperties : undefined} {...hoverOn("zone", z.id)}>
            <span className="economic-zone__marker" aria-hidden="true" />
            <span className="economic-zone__name">{ZONE_LABEL[z.id] ?? z.name}</span>
            <GradeJewel key={`${z.id}-${grade}`} grade={grade} label={z.name} size="sm" className="rating-instrument" />
          </button>;
        })}</div>
      </div>
      <div className="rating-group">
        <span className="gf-kicker">Secteurs</span>
        <div className="world-sectors">{game.sectors.map(s => {
          const grade = game.sectorGrades[s.id];
          return <div className={`economic-tile ${impactClass("sector", s.id)}`} key={s.id} title={`${s.name} — ${GRADE_META[grade].label}`} {...hoverOn("sector", s.id)}>
            <SectorIcon id={s.id} size={15} />
            <span className="economic-tile__name">{sectorMeta(s.id)?.label ?? s.name.split("&")[0]}</span>
            <GradeJewel key={`${s.id}-${grade}`} grade={grade} label={s.name} size="sm" className="rating-instrument" />
          </div>;
        })}</div>
      </div>
    </section>

    <button type="button" className={`world-overview ${overview ? "is-on" : ""}`} aria-label="Vue globale du plateau" aria-pressed={overview}
      title={`Vue globale du plateau · ${game.board.length} semaines, ${game.companies.length} entreprises`} onClick={() => { setOverview(!overview); setFocusedZone(null); }}>
      <Maximize2 size={16} strokeWidth={1.6} aria-hidden="true" /><span aria-hidden="true">Vue globale</span>
    </button>

    <section className="command-console gf-glass" aria-label="Console de tour">
      <div className="console-rail">
        <ol className="turn-sequence" aria-label="Séquence du tour">
          {TURN_STEPS.map((step, index) => {
            const state = index < stepIndex ? "is-done" : index === stepIndex ? "is-current" : "";
            return <li key={step.phase} className={state} aria-current={game.phase === step.phase ? "step" : undefined}>
              <b aria-hidden="true">{index < stepIndex ? <Check size={10} strokeWidth={2.4} /> : index + 1}</b>{step.label}
            </li>;
          })}
        </ol>
        {active.jailed && <span className="detention-instrument" title="Trading et revenus suspendus. Procès au prochain tour ; sortie forcée à la 3e tentative : 5 M€.">
          <Scale size={13} strokeWidth={1.75} aria-hidden="true" /><b>Sous contrôle judiciaire</b><span>procès · sortie forcée 5 M€</span>
        </span>}
        <div className="active-location" title={`Semaine ${pad2(active.sectorPosition + 1)} sur ${game.board.length}`}>
          <MapPin size={13} strokeWidth={1.75} aria-hidden="true" />
          <span>{active.jailed ? "Justice" : zoneName(active.zone)}</span>
          <small className="gf-num">S. {pad2(active.sectorPosition + 1)}</small>
        </div>
      </div>
      <div className="console-main">
        <div className="active-fund" style={{ "--player-color": active.color } as CSSProperties}>
          <Pawn id={active.pawn} color={active.color} />
          <div className="active-fund__text">
            <h2>{active.name}</h2>
            <p className={`active-fund__status is-${status.kind}`}><i aria-hidden="true" />{status.text}</p>
          </div>
        </div>
        <div className="turn-actions">
          {visual.busy ? <div className="world-resolution" role="status">
            <span className="resolution-orbit" aria-hidden="true" />
            <span className="world-resolution__text"><b>{stageLabel(presentationStage)}</b>{showNoticeTitle && <small>{notice?.title}</small>}</span>
            {current && terminal && <button type="button" className="gf-btn gf-btn--ghost gf-btn--sm" onClick={() => setTerminal(null)}>Lire la carte</button>}
          </div>
          : game.phase === "sector" ? <button type="button" className={`gf-btn gf-btn--primary gf-btn--lg action-dice ${canAct ? "is-ready" : ""}`} disabled={!canAct} aria-keyshortcuts="Space" onClick={() => send({ type: "ROLL" })}>
            <Dice5 size={20} strokeWidth={1.6} aria-hidden="true" /><span>Lancer le dé</span><kbd className="keycap" aria-hidden="true">␣</kbd>
          </button>
          : game.phase === "market" ? <>
            <button type="button" className={`gf-btn ${terminal ? "gf-btn--ghost" : "gf-btn--primary gf-btn--lg"}`} onClick={() => setTerminal("market")}><ChartNoAxesCombined size={18} strokeWidth={1.6} aria-hidden="true" /> Négocier</button>
            {!terminal && <button type="button" className="gf-btn gf-btn--ghost" disabled={!canAct} onClick={() => send({ type: "END_TURN" })}>Terminer le marché <Check size={16} strokeWidth={1.75} aria-hidden="true" /></button>}
          </>
          : game.phase === "awaitNext" ? <button type="button" className="gf-btn gf-btn--primary gf-btn--lg" disabled={!canAct} onClick={() => send({ type: "NEXT_TURN" })}>Prochain investisseur <ArrowRight size={18} strokeWidth={1.75} aria-hidden="true" /></button>
          : game.phase === "geography" ? <button type="button" className={`gf-btn ${geographyVisible ? "gf-btn--ghost" : "gf-btn--primary gf-btn--lg"} action-travel`} disabled={!canAct} onClick={() => { setTerminal(null); setGeographyOpen(true); }}><Plane size={18} strokeWidth={1.6} aria-hidden="true" /> Choisir son marché</button>
          : <p className="turn-idle">{game.phase === "settlement" ? "Règlement en attente" : game.phase === "finished" ? "Séance close" : "En attente"}</p>}
        </div>
        <div className="console-fund">
          <span className="gf-kicker">Liquidités</span>
          <strong><AnimatedMoney value={active.cash} /></strong>
        </div>
      </div>
    </section>

    <section className="fund-dock" aria-label="Fonds à la table">{game.players.map(p => {
      const place = p.jailed ? "Justice" : zoneName(p.currentMarket ?? p.zone);
      return <button key={p.id} type="button" className={`investor-card dock-fund ${p.id === active.id ? "is-active" : ""} ${p.id === viewerId ? "inspecting" : ""} ${!p.solvent ? "insolvent" : ""} ${p.jailed ? "is-jailed" : ""}`}
        onClick={() => setViewerId(p.id)} aria-pressed={p.id === viewerId} style={{ "--player-color": p.color } as CSSProperties} title={`Inspecter ${p.name}`} {...hoverOn("player", p.id)}>
        <Pawn id={p.pawn} color={p.color} />
        <span className="dock-text">
          <span className="dock-head"><b>{p.name}</b>{p.bot ? <i className="dock-kind">IA</i> : <span className="sr-only"> · Humain</span>}</span>
          <small className="dock-place">
            <span>{p.jailed && <Scale size={11} strokeWidth={1.75} aria-hidden="true" />}{place}{!p.solvent && <em className="dock-flag">Insolvable</em>}</span>
            <span className="dock-place__cash" aria-hidden="true"><Wallet size={11} strokeWidth={1.75} /><AnimatedMoney value={p.cash} /></span>
          </small>
          <span className="dock-figures">
            <strong className="dock-value" title="Valeur du fonds"><span className="sr-only">Valeur du fonds </span><AnimatedMoney value={p.fundValue} /></strong>
            <span className="dock-cash" title="Liquidités"><Wallet size={11} strokeWidth={1.75} aria-hidden="true" /><span className="sr-only">Liquidités </span><AnimatedMoney value={p.cash} /></span>
          </span>
        </span>
      </button>;
    })}</section>

    <nav className="world-tools" aria-label="Consoles du fonds">
      <div className="selected-fund" title={`${viewer.name} · ${holdings.length} participations · ${controlled.length} sociétés contrôlées à 100 % (revenu minimum C/C)`}>
        <b>{viewer.name}</b>
        <span>{holdings.length} participation{holdings.length > 1 ? "s" : ""}</span>
        {controlled.length > 0 && <span className="control-summary"><Crown size={12} strokeWidth={1.75} aria-hidden="true" />{controlled.length} C/C</span>}
      </div>
      <div className="world-tools__row">
        <ToolButton icon={BriefcaseBusiness} label="Portefeuille" shortcut="P" pressed={terminal === "portfolio"} onClick={tool("portfolio")} />
        <ToolButton icon={ChartNoAxesCombined} label="Marché" shortcut="M" pressed={terminal === "market"} onClick={tool("market")} />
        <ToolButton icon={Globe2} label="Analyse" pressed={terminal === "analysis"} onClick={() => setTerminal("analysis")} />
        <ToolButton icon={BarChart3} label="Statistiques" pressed={terminal === "statistics"} onClick={() => setTerminal("statistics")} />
        <ToolButton icon={MessageSquare} label="Salon" pressed={chatOpen} badge={unreadMessages > 0 ? unreadMessages : undefined} onClick={() => setChatOpen(!chatOpen)} />
      </div>
    </nav>

    <FinancialTicker companies={game.companies} history={game.marketHistory} wire={game.log.at(-1)} />

    <AnimatePresence>
      {receipt && <motion.div key={receipt.id} className={`trade-receipt receipt-${receipt.kind}`} role="status"
        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -16, scale: 0.97 }} animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -10, transition: { duration: 0.2 } }} transition={reducedMotion ? { duration: 0.16 } : { duration: 0.42, ease: [0.22, 1, 0.36, 1] }}>
        <span className="receipt-emblem" aria-hidden="true">{receipt.kind === "control" ? <Crown size={20} strokeWidth={1.5} /> : receipt.kind === "monopoly" ? <Network size={20} strokeWidth={1.5} /> : <Check size={20} strokeWidth={1.75} />}</span>
        <div className="receipt-body"><span className="gf-kicker">{receipt.title}</span><h2>{receipt.name}</h2><p>{receipt.detail}</p></div>
        <strong className={`receipt-amount gf-num ${tone(receipt.amount)}`}>{signedMoney(receipt.amount)}</strong>
      </motion.div>}
    </AnimatePresence>
    {chatOpen && <aside className="world-chat gf-glass" aria-label="Salon de discussion">
      <header className="world-chat__head"><span className="gf-kicker">Salon <b className="gf-mono">{room.roomId}</b></span><button type="button" className="gf-icon-btn" aria-label="Fermer le chat" onClick={() => setChatOpen(false)}><X size={15} strokeWidth={1.75} aria-hidden="true" /></button></header>
      <Chat room={room} title={false} />
    </aside>}
    {terminal && <TerminalWindow key={`${viewerId}-${terminal}`} game={game} viewerId={viewerId} canAct={canAct && viewerId === active.id} tab={terminal} browseZone={browseZone} onBrowseZone={setBrowseZone} onCommand={send} onClose={() => { setTerminal(null); setGeographyOpen(true); }} />}
    {geographyVisible && <Geography game={game} destination={destination} onDestination={setDestination} onAnalyse={id => { setBrowseZone(id); setTerminal("market"); }} onCommand={send} onClose={() => setGeographyOpen(false)} />}
    {cardVisible && current && <CardScene embedded notice={current} game={authoritativeGame} onClose={visual.continueCard} />}
    {settlementVisible && settlement && <SettlementDesk key={`${settlement.id}-${settlement.debtorId}-${settlement.creditorId ?? "bank"}-${settlement.completed.length}-${settlement.status}-${settlement.marketSales?.length ?? 0}`} game={authoritativeGame} settlement={settlement} viewerId={decisionControls ? decisionId : session?.playerId ?? viewerId} canAct={canSettle} onCommand={sendSettlement} />}
    {visual.busy && !current && presentationStage === "MARKET_IMPACT" && <ConsequenceRibbon game={game} notice={notice!} gradeImpact={visual.gradeImpact} awaitingMarketConfirmation={visual.awaitingMarketConfirmation} onContinue={visual.continueImpact} />}
    {flight && <TravelCinema key={flight.id} game={visual.boardGame!} notice={flight} />}
    {game.finished && !visual.busy && <Victory game={game} />}
    <SceneLoader world={worldRef} reducedMotion={reducedMotion} />
  </main>;
}
