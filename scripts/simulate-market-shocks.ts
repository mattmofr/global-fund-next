import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  chooseAiCommand,
  createGame,
  executeCommand,
  fundValue,
  getDecisionPlayerId,
} from "@global-fund/game-engine";
import type { GameNotice, GameState, SeatConfig } from "@global-fund/shared";

// Repeatable seeded stream, shared with the existing economy balancing tool.
function randomFor(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gameCount = Number(process.argv[2] ?? 20);
const baseSeed = Number(process.argv[3] ?? 20261012);
const timeCapSeconds = Number(process.argv[4] ?? 180);
if (!Number.isInteger(gameCount) || gameCount < 1 || gameCount > 10000) {
  throw new Error("Le nombre de parties doit être compris entre 1 et 10000.");
}
if (!Number.isSafeInteger(baseSeed) || baseSeed < 0) {
  throw new Error("La graine doit être un entier positif.");
}
if (!Number.isFinite(timeCapSeconds) || timeCapSeconds <= 0) {
  throw new Error("La limite de temps doit être positive.");
}

const catalogPath = "packages/game-engine/legacy/data/gameData.json";
const enginePath = "packages/game-engine/legacy/game.cjs";
const marketRulesPath = "packages/game-engine/legacy/marketRules.cjs";
const catalogHash = createHash("sha256").update(readFileSync(catalogPath)).digest("hex");
const engineHash = createHash("sha256").update(readFileSync(enginePath)).digest("hex");
const marketRulesHash = createHash("sha256").update(readFileSync(marketRulesPath)).digest("hex");
const originalRandom = Math.random;
const startedAt = performance.now();
const records: Record<string, unknown>[] = [];
const errors: { game: number; cycle: number; phase: string; error: string }[] = [];
let commands = 0;
let shocksTotal = 0;
const totals = {
  bull: 0,
  bear: 0,
  crash: 0,
  gradeChanges: 0,
  navImpact: 0,
  bankruptcies: 0,
  shockCashChanges: 0,
  newlyInsolventOnShockCommand: 0,
  rankingPairsChanged: 0,
};

function navs(state: GameState) {
  return Object.fromEntries(state.players.map((player) => [player.id, fundValue(state, player)]));
}

function ranks(values: Record<string, number>, players: GameState["players"]) {
  return Object.fromEntries(
    players
      .filter((player) => player.solvent)
      .sort((a, b) => (values[b.id] ?? 0) - (values[a.id] ?? 0) || a.id.localeCompare(b.id))
      .map((player, index) => [player.id, index + 1]),
  );
}

function newBoardShocks(state: GameState, previousNoticeSeq: number) {
  return state.notices.filter((notice) =>
    notice.id > previousNoticeSeq &&
    notice.kind === "event" &&
    notice.source === "board" &&
    /^(Bull Market|Bear Market|Market Crash)$/i.test(notice.title ?? ""),
  );
}

function shockKind(notice: GameNotice): "bull" | "bear" | "crash" | null {
  if (/^Bull Market$/i.test(notice.title ?? "")) return "bull";
  if (/^Bear Market$/i.test(notice.title ?? "")) return "bear";
  if (/^Market Crash$/i.test(notice.title ?? "")) return "crash";
  return null;
}

try {
  for (let gameIndex = 0; gameIndex < gameCount; gameIndex += 1) {
    if ((performance.now() - startedAt) / 1000 >= timeCapSeconds) break;
    const gameStarted = performance.now();
    Math.random = randomFor(baseSeed + gameIndex);
    let state = createGame(([
      { name: "easy", kind: "ai", startingMarket: "europe", pawn: "lion", difficulty: "easy" },
      { name: "normal", kind: "ai", startingMarket: "americas", pawn: "bull", difficulty: "normal" },
      { name: "hard", kind: "ai", startingMarket: "asia", pawn: "globe", difficulty: "hard" },
    ]) as SeatConfig[]);
    const gameShocks: Record<string, any>[] = [];
    let gameCommands = 0;
    let gameBankruptcies = 0;
    let gameShockCashChanges = 0;
    let gameNewInsolvent = 0;
    let gameRankChanges = 0;
    let error: string | null = null;

    try {
      for (let step = 0; !state.finished; step += 1) {
        if (step >= 20000) throw new Error("Limite de 20000 commandes atteinte.");
        if ((performance.now() - startedAt) / 1000 >= timeCapSeconds) {
          throw new Error("Limite globale de temps atteinte.");
        }
        const player = state.players.find((item) => item.id === getDecisionPlayerId(state));
        if (!player) throw new Error("Joueur décisionnaire introuvable.");
        const before = state;
        const noticeSeq = before.noticeSeq;
        const next = executeCommand(before, player.id, chooseAiCommand(before, player.difficulty));
        const shocks = newBoardShocks(next, noticeSeq);
        state = next;
        gameCommands += 1;
        commands += 1;

        // Reporting history is not game state; retain only the recent points during long runs.
        state.marketHistory = state.marketHistory.slice(-2);

        for (const notice of shocks) {
          const kind = shockKind(notice);
          if (!kind) continue;
          shocksTotal += 1;
          totals[kind] += 1;
          const impacts = notice.playerImpacts ?? [];
          const afterNav = navs(state);
          const beforeNav = Object.fromEntries(state.players.map((item) => {
            const impact = impacts.find((row) => row.playerId === item.id);
            return [item.id, (afterNav[item.id] ?? 0) - (impact?.valuation ?? 0)];
          }));
          const beforeSolvent = Object.fromEntries(before.players.map((item) => [item.id, item.solvent]));
          const afterSolvent = Object.fromEntries(state.players.map((item) => [item.id, item.solvent]));
          const preRanks = ranks(beforeNav, state.players.map((item) => ({
            ...item,
            solvent: Boolean(beforeSolvent[item.id]) && item.solvent,
          })));
          const postRanks = ranks(afterNav, state.players);
          const comparedIds = Object.keys(preRanks).filter((id) => Object.hasOwn(postRanks, id));
          const changedPairs: { aheadBefore: string; aheadAfter: string }[] = [];
          for (let left = 0; left < comparedIds.length; left += 1) {
            for (let right = left + 1; right < comparedIds.length; right += 1) {
              const a = comparedIds[left];
              const b = comparedIds[right];
              const beforeOrder = Math.sign((preRanks[a] ?? 0) - (preRanks[b] ?? 0));
              const afterOrder = Math.sign((postRanks[a] ?? 0) - (postRanks[b] ?? 0));
              if (beforeOrder !== afterOrder) changedPairs.push({ aheadBefore: beforeOrder < 0 ? a : b, aheadAfter: afterOrder < 0 ? a : b });
            }
          }
          const bankruptcies = (notice.companyImpacts ?? []).filter((impact) => impact.bankruptcy).map((impact) => impact.companyId);
          const cashChanges = impacts.filter((impact) => impact.cash !== 0).map((impact) => ({ playerId: impact.playerId, amount: impact.cash }));
          const newlyInsolvent = state.players.filter((item) => Boolean(beforeSolvent[item.id]) && !item.solvent).map((item) => item.id);
          const gradeChanges = notice.gradeChanges ?? [];
          const navImpact = impacts.reduce((sum, impact) => sum + impact.valuation, 0);
          gameBankruptcies += bankruptcies.length;
          gameShockCashChanges += cashChanges.length;
          gameNewInsolvent += newlyInsolvent.length;
          gameRankChanges += changedPairs.length;
          totals.gradeChanges += gradeChanges.length;
          totals.navImpact += navImpact;
          totals.bankruptcies += bankruptcies.length;
          totals.shockCashChanges += cashChanges.length;
          totals.newlyInsolventOnShockCommand += newlyInsolvent.length;
          totals.rankingPairsChanged += changedPairs.length;
          gameShocks.push({
            cycle: notice.cycle,
            title: notice.title,
            position: notice.position,
            playerId: notice.playerId ?? player.id,
            activeZone: player.zone,
            gradeChanges,
            playerImpacts: impacts,
            navBefore: beforeNav,
            navAfter: afterNav,
            ranksBefore: preRanks,
            ranksAfter: postRanks,
            changedRankingPairs: changedPairs,
            bankruptcies,
            cashChanges,
            newlyInsolventOnCommand: newlyInsolvent,
          });
        }
      }
    } catch (caught) {
      error = String(caught);
      errors.push({ game: gameIndex + 1, cycle: state.cycle, phase: state.phase, error });
      if (error.includes("Limite globale de temps")) {
        records.push({
          game: gameIndex + 1,
          seed: baseSeed + gameIndex,
          finished: false,
          cycles: state.cycle,
          commands: gameCommands,
          durationSeconds: (performance.now() - gameStarted) / 1000,
          error,
          shocks: gameShocks,
          bankruptcies: gameBankruptcies,
          shockCashChanges: gameShockCashChanges,
          newlyInsolventOnShockCommand: gameNewInsolvent,
          rankingPairsChanged: gameRankChanges,
          finalNAV: navs(state),
        });
        break;
      }
    }

    records.push({
      game: gameIndex + 1,
      seed: baseSeed + gameIndex,
      finished: state.finished,
      cycles: state.cycle,
      commands: gameCommands,
      durationSeconds: (performance.now() - gameStarted) / 1000,
      error,
      shocks: gameShocks,
      bankruptcies: gameBankruptcies,
      shockCashChanges: gameShockCashChanges,
      newlyInsolventOnShockCommand: gameNewInsolvent,
      rankingPairsChanged: gameRankChanges,
      finalNAV: navs(state),
      players: state.players.map((item) => ({ id: item.id, name: item.name, difficulty: item.difficulty, solvent: item.solvent, nav: fundValue(state, item) })),
    });
  }
} finally {
  Math.random = originalRandom;
}

const completed = records.filter((record) => record.finished).length;
const number = (value: unknown) => typeof value === "number" ? value : 0;
const output = {
  objective: "Simulation des chocs de marché Bull/Bear avec la politique de zones active du moteur.",
  configuration: {
    requestedGames: gameCount,
    completedGames: completed,
    seed: baseSeed,
    timeCapSeconds,
    maxCommandsPerGame: 20000,
    seatMarkets: ["europe", "americas", "asia"],
    difficulties: ["easy", "normal", "hard"],
    historyRetention: 2,
  },
  hashes: { enginePath, engineHash, marketRulesPath, marketRulesHash, catalogPath, catalogHash },
  totals: {
    gamesRecorded: records.length,
    finishedGames: completed,
    commands,
    shocks: shocksTotal,
    bull: totals.bull,
    bear: totals.bear,
    crash: totals.crash,
    gradeChanges: totals.gradeChanges,
    aggregatePlayerNavImpact: Math.round(totals.navImpact * 100) / 100,
    bankruptcies: totals.bankruptcies,
    shockCashChanges: totals.shockCashChanges,
    newlyInsolventOnShockCommand: totals.newlyInsolventOnShockCommand,
    changedRankingPairs: totals.rankingPairsChanged,
  },
  averages: {
    cyclesPerFinishedGame: completed ? records.filter((record) => record.finished).reduce((sum, record) => sum + number(record.cycles), 0) / completed : null,
    secondsPerRecordedGame: records.length ? records.reduce((sum, record) => sum + number(record.durationSeconds), 0) / records.length : null,
    shocksPerFinishedGame: completed ? shocksTotal / completed : null,
    bankruptciesPerFinishedGame: completed ? totals.bankruptcies / completed : null,
    navImpactPerShock: shocksTotal ? totals.navImpact / shocksTotal : null,
  },
  durationSeconds: (performance.now() - startedAt) / 1000,
  errors,
  records,
};
const outputPath = "docs/market-shock-simulation.json";
writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ path: outputPath, ...output.configuration, ...output.totals, durationSeconds: output.durationSeconds, errors }, null, 2));
if (completed !== gameCount || errors.length) process.exitCode = 1;
