/**
 * Static top-down board for browsers without WebGL (or after a GPU failure):
 * the same engraved atlas, drawn once on a 2D canvas, with the funds' seats.
 */
import { useEffect, useRef, type RefObject } from "react";
import type { BoardCell, Player } from "@global-fund/shared";
import type { BoardInsets } from "../types";
import { buildBoardAtlas, ensureBoardFonts } from "./atlas";
import { BOARD_SIZE, CELLS, PLAQUE_GAP, TRACK_HALF, wrapCell } from "./layout";

export function FallbackBoard({ board, players, insets, host }: { board: BoardCell[]; players: Player[]; insets: BoardInsets; host: RefObject<HTMLDivElement | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    void ensureBoardFonts().then(() => {
      const el = canvas.current;
      if (!alive || !el) return;
      const width = window.innerWidth, height = window.innerHeight;
      el.width = width;
      el.height = height;
      const ctx = el.getContext("2d");
      if (!ctx) return;
      const atlas = buildBoardAtlas(board, 96, false);
      const fw = width - insets.left - insets.right, fh = height - insets.top - insets.bottom;
      const size = Math.max(120, Math.min(fw, fh) * 0.94);
      const unit = size / BOARD_SIZE;
      const x0 = insets.left + (fw - size) / 2, y0 = insets.top + (fh - size) / 2;
      const X = (x: number) => x0 + (x + BOARD_SIZE / 2) * unit;
      const Y = (z: number) => y0 + (z + BOARD_SIZE / 2) * unit;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#c79f5c";
      ctx.fillRect(x0, y0, size, size);
      ctx.fillStyle = "#070606";
      ctx.fillRect(X(-TRACK_HALF), Y(-TRACK_HALF), TRACK_HALF * 2 * unit, TRACK_HALF * 2 * unit);
      const g = PLAQUE_GAP / 2;
      CELLS.forEach((cell, i) => {
        const r = atlas.cells[i]!;
        ctx.drawImage(atlas.color, r.x, r.y, r.w, r.h, X(cell.x0 + g), Y(cell.z0 + g), (cell.x1 - cell.x0 - g * 2) * unit, (cell.z1 - cell.z0 - g * 2) * unit);
      });
      players.forEach((player, index) => {
        const cell = CELLS[wrapCell(player.sectorPosition)]!;
        const peers = players.filter((p) => wrapCell(p.sectorPosition) === wrapCell(player.sectorPosition));
        const slot = peers.indexOf(player);
        const offset = (slot - (peers.length - 1) / 2) * unit * 0.32;
        ctx.beginPath();
        ctx.arc(X(cell.cx) + offset, Y(cell.cz), unit * 0.2, 0, Math.PI * 2);
        ctx.fillStyle = player.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#f6e7c4";
        ctx.stroke();
        void index;
      });
      if (host.current) host.current.dataset.sceneReady = "true";
    });
    return () => { alive = false; };
  }, [board, players, insets, host]);
  return <canvas ref={canvas} className="fund-board-fallback" />;
}
