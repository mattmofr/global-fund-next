import { afterEach, describe, expect, it, vi } from "vitest";
import { io as clientIo, type Socket } from "socket.io-client";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../apps/server/src/server.js";
import type { ApiResult, RoomView, SeatConfig } from "@global-fund/shared";

const seats: SeatConfig[] = [
  { name: "Europe", kind: "local", startingMarket: "europe", pawn: "lion", difficulty: "normal" },
  { name: "Asia", kind: "remote", startingMarket: "asia", pawn: "bull", difficulty: "normal" },
];
const services: Awaited<ReturnType<typeof createServer>>[] = [];
const sockets: Socket[] = [];
const folders: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  sockets.splice(0).forEach(socket => socket.disconnect());
  await Promise.all(services.splice(0).map(service => service.close()));
  folders.splice(0).forEach(folder => rmSync(folder, { recursive: true, force: true }));
  vi.unstubAllEnvs();
});

function emit(socket: Socket, event: string, body: unknown): Promise<ApiResult & { ok: true }> {
  return new Promise((resolve, reject) => socket.timeout(5000).emit(event, body, (error: Error | null, result: ApiResult) => {
    if (error) reject(error);
    else if (!result.ok) reject(new Error(result.error));
    else resolve(result);
  }));
}

async function connect(port: number) {
  const socket = clientIo(`http://127.0.0.1:${port}`, { transports: ["websocket"], reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });
  return socket;
}

describe("durable multiplayer market shocks", () => {
  it.each([
    { label: "Bull Market", index: 13, focusGrade: "A", otherGrade: "B" },
    { label: "Bear Market", index: 39, focusGrade: "E", otherGrade: "D" },
  ])("broadcasts, saves and deduplicates $label without a second shock", async ({ label, index, focusGrade, otherGrade }) => {
    vi.stubEnv("DATABASE_URL", "");
    const folder = mkdtempSync(join(tmpdir(), "evolve-market-shock-"));
    folders.push(folder);
    const storageFile = join(folder, "rooms.json");
    const service = await createServer({ storageFile, logger: false });
    services.push(service);
    await service.app.listen({ host: "127.0.0.1", port: 0 });
    const address = service.app.server.address();
    if (!address || typeof address === "string") throw new Error("TCP address required");
    const host = await connect(address.port);
    const created = await emit(host, "room:create", { seats });
    const guest = await connect(address.port);
    await emit(guest, "room:join", { roomId: created.room.roomId, name: "Asia", startingMarket: "asia" });
    await emit(guest, "room:ready", { roomId: created.room.roomId, ready: true });
    const started = await emit(host, "room:start", { roomId: created.room.roomId });
    expect(started.room.game?.board[39].label).toBe("Bear Market");
    const stored = service.rooms.get(started.room.roomId)!;
    const state = stored.state!;
    // Install a legal pre-roll position; only the public command resolves it.
    state.activeIndex = 0;
    state.players[0].sectorPosition = index - 1;
    state.players[0].zone = "europe";
    state.players[0].geoResolved = true;
    state.phase = "sector";
    state.stage = "sector";
    const company = state.companies.find(item => item.zone === "europe")!;
    company.basePrice = 100;
    company.baseIncome = 10;
    company.holdings.p1 = 1;
    company.costBasis = { p1: 20 };
    const beforeDeck = structuredClone(state.deck);
    let broadcast: RoomView | undefined;
    guest.on("room:state", room => { broadcast = room; });
    vi.spyOn(Math, "random").mockReturnValue(0); // A server-generated die of 1.
    const request = { roomId: stored.roomId, playerId: "p1", commandId: `one-${index}`, expectedRevision: started.room.revision, command: { type: "ROLL" } };
    const rolled = await emit(host, "room:command", request);
    await expect.poll(() => broadcast?.revision).toBe(rolled.room.revision);
    expect(broadcast?.game?.zoneGrades).toEqual(rolled.room.game?.zoneGrades);
    expect(rolled.room.game?.zoneGrades.europe).toBe(focusGrade);
    expect(rolled.room.game?.zoneGrades.asia).toBe(otherGrade);
    expect(rolled.room.game?.notices.find(item => item.title === label)?.cell).toEqual({ kind: "market", label });
    expect(rolled.room.game?.companies.find(item => item.id === company.id)?.price).toBe(label === "Bull Market" ? 30 : 10);
    expect(rolled.room.game?.players[0].cash).toBe(100);

    const repeated = await emit(host, "room:command", request);
    expect(repeated.room.revision).toBe(rolled.room.revision);
    expect(repeated.room.game?.zoneGrades).toEqual(rolled.room.game?.zoneGrades);
    const saved = JSON.parse(readFileSync(storageFile, "utf8"))[0];
    expect(saved.state.board[39].label).toBe("Bear Market");
    expect(saved.state.zoneGrades).toEqual(rolled.room.game?.zoneGrades);
    expect(saved.state.deck).toEqual(beforeDeck);
    expect(saved.state.companies.find((item: { id: string }) => item.id === company.id).holdings).toEqual({ p1: 1 });
    expect(saved.state.notices.filter((item: { title: string }) => item.title === label)).toHaveLength(1);
  });
});
