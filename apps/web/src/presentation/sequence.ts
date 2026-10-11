import type { GameNotice, GameView, GradeChange, Player } from "@global-fund/shared";
import { isMarketId } from "@global-fund/shared";

/** This clock orders server results; it never resolves rules or creates commands. */
export type PresentationStage = "TURN_START" | "TRAVEL_DECISION" | "TRAVEL_RESOLUTION" | "BOARD_FOCUS" | "WAITING_FOR_DICE" | "DICE_ROLLING" | "DICE_RESULT" | "PAWN_MOVING" | "PAWN_ARRIVAL" | "SPACE_REVEAL" | "CARD_READING" | "CARD_DISMISS" | "MARKET_IMPACT" | "TRADING" | "TURN_END";
export interface BoardTimeline {
  noticeId: number; playerId: string; roll: number; fromPosition: number; toPosition: number;
  diceStartedAt: number; motionStartedAt: number; motionStepMs: number;
}
/** Visible beats of the 3D table (ms). Values only pace the presentation of facts already decided by the server. */
export const PRESENTATION_TIMING = { focus: 260, travel: 6500, dice: 1300, result: 560, step: 220, arrival: 900, reveal: 260, dismiss: 220, grade: 420, prices: 420 } as const;
export function idleStage(game: GameView): PresentationStage {
  return game.phase === "geography" ? "TRAVEL_DECISION" : game.phase === "sector" ? "WAITING_FOR_DICE" : game.phase === "market" ? "TRADING" : "TURN_END";
}
const copy = <T,>(value: T): T => structuredClone(value);
const round = (value: number) => Math.round(value * 100) / 100;
const playerFlags: (keyof Player)[] = ["jailed", "prisonStage", "prisonWait", "zone", "currentMarket", "previousZone", "geoResolved", "solvent", "lapStartValue", "capitalFlows", "lapStartCapitalFlows", "lapPerformance"];

/** A lap's cash movement is reported in the later payments notice by the engine.
 * Give it to the lap in this detached visual ledger, once, in chronological order. */
function visualLedger(notices: GameNotice[]): GameNotice[] {
  const ledger = copy(notices);
  for (let i = 0; i < ledger.length; i++) {
    const notice = ledger[i];
    const lap = ledger.slice(0, i).reverse().find(n => n.action === "lap" && n.playerId === notice.playerId && n.cycle === notice.cycle);
    if (!lap) continue;
    const capital = notice.payments?.filter(p => /Performance au Départ/i.test(p.reason ?? "")) ?? [];
    if (!capital.length) continue;
    lap.payments = [...(lap.payments ?? []), ...capital];
    notice.payments = notice.payments?.filter(p => !capital.includes(p));
  }
  return ledger;
}

/** Undo only recorded facts. On reconnection the server does not supply historical
 * income/basis/prison-stage metadata. Income uses the received price ratio; erased
 * purchase averages remain unknown (null). A live previous snapshot is exact. */
export function reverseNotice(after: GameView, notice: GameNotice, previous?: GameView): GameView {
  const before = copy(after);
  for (const change of notice.gradeChanges ?? []) {
    (change.scope === "zone" ? before.zoneGrades : before.sectorGrades)[change.id] = change.before;
  }
  const restored = new Set<string>();
  for (const impact of notice.companyImpacts ?? []) {
    const company = before.companies.find(c => c.id === impact.companyId);
    if (!company) continue;
    const old = previous?.companies.find(c => c.id === company.id);
    company.price = impact.beforePrice;
    company.available = impact.bankruptcy ? true : impact.returned ? false : company.available;
    company.income = old?.price === impact.beforePrice ? old.income : round(impact.beforePrice * company.baseIncome / company.basePrice);
    for (const shares of impact.sharesChanged ?? []) {
      company.holdings[shares.playerId] = shares.before;
      restored.add(`${company.id}:${shares.playerId}`);
    }
  }
  const restoreSale = (companyId: string, playerId: string, quantity: number) => {
    const company = before.companies.find(c => c.id === companyId);
    if (!company || restored.has(`${companyId}:${playerId}`)) return;
    company.holdings[playerId] = (company.holdings[playerId] ?? 0) + quantity;
  };
  for (const impact of notice.playerImpacts ?? []) {
    const player = before.players.find(p => p.id === impact.playerId);
    if (!player) continue;
    player.cash = round(player.cash - impact.cash);
    player.fundValue = round(player.fundValue - impact.valuation);
    if (player.valuation != null) player.valuation = round(player.valuation - impact.valuation);
    if (impact.prison != null) {
      const old = previous?.players.find(p => p.id === player.id);
      player.jailed = !impact.prison;
      if (old) for (const key of playerFlags) Object.assign(player, { [key]: old[key] });
      else if (impact.prison) {
        player.zone = player.previousZone ?? notice.fromZoneId ?? null;
        player.currentMarket = isMarketId(player.zone) ? player.zone : null;
      }
    }
    for (const sale of impact.sharesSold ?? []) restoreSale(sale.companyId, player.id, sale.quantity);
  }
  // Player impacts already describe the entire cash/valuation movement of events.
  if (!notice.playerImpacts?.length) for (const payment of notice.payments ?? []) {
    const payer = before.players.find(p => p.id === payment.fromId);
    const payee = before.players.find(p => p.id === payment.toId);
    const sales = payment.forcedSales ?? [];
    const proceeds = sales.reduce((sum, sale) => sum + (sale.amount ?? (sale.perShare ?? 0) * sale.quantity), 0);
    if (payer) {
      payer.cash = round(payer.cash + payment.amount - proceeds);
      payer.fundValue = round(payer.fundValue + payment.amount);
      if (payer.valuation != null) payer.valuation = round(payer.valuation + payment.amount);
      for (const sale of sales) restoreSale(sale.companyId, payer.id, sale.quantity);
    }
    if (payee) {
      payee.cash = round(payee.cash - payment.amount);
      payee.fundValue = round(payee.fundValue - payment.amount);
      if (payee.valuation != null) payee.valuation = round(payee.valuation - payment.amount);
    }
  }
  if (notice.action === "move") {
    const player = before.players.find(p => p.id === notice.playerId);
    if (player) {
      player.zone = notice.fromZoneId ?? null;
      player.currentMarket = isMarketId(player.zone) ? player.zone : null;
      player.geoResolved = false;
    }
  }
  if (notice.action === "prisonRoll") {
    const player = before.players.find(p => p.id === notice.playerId);
    const old = previous?.players.find(p => p.id === notice.playerId);
    if (player && old) Object.assign(player, copy(old));
    else if (player && !player.jailed) { player.jailed = true; player.zone = "prison"; player.currentMarket = null; }
  }
  for (const company of before.companies) {
    company.totalHeld = Object.values(company.holdings).reduce((sum, quantity) => sum + quantity, 0);
    company.sharesAvailable = company.available ? Math.max(0, 5 - company.totalHeld) : 0;
    const old = previous?.companies.find(c => c.id === company.id);
    for (const [playerId, quantity] of Object.entries(company.holdings)) {
      if (!quantity) continue;
      if (old && old.holdings[playerId] === quantity) {
        company.averageBuyPrice[playerId] = old.averageBuyPrice[playerId] ?? null;
        if (old.costBasis) { company.costBasis ??= {}; company.costBasis[playerId] = old.costBasis[playerId] ?? null; }
      } else if (!(playerId in company.averageBuyPrice)) company.averageBuyPrice[playerId] = null;
    }
  }
  return before;
}

interface NoticeFrames { notice: GameNotice; before: GameView; after: GameView; acknowledgedIds: number[] }
/** A synchronous funded operation already has a final receipt. Fold its debt
 * announcement into that receipt, after reversing the original ledger facts. */
function consolidateSettlements(frames: NoticeFrames[]): NoticeFrames[] {
  const combined: NoticeFrames[] = [];
  for (let i = 0; i < frames.length; i++) {
    const first = frames[i];
    const final = frames[i + 1];
    const results = final?.notice.settlements;
    const obligations = first.notice.obligations;
    const sameOperation = obligations?.length && results?.length
      && first.notice.cycle === final.notice.cycle
      && first.notice.kind === "payments"
      && obligations.every(debt => results.some(result => result.debtorId === debt.debtorId
        && result.creditorId === debt.creditorId && result.amount === debt.amount && result.reason === debt.reason));
    if (!sameOperation) { combined.push(first); continue; }
    combined.push({
      notice: { ...first.notice, ...final.notice, roll: first.notice.roll, position: first.notice.position,
        payments: final.notice.payments, obligations: undefined },
      before: first.before, after: final.after,
      acknowledgedIds: [...first.acknowledgedIds, ...final.acknowledgedIds],
    });
    i++;
  }
  return combined;
}
interface RollGroup { start: number; roll: GameNotice | null; signature: string; timeline: BoardTimeline | null; beforePositions: Record<string, number>; afterPositions: Record<string, number> }
export class PresentationSequence {
  readonly frames: NoticeFrames[];
  stage: PresentationStage;
  index = 0;
  gradeIndex = -1;
  deadline: number | null = null;
  private reducedMotion: boolean;
  private historical: GameView["marketHistory"];
  private historicalLog: string[];
  private groups: RollGroup[] = [];
  private frameGroups: RollGroup[] = [];
  private committedStage: string | null = null;
  constructor(readonly target: GameView, notices: GameNotice[], previous: GameView | undefined, now: number, reducedMotion = false) {
    this.reducedMotion = reducedMotion;
    this.historical = previous?.marketHistory ?? target.marketHistory.filter(point => point.cycle < Math.min(...notices.map(n => n.cycle)));
    this.historicalLog = previous?.log ?? [];
    const ledger = visualLedger(notices);
    const announcementId = target.pendingSettlement?.receiptBefore
      ? [...ledger].reverse().find(notice => notice.obligations?.length)?.id : undefined;
    let cursor = copy(target);
    this.frames = Array(ledger.length);
    for (let i = ledger.length - 1; i >= 0; i--) {
      let recordedAfter = cursor;
      if (ledger[i].id === announcementId && target.pendingSettlement?.receiptBefore) {
        // Some creditors can already be paid before a later debt needs a choice.
        // Their receipt is deferred. Reconnect must undo the source bank income
        // from its recorded baseline, not from cash after those unreported debts.
        recordedAfter = copy(cursor);
        const baseline = target.pendingSettlement.receiptBefore;
        for (const player of recordedAfter.players) {
          const saved = baseline.players[player.id];
          if (!saved) continue;
          player.cash = saved.cash; player.fundValue = saved.valuation;
          if (player.valuation != null) player.valuation = saved.valuation;
        }
        for (const company of recordedAfter.companies) {
          const saved = baseline.companies[company.id];
          if (!saved) continue;
          for (const [id, quantity] of Object.entries(saved.holdings)) {
            if ((company.holdings[id] ?? 0) !== quantity) {
              company.averageBuyPrice[id] = null;
              if (company.costBasis) company.costBasis[id] = null;
            }
          }
          company.holdings = copy(saved.holdings);
        }
      }
      const before = reverseNotice(recordedAfter, ledger[i], previous);
      this.frames[i] = { notice: ledger[i], before, after: cursor, acknowledgedIds: [ledger[i].id] };
      cursor = before;
    }
    // Live snapshots preserve all historical metadata, including erased averages,
    // prison flags, and lap counters that the notice ledger does not describe.
    if (previous && this.frames.length) {
      this.frames[0].before.players = copy(previous.players);
      this.frames[0].before.companies = copy(previous.companies);
      this.frames[0].before.zoneGrades = copy(previous.zoneGrades);
      this.frames[0].before.sectorGrades = copy(previous.sectorGrades);
    }
    this.frames = consolidateSettlements(this.frames);
    notices = this.frames.map(frame => frame.notice);
    const recordedActor = (roll: GameNotice, index: number): string => {
      if (roll.playerId) return roll.playerId;
      // Market-space notices omit playerId; their immediately following payment
      // notice records the same roll, position and actor. Reuse that server fact.
      for (let distance = 1; distance < notices.length; distance++) {
        for (const candidate of [notices[index + distance], notices[index - distance]]) {
          if (candidate?.playerId && candidate.cycle === roll.cycle && candidate.roll === roll.roll && candidate.position === roll.position) return candidate.playerId;
        }
      }
      return previous?.activePlayerId ?? target.activePlayerId;
    };
    const signature = (roll: GameNotice) => `${roll.playerId}:${roll.cycle}:${roll.roll}:${roll.position ?? "trial"}`;
    for (let i = 0; i < notices.length; i++) {
      const notice = notices[i];
      const rollIndex = notice.roll != null ? i : notice.action === "lap" ? notices.findIndex((n, index) => index > i && n.roll != null) : -1;
      const rawRoll = rollIndex < 0 ? null : notices[rollIndex];
      const roll = rawRoll ? { ...rawRoll, playerId: recordedActor(rawRoll, rollIndex) } : null;
      if (notice.roll != null && !notice.playerId && roll) this.frames[i].notice = { ...this.frames[i].notice, playerId: roll.playerId };
      const key = roll ? signature(roll) : `notice:${notice.id}`;
      let group = this.groups.at(-1);
      const joinsRoll = roll && group?.signature === key;
      const followsRoll = !roll && notice.action === "skipTrading" && group?.roll?.playerId === notice.playerId;
      if (!group || (!joinsRoll && !followsRoll)) {
        group = { start: i, roll, signature: key, timeline: null, beforePositions: {}, afterPositions: {} };
        this.groups.push(group);
      }
      this.frameGroups.push(group);
    }
    const initialPositions = Object.fromEntries(target.players.map(player => {
      const first = this.groups.find(group => group.roll && (group.roll.playerId ?? target.activePlayerId) === player.id)?.roll;
      const old = previous?.players.find(p => p.id === player.id)?.sectorPosition;
      const position = old ?? (first?.position != null && first.action !== "prisonRoll" ? (first.position - (first.roll ?? 0) + target.board.length) % target.board.length : player.sectorPosition);
      return [player.id, position];
    }));
    let positions = initialPositions;
    for (const group of this.groups) {
      group.beforePositions = { ...positions };
      const roll = group.roll;
      const playerId = roll?.playerId ?? target.activePlayerId;
      if (roll) {
        const toPosition = roll.position ?? positions[playerId] ?? 0;
        const fromPosition = roll.action === "prisonRoll" ? toPosition : (roll.position != null ? (toPosition - (roll.roll ?? 0) + target.board.length) % target.board.length : positions[playerId] ?? 0);
        // A live previous snapshot is the exact source for the first movement.
        const firstForPlayer = this.groups.find(g => (g.roll?.playerId ?? target.activePlayerId) === playerId && g.roll) === group;
        group.timeline = { noticeId: roll.id, playerId, roll: roll.roll!, fromPosition: firstForPlayer && previous ? previous.players.find(p => p.id === playerId)?.sectorPosition ?? fromPosition : fromPosition, toPosition, diceStartedAt: 0, motionStartedAt: 0, motionStepMs: PRESENTATION_TIMING.step };
        positions = { ...positions, [playerId]: toPosition };
      }
      group.afterPositions = { ...positions };
    }
    this.stage = idleStage(target);
    if (notices.length) this.startNotice(now);
    if (!notices.length && previous && previous.activePlayerId !== target.activePlayerId && !reducedMotion) {
      this.stage = "TURN_START";
      this.deadline = now + PRESENTATION_TIMING.focus;
    }
  }
  get timeline(): BoardTimeline | null { return this.frameGroups[this.index]?.timeline ?? null; }
  private get debtAnnouncement(): boolean {
    // The decision desk already explains an unfunded sector operation. Let the
    // die/pawn finish, then open that desk instead of another announcement card.
    return !!this.notice?.obligations?.length && !!this.frames[this.index]?.after.pendingSettlement;
  }
  private startNotice(now: number) {
    const group = this.frameGroups[this.index];
    const startsRoll = group?.start === this.index && !!group.timeline;
    if (startsRoll && group.timeline) {
      group.timeline.diceStartedAt = now + PRESENTATION_TIMING.focus;
      group.timeline.motionStartedAt = now + PRESENTATION_TIMING.focus + PRESENTATION_TIMING.dice + PRESENTATION_TIMING.result;
    }
    this.stage = this.reducedMotion ? this.debtAnnouncement ? "SPACE_REVEAL" : "CARD_READING" : startsRoll ? "BOARD_FOCUS" : this.notice?.action === "move" ? "TRAVEL_RESOLUTION" : "SPACE_REVEAL";
    this.deadline = this.reducedMotion ? this.debtAnnouncement ? now : null : now + (this.stage === "TRAVEL_RESOLUTION" ? PRESENTATION_TIMING.travel : PRESENTATION_TIMING.focus);
  }
  get notice(): GameNotice | null { return this.frames[this.index]?.notice ?? null; }
  get busy(): boolean { return this.index < this.frames.length; }
  get currentCard(): GameNotice | null { return this.stage === "CARD_READING" ? this.notice : null; }
  get gradeImpact(): GradeChange | null { return this.stage === "MARKET_IMPACT" ? this.notice?.gradeChanges?.[this.gradeIndex] ?? null : null; }
  /** Reading time is independent of animation and of the actor being human or AI. */
  get awaitingMarketConfirmation(): boolean { return this.stage === "MARKET_IMPACT" && this.gradeIndex < 0 && this.deadline == null; }
  private get marketChanged(): boolean {
    return !!this.notice?.gradeChanges?.some(change => change.before !== change.after)
      || !!this.notice?.companyImpacts?.some(impact => impact.beforePrice !== impact.afterPrice || impact.bankruptcy || impact.returned);
  }
  private finishNotice(now: number, completed: number[]) {
    completed.push(...(this.frames[this.index]?.acknowledgedIds ?? []));
    this.index++; this.gradeIndex = -1;
    if (this.busy) this.startNotice(now);
    else { this.stage = idleStage(this.target); this.deadline = null; }
  }
  /** React calls this after the stage commits, so expensive rendering cannot
   * consume the visible die or pawn animation before its timer is installed. */
  commit(now: number) {
    if (this.reducedMotion || this.deadline == null) return;
    const key = `${this.index}:${this.stage}:${this.gradeIndex}`;
    if (this.committedStage === key) return;
    this.committedStage = key;
    const duration = this.stage === "DICE_ROLLING" ? PRESENTATION_TIMING.dice
      : this.stage === "DICE_RESULT" ? PRESENTATION_TIMING.result
      : this.stage === "PAWN_MOVING" ? (this.timeline?.roll ?? 0) * PRESENTATION_TIMING.step
      : this.stage === "PAWN_ARRIVAL" ? PRESENTATION_TIMING.arrival
      : this.stage === "TRAVEL_RESOLUTION" ? PRESENTATION_TIMING.travel
      : this.stage === "CARD_DISMISS" ? PRESENTATION_TIMING.dismiss
      : this.stage === "MARKET_IMPACT" ? this.gradeIndex < 0 ? PRESENTATION_TIMING.prices : PRESENTATION_TIMING.grade
      : PRESENTATION_TIMING.focus;
    this.deadline = duration == null ? null : now + duration;
    if (this.timeline && this.stage === "DICE_ROLLING") {
      this.timeline.diceStartedAt = now;
      this.timeline.motionStartedAt = now + PRESENTATION_TIMING.dice + PRESENTATION_TIMING.result;
    }
    if (this.timeline && this.stage === "PAWN_MOVING") this.timeline.motionStartedAt = now;
  }
  setReducedMotion(enabled: boolean, now: number): number[] {
    if (this.reducedMotion === enabled) return [];
    this.reducedMotion = enabled;
    if (!enabled || !this.busy || this.stage === "CARD_READING") return [];
    // A motion preference must never shorten market reading time.
    if (this.awaitingMarketConfirmation) return [];
    if (["CARD_DISMISS", "MARKET_IMPACT"].includes(this.stage)) {
      this.deadline = now;
      return this.advance(now);
    }
    this.stage = this.debtAnnouncement ? "SPACE_REVEAL" : "CARD_READING";
    this.deadline = this.debtAnnouncement ? now : null;
    return this.debtAnnouncement ? this.advance(now) : [];
  }
  continueCard(now: number): number[] {
    if (this.stage !== "CARD_READING") return [];
    this.stage = "CARD_DISMISS";
    this.deadline = now + (this.reducedMotion ? 0 : PRESENTATION_TIMING.dismiss);
    return this.advance(now);
  }
  dismissImpact(now: number): number[] {
    if (!this.awaitingMarketConfirmation) return [];
    this.deadline = now;
    return this.advance(now);
  }
  /** Return acknowledgements only after every consequence has been revealed. */
  advance(now: number): number[] {
    const completed: number[] = [];
    while (this.deadline != null && now >= this.deadline) {
      const at = this.reducedMotion ? this.deadline : now;
          const delay = (duration: number) => { this.deadline = at + (this.reducedMotion ? 0 : duration); };
      switch (this.stage) {
        case "TURN_START": this.stage = idleStage(this.target); this.deadline = null; break;
        case "BOARD_FOCUS":
          this.stage = "DICE_ROLLING";
          if (this.timeline) {
            this.timeline.diceStartedAt = now;
            this.timeline.motionStartedAt = now + PRESENTATION_TIMING.dice + PRESENTATION_TIMING.result;
          }
          delay(PRESENTATION_TIMING.dice); break;
        case "DICE_ROLLING": this.stage = "DICE_RESULT"; delay(PRESENTATION_TIMING.result); break;
        case "DICE_RESULT":
          this.stage = this.timeline?.fromPosition === this.timeline?.toPosition ? "SPACE_REVEAL" : "PAWN_MOVING";
          if (this.stage === "PAWN_MOVING" && this.timeline) this.timeline.motionStartedAt = now;
          delay(this.stage === "PAWN_MOVING" ? (this.timeline?.roll ?? 0) * PRESENTATION_TIMING.step : PRESENTATION_TIMING.reveal); break;
        case "PAWN_MOVING": this.stage = "PAWN_ARRIVAL"; delay(PRESENTATION_TIMING.arrival); break;
        case "PAWN_ARRIVAL": this.stage = "SPACE_REVEAL"; delay(PRESENTATION_TIMING.reveal); break;
        case "TRAVEL_RESOLUTION": case "SPACE_REVEAL":
          if (this.debtAnnouncement) this.finishNotice(at, completed);
          else { this.stage = "CARD_READING"; this.deadline = null; }
          break;
        case "CARD_DISMISS":
          if (!this.marketChanged) { this.finishNotice(at, completed); break; }
          this.stage = "MARKET_IMPACT";
          this.gradeIndex = this.notice?.gradeChanges?.length ? 0 : -1;
          if (this.gradeIndex < 0) this.deadline = null;
          else delay(PRESENTATION_TIMING.grade);
          break;
        case "MARKET_IMPACT":
          if (this.gradeIndex >= 0 && this.gradeIndex < (this.notice?.gradeChanges?.length ?? 0) - 1) { this.gradeIndex++; delay(PRESENTATION_TIMING.grade); }
          else if (this.gradeIndex >= 0) { this.gradeIndex = -1; this.deadline = null; }
          else this.finishNotice(at, completed);
          break;
        default: this.deadline = null;
      }
      // A slow frame must still commit each visible phase. Only reduced motion
      // may consume several zero-duration consequences in one callback.
      if (!this.reducedMotion) break;
    }
    return completed;
  }
  view(): { viewGame: GameView; boardGame: GameView } {
    const frame = this.frames[this.index];
    if (!frame) return { viewGame: this.target, boardGame: this.target };
    const game = copy(frame.before);
    // Keep latest strategic history hidden until all notices in this batch finish.
    game.marketHistory = copy(this.historical);
    game.log = copy(this.historicalLog);
    if (this.stage === "MARKET_IMPACT") {
      const changes = frame.notice.gradeChanges ?? [];
      for (let i = 0; i < changes.length; i++) if (this.gradeIndex < 0 || i <= this.gradeIndex) {
        const change = changes[i];
        (change.scope === "zone" ? game.zoneGrades : game.sectorGrades)[change.id] = change.after;
      }
      if (this.gradeIndex < 0) { game.companies = copy(frame.after.companies); game.players = copy(frame.after.players); }
    }
    const group = this.frameGroups[this.index];
    const beforeMotion = group?.start === this.index && ["BOARD_FOCUS", "DICE_ROLLING", "DICE_RESULT"].includes(this.stage);
    const positions = beforeMotion ? group?.beforePositions : group?.afterPositions;
    for (const player of game.players) if (positions?.[player.id] != null) {
      player.sectorPosition = positions[player.id];
      if (player.position != null) player.position = player.sectorPosition;
    }
    if (frame.notice.action === "move" && frame.notice.zoneId) {
      const boardGame = copy(game);
      const traveler = boardGame.players.find(player => player.id === frame.notice.playerId);
      if (traveler) {
        traveler.zone = frame.notice.zoneId;
        traveler.currentMarket = isMarketId(traveler.zone) ? traveler.zone : null;
      }
      return { viewGame: game, boardGame };
    }
    return { viewGame: game, boardGame: game };
  }
}
