import { describe, expect, it } from "vitest";
import { createGame } from "@global-fund/game-engine";

const EXPECTED_CELLS = [
  "start",
  "sector:industry",
  "sector:technology",
  "event",
  "sector:transport",
  "sector:realestate",
  "sector:energy",
  "sector:media",
  "event",
  "sector:finance",
  "sector:agrifood",
  "sector:health",
  "sector:technology",
  "market:Bull Market",
  "sector:industry",
  "sector:realestate",
  "event",
  "sector:transport",
  "sector:energy",
  "sector:finance",
  "sector:media",
  "event",
  "sector:technology",
  "sector:agrifood",
  "sector:health",
  "sector:realestate",
  "event",
  "sector:industry",
  "sector:transport",
  "sector:finance",
  "event",
  "sector:energy",
  "sector:technology",
  "sector:media",
  "sector:realestate",
  "event",
  "sector:agrifood",
  "sector:health",
  "event",
  "market:Bear Market",
  "sector:finance",
  "sector:industry",
  "sector:transport",
  "event",
  "sector:technology",
  "sector:energy",
  "sector:realestate",
  "sector:media",
  "event",
  "sector:agrifood",
  "sector:health",
  "sector:finance",
] as const;

function encodedBoard() {
  return createGame([
    {
      name: "Audit",
      kind: "local",
      startingMarket: "europe",
      pawn: "lion",
      difficulty: "normal",
    },
    {
      name: "Peer",
      kind: "local",
      startingMarket: "asia",
      pawn: "bull",
      difficulty: "normal",
    },
  ]).board.map((cell) => {
    if (cell.kind === "sector") return `sector:${cell.sector}`;
    if (cell.kind === "market") return `market:${cell.label}`;
    return cell.kind;
  });
}

function circularGaps(positions: number[], boardLength: number): number[] {
  return positions.map((position, index) => {
    const next = positions[(index + 1) % positions.length]!;
    return (next - position + boardLength) % boardLength;
  });
}

describe("canonical board balance", () => {
  it("keeps the validated 52-cell order, sectors, and special positions", () => {
    const board = encodedBoard();
    expect(board).toHaveLength(52);
    expect(board).toEqual(EXPECTED_CELLS);
    expect(board[0]).toBe("start");
    expect(board[13]).toBe("market:Bull Market");
    expect(board[25]).toBe("sector:realestate");
    expect(board[38]).toBe("event");
    expect(board[39]).toBe("market:Bear Market");
    expect(board.filter((cell) => cell === "event")).toHaveLength(10);
    expect(board.some((cell) => cell === "market:Market Crash")).toBe(false);
  });

  it("gives Finance, Technology, and Real Estate five cells and every other sector four", () => {
    const counts = new Map<string, number>();
    for (const cell of encodedBoard()) {
      if (!cell.startsWith("sector:")) continue;
      const sector = cell.slice("sector:".length);
      counts.set(sector, (counts.get(sector) ?? 0) + 1);
    }

    expect(Object.fromEntries(counts)).toEqual({
      industry: 4,
      technology: 5,
      transport: 4,
      realestate: 5,
      energy: 4,
      media: 4,
      finance: 5,
      agrifood: 4,
      health: 4,
    });
    expect([...counts.values()].filter((count) => count === 5)).toHaveLength(3);
    expect([...counts.values()].filter((count) => count === 4)).toHaveLength(6);
  });

  it("covers all nine sectors in every 13-cell quarter", () => {
    const board = encodedBoard();
    for (let quarter = 0; quarter < 4; quarter += 1) {
      const cells = board.slice(quarter * 13, (quarter + 1) * 13);
      const sectors = cells
        .filter((cell) => cell.startsWith("sector:"))
        .map((cell) => cell.slice("sector:".length));

      expect(new Set(sectors), `quarter ${quarter + 1}`).toHaveProperty("size", 9);
    }
  });

  it("spaces each sector around the circular board with gaps from 9 to 14", () => {
    const board = encodedBoard();
    const sectorIds = [...new Set(board.filter((cell) => cell.startsWith("sector:")))];

    for (const sectorCell of sectorIds) {
      const positions = board.flatMap((cell, index) => cell === sectorCell ? [index] : []);
      const gaps = circularGaps(positions, board.length);

      expect(Math.min(...gaps), sectorCell).toBeGreaterThanOrEqual(9);
      expect(Math.max(...gaps), sectorCell).toBeLessThanOrEqual(14);
    }
  });

  it("has no repeated sector in the same or any of the next four circular cells", () => {
    const board = encodedBoard();

    for (let index = 0; index < board.length; index += 1) {
      const cell = board[index]!;
      if (!cell.startsWith("sector:")) continue;
      for (let distance = 1; distance <= 4; distance += 1) {
        const next = board[(index + distance) % board.length]!;
        expect(next, `case ${index + 1} and circular distance ${distance}`).not.toBe(cell);
      }
    }
  });
});
