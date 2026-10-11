import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ArrowRight, Check, Copy, Settings2, Volume2, VolumeX, X } from "lucide-react";
import {
  PAWNS,
  PLAYER_COLORS,
  diversifyStartingMarkets,
  type PawnId,
  type RoomPlayer,
  type RoomView,
  type SeatConfig,
  type ZoneId,
} from "@global-fund/shared";
import Game from "./game/GameWorld";
import MainMenu, { Emblem } from "./game/MainMenu";
import Pawn from "./game/Pawn";
import Chat from "./game/Chat";
import StartingMarketPicker, { type MarketOccupant } from "./game/StartingMarketPicker";
import { MARKET_PLACES } from "./game/marketPlaceVisuals";
import { usePresentationSettings, setPresentationSettings } from "./presentation/settings";
import { getAudioSettings, setAudioSettings, unlockAudio, type AudioSettings } from "./presentation/audio";
import { useGameStore, createRoom, joinRoom, request } from "./store";
import { useDialogFocus } from "./presentation/useDialogFocus";
import { loadSetupDraft, saveSetupDraft } from "./setupDraft";
import "./game/game-world.css";
import "./game/app-shell.css";
import "./game/home.css";
import "./game/lobby.css";

const MenuHero = lazy(() => import("./board/three/MenuHero"));

type Screen = "menu" | "create" | "join" | "lobby" | "game";
interface HeroCast { pawns: PawnId[]; focusPawn: PawnId | null; focusZone: ZoneId | null }

const diversifiedMarkets: ZoneId[] = ["europe", "americas", "asia", "africa", "oceania", "europe"];
const marketPlace = (id: ZoneId) => MARKET_PLACES.find((place) => place.id === id);
const marketName = (id: ZoneId) => marketPlace(id)?.name ?? "Europe";
const pad2 = (value: number) => String(value).padStart(2, "0");
const DIFFICULTY: Record<SeatConfig["difficulty"], string> = { easy: "Prudente", normal: "Stratège", hard: "Experte" };
const seatColor = (index: number) => PLAYER_COLORS[index % PLAYER_COLORS.length];

/* ------------------------------------------------------------- brand -- */
function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`shell-brand${compact ? " is-compact" : ""}`} aria-label={compact ? "Global Fund" : undefined} role={compact ? "img" : undefined}>
      <Emblem className="shell-brand__emblem" />
      {!compact && <span className="shell-brand__word">GLOBAL <em>FUND</em></span>}
    </span>
  );
}

/* ---------------------------------------------------- pawn radiogroup -- */
function PawnPicker({ seat, value, onPick }: { seat: number; value: PawnId; onPick: (pawn: PawnId) => void }) {
  const group = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = PAWNS.findIndex((pawn) => pawn.id === value);
    const next = PAWNS[(index + step + PAWNS.length) % PAWNS.length]!;
    onPick(next.id);
    group.current?.querySelector<HTMLButtonElement>(`[data-pawn="${next.id}"]`)?.focus();
  };
  return (
    <div ref={group} className="pawn-picker" role="radiogroup" aria-label={`Pion du joueur ${seat}`} onKeyDown={move}>
      {PAWNS.map((pawn) => {
        const checked = value === pawn.id;
        return (
          <button
            key={pawn.id}
            type="button"
            role="radio"
            data-pawn={pawn.id}
            aria-label={pawn.name}
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            title={`${pawn.name} · ${pawn.label}`}
            className={checked ? "selected" : ""}
            onClick={() => onPick(pawn.id)}
          >
            <Pawn id={pawn.id} size={32} />
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------- setup and joining -- */
function Home({ mode, onBack, onMode, onCast }: {
  mode: "create" | "join";
  onBack: () => void;
  onMode: (mode: "create" | "join") => void;
  onCast: (cast: HeroCast) => void;
}) {
  const [initialDraft] = useState(() => {
    const draft = loadSetupDraft();
    const invitation = new URLSearchParams(location.search).get("room");
    return invitation ? { ...draft, join: invitation.slice(0, 8) } : draft;
  });
  const [allSeats, setAllSeats] = useState<SeatConfig[]>(initialDraft.seats);
  const [seatCount, setSeatCount] = useState(initialDraft.seatCount);
  const seats = allSeats.slice(0, seatCount);
  const [join, setJoin] = useState(initialDraft.join);
  const [name, setName] = useState(initialDraft.name);
  const [startingMarket, setStartingMarket] = useState<ZoneId>(initialDraft.startingMarket);
  const [joinPawn, setJoinPawn] = useState<PawnId>(initialDraft.joinPawn);
  const [createStep, setCreateStep] = useState<"funds" | "markets">(initialDraft.createStep);
  const [activeHuman, setActiveHuman] = useState(initialDraft.activeHuman);
  const [lastPawn, setLastPawn] = useState<PawnId | null>(null);
  // Hovered or focused city card: the 3D globe previews it (presentation only, never saved).
  const [previewZone, setPreviewZone] = useState<ZoneId | null>(null);
  const pending = useGameStore((s) => s.pending);
  const connected = useGameStore((s) => s.connected);
  useEffect(() => {
    saveSetupDraft({ seats: allSeats, seatCount, createStep, activeHuman, join, name, startingMarket, joinPawn });
  }, [allSeats, seatCount, createStep, activeHuman, join, name, startingMarket, joinPawn]);
  const update = (index: number, patch: Partial<SeatConfig>) =>
    setAllSeats((current) => current.map((seat, i) => (i === index ? { ...seat, ...patch } : seat)));
  const resize = (count: number) => {
    setAllSeats((current) => Array.from(
      { length: Math.max(count, current.length) },
      (_, i) => current[i] || {
        name: `Fonds ${i + 1}`,
        kind: "ai",
        startingMarket: diversifiedMarkets[i],
        pawn: PAWNS[i].id,
        difficulty: "normal",
      },
    ));
    setSeatCount(count);
  };
  const plannedSeats = diversifyStartingMarkets(seats);
  const humanSeats = seats.flatMap((seat, index) => (seat.kind === "ai" ? [] : [{ seat, index }]));
  const activeHumanIndex = humanSeats.some(({ index }) => index === activeHuman) ? activeHuman : (humanSeats[0]?.index ?? 0);
  const activeHumanSeat = seats[activeHumanIndex];
  const aiSeats = plannedSeats.flatMap((seat, index) => (seat.kind === "ai" ? [{ seat, index }] : []));
  const occupants: Partial<Record<ZoneId, MarketOccupant[]>> = {};
  plannedSeats.forEach((seat, index) => {
    (occupants[seat.startingMarket] ??= []).push({ pawn: seat.pawn, name: seat.name || `Fonds ${index + 1}`, color: seatColor(index) });
  });
  const missingName = seats.some((seat) => !seat.name.trim());
  const blocked = pending || !connected || missingName;
  const blockedReason = !connected ? "Connexion au serveur…" : missingName ? "Chaque fonds doit porter un nom." : "";

  // The 3D backdrop shows the configured figurines, the last one touched in front.
  const seatPawns = seats.map((seat) => seat.pawn).join(",");
  const focus = mode === "join" ? joinPawn : lastPawn && seats.some((seat) => seat.pawn === lastPawn) ? lastPawn : (seats[0]?.pawn ?? null);
  // While a starting market is being chosen, the globe turns to that city (or to the card under the pointer).
  const chosenZone = mode === "join" ? startingMarket : createStep === "markets" ? activeHumanSeat?.startingMarket ?? null : null;
  const focusZone = chosenZone && previewZone ? previewZone : chosenZone;
  useEffect(() => { setPreviewZone(null); }, [mode, createStep]);
  useEffect(() => {
    onCast({ pawns: mode === "join" ? [joinPawn] : (seatPawns.split(",") as PawnId[]), focusPawn: focus, focusZone });
  }, [mode, joinPawn, seatPawns, focus, focusZone, onCast]);

  const switchLink = (
    <button type="button" className="gf-btn gf-btn--quiet gf-btn--sm gf-setup__switch" onClick={() => onMode(mode === "create" ? "join" : "create")}>
      {mode === "create" ? "J’ai déjà un code d’invitation →" : "Créer une nouvelle partie →"}
    </button>
  );

  return (
    <main className={`home-scene home-${mode}`}>
      <section className="gf-setup gf-glass" aria-labelledby="gf-setup-title">
        <div className="gf-setup__nav">
          <button type="button" className="gf-btn gf-btn--quiet gf-btn--sm gf-setup__back" onClick={onBack}>← Retour au menu</button>
          {switchLink}
        </div>

        {mode === "create" ? (
          <>
            <header className="gf-setup__head">
              <ol className="gf-steps" aria-label="Étapes de création">
                <li className={createStep === "funds" ? "is-current" : "is-done"} aria-current={createStep === "funds" ? "step" : undefined}>
                  <i aria-hidden="true">{createStep === "funds" ? "1" : <Check size={11} strokeWidth={3} />}</i>
                  <span>Fonds</span>
                </li>
                <li className={createStep === "markets" ? "is-current" : ""} aria-current={createStep === "markets" ? "step" : undefined}>
                  <i aria-hidden="true">2</i>
                  <span>Places financières</span>
                </li>
              </ol>
              <div className="gf-setup__title">
                <h1 id="gf-setup-title" className="gf-display">{createStep === "funds" ? "Composez la table." : "Choisissez vos places."}</h1>
                {createStep === "funds" && (
                  <label className="gf-setup__count">
                    <span>Fonds à la table</span>
                    <select aria-label="Nombre de joueurs" value={seats.length} onChange={(e) => resize(Number(e.target.value))}>
                      {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                )}
              </div>
            </header>

            {createStep === "funds" ? (
              <div className="gf-setup__body fund-setup-step" data-testid="setup-step-funds" key="funds">
                <ol className="seat-list">
                  {seats.map((seat, index) => (
                    <li className={`seat-row is-${seat.kind}`} key={index} style={{ "--seat-color": seatColor(index), "--i": index } as CSSProperties}>
                      <span className="seat-row__num" aria-hidden="true"><i />{pad2(index + 1)}</span>
                      <input
                        className="seat-row__name"
                        aria-label={`Nom du fonds ${index + 1}`}
                        value={seat.name}
                        maxLength={40}
                        spellCheck={false}
                        onChange={(e) => update(index, { name: e.target.value })}
                      />
                      <select
                        className="seat-row__kind"
                        aria-label={`Type du joueur ${index + 1}`}
                        value={seat.kind}
                        disabled={index === 0}
                        title={index === 0 ? "Votre fonds, joué sur cet écran" : undefined}
                        onChange={(e) => update(index, { kind: e.target.value as SeatConfig["kind"] })}
                      >
                        <optgroup label="Humain">
                          <option value="local">Même écran</option>
                          <option value="remote">À distance</option>
                        </optgroup>
                        <option value="ai">IA</option>
                      </select>
                      {seat.kind === "ai" ? (
                        <select
                          className="seat-row__level"
                          aria-label={`Difficulté de l’IA ${index + 1}`}
                          value={seat.difficulty}
                          onChange={(e) => update(index, { difficulty: e.target.value as SeatConfig["difficulty"] })}
                        >
                          <option value="easy">Prudente</option>
                          <option value="normal">Stratège</option>
                          <option value="hard">Experte</option>
                        </select>
                      ) : (
                        <span className="seat-row__level is-empty" aria-hidden="true" />
                      )}
                      <PawnPicker seat={index + 1} value={seat.pawn} onPick={(pawn) => { update(index, { pawn }); setLastPawn(pawn); }} />
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <div className="gf-setup__body market-setup-step" data-testid="setup-step-markets" key="markets">
                <div className="market-player-tabs" role="group" aria-label="Fonds humains">
                  {humanSeats.map(({ seat, index }) => (
                    <button
                      key={index}
                      type="button"
                      data-testid={`market-player-tab-${index}`}
                      aria-pressed={activeHumanIndex === index}
                      className={activeHumanIndex === index ? "is-active" : ""}
                      style={{ "--seat-color": seatColor(index) } as CSSProperties}
                      onClick={() => { setActiveHuman(index); setLastPawn(seat.pawn); }}
                    >
                      <Pawn id={seat.pawn} color={seatColor(index)} size={30} />
                      <span className="market-tab__text">
                        <span>{seat.name || `Fonds ${index + 1}`}</span>
                        <em>{marketPlace(seat.startingMarket)?.city}</em>
                      </span>
                    </button>
                  ))}
                </div>
                {activeHumanSeat && (
                  <StartingMarketPicker
                    value={activeHumanSeat.startingMarket}
                    label={`Place de marché de ${activeHumanSeat.name || `Fonds ${activeHumanIndex + 1}`}`}
                    hideLegend
                    occupants={occupants}
                    onChange={(market) => update(activeHumanIndex, { startingMarket: market })}
                    onPreview={setPreviewZone}
                  />
                )}
                {aiSeats.length > 0 && (
                  <div className="automatic-markets" role="group" aria-label="Implantations automatiques des IA">
                    <span className="automatic-markets__label">Placement IA</span>
                    {aiSeats.map(({ seat, index }) => (
                      <span
                        key={index}
                        className="automatic-market"
                        title={`${seat.name} · ${marketName(seat.startingMarket)}`}
                        style={{ "--seat-color": seatColor(index) } as CSSProperties}
                      >
                        <Pawn id={seat.pawn} color={seatColor(index)} size={20} />
                        <span>{seat.name}</span>
                        <b>{marketPlace(seat.startingMarket)?.city}</b>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <footer className="gf-setup__foot">
              {createStep === "funds" ? (
                <span className="gf-setup__reason" aria-live="polite">{blockedReason}</span>
              ) : (
                <button type="button" className="gf-btn gf-btn--quiet gf-setup__prev" onClick={() => setCreateStep("funds")}>← Configuration des fonds</button>
              )}
              {createStep === "funds" ? (
                <button className="gf-btn gf-btn--primary gf-btn--lg start-button" disabled={blocked} onClick={() => setCreateStep("markets")}>
                  Choisir les places financières <ArrowRight size={18} />
                </button>
              ) : (
                <button className="gf-btn gf-btn--primary gf-btn--lg start-button" disabled={blocked} onClick={() => void createRoom(plannedSeats)}>
                  Créer ma partie <ArrowRight size={18} />
                </button>
              )}
            </footer>
          </>
        ) : (
          <form
            className="join-form"
            onSubmit={(e) => {
              e.preventDefault();
              void joinRoom(join, name, startingMarket, joinPawn);
            }}
          >
            <header className="gf-setup__head">
              <div className="gf-setup__title">
                <h1 id="gf-setup-title" className="gf-display">Rejoindre un salon.</h1>
              </div>
            </header>
            <div className="gf-setup__body join-form__body">
              <div className="join-fields">
                <label className="join-field join-field--code">
                  <span>Code du salon</span>
                  <input
                    aria-label="Code du salon"
                    placeholder="A1B2C3D4"
                    value={join}
                    onChange={(e) => setJoin(e.target.value.toUpperCase())}
                    maxLength={8}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label className="join-field">
                  <span>Nom de votre fonds</span>
                  <input aria-label="Nom pour rejoindre" placeholder="Ex. Aster Capital" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} required />
                </label>
                <label className="join-field join-field--pawn">
                  <span>Votre pion</span>
                  <span className="join-pawn">
                    <Pawn id={joinPawn} size={30} />
                    <select aria-label="Pion pour rejoindre" value={joinPawn} onChange={(e) => setJoinPawn(e.target.value as PawnId)}>
                      {PAWNS.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} · {p.label}</option>
                      ))}
                    </select>
                  </span>
                </label>
              </div>
              <StartingMarketPicker value={startingMarket} label="Votre place de départ" onChange={setStartingMarket} onPreview={setPreviewZone} />
            </div>
            <footer className="gf-setup__foot">
              <span className="gf-setup__reason" aria-live="polite">{!connected ? "Connexion au serveur…" : ""}</span>
              <button className="gf-btn gf-btn--primary gf-btn--lg start-button" disabled={!join || !name || pending || !connected}>
                Rejoindre <ArrowRight size={18} />
              </button>
            </footer>
          </form>
        )}
      </section>
    </main>
  );
}

/* --------------------------------------------------------------- lobby -- */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall back below */ }
  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand("copy");
    field.remove();
    return ok;
  } catch {
    return false;
  }
}

function LobbySeat({ player, index, you, onSpotlight }: {
  player: RoomPlayer;
  index: number;
  you: boolean;
  /** Hovering a seat puts that figurine in the light on the 3D table (presentation only). */
  onSpotlight: (pawn: PawnId | null) => void;
}) {
  const state = player.ready ? "ready" : player.connected ? "waiting" : "absent";
  const status = player.ready ? "Prêt à investir" : player.connected ? "Connexion établie · en attente" : "En attente de votre invité";
  return (
    <article
      className={`lobby-player is-${state} ${index % 2 === 0 ? "is-left" : "is-right"}${you ? " you" : ""}`}
      style={{ "--seat-color": player.color, "--row": Math.floor(index / 2) + 1, "--i": index } as CSSProperties}
      onPointerMove={() => onSpotlight(player.pawn)}
      onPointerLeave={() => onSpotlight(null)}
    >
      <span className="lobby-player__pawn">
        <Pawn id={player.pawn} color={player.color} size={56} />
      </span>
      <div className="lobby-player__body">
        <div className="lobby-player__meta">
          <span className="lobby-player__seat">Fonds {pad2(index + 1)}{you && <em> · vous</em>}</span>
          <i className="lobby-tag">{player.kind === "ai" ? "IA" : player.kind === "remote" ? "DISTANT" : "LOCAL"}</i>
          {player.kind === "ai" && <span className="ai-level">{DIFFICULTY[player.difficulty]}</span>}
        </div>
        <h3>{player.name}</h3>
        <p className="lobby-player__market">{marketName(player.startingMarket)} <span>· {marketPlace(player.startingMarket)?.city}</span></p>
        <p className="lobby-player-status"><i aria-hidden="true" />{status}</p>
      </div>
    </article>
  );
}

function Lobby({ room, onSpotlight }: { room: RoomView; onSpotlight: (pawn: PawnId | null) => void }) {
  const session = useGameStore((s) => s.session);
  const pending = useGameStore((s) => s.pending);
  const host = session?.playerId === room.hostId;
  const own = room.players.find((p) => p.id === session?.playerId);
  const allReady = room.players.every((p) => p.kind !== "remote" || (p.connected && p.ready));
  const [copied, setCopied] = useState(false);
  // Leaving the lobby clears the spotlight (pointerleave never fires on unmount).
  useEffect(() => () => onSpotlight(null), [onSpotlight]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2400);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = () => {
    void copyText(`${location.origin}?room=${room.roomId}`).then((ok) => { if (ok) setCopied(true); });
  };
  return (
    <main className="lobby-scene" style={{ "--seat-rows": Math.ceil(room.players.length / 2) } as CSSProperties}>
      <header className="lobby-head">
        <h1 className="gf-display">Le capital vous attend.</h1>
        <ul className="lobby-facts" aria-label="La partie">
          <li><b>100 M€</b> par fonds</li>
          <li><b>100</b> contextes</li>
          <li><b>50</b> événements</li>
          <li><b>52</b> semaines</li>
        </ul>
        <div className="room-code">
          <small>CODE D’INVITATION</small>
          <b className="gf-mono">{room.roomId}</b>
          <button type="button" className={`gf-btn gf-btn--ghost gf-btn--sm room-code__copy${copied ? " is-copied" : ""}`} onClick={copy} title="Copier le lien d’invitation">
            {copied ? <Check size={14} strokeWidth={2.2} aria-hidden="true" /> : <Copy size={14} strokeWidth={1.8} aria-hidden="true" />}
            {copied ? "Copié" : "Inviter"}
          </button>
          <span className="sr-only" aria-live="polite">{copied ? "Lien copié" : ""}</span>
        </div>
      </header>

      {room.players.map((player, index) => (
        <LobbySeat key={player.id} player={player} index={index} you={player.id === session?.playerId} onSpotlight={onSpotlight} />
      ))}

      <div className="lobby-chat">
        <Chat room={room} />
      </div>

      <div className="lobby-dock">
        <div className="lobby-dock__actions">
          <button type="button" className="gf-btn gf-btn--ghost gf-btn--lg lobby-dock__back" onClick={() => useGameStore.getState().reset()}>
            Retour à l’accueil
          </button>
          {host ? (
            <button
              type="button"
              className="gf-btn gf-btn--primary gf-btn--lg lobby-dock__main"
              disabled={pending || !allReady}
              onClick={() => void request("room:start", { roomId: room.roomId })}
            >
              Ouvrir le parquet <ArrowRight size={18} />
            </button>
          ) : (
            <button
              type="button"
              className={`gf-btn ${own?.ready ? "gf-btn--ghost" : "gf-btn--primary"} gf-btn--lg lobby-dock__main`}
              disabled={pending}
              onClick={() => void request("room:ready", { roomId: room.roomId, ready: !own?.ready })}
            >
              {own?.ready ? "Annuler mon état prêt" : "Je suis prêt"} <Check size={17} />
            </button>
          )}
        </div>
        {!allReady && host && <p className="lobby-ready-note">Ouverture dès que chaque invité est prêt.</p>}
      </div>
    </main>
  );
}

/* ------------------------------------------------------------ dialogs -- */
const CHANNELS: Array<[keyof Omit<AudioSettings, "muted">, string]> = [
  ["master", "Volume général"],
  ["music", "Musique"],
  ["ambience", "Ambiance"],
  ["effects", "Effets"],
];

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const dialog = useDialogFocus(onClose);
  const [values, setValues] = useState(getAudioSettings());
  const presentation = usePresentationSettings();
  const update = (v: Partial<AudioSettings>) => {
    void unlockAudio();
    setValues(setAudioSettings(v));
  };
  return (
    <div className="shell-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <section ref={dialog} tabIndex={-1} className="shell-modal settings-panel gf-glass">
        <header className="shell-modal__head">
          <h2 id="settings-title" className="gf-display">Paramètres</h2>
          <button type="button" className="gf-icon-btn shell-modal__close" aria-label="Fermer les paramètres" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <div className="settings-group">
          <h3 className="settings-group__title">Son</h3>
          <label className="settings-row">
            <span>Son activé</span>
            <input type="checkbox" role="switch" className="shell-switch" checked={!values.muted} onChange={(e) => update({ muted: !e.target.checked })} />
          </label>
          {CHANNELS.map(([channel, label]) => (
            <label key={channel} className={`settings-row settings-row--range${values.muted ? " is-muted" : ""}`}>
              <span>{label}</span>
              <input
                aria-label={label}
                className="shell-range"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={values[channel]}
                style={{ "--fill": `${Math.round(values[channel] * 100)}%` } as CSSProperties}
                onChange={(e) => update({ [channel]: Number(e.target.value) })}
              />
              <output className="gf-num">{Math.round(values[channel] * 100)}</output>
            </label>
          ))}
          <p className="settings-note">Musique et ambiance : pistes à venir.</p>
        </div>

        <div className="settings-group">
          <h3 className="settings-group__title">Affichage</h3>
          <label className="settings-row">
            <span>Réduire les animations</span>
            <input type="checkbox" role="switch" className="shell-switch" checked={presentation.reducedMotion} onChange={(e) => setPresentationSettings({ reducedMotion: e.target.checked })} />
          </label>
          <label className="settings-row">
            <span>Qualité graphique</span>
            <select aria-label="Qualité graphique" value={presentation.quality} onChange={(e) => setPresentationSettings({ quality: e.target.value as "high" | "medium" | "low" })}>
              <option value="high">Haute</option>
              <option value="medium">Moyenne</option>
              <option value="low">Basse</option>
            </select>
          </label>
        </div>

        <footer className="shell-modal__foot">
          <a className="settings-credits" href="/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noreferrer">Crédits et licences</a>
          <button type="button" className="gf-btn gf-btn--primary" onClick={onClose}>Reprendre la séance</button>
        </footer>
      </section>
    </div>
  );
}

const RULES: Array<[string, string]> = [
  ["Ouverture", "Toutes les notes partent de C. Chaque fonds choisit gratuitement sa première place de marché."],
  ["Ordre du jeu", "Le plus haut dé de départ commence. L’ordre ne change plus ; les fonds insolvables sont sautés."],
  ["Contexte", "Dès le cycle 2, une carte Contexte commune ajuste les notes des zones et des secteurs."],
  ["Voyage", "Puis, avant le dé : rester gratuitement ou voyager pour 1 M€."],
  ["Le circuit", "Avancez sur les 52 semaines. Case secteur : payez les autres détenteurs au prorata de leurs parts. Vos parts vous rapportent quand un autre fonds s’y arrête, jamais sur votre propre passage."],
  ["Événements", "Une case Événement tire une carte : prime, vente forcée ou enquête. Bull, Bear et Crash font bouger le marché."],
  ["Trading", "Ordres dans votre zone active. Une société = 5 parts de 20 %. Contrôle total : revenu minimum C/C. Tout un groupe zone/secteur : A/A."],
  ["Départ", "Passer le Départ rapporte 20 M€ de capitaux si la performance du tour est positive, et en retire 20 M€ si elle est négative."],
  ["Liquidation", "Une société notée E/E est liquidée. Elle revient dès qu’une de ses notes remonte."],
  ["Détention", "Elle suspend le trading et les revenus."],
  ["Fin", "Après le cycle de la 100e carte Contexte, ou quand un seul fonds reste solvable. La plus forte valeur de fonds gagne."],
];

function RulesDialog({ onClose }: { onClose: () => void }) {
  const dialog = useDialogFocus(onClose);
  return (
    <div className="shell-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="rules-title">
      <section className="shell-modal rules-panel gf-glass" ref={dialog} tabIndex={-1}>
        <header className="shell-modal__head">
          <div>
            <span className="gf-kicker">Règles</span>
            <h2 id="rules-title" className="gf-display">Faire grandir votre fonds.</h2>
          </div>
          <button type="button" className="gf-icon-btn shell-modal__close" aria-label="Fermer les règles" onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        <p className="rules-lead">2 à 6 fonds démarrent avec <b>100 M€</b>. Valeur du fonds = liquidités + valeur actuelle des participations.</p>
        <ol className="rules-list">
          {RULES.map(([term, text]) => (
            <li key={term}>
              <b>{term}</b>{" "}
              <span>{text}</span>
            </li>
          ))}
        </ol>
        <footer className="shell-modal__foot">
          <button type="button" className="gf-btn gf-btn--primary" onClick={onClose}>
            Prendre place à la table <ArrowRight size={17} />
          </button>
        </footer>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- app -- */
export default function App() {
  const room = useGameStore((s) => s.room);
  const connected = useGameStore((s) => s.connected);
  const error = useGameStore((s) => s.error);
  const pending = useGameStore((s) => s.pending);
  const session = useGameStore((s) => s.session);
  const presentation = usePresentationSettings();
  const [settings, setSettings] = useState(false);
  const [audio, setAudio] = useState(getAudioSettings());
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const [menuScreen, setMenuScreen] = useState<"menu" | "create" | "join">(new URLSearchParams(location.search).get("room") ? "join" : "menu");
  const [rules, setRules] = useState(false);
  const [cast, setCast] = useState<HeroCast>({ pawns: [], focusPawn: null, focusZone: null });
  const [spotlight, setSpotlight] = useState<PawnId | null>(null);
  useEffect(() => {
    const gesture = () => void unlockAudio();
    window.addEventListener("pointerdown", gesture, { once: true });
    return () => window.removeEventListener("pointerdown", gesture);
  }, []);

  const screen: Screen = room ? (room.status === "lobby" ? "lobby" : "game") : menuScreen;
  const heroVariant = screen === "game" ? null : screen === "menu" ? "menu" : screen === "lobby" ? "lobby" : "setup";
  const ownPawn = room?.players.find((p) => p.id === session?.playerId)?.pawn ?? null;
  const castKey = screen === "lobby" && room ? room.players.map((p) => p.pawn).join(",") : heroVariant === "setup" ? cast.pawns.join(",") : "";
  const castFocus = screen === "lobby" ? (spotlight ?? ownPawn) : heroVariant === "setup" ? cast.focusPawn : null;
  // Stable identity: the persistent 3D backdrop only reacts to real cast changes.
  const heroPawns = useMemo(() => (castKey ? (castKey.split(",") as PawnId[]) : undefined), [castKey]);

  return (
    <div
      className={`app app-shell ${screen === "game" ? "is-playing" : screen === "menu" ? "is-menu" : ""}`}
      data-screen={screen}
    >
      {heroVariant && (
        <Suspense fallback={<div className="shell-hero-fallback" aria-hidden="true" />}>
          <MenuHero
            variant={heroVariant}
            pawns={heroPawns}
            focusPawn={castFocus}
            focusZone={heroVariant === "setup" ? cast.focusZone : null}
            reducedMotion={presentation.reducedMotion}
            quality={presentation.quality}
          />
        </Suspense>
      )}

      <header className="topbar shell-topbar">
        {screen !== "menu" && <Brand compact={screen === "game"} />}
        <div className="shell-tools">
          <span className={`shell-connection ${connected ? "is-online" : "is-offline"}`} role="status">
            <i aria-hidden="true" />
            {connected ? "Serveur connecté" : "Reconnexion…"}
          </span>
          <button
            type="button"
            className="gf-icon-btn shell-tool"
            aria-label={audio.muted ? "Activer le son" : "Couper le son"}
            title={audio.muted ? "Activer le son" : "Couper le son"}
            onClick={() => {
              void unlockAudio();
              setAudio(setAudioSettings({ muted: !audio.muted }));
            }}
          >
            {audio.muted ? <VolumeX size={16} strokeWidth={1.7} /> : <Volume2 size={16} strokeWidth={1.7} />}
          </button>
          <button type="button" className="gf-icon-btn shell-tool" aria-label="Paramètres" title="Paramètres" onClick={() => setSettings(true)}>
            <Settings2 size={16} strokeWidth={1.7} />
          </button>
        </div>
      </header>

      {pending && (
        <div className="shell-pending" role="status">
          <span className="sr-only">Transmission au parquet…</span>
        </div>
      )}

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button aria-label="Fermer le message d’erreur" onClick={() => useGameStore.setState({ error: "" })}>
            <X size={16} />
          </button>
          {!room && session && !resumeDismissed && (
            <button
              onClick={() => {
                useGameStore.getState().reset();
                setResumeDismissed(true);
              }}
            >
              Nouvelle session
            </button>
          )}
        </div>
      )}

      {!room ? (
        menuScreen === "menu" ? (
          <MainMenu
            onNew={() => setMenuScreen("create")}
            onJoin={() => setMenuScreen("join")}
            onSettings={() => setSettings(true)}
            onRules={() => setRules(true)}
            onResume={session ? () => { void request("room:resume", session); } : undefined}
            resumeCode={session?.roomId}
          />
        ) : (
          <Home mode={menuScreen} onBack={() => setMenuScreen("menu")} onMode={setMenuScreen} onCast={setCast} />
        )
      ) : room.status === "lobby" ? (
        <Lobby room={room} onSpotlight={setSpotlight} />
      ) : (
        <Suspense
          fallback={
            <div className="parquet-loading" role="status">
              <Emblem className="parquet-loading__emblem" />
              <span>Préparation du parquet mondial…</span>
            </div>
          }
        >
          <Game room={room} />
        </Suspense>
      )}

      {settings && (
        <SettingsDialog
          onClose={() => {
            setSettings(false);
            setAudio(getAudioSettings());
          }}
        />
      )}
      {rules && <RulesDialog onClose={() => setRules(false)} />}
    </div>
  );
}
