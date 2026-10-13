'use strict';

/* Pure, in-memory game engine.  The UI/server may serialize the object returned
 * by publicState; no timers, sockets, or framework code belong here. */
const data = require('./data/gameData.json');
const nationalities = require('./data/nationalities.json');
const { eventPremise } = require('./eventStories.cjs');
const { BOARD_EVENT_CARDS } = require('./boardEventCards.cjs');
const { BOARD_LAYOUT_VERSION, MARKET_RULES_VERSION, marketEffectFor, upgradeMarketBoard } = require('./marketRules.cjs');
const { CARD_RULES_VERSION, EVENT_TEXT_VERSION, upgradeCardCatalogs } = require('./deckRules.cjs');

const FACTOR = Object.freeze({ A: 1.5, B: 1.25, C: 1, D: 0.75, E: 0.5 });
const GRADES = ['A', 'B', 'C', 'D', 'E'];

function idOf(value) { return String(value && typeof value === 'object' ? value.id : value); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function fail(message) { throw new Error(message); }
function gradeFactor(grade) { return FACTOR[grade] || FACTOR.C; }
function randInt(max) { return Math.floor(Math.random() * max); }
function suppliedDie() { return randInt(6) + 1; }
function shuffle(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = randInt(i + 1); [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

const NATIONALITY_BY_ID = new Map(nationalities.map(item => [String(item.id), item]));
const MARKET_IDS = ['americas', 'europe', 'asia', 'africa', 'oceania'];

function syncPlayerMarkets(record) {
  // Old nationality fields are read only. A saved fund retains its current
  // location (including detention), trading access, holdings, and initial market.
  if (!MARKET_IDS.includes(record.startingMarket)) {
    const legacyMarket = NATIONALITY_BY_ID.get(record.nationality)?.zoneId;
    record.startingMarket = MARKET_IDS.includes(legacyMarket) ? legacyMarket
      : MARKET_IDS.includes(record.zone) ? record.zone : 'europe';
  }
  record.currentMarket = MARKET_IDS.includes(record.zone) ? record.zone : null;
}

function notice(game, value) {
  game.noticeSeq = Number(game.noticeSeq || 0) + 1;
  const item = { id: game.noticeSeq, cycle: game.cycle || 0, ...value };
  game.notices ||= [];
  game.notices.push(item);
  if (game.notices.length > 30) game.notices.splice(0, game.notices.length - 30);
  return item;
}

function player(game, playerId) {
  const found = game.players.find(p => p.id === String(playerId));
  if (!found) fail(`Joueur introuvable : ${playerId}`);
  syncPlayerMarkets(found);
  if (!game.legacyOpening && (game.cycle || 1) === 1 && !found.jailed) found.geoResolved = true;
  else if (found.geoResolved == null) found.geoResolved = (game.cycle || 1) === 1;
  return found;
}
function company(game, companyId) {
  const found = game.companies.find(c => c.id === String(companyId));
  if (!found) fail(`Entreprise introuvable : ${companyId}`);
  return found;
}
function zone(game, zoneId) {
  const found = game.zones.find(z => z.id === String(zoneId));
  if (!found) fail(`Zone introuvable : ${zoneId}`);
  return found;
}
function currentPlayer(game) { return game.players[game.activeIndex]; }
function currentGrade(game, scope, id) {
  return (scope === 'zone' ? game.zoneGrades : game.sectorGrades)[String(id)] || 'C';
}
function setGrade(game, scope, id, grade) {
  if (!GRADES.includes(grade)) fail(`Indice économique invalide : ${grade}`);
  const map = scope === 'zone' ? game.zoneGrades : game.sectorGrades;
  map[String(id)] = grade;
}
function sharesOf(c, pid) { return Number(c.holdings[String(pid)] || 0); }
function totalHeld(c) { return Object.values(c.holdings).reduce((a, n) => a + Number(n || 0), 0); }
function averageBuyPrice(c, pid) {
  const held = sharesOf(c, pid);
  const rawBasis = (c.costBasis || {})[String(pid)];
  const basis = Number(rawBasis);
  return held > 0 && rawBasis != null && Number.isFinite(basis) && basis >= 0 ? Math.round((basis / held) * 100) / 100 : null;
}
function recordBuy(c, pid, quantity, price) {
  c.costBasis ||= {};
  const previous = c.costBasis[String(pid)];
  // A saved game from before cost tracking has no known purchase price.
  if (sharesOf(c, pid) > 0 && previous == null) c.costBasis[String(pid)] = null;
  else if (previous !== null) c.costBasis[String(pid)] = Number(previous || 0) + quantity * price;
}
function removeHolding(c, pid, quantity) {
  const held = sharesOf(c, pid); const sold = Math.min(held, Math.max(0, Number(quantity) || 0));
  if (!sold) return 0;
  const basis = (c.costBasis || {})[String(pid)];
  c.holdings[pid] = held - sold;
  if (!c.holdings[pid]) delete c.holdings[pid];
  c.costBasis ||= {};
  if (held <= sold) delete c.costBasis[String(pid)];
  else c.costBasis[String(pid)] = basis == null ? null : Math.max(0, Number(basis) * (held - sold) / held);
  return sold;
}
function sharesInGroup(game, c) {
  return game.companies.filter(x => x.zone === c.zone && x.sector === c.sector);
}
function ownsMonopoly(game, p, c) {
  const group = sharesInGroup(game, c);
  return group.length > 0 && group.every(x => sharesOf(x, p.id) === 5);
}
function titlePrice(c, game) {
  return (Number(c.basePrice) / 5) * gradeFactor(currentGrade(game, 'zone', c.zone)) * gradeFactor(currentGrade(game, 'sector', c.sector));
}
function incomeBase(c, game) {
  return (Number(c.baseIncome) / 5) * gradeFactor(currentGrade(game, 'zone', c.zone)) * gradeFactor(currentGrade(game, 'sector', c.sector));
}

function priceFor(c, game) { return Math.round(titlePrice(c, game) * 100) / 100; }

function incomeFor(c, game) {
  let value = incomeBase(c, game);
  const cc = (Number(c.baseIncome) / 5) * FACTOR.C * FACTOR.C;
  // A wholly owned company guarantees at least its C/C per-title income.
  if (Object.values(c.holdings).some(n => Number(n) >= 5)) value = Math.max(value, cc);
  return Math.round(value * 100) / 100;
}

function incomeForHolder(c, game, pid) {
  let value = incomeFor(c, game);
  const p = player(game, pid);
  if (ownsMonopoly(game, p, c)) value = Math.max(value, (Number(c.baseIncome) / 5) * FACTOR.A * FACTOR.A);
  return Math.round(value * 100) / 100;
}

function contextDeck() {
  const source = Array.isArray(data.events) ? data.events : [];
  if (!source.length) return [];
  const groups = Object.fromEntries(['positive', 'negative', 'neutral', 'prison', 'regulation'].map(type =>
    [type, shuffle(source.filter(card => card.type === type).map(clone))]));
  if (groups.positive.length !== 35 || groups.negative.length !== 35 ||
      groups.neutral.length !== 10 || groups.prison.length !== 10 || groups.regulation.length !== 10) {
    return shuffle(source.map(clone));
  }
  // Each group of ten cards has three or four rises, three or four falls,
  // and one of each other type, so long runs cannot skew a whole cycle block.
  const extraRise = shuffle([true, true, true, true, true, false, false, false, false, false]);
  return extraRise.flatMap(rising => shuffle([
    ...groups.positive.splice(0, rising ? 4 : 3),
    ...groups.negative.splice(0, rising ? 3 : 4),
    groups.neutral.pop(), groups.prison.pop(), groups.regulation.pop(),
  ]));
}

function describeGrades(game, before, changes) {
  const subjects = changes.map(change => {
    const item = (change.scope === 'zone' ? game.zones : game.sectors).find(entry => entry.id === change.id);
    const name = item?.name || change.id;
    const previous = before.grades[change.scope]?.[change.id] || 'C';
    const current = currentGrade(game, change.scope, change.id);
    const direction = GRADES.indexOf(current) < GRADES.indexOf(previous) ? 'progresse' :
      GRADES.indexOf(current) > GRADES.indexOf(previous) ? 'recule' : 'reste stable';
    return `${change.scope === 'zone' ? 'la zone' : 'le secteur'} ${name} ${direction}`;
  });
  return subjects.length ? `Sur les marchés, ${subjects.join(' ; ')}.` : 'Les indices de zones et de secteurs restent inchangés.';
}

function gradeOutcomes(game, before, changes) {
  return changes.map(change => ({ scope: change.scope, id: change.id,
    before: before.grades[change.scope]?.[change.id] || 'C', after: currentGrade(game, change.scope, change.id) }));
}

function eventDescription(game, event, outcomes) {
  const zoneChange = (event.changes || []).find(change => change.scope === 'zone');
  const sectorChange = (event.changes || []).find(change => change.scope === 'sector');
  const zoneName = game.zones.find(item => item.id === zoneChange?.id)?.name || zoneChange?.id || 'la région concernée';
  const sectorName = game.sectors.find(item => item.id === sectorChange?.id)?.name || sectorChange?.id || 'ce secteur';
  const premise = eventPremise(event, zoneName, sectorName);
  const rising = outcomes.filter(change => GRADES.indexOf(change.after) < GRADES.indexOf(change.before));
  const falling = outcomes.filter(change => GRADES.indexOf(change.after) > GRADES.indexOf(change.before));
  const favorable = rising.length > 0;
  const unfavorable = falling.length > 0;
  const subject = change => `${change.scope === 'zone' ? 'la zone' : 'le secteur'} ${(change.scope === 'zone' ? game.zones : game.sectors).find(item => item.id === change.id)?.name || change.id}`;
  let response;
  if (favorable && unfavorable) {
    response = `Les capitaux se réorientent vers ${rising.map(subject).join(', ')}, tandis que les ventes pèsent sur ${falling.map(subject).join(', ')}.`;
  } else if (favorable) {
    response = event.type === 'negative' || event.type === 'prison'
      ? 'Malgré l’alerte, des achats de soutien l’emportent et les cours concernés se redressent.'
      : 'La nouvelle attire des capitaux et soutient les cours concernés.';
  } else if (unfavorable) {
    response = event.type === 'positive'
      ? 'Malgré cette annonce, les investisseurs prennent leurs bénéfices et les cours concernés cèdent du terrain.'
      : 'La défiance pousse les investisseurs à vendre les titres concernés.';
  } else {
    response = 'Les investisseurs attendent des preuves supplémentaires avant de modifier leurs positions.';
  }
  const movements = outcomes.map(change => {
    const name = (change.scope === 'zone' ? game.zones : game.sectors).find(item => item.id === change.id)?.name || change.id;
    const status = GRADES.indexOf(change.after) < GRADES.indexOf(change.before) ? 'progresse' :
      GRADES.indexOf(change.after) > GRADES.indexOf(change.before) ? 'recule' : 'reste stable';
    return `${change.scope === 'zone' ? 'la zone' : 'le secteur'} ${name} ${status}`;
  });
  const result = movements.length ? `Au terme de la séance, ${movements.join(' ; ')}.` : 'Les indices de zones et de secteurs restent inchangés.';
  return [premise, response, result].filter(Boolean).join(' ');
}

function bankruptCompanies(game) {
  game.companies.forEach(c => {
    const isWorst = currentGrade(game, 'zone', c.zone) === 'E' && currentGrade(game, 'sector', c.sector) === 'E';
    if (c.available && isWorst) {
      const liquidation = titlePrice(c, game);
      Object.keys(c.holdings).forEach(pid => {
        const holder = game.players.find(p => p.id === pid);
        if (holder) holder.cash += liquidation * sharesOf(c, pid);
      });
      c.holdings = {};
      c.costBasis = {};
      c.available = false;
      game.log.push(`Faillite de ${c.name || c.id}`);
    } else if (!c.available && !isWorst) {
      c.available = true;
      game.log.push(`Retour de ${c.name || c.id} sur le marché`);
    }
  });
}

function marketSnapshot(game) {
  return {
    grades: { zone: clone(game.zoneGrades), sector: clone(game.sectorGrades) },
    companies: Object.fromEntries(game.companies.map(c => [c.id, {
      price: c.available ? priceFor(c, game) : 0,
      available: c.available,
      holdings: { ...c.holdings },
    }])),
    players: Object.fromEntries(game.players.map(p => [p.id, {
      cash: p.cash, valuation: fundValue(game, p), jailed: p.jailed,
      shares: Object.fromEntries(game.companies.map(c => [c.id, sharesOf(c, p.id)])),
    }])),
  };
}

function marketImpacts(game, before) {
  const gradeChanges = [];
  for (const scope of ['zone', 'sector']) {
    const grades = scope === 'zone' ? game.zoneGrades : game.sectorGrades;
    Object.keys(grades).forEach(id => {
      if (before.grades[scope][id] !== grades[id]) gradeChanges.push({ scope, id, before: before.grades[scope][id], after: grades[id] });
    });
  }
  const companyImpacts = game.companies.flatMap(c => {
    const old = before.companies[c.id];
    const afterPrice = c.available ? priceFor(c, game) : 0;
    const sharesChanged = game.players.flatMap(p => {
      const prior = Number(old.holdings[p.id] || 0);
      const current = sharesOf(c, p.id);
      return prior === current ? [] : [{ playerId: p.id, playerName: p.name, before: prior, after: current }];
    });
    if (old.price === afterPrice && old.available === c.available && !sharesChanged.length) return [];
    return [{ companyId: c.id, companyName: c.name || c.id, beforePrice: old.price, afterPrice,
      bankruptcy: old.available && !c.available, returned: !old.available && c.available, sharesChanged }];
  });
  const round = value => Math.round(value * 100) / 100;
  const playerImpacts = game.players.map(p => {
    const old = before.players[p.id];
    const sharesSold = game.companies.flatMap(c => {
      const prior = old.shares[c.id] || 0;
      const current = sharesOf(c, p.id);
      return current < prior ? [{ companyId: c.id, companyName: c.name || c.id, quantity: prior - current }] : [];
    });
    return { playerId: p.id, playerName: p.name, cash: round(p.cash - old.cash),
      valuation: round(fundValue(game, p) - old.valuation), prison: p.jailed !== old.jailed ? p.jailed : null, sharesSold };
  });
  return { gradeChanges, playerImpacts, companyImpacts };
}

function applyRegulation(game, targetSector = null, quantity = 3) {
  const targets = [];
  game.players.forEach(p => game.companies.forEach(c => {
    if ((!targetSector || c.sector === targetSector) && sharesOf(c, p.id) >= 5 && ownsMonopoly(game, p, c)) targets.push([p, c]);
  }));
  const sales = [];
  targets.forEach(([p, c]) => {
    if (sharesOf(c, p.id) < 5) return;
    const sell = Math.min(quantity, sharesOf(c, p.id));
    removeHolding(c, p.id, sell);
    p.cash += sell * priceFor(c, game);
    game.log.push(`${p.name} revend ${sell} titres de ${c.name || c.id} (Régulation)`);
    sales.push(`${p.name} cède ${sell} titre${sell > 1 ? 's' : ''} de ${c.name || c.id} au cours du marché.`);
  });
  return sales;
}

function drawContext(game) {
  const event = game.deck.shift();
  if (!event) { finishGame(game); return null; }
  const before = marketSnapshot(game);
  game.cycle = (game.cycle || 0) + 1;
  game.log.push(`Contexte : ${event.title || event.id || 'sans titre'}`);
  (event.changes || []).forEach(change => setGrade(game, change.scope, change.id, change.grade));
  bankruptCompanies(game);
  const { gradeChanges, playerImpacts, companyImpacts } = marketImpacts(game, before);
  const description = eventDescription(game, event, gradeOutcomes(game, before, event.changes || []));
  game.currentContext = { ...event, description, effect: description };
  delete game.currentEvent;
  notice(game, { kind: 'event', source: 'card', cardType: 'context', title: event.title || event.id || 'Contexte', description,
    gradeChanges, gradeOutcomes: gradeOutcomes(game, before, event.changes || []), playerImpacts, companyImpacts });
  recordMarketHistory(game, 'contexte');
  return event;
}

function ensureBoardEventDeck(game) {
  if (!Array.isArray(game.boardEventDeck)) game.boardEventDeck = shuffle(BOARD_EVENT_CARDS.map(clone));
  if (!Array.isArray(game.boardEventDiscard)) game.boardEventDiscard = [];
  if (!game.boardEventDeck.length && game.boardEventDiscard.length) {
    game.boardEventDeck = shuffle(game.boardEventDiscard.splice(0));
  }
}

function eventTargetCompany(game, p, card) {
  const sector = card.targetSector || null;
  const candidates = game.companies.filter(c => c.available && (!sector || c.sector === sector));
  if (!candidates.length) return null;
  const own = candidates.filter(c => sharesOf(c, p.id) > 0);
  const held = candidates.filter(c => totalHeld(c) > 0);
  const pool = own.length ? own : held.length ? held : candidates;
  const zones = [...new Set(pool.map(c => c.zone))];
  const selectedZone = zones[randInt(zones.length)];
  const zonePool = pool.filter(c => c.zone === selectedZone);
  const recent = new Set(game.recentEventTargets || []);
  const fresh = zonePool.filter(c => !recent.has(c.id));
  const selection = fresh.length ? fresh : zonePool;
  const target = selection[randInt(selection.length)];
  game.recentEventTargets = [...(game.recentEventTargets || []), target.id].slice(-4);
  return target;
}

function drawBoardEvent(game, p, die, cell) {
  ensureBoardEventDeck(game);
  const card = game.boardEventDeck.shift();
  if (!card) return;
  game.boardEventDiscard.push(card);
  const before = marketSnapshot(game);
  const target = eventTargetCompany(game, p, card);
  const triggerOwnedTarget = target ? sharesOf(target, p.id) > 0 : false;
  const companyName = target?.name || 'une société cotée';
  const description = String(card.story || '').replaceAll('{company}', companyName);
  const effectLines = [];
  const amount = Number(card.amount || 0);
  const quantity = Math.max(1, Number(card.quantity || 1));
  const cash = Number(card.activeCash || 0);
  if (cash > 0) {
    p.cash += cash;
    effectLines.push(`${p.name} reçoit ${cash} M€ de la banque.`);
  } else if (cash < 0) {
    const context = { forcedSales: [], reason: `Carte — ${card.title}` };
    const paid = payOrSell(game, p, -cash, context);
    effectLines.push(`${p.name} ${paid ? 'paie' : 'doit régler'} ${-cash} M€ à la banque${context.forcedSales.length ? ' et revend des titres pour couvrir la somme' : ''}.`);
  }
  if (card.effect === 'dividend' && target) {
    const holders = game.players.filter(holder => sharesOf(target, holder.id) > 0);
    holders.forEach(holder => {
      const paid = sharesOf(target, holder.id) * amount;
      if (holder.jailed) {
        effectLines.push(`${holder.name} est en prison : son dividende de ${paid} M€ reste à la banque.`);
        return;
      }
      holder.cash += paid;
      effectLines.push(`${holder.name} reçoit ${paid} M€ de dividende pour ${target.name}.`);
    });
    if (!holders.length) effectLines.push(`Aucun actionnaire de ${target.name} ne perçoit de dividende.`);
  } else if (card.effect === 'fine' && target) {
    const holders = game.players.filter(holder => sharesOf(target, holder.id) > 0);
    holders.forEach(holder => {
      const due = sharesOf(target, holder.id) * amount;
      const paid = payOrSell(game, holder, due, { reason: `Amende — ${target.name}` });
      effectLines.push(`${holder.name} ${paid ? 'paie' : 'doit régler'} ${due} M€ pour ses titres de ${target.name}.`);
    });
    if (!holders.length) effectLines.push(`Aucun actionnaire de ${target.name} ne reçoit de charge supplémentaire.`);
  } else if (card.effect === 'forcedSale' && target) {
    const holders = game.players.filter(holder => sharesOf(target, holder.id) > 0);
    holders.forEach(holder => {
      const sold = removeHolding(target, holder.id, quantity);
      const proceeds = Math.round(sold * priceFor(target, game) * 100) / 100;
      holder.cash += proceeds;
      effectLines.push(`${holder.name} revend ${sold} titre${sold > 1 ? 's' : ''} de ${target.name} pour ${proceeds} M€.`);
    });
    if (!holders.length) effectLines.push(`Aucune part de ${target.name} n’est détenue : aucune vente imposée.`);
  } else if (card.effect === 'buyback' && target) {
    const holders = game.players.filter(holder => sharesOf(target, holder.id) > 0);
    holders.forEach(holder => {
      const sold = removeHolding(target, holder.id, 1);
      const proceeds = Math.round(sold * (priceFor(target, game) + amount) * 100) / 100;
      holder.cash += proceeds;
      effectLines.push(`${holder.name} cède ${sold} titre de ${target.name} pour ${proceeds} M€, prime incluse.`);
    });
    if (!holders.length) effectLines.push(`L’offre de rachat de ${target.name} ne trouve aucun titre détenu.`);
  } else if (card.effect === 'marginCall' && target) {
    if (sharesOf(target, p.id) > 0) {
      const paid = payOrSell(game, p, amount, { reason: `Appel de marge — ${target.name}` });
      effectLines.push(`${p.name} ${paid ? 'dépose' : 'doit déposer'} ${amount} M€ de garantie supplémentaire pour ${target.name}.`);
    } else effectLines.push(`${p.name} ne détient pas ${target.name} : aucune marge supplémentaire.`);
  } else if (card.effect === 'prison') {
    if (target && triggerOwnedTarget && !p.jailed) {
      p.previousZone = p.zone;
      p.jailed = true; p.prisonStage = 0; p.prisonWait = true; p.geoResolved = false; p.zone = 'prison';
      effectLines.push(`${p.name} détenait ${target.name} : placement en prison pour l’enquête.`);
    } else effectLines.push(`${p.name} ne détient pas l’entreprise visée : aucune détention.`);
  } else if (card.effect === 'regulation') {
    const sales = applyRegulation(game, card.targetSector, quantity);
    effectLines.push(...(sales.length ? sales : ['Aucun fonds ne détient une position dominante concernée.']));
  }
  if (!effectLines.length) effectLines.push('Aucun versement ni mouvement de titres ; les positions et les indices restent inchangés.');
  const impacts = marketImpacts(game, before);
  game.log.push(`Événement de case : ${card.title} (${p.name})`);
  notice(game, { kind: 'event', source: 'board', cardType: 'event', cardId: card.id,
    playerId: p.id, playerName: p.name, effect: card.effect,
    targetCompanyId: target?.id, targetCompanyName: target?.name,
    targetedSector: target?.sector || card.targetSector, targetedZone: target?.zone,
    title: card.title, description, roll: die, position: p.sectorPosition,
    cell: { kind: cell.kind, label: cell.label }, effectLines,
    ...impacts });
  recordMarketHistory(game, 'événement');
}

function fundValue(game, p) {
  return Math.round((p.cash + game.companies.reduce((sum, c) => sum + sharesOf(c, p.id) * priceFor(c, game), 0)) * 100) / 100;
}
function historyPoint(game, reason) {
  return {
    seq: (game.marketHistory?.at(-1)?.seq || 0) + 1,
    cycle: game.cycle || 1,
    reason,
    zoneGrades: { ...game.zoneGrades },
    sectorGrades: { ...game.sectorGrades },
    prices: Object.fromEntries(game.companies.map(c => [c.id, c.available ? priceFor(c, game) : 0])),
    funds: Object.fromEntries(game.players.map(p => [p.id, fundValue(game, p)])),
  };
}
function recordMarketHistory(game, reason) {
  game.marketHistory ||= [];
  const point = historyPoint(game, reason);
  const previous = game.marketHistory.at(-1);
  if (previous && JSON.stringify([previous.zoneGrades, previous.sectorGrades, previous.prices, previous.funds]) ===
      JSON.stringify([point.zoneGrades, point.sectorGrades, point.prices, point.funds])) return;
  game.marketHistory.push(point);
  if (game.marketHistory.length > 180) game.marketHistory.splice(0, game.marketHistory.length - 180);
}
const money = value => Math.round(Number(value) * 100) / 100;
function liquidAssets(game, p) {
  return game.companies.filter(c => c.available && sharesOf(c, p.id) > 0 && priceFor(c, game) > 0);
}
function payOrSell(game, p, amount, context = null, creditorId = null) {
  amount = money(amount);
  if (amount <= 0) return true;
  if (!game._settlementDebts?.length && p.cash >= amount) {
    p.cash = money(p.cash - amount);
    if (creditorId) player(game, creditorId).cash = money(player(game, creditorId).cash + amount);
    return true;
  }
  game._settlementDebts ||= [];
  game._settlementDebts.push({ debtorId: p.id, creditorId, amount,
    reason: context?.reason || 'Obligation financière', sectorId: context?.sectorId,
    sectorLabel: context?.sectorLabel, items: context?.items,
    lapBaseline: context?.lapBaseline || false });
  return false;
}
function settlementResult(game, debt, cashAmount, assets = [], marketSales = [], unpaidAmount = 0, before = null) {
  const { debtorId, creditorId, amount, reason, sectorId, sectorLabel, items, lapBaseline } = debt;
  const publicDebt = { debtorId, creditorId, amount, reason, sectorId, sectorLabel, items };
  const result = { ...publicDebt, cashAmount: money(cashAmount), assets, marketSales, unpaidAmount: money(unpaidAmount), cycle: game.cycle };
  game.settlementHistory ||= [];
  game.settlementHistory.push(result);
  if (game.settlementHistory.length > 100) game.settlementHistory.shift();
  if (lapBaseline) {
    const p = player(game, debt.debtorId);
    p.lapStartValue = money(Number(p.lapStartValue || 0) - (debt.amount - unpaidAmount));
    if (unpaidAmount) {
      p.capitalFlows = money(Number(p.capitalFlows || 0) + unpaidAmount);
      p.lapStartCapitalFlows = p.capitalFlows;
    }
  }
  game.log.push(`${player(game, debt.debtorId).name} règle ${debt.amount - unpaidAmount} M€ à ${debt.creditorId ? player(game, debt.creditorId).name : 'la banque'}${assets.length ? ' par transfert de titres' : ''}${unpaidAmount ? ` ; ${unpaidAmount} M€ non réglés, insolvabilité` : ''}.`);
  return result;
}
function continueSettlements(game, debts, resumePhase, completed = [], creditorOrder = [], creditorPriorities = [], receiptBefore = null, receiptPayments = []) {
  // This detached snapshot persists with the pending decision, so one receipt can
  // describe a whole operation even when humans resolve it across several commands.
  receiptBefore ||= marketSnapshot(game);
  delete game.pendingSettlement;
  while (debts.length) {
    const debt = debts.shift();
    const debtor = player(game, debt.debtorId);
    const before = marketSnapshot(game);
    if (debtor.cash >= debt.amount) {
      debtor.cash = money(debtor.cash - debt.amount);
      if (debt.creditorId) player(game, debt.creditorId).cash = money(player(game, debt.creditorId).cash + debt.amount);
      completed.push(settlementResult(game, debt, debt.amount, [], [], 0, before));
      continue;
    }
    if (!liquidAssets(game, debtor).length) {
      const funded = Math.max(0, money(debtor.cash));
      debtor.cash = 0; debtor.solvent = false;
      if (debt.creditorId) player(game, debt.creditorId).cash = money(player(game, debt.creditorId).cash + funded);
      completed.push(settlementResult(game, debt, funded, [], [], debt.amount - funded, before));
      continue;
    }
    game.pendingSettlement = { ...debt, id: Number(game.noticeSeq || 0) + 1,
      remainingAmount: debt.amount, resumePhase, decisionActorId: debtor.id,
      status: 'selectAssets', debts, completed, creditorOrder, creditorPriorities, priorityMetric: 'fundValue', receiptBefore, receiptPayments };
    game.phase = 'settlement'; game.stage = 'settlement';
    return;
  }
  if (completed.length) {
    const first = completed[0];
    const sameSector = first.sectorId && completed.every(result => result.sectorId === first.sectorId);
    const payments = [...receiptPayments, ...completed.flatMap(result =>
      !result.assets.length && !result.unpaidAmount && result.items?.length
        ? result.items.map(item => ({ ...item, forcedSales: result.marketSales }))
        : [{
          fromId: result.cashAmount < 0 ? result.creditorId : result.debtorId,
          toId: result.cashAmount < 0 ? result.debtorId : result.creditorId,
          amount: Math.abs(result.cashAmount), reason: result.reason, forcedSales: result.marketSales,
        }])];
    notice(game, { kind: 'payments', action: 'settlementComplete',
      title: sameSector ? `Synthèse des règlements — ${first.sectorLabel || first.sectorId}` : 'Synthèse des règlements',
      playerId: first.debtorId, settlements: completed,
      cell: sameSector ? { kind: 'sector', label: first.sectorLabel || first.sectorId, sector: first.sectorId } : undefined,
      payments, ...marketImpacts(game, receiptBefore) });
  }
  const active = game.players[game.activeIndex];
  game.phase = active.solvent ? resumePhase : 'awaitNext';
  game.stage = game.phase;
  recordMarketHistory(game, 'règlement');
}
function validateSettlementAssets(game, pending, raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > game.companies.length) fail('Sélectionnez des titres à céder.');
  const seen = new Set();
  return raw.map(item => {
    if (!item || typeof item.companyId !== 'string' || seen.has(item.companyId) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 5) fail('Sélection de titres invalide.');
    seen.add(item.companyId);
    const c = company(game, item.companyId);
    if (!c.available || priceFor(c, game) <= 0 || sharesOf(c, pending.debtorId) < item.quantity) fail('Titres indisponibles pour ce règlement.');
    const perShare = priceFor(c, game);
    return { companyId: c.id, companyName: c.name || c.id, quantity: item.quantity, perShare, value: money(perShare * item.quantity) };
  });
}
function sellSettlementAssets(game, pending, assets) {
  const debtor = player(game, pending.debtorId);
  const sales = [];
  for (const asset of assets) {
    const c = company(game, asset.companyId);
    const perShare = priceFor(c, game);
    removeHolding(c, debtor.id, asset.quantity);
    const amount = money(perShare * asset.quantity);
    debtor.cash = money(debtor.cash + amount);
    sales.push({ companyId: c.id, companyName: c.name || c.id, quantity: asset.quantity, perShare, amount });
  }
  return sales;
}
function finishCurrentSettlement(game, pending, cashAmount, assets = [], marketSales = [], unpaidAmount = 0, before = null) {
  const completed = [...(pending.completed || []), settlementResult(game, pending, cashAmount, assets, marketSales, unpaidAmount, before)];
  continueSettlements(game, pending.debts, pending.resumePhase, completed, pending.creditorOrder, pending.creditorPriorities, pending.receiptBefore || before, pending.receiptPayments || []);
}
function settleWithCash(game, pending, sales, before) {
  const debtor = player(game, pending.debtorId);
  if (debtor.cash < pending.amount && liquidAssets(game, debtor).length) {
    pending.status = 'selectAssets'; pending.decisionActorId = debtor.id;
    delete pending.offer;
    pending.marketSales = [...(pending.marketSales || []), ...sales];
    recordMarketHistory(game, 'liquidation');
    return;
  }
  const funded = Math.min(pending.amount, Math.max(0, money(debtor.cash)));
  debtor.cash = money(debtor.cash - funded);
  if (pending.creditorId) player(game, pending.creditorId).cash = money(player(game, pending.creditorId).cash + funded);
  const unpaid = money(pending.amount - funded);
  if (unpaid) debtor.solvent = false;
  finishCurrentSettlement(game, pending, funded, [], [...(pending.marketSales || []), ...sales], unpaid, before);
}
function settlementAction(game, playerId, action, payload) {
  const pending = game.pendingSettlement;
  if (!pending || game.phase !== 'settlement') fail('Aucun règlement en cours.');
  if (pending.decisionActorId !== playerId) fail('Ce règlement attend la décision d’un autre fonds.');
  const before = marketSnapshot(game);
  if (pending.status === 'selectAssets') {
    if (!['liquidateAssets', 'proposeSettlement'].includes(action)) fail('Sélectionnez des actifs pour le règlement.');
    const assets = validateSettlementAssets(game, pending, payload.assets);
    if (action === 'liquidateAssets') { settleWithCash(game, pending, sellSettlementAssets(game, pending, assets), before); return; }
    if (!pending.creditorId) fail('Une dette bancaire se règle par une vente au marché.');
    const value = money(assets.reduce((sum, asset) => sum + asset.value, 0));
    const cashDelta = money(pending.amount - value);
    if (cashDelta > player(game, pending.debtorId).cash) fail('Liquidités insuffisantes pour compléter cette proposition.');
    pending.offer = { assets, value, cashDelta };
    pending.status = 'awaitingCreditor'; pending.decisionActorId = pending.creditorId;
    return;
  }
  if (!['acceptSettlement', 'rejectSettlement', 'requireCash'].includes(action) || !pending.offer) fail('Décision de règlement invalide.');
  if (action === 'rejectSettlement') {
    pending.status = 'selectAssets'; pending.decisionActorId = pending.debtorId;
    if (player(game, pending.debtorId).bot) pending.marketOnly = true;
    delete pending.offer; return;
  }
  if (action === 'requireCash') {
    const assets = validateSettlementAssets(game, pending, pending.offer.assets);
    const sales = sellSettlementAssets(game, pending, assets);
    const debtor = player(game, pending.debtorId);
    for (const c of liquidAssets(game, debtor)) {
      if (debtor.cash >= pending.amount) break;
      const quantity = Math.min(sharesOf(c, debtor.id), Math.ceil((pending.amount - debtor.cash) / priceFor(c, game)));
      sales.push(...sellSettlementAssets(game, pending, [{ companyId: c.id, quantity }]));
    }
    settleWithCash(game, pending, sales, before); return;
  }
  const debtor = player(game, pending.debtorId), creditor = player(game, pending.creditorId);
  const { assets, cashDelta } = pending.offer;
  // Validate all ownership and both cash legs before changing either portfolio.
  for (const asset of assets) {
    const c = company(game, asset.companyId);
    if (!c.available || sharesOf(c, debtor.id) < asset.quantity) fail('Les titres proposés ne sont plus disponibles.');
  }
  if (cashDelta >= 0 && debtor.cash < cashDelta) fail('Liquidités insuffisantes pour compléter cette proposition.');
  if (cashDelta < 0 && creditor.cash < -cashDelta) fail('Liquidités insuffisantes pour accepter cette proposition.');
  for (const asset of assets) {
    const c = company(game, asset.companyId);
    removeHolding(c, debtor.id, asset.quantity);
    recordBuy(c, creditor.id, asset.quantity, asset.perShare);
    c.holdings[creditor.id] = sharesOf(c, creditor.id) + asset.quantity;
  }
  debtor.cash = money(debtor.cash - cashDelta); creditor.cash = money(creditor.cash + cashDelta);
  finishCurrentSettlement(game, pending, cashDelta, assets, pending.marketSales || [], 0, before);
}

function processPrisonRoll(game, p, roll) {
  if (!p.jailed) return true;
  const r = Number(roll);
  if (!Number.isInteger(r) || r < 1 || r > 6) fail('Le dé doit être compris entre 1 et 6.');
  if (p.prisonStage === 0) {
    p.prisonStage = r === 6 ? -1 : 1;
  } else if (p.prisonStage === 1) {
    p.prisonStage = r === 5 || r === 6 ? -1 : 2;
  } else if (p.prisonStage === 2) {
    payOrSell(game, p, 5, { reason: 'Libération de prison' }); p.prisonStage = -1;
  }
  if (p.prisonStage === -1) {
    p.jailed = false;
    p.zone = p.previousZone && p.previousZone !== 'prison'
      ? p.previousZone
      : p.startingMarket;
    syncPlayerMarkets(p);
    delete p.previousZone;
    game.log.push(`${p.name} sort de prison et retrouve son marché en ${zone(game, p.zone).name}`);
    return true;
  }
  game.log.push(`${p.name} reste en prison`); return false;
}

function chooseZone(game, p, target) {
  const fromZoneId = p.zone;
  const destination = zone(game, target);
  const cost = fromZoneId === target ? 0 : 1;
  const moveContext = { forcedSales: [], reason: 'Voyage entre marchés' };
  const paid = !cost || payOrSell(game, p, cost, moveContext);
  p.zone = target;
  syncPlayerMarkets(p);
  p.geoResolved = true;
  game.log.push(cost ? `${p.name} voyage vers ${destination.name} pour 1 M€` : `${p.name} reste en ${destination.name} sans frais`);
  if (cost) notice(game, { kind: 'payments', playerId: p.id, playerName: p.name, action: 'move',
    title: `Voyage vers ${destination.name}`, fromZoneId, zoneId: target, zoneName: destination.name,
    payments: [{ fromId: p.id, toId: null, companyId: null, companyName: null, quantity: 1, perShare: 1, amount: paid ? 1 : 0, dueAmount: paid ? undefined : 1, forcedSales: moveContext.forcedSales }] });
  recordMarketHistory(game, 'voyage');
}

function move(game, p, payload) {
  if (game.phase !== 'geography') fail('Le voyage se choisit avant le dé sectoriel.');
  if (p.jailed) fail('Le procès doit être joué avant de voyager.');
  if (p.geoResolved) fail('Le choix géographique a déjà été joué ce tour.');
  const target = idOf(payload && payload.zoneId);
  zone(game, target);
  chooseZone(game, p, target);
  game.phase = p.solvent ? 'sector' : 'awaitNext';
  game.stage = game.phase;
}

function stay(game, p) {
  if (game.phase !== 'geography') fail('Le choix de rester précède le dé sectoriel.');
  if (p.jailed) fail('Le procès doit être joué avant de rester.');
  if (p.geoResolved) fail('Le choix géographique a déjà été joué ce tour.');
  if (!p.zone) fail('Le fonds doit avoir un marché de départ.');
  chooseZone(game, p, p.zone);
  game.phase = 'sector';
  game.stage = 'sector';
}

function prisonRoll(game, p) {
  if (game.phase !== 'geography' || !p.jailed) fail('Aucun procès à jouer maintenant.');
  const die = suppliedDie();
  p.prisonWait = false;
  const released = processPrisonRoll(game, p, die);
  p.geoResolved = false;
  notice(game, { kind: 'event', source: 'board', action: 'prisonRoll', playerId: p.id,
    playerName: p.name, roll: die, title: released ? 'Libération' : 'Procès ajourné',
    description: released ? `${p.name} retrouve son marché et peut choisir de voyager.` : `${p.name} reste en prison et passe son tour sans échanges.` });
  if (!released || !p.solvent) { game.phase = 'awaitNext'; p.geoResolved = true; }
  else if (game.cycle === 1) { p.geoResolved = true; game.phase = 'sector'; }
  game.stage = game.phase;
  recordMarketHistory(game, 'procès');
}

function settleLap(game, p, payments) {
  const currentValue = fundValue(game, p);
  const flow = Number(p.capitalFlows || 0) - Number(p.lapStartCapitalFlows || 0);
  const baseline = Number(p.lapStartValue ?? currentValue);
  const performance = Math.round((currentValue - baseline - flow) * 100) / 100;
  const lapReturn = baseline > 0 ? Math.round((performance / baseline) * 10000) / 100 : 0;
  const adjustment = performance > 0 ? 20 : performance < 0 ? -20 : 0;
  const forced = { forcedSales: [], reason: 'Performance au Départ', lapBaseline: true };
  let paid = true;
  if (adjustment > 0) p.cash += adjustment;
  else if (adjustment < 0) paid = payOrSell(game, p, -adjustment, forced);
  p.capitalFlows = Number(p.capitalFlows || 0) + adjustment;
  p.lapPerformance = performance;
  // Start records the new baseline only after the injection/withdrawal.
  p.lapStartValue = fundValue(game, p);
  p.lapStartCapitalFlows = p.capitalFlows;
  if (adjustment) payments.push({ fromId: adjustment < 0 ? p.id : null, toId: adjustment > 0 ? p.id : null,
    quantity: 1, perShare: Math.abs(adjustment), amount: paid ? Math.abs(adjustment) : 0, dueAmount: paid ? undefined : Math.abs(adjustment), reason: 'Performance au Départ', forcedSales: forced.forcedSales });
  notice(game, { kind: 'event', source: 'board', action: 'lap', playerId: p.id, playerName: p.name,
    title: 'Bilan au Départ', lapPerformance: performance, lapReturn,
    description: `Performance du tour : ${performance} M€ (${lapReturn} %). Flux de capital : ${adjustment} M€.` });
}

function trade(game, p, payload) {
  if (game.phase !== 'market') fail('Les échanges ne sont possibles que pendant le marché.');
  if (p.jailed) fail('Les avoirs sont gelés pendant la détention.');
  if (!p.geoResolved) fail('Choisissez de rester ou de voyager avant les échanges.');
  const c = company(game, payload && payload.companyId);
  const quantity = Number(payload && payload.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) fail('Quantité de titres invalide.');
  if (c.zone !== p.zone) fail('Cette entreprise est dans une autre zone.');
  if (payload.side !== 'buy' && payload.side !== 'sell') fail('Opération inconnue : utilisez buy ou sell.');
  const price = priceFor(c, game);
  if (payload.side === 'buy') {
    if (!c.available || (currentGrade(game, 'zone', c.zone) === 'E' && currentGrade(game, 'sector', c.sector) === 'E')) fail('Cette entreprise n’est pas cotée.');
    if (totalHeld(c) + quantity > 5) fail('Il ne reste pas assez de titres.');
    if (p.cash < quantity * price) fail('Liquidités insuffisantes.');
    p.cash -= quantity * price;
    recordBuy(c, p.id, quantity, price);
    c.holdings[p.id] = sharesOf(c, p.id) + quantity;
  } else {
    if (sharesOf(c, p.id) < quantity) fail('Vous ne possédez pas assez de titres.');
    removeHolding(c, p.id, quantity); p.cash += quantity * price;
  }
  game.log.push(`${p.name} ${payload.side === 'buy' ? 'achète' : 'vend'} ${quantity} titre(s) de ${c.name || c.id}`);
  p.fundValue = fundValue(game, p);
  recordMarketHistory(game, 'échange');
  return game;
}

function sectorIdAt(game, position) {
  const cell = game.board[position % game.board.length];
  return cell && (cell.sector || cell.sectorId || (cell.kind === 'sector' ? cell.id : null));
}
function resolveMarketShock(game, p, cell, die) {
  const before = marketSnapshot(game);
  const effect = marketEffectFor(cell);
  let targets;
  let description = '';
  if (!effect) {
    // Unrecognized house-rule market cells retain their previous behavior.
    const scope = randInt(2) === 0 ? 'zone' : 'sector';
    const label = String(cell.label || '');
    const delta = label.includes('Bull') ? -1 : label.includes('Crash') ? 2 : 1;
    targets = (scope === 'zone' ? game.zones : game.sectors).map(item => ({ scope, id: item.id, delta }));
  } else if (effect === 'crash') {
    // Crash retains its existing random scope and two-grade decline.
    const scope = randInt(2) === 0 ? 'zone' : 'sector';
    targets = (scope === 'zone' ? game.zones : game.sectors)
      .map(item => ({ scope, id: item.id, delta: 2 }));
    description = `Krach : ${scope === 'zone' ? 'toutes les zones' : 'tous les secteurs'} reculent de deux niveaux, dans la limite E.`;
  } else {
    const delta = effect === 'bull' ? -1 : 1;
    const focusZone = game.zones.find(item => item.id === p.zone);
    if (!focusZone) fail('Le fonds actif doit être implanté sur un marché.');
    targets = game.zones.map(item => ({ scope: 'zone', id: item.id, delta: delta * (item.id === focusZone.id ? 2 : 1) }));
    description = `${effect === 'bull' ? 'Choc haussier' : 'Choc baissier'} : toutes les zones ${effect === 'bull' ? 'progressent' : 'reculent'} d’un niveau, et la zone ${focusZone.name} du fonds actif de deux niveaux au total. Les notes restent bornées de A à E ; les secteurs sont inchangés.`;
  }
  for (const target of targets) {
    const oldGrade = currentGrade(game, target.scope, target.id);
    setGrade(game, target.scope, target.id, GRADES[Math.max(0, Math.min(4, GRADES.indexOf(oldGrade) + target.delta))]);
  }
  bankruptCompanies(game);
  const outcomes = gradeOutcomes(game, before, targets);
  const movements = outcomes.map(change => `${change.scope === 'zone' ? 'Zone' : 'Secteur'} ${(change.scope === 'zone' ? game.zones : game.sectors).find(item => item.id === change.id)?.name || change.id} : ${change.before} → ${change.after}.`);
  game.log.push(`${cell.label} : ${movements.join(' ')}`);
  notice(game, { kind: 'event', source: 'board', title: cell.label, roll: die, position: p.sectorPosition,
    playerId: p.id, playerName: p.name, cell: { kind: cell.kind, label: cell.label },
    description: [description, describeGrades(game, before, targets)].filter(Boolean).join(' '),
    effectLines: movements, gradeOutcomes: outcomes, ...marketImpacts(game, before) });
}
function roll(game, p, payload) {
  if (game.phase !== 'sector') fail('Le déplacement sectoriel n’est pas ouvert.');
  const die = suppliedDie(payload);
  if (die < 1 || die > 6) fail('Le dé doit être compris entre 1 et 6.');
  const old = p.sectorPosition;
  p.sectorPosition = (old + die) % game.board.length;
  game.log.push(`${p.name} lance ${die} et arrive sur ${game.board[p.sectorPosition]?.label || 'le marché'}`);
  const payments = [];
  if (old + die >= game.board.length) settleLap(game, p, payments);
  const cell = game.board[p.sectorPosition % game.board.length];
  const landed = sectorIdAt(game, p.sectorPosition);
  if (cell && String(cell.kind || '').toLowerCase() === 'event') drawBoardEvent(game, p, die, cell);
  if (cell && String(cell.kind || '').toLowerCase() === 'market') {
    resolveMarketShock(game, p, cell, die);
  }
  // Freeze the entire sector debt list before any cash/ownership changes.
  const sectorLabel = game.sectors.find(item => item.id === landed)?.name || landed;
  const byCreditor = new Map();
  game.companies.filter(c => c.sector === landed).forEach(c => {
    Object.keys(c.holdings).forEach(pid => {
      // A sector landing pays only other holders; the active fund earns no
      // market income from its own shares, including full control/monopolies.
      if (pid === p.id) return;
      const qty = sharesOf(c, pid);
      if (!qty) return;
      const amount = money(qty * incomeForHolder(c, game, pid));
      const holder = game.players.find(x => x.id === pid);
      if (!holder || !holder.solvent) return;
      const item = { fromId: p.id, toId: holder.jailed ? null : holder.id,
        companyId: c.id, companyName: c.name || c.id, quantity: qty, perShare: incomeForHolder(c, game, pid), amount };
      const creditorId = holder.jailed ? null : holder.id;
      const key = creditorId || 'bank';
      if (!byCreditor.has(key)) byCreditor.set(key, { debtorId: p.id, creditorId, amount: 0,
        reason: `Revenus du secteur ${sectorLabel}`, sectorId: landed, sectorLabel, items: [] });
      const debt = byCreditor.get(key);
      debt.amount = money(debt.amount + amount); debt.items.push(item);
    });
  });
  const sectorDebts = [...byCreditor.values()].sort((a, b) => {
    if (!a.creditorId) return b.creditorId ? 1 : 0;
    if (!b.creditorId) return -1;
    return fundValue(game, player(game, a.creditorId)) - fundValue(game, player(game, b.creditorId))
      || game.players.findIndex(item => item.id === a.creditorId) - game.players.findIndex(item => item.id === b.creditorId);
  });
  if (sectorDebts.length) {
    game._settlementDebts ||= [];
    game._settlementDebts.push(...sectorDebts);
    game._creditorOrder = sectorDebts.map(debt => debt.creditorId).filter(Boolean);
    game._creditorPriorities = game._creditorOrder.map(playerId => ({ playerId, value: fundValue(game, player(game, playerId)) }));
  }
  if (payments.length || cell?.kind !== 'event') notice(game, { kind: 'payments', playerId: p.id, playerName: p.name, roll: die, position: p.sectorPosition, cell: cell ? { kind: cell.kind, label: cell.label, sector: landed } : null, payments, obligations: sectorDebts });
  p.fundValue = fundValue(game, p);
  recordMarketHistory(game, cell?.kind === 'market' ? 'marché' : 'dé');
  game.phase = p.jailed || !p.solvent ? 'awaitNext' : 'market';
  game.stage = game.phase;
  if (p.jailed) {
    p.geoResolved = true;
    notice(game, { kind: 'event', source: 'board', action: 'skipTrading', playerId: p.id, playerName: p.name,
      title: 'Avoirs gelés', description: `${p.name} est en prison : la séance d’échanges est passée. Le premier procès aura lieu à son prochain tour.` });
  }
  return game;
}

function endMarket(game, p) {
  if (game.phase !== 'market') fail('La phase de marché est déjà terminée.');
  if (!p.geoResolved) fail('Choisissez de rester ou de voyager avant de terminer le marché.');
  game.phase = 'awaitNext';
  return game;
}

function nextTurn(game, p) {
  if (game.phase !== 'awaitNext') fail('Terminez votre action avant de passer.');
  p.fundValue = fundValue(game, p);
  if (!game.completedPlayers.includes(p.id)) game.completedPlayers.push(p.id);
  const alive = game.players.filter(x => x.solvent);
  if (alive.length === 0 || (alive.length <= 1 && game.players.length > 1)) { finishGame(game); return game; }
  const ordered = [...game.players.slice(game.starterIndex), ...game.players.slice(0, game.starterIndex)].filter(x => x.solvent);
  const nextPlayer = ordered.find(x => !game.completedPlayers.includes(x.id));
  if (!nextPlayer) {
    game.completedPlayers = [];
    if (!game.deck.length) { finishGame(game); return game; }
    // Keep the opening seat as the permanent anchor. If it is insolvent,
    // start with the first surviving seat in the same fixed table order.
    game.activeIndex = game.players.indexOf(ordered[0]);
    game.stage = 'geography';
    game.phase = 'geography';
    // The opening cycle already has a geographic starting point. Once the
    // first Context is drawn, every following cycle asks for a new choice.
    const geographicChoiceRequired = (game.cycle || 1) >= 1 && game.deck.length > 0;
    game.players.forEach(x => { x.geoResolved = geographicChoiceRequired ? false : true; x.botMarketDone = false; x.botSectorRolled = false; });
    drawContext(game);
  } else {
    game.activeIndex = game.players.indexOf(nextPlayer);
    game.stage = 'geography';
    game.phase = 'geography';
    nextPlayer.geoResolved = game.cycle === 1 && !nextPlayer.jailed;
    game.phase = nextPlayer.geoResolved ? 'sector' : 'geography';
    game.stage = game.phase;
  }
  return game;
}

function finishGame(game) {
  game.phase = 'finished';
  game.finished = true;
  const solvent = game.players.filter(p => p.solvent);
  const values = solvent.map(p => fundValue(game, p));
  const best = values.length ? Math.max(...values) : 0;
  game.winnerIds = solvent.filter(p => fundValue(game, p) === best).map(p => p.id);
}

function createGame(names) {
  if (!Array.isArray(names) || names.length < 2 || names.length > 6) fail('La partie doit compter de 2 à 6 joueurs.');
  const descriptors = names.map(entry => typeof entry === 'object' ? entry : { name: entry, bot: false });
  const zones = clone(data.zones || []).map(z => ({ id: String(z.id), name: z.name }));
  const sectors = clone(data.sectors || []).map(s => ({ id: String(s.id), name: s.name }));
  const board = clone(data.board || sectors.map(s => ({ kind: 'sector', sector: s.id, label: s.name })));
  if (!board.length) fail('Le plateau sectoriel est vide.');
  const initiative = descriptors.map(() => randInt(6) + 1);
  let candidates = initiative.map((value, index) => ({ value, index })).filter(item => item.value === Math.max(...initiative)).map(item => item.index);
  while (candidates.length > 1) {
    const rerolls = candidates.map(index => ({ index, value: randInt(6) + 1 }));
    const highest = Math.max(...rerolls.map(item => item.value));
    candidates = rerolls.filter(item => item.value === highest).map(item => item.index);
  }
  const starterIndex = candidates[0];
  const players = descriptors.map((entry, i) => {
    const record = { id: `p${i + 1}`, name: String(entry.name || `Joueur ${i + 1}`), bot: entry.kind === 'ai', pawn: entry.pawn, color: ['#dfb96d', '#55a9e2', '#c2cbd6', '#b18bea', '#e96b6b', '#55b999'][i], difficulty: entry.difficulty, lapStartValue: 100, capitalFlows: 0, lapStartCapitalFlows: 0, cash: 100, zone: null, sectorPosition: 0, jailed: false, prisonStage: -1, prisonWait: false, geoResolved: true, botMarketDone: false, botSectorRolled: false, solvent: true, fundValue: 100 };
    record.startingMarket = entry.startingMarket;
    record.zone = entry.startingMarket;
    const legacyNationality = NATIONALITY_BY_ID.get(entry.nationality);
    if (legacyNationality) {
      record.nationality = legacyNationality.id;
      record.nationalityName = legacyNationality.name;
      record.nationalityFlag = legacyNationality.flag;
    }
    syncPlayerMarkets(record);
    return record;
  });
  const game = {
    players,
    zones, sectors, board,
    zoneGrades: Object.fromEntries(zones.map(z => [z.id, 'C'])),
    sectorGrades: Object.fromEntries(sectors.map(s => [s.id, 'C'])),
    companies: clone(data.companies || []).map(c => ({ ...c, id: String(c.id), zone: String(c.zone), sector: String(c.sector), holdings: {}, costBasis: {}, available: true })),
    deck: contextDeck(), currentContext: null, boardEventDeck: shuffle(BOARD_EVENT_CARDS.map(clone)), boardEventDiscard: [], activeIndex: starterIndex, starterIndex, initiative, turnFormat: 'travel-first', rulesVersion: 3, eventTextVersion: EVENT_TEXT_VERSION, cardRulesVersion: CARD_RULES_VERSION, marketRulesVersion: MARKET_RULES_VERSION, boardLayoutVersion: BOARD_LAYOUT_VERSION, legacyOpening: false, stage: 'sector', phase: 'sector', cycle: 1, noticeSeq: 0, notices: [], finished: false, winnerIds: [], completedPlayers: [], log: [], started: true
  };
  game.log.push(`${game.players[starterIndex].name} ouvre la partie (dé ${initiative[starterIndex]})`);
  game.log.push('Cycle d’ouverture : tous les indices commencent à C, sans carte Contexte.');
  recordMarketHistory(game, 'ouverture');
  return game;
}

function applyAction(game, playerId, action, payload = {}) {
  if (!game || game.phase === 'finished') fail('La partie est terminée.');
  if (game.marketRulesVersion > MARKET_RULES_VERSION || game.boardLayoutVersion > BOARD_LAYOUT_VERSION || game.cardRulesVersion > CARD_RULES_VERSION || game.eventTextVersion > EVENT_TEXT_VERSION)
    fail('Cette version des règles de marché, du plateau ou des cartes n’est pas prise en charge.');
  upgradeMarketBoard(game);
  upgradeCardCatalogs(game);
  if (game.pendingSettlement) {
    settlementAction(game, playerId, action, payload);
    game.players.forEach(syncPlayerMarkets);
    return game;
  }
  const p = player(game, playerId);
  if (game.players[game.activeIndex].id !== p.id) fail('Ce n’est pas votre tour.');
  if (!p.solvent && action !== 'nextTurn') fail('Ce joueur est insolvable.');
  switch (action) {
    case 'move': move(game, p, payload); break;
    case 'prisonRoll': prisonRoll(game, p); break;
    case 'stay': stay(game, p); break;
    case 'trade': trade(game, p, payload); break;
    case 'endMarket': endMarket(game, p); break;
    case 'roll': roll(game, p, payload); break;
    case 'nextTurn': nextTurn(game, p); break;
    default: fail(`Action inconnue : ${action}`);
  }
  if (!p.solvent && game.phase !== 'finished') game.phase = 'awaitNext';
  if (game._settlementDebts?.length) {
    const debts = game._settlementDebts; const order = game._creditorOrder || []; const priorities = game._creditorPriorities || [];
    delete game._settlementDebts; delete game._creditorOrder; delete game._creditorPriorities;
    const receiptPayments = (game.notices.at(-1)?.payments || []).filter(payment =>
      !payment.fromId && payment.toId && payment.companyId && payment.quantity > 0);
    continueSettlements(game, debts, game.phase, [], order, priorities, null, receiptPayments);
  }
  game.players.forEach(syncPlayerMarkets);
  game.stage = game.phase;
  return game;
}

function publicState(game) {
  upgradeMarketBoard(game);
  upgradeCardCatalogs(game);
  // Upgrade old serialized rooms lazily when they are first observed.
  game.players.forEach(item => {
    syncPlayerMarkets(item);
    if (!game.legacyOpening && (game.cycle || 1) === 1 && !item.jailed) item.geoResolved = true;
    else if (item.geoResolved == null) item.geoResolved = (game.cycle || 1) === 1;
  });
  const state = clone(game);
  state.activePlayerId = game.players[game.activeIndex] && game.players[game.activeIndex].id;
  state.contextsRemaining = game.deck.length;
  state.boardEventsRemaining = Array.isArray(game.boardEventDeck) ? game.boardEventDeck.length : BOARD_EVENT_CARDS.length;
  state.marketHistory = game.marketHistory?.length ? state.marketHistory : [historyPoint(game, 'reprise')];
  state.currentContext = game.currentContext || game.currentEvent || null;
  delete state.currentEvent;
  state.finished = game.phase === 'finished' || game.finished === true;
  state.winnerIds = state.finished ? (game.winnerIds || []) : [];
  state.players = game.players.map(p => ({
    ...p,
    position: p.sectorPosition,
    valuation: fundValue(game, p),
    fundValue: fundValue(game, p)
  }));
  state.companies = game.companies.map(c => ({ ...c, price: priceFor(c, game), income: incomeFor(c, game), totalHeld: totalHeld(c), sharesAvailable: c.available ? Math.max(0, 5 - totalHeld(c)) : 0, averageBuyPrice: Object.fromEntries(Object.keys(c.holdings).map(pid => [pid, averageBuyPrice(c, pid)])) }));
  state.companies.forEach(c => { delete c.costBasis; });
  delete state.deck;
  delete state.boardEventDeck;
  delete state.boardEventDiscard;
  delete state.recentEventTargets;
  return state;
}

module.exports = { createGame, applyAction, publicState, priceFor, incomeFor, incomeForHolder, ownsMonopoly, fundValue, eventDescription, data, nationalities };
