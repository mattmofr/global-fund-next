'use strict';

const { events } = require('./data/gameData.json');
const { BOARD_EVENT_CARDS } = require('./boardEventCards.cjs');
const CARD_RULES_VERSION = 3;
const EVENT_TEXT_VERSION = 3;
const contextsById = new Map(events.map(card => [String(card.id), card]));
const eventsById = new Map(BOARD_EVENT_CARDS.map(card => [String(card.id), card]));

function upgradeCardCatalogs(game) {
  if (game.eventTextVersion > EVENT_TEXT_VERSION || game.cardRulesVersion > CARD_RULES_VERSION) return;
  if (game.cardRulesVersion === CARD_RULES_VERSION) {
    game.eventTextVersion = Math.max(Number(game.eventTextVersion) || 0, EVENT_TEXT_VERSION);
    return;
  }
  const replace = (cards, catalog) => Array.isArray(cards)
    ? cards.map(card => catalog.has(String(card.id)) ? JSON.parse(JSON.stringify(catalog.get(String(card.id)))) : card)
    : cards;
  // Keep draw order/count and unknown custom cards. A revealed Context and
  // historical notices remain exactly as resolved; discards supply future draws.
  game.deck = replace(game.deck, contextsById);
  game.boardEventDeck = replace(game.boardEventDeck, eventsById);
  game.boardEventDiscard = replace(game.boardEventDiscard, eventsById);
  game.cardRulesVersion = CARD_RULES_VERSION;
  game.eventTextVersion = Math.max(Number(game.eventTextVersion) || 0, EVENT_TEXT_VERSION);
}

module.exports = { CARD_RULES_VERSION, EVENT_TEXT_VERSION, upgradeCardCatalogs };
