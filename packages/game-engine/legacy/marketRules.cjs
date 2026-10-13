'use strict';

const { board } = require('./data/gameData.json');
const previousBoard = require('./data/board-layout-v2.json');
const BOARD_LAYOUT_VERSION = 3;
const MARKET_RULES_VERSION = 2;
const BEAR_INDEX = 39; // Case 40, with the existing zero-based engine positions.
const LABEL_EFFECTS = Object.freeze({ 'Bull Market': 'bull', 'Bear Market': 'bear', 'Market Crash': 'crash' });

function marketEffectFor(cell) {
  if (cell?.kind !== 'market') return null;
  return ['bull', 'bear', 'crash'].includes(cell.marketEffect)
    ? cell.marketEffect : LABEL_EFFECTS[cell.label] || null;
}

// Match every logical cell before upgrading a saved board. Custom layouts and
// old 44-cell boards must retain their own order, positions and rules of travel.
function layoutSignature(cells) {
  return JSON.stringify(cells.map(cell => [cell.kind, cell.label, cell.sector || null, cell.marketEffect || LABEL_EFFECTS[cell.label] || null]));
}
const currentSignature = layoutSignature(board);
const previousSignature = layoutSignature(previousBoard);
const originalBoard = previousBoard.map(cell => ({ ...cell }));
[originalBoard[BEAR_INDEX - 1], originalBoard[BEAR_INDEX]] = [originalBoard[BEAR_INDEX], originalBoard[BEAR_INDEX - 1]];
const originalSignature = layoutSignature(originalBoard);

function upgradeMarketBoard(game) {
  if (game.boardLayoutVersion > BOARD_LAYOUT_VERSION || game.marketRulesVersion > MARKET_RULES_VERSION) return;
  const signature = layoutSignature(game.board);
  if (![originalSignature, previousSignature, currentSignature].includes(signature)) return;

  // Notices describe an already resolved landing. Freeze its identity before
  // changing the board, without rewriting its historical position or outcome.
  for (const item of game.notices || []) {
    if (!item.cell && item.source === 'board' && LABEL_EFFECTS[item.title]) {
      item.cell = { kind: 'market', label: item.title };
    } else if (!item.cell && Number.isInteger(item.position) && game.board[item.position]) {
      const cell = game.board[item.position];
      item.cell = { kind: cell.kind, label: cell.label, ...(cell.sector ? { sector: cell.sector } : {}) };
    }
  }
  if (signature !== currentSignature) {
    game.board = board.map(cell => ({ ...cell }));
  }
  for (const cell of game.board) {
    if (cell.kind === 'market' && LABEL_EFFECTS[cell.label]) cell.marketEffect = LABEL_EFFECTS[cell.label];
  }
  // Players keep their numerical week positions. No past landing is replayed.
  game.boardLayoutVersion = BOARD_LAYOUT_VERSION;
  game.marketRulesVersion = MARKET_RULES_VERSION;
}

module.exports = { BOARD_LAYOUT_VERSION, MARKET_RULES_VERSION, BEAR_INDEX, marketEffectFor, upgradeMarketBoard };
