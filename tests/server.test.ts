import { afterEach, describe, expect, it } from "vitest";
import { io as clientIo, type Socket } from "socket.io-client";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chooseAiCommand } from "@global-fund/game-engine";
import { createServer } from "../apps/server/src/server.js";
import type {
  ApiResult,
  CommandRequest,
  RoomView,
  SeatConfig,
  Session,
} from "@global-fund/shared";
import { MARKET_IDS } from "@global-fund/shared";

const seats: SeatConfig[] = [
  {
    name: "Host",
    kind: "local",
    startingMarket: "europe",
    pawn: "lion",
    difficulty: "normal",
  },
  {
    name: "Guest",
    kind: "remote",
    startingMarket: "asia",
    pawn: "bull",
    difficulty: "normal",
  },
  {
    name: "Bot",
    kind: "ai",
    startingMarket: "americas",
    pawn: "globe",
    difficulty: "easy",
  },
];
const services: Awaited<ReturnType<typeof createServer>>[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.disconnect());
  await Promise.all(services.splice(0).map((s) => s.close()));
});
function emit<T = ApiResult>(
  socket: Socket,
  event: string,
  body?: unknown,
): Promise<T> {
  return new Promise((resolve, reject) =>
    socket
      .timeout(5000)
      .emit(event, body, (err: Error | null, result: T) =>
        err ? reject(err) : resolve(result),
      ),
  );
}
async function client(port: number) {
  const socket = clientIo(`http://127.0.0.1:${port}`, {
    transports: ["websocket"],
    reconnection: false,
  });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return socket;
}
async function humanTurn(host: Socket, room: ApiResult & { ok: true }) {
  let current = room.room;
  while (current.game?.activePlayerId === "p3") {
    current = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        host.off("room:state", onState);
        resolve(current);
      }, 8000);
      const onState = (next: typeof current) => {
        current = next;
        if (next.game?.activePlayerId !== "p3") {
          clearTimeout(timeout);
          host.off("room:state", onState);
          resolve(next);
        }
      };
      host.on("room:state", onState);
    });
  }
  return current;
}
async function setup() {
  const service = await createServer({ storageFile: false });
  services.push(service);
  await service.app.listen({ host: "127.0.0.1", port: 0 });
  const address = service.app.server.address();
  if (!address || typeof address === "string")
    throw new Error("Expected TCP address");
  return { service, port: address.port };
}

describe("authoritative socket server", () => {
  it("accepts exactly five canonical markets and rejects an explicit sixth in create, join and start", async () => {
    const { port } = await setup();
    const host = await client(port);
    const guest = await client(port);
    for (const startingMarket of MARKET_IDS) {
      const created = await emit(host, "room:create", { seats: [{ ...seats[0], startingMarket }, seats[1]] });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("create failed");
      expect(created.room.players[0].startingMarket).toBe(startingMarket);
      expect(created.room.players[0]).not.toHaveProperty("nationality");
    }
    const invalid = await emit(host, "room:create", {
      seats: [{ ...seats[0], startingMarket: "mea", nationality: "france" }, seats[1]],
    });
    expect(invalid.ok).toBe(false);
    const created = await emit(host, "room:create", { seats: [seats[0], seats[1]] });
    if (!created.ok) throw new Error("create failed");
    const roomId = created.room.roomId;
    expect((await emit(guest, "room:join", { roomId, name: "Guest", startingMarket: "mea", nationality: "japan" })).ok).toBe(false);
    expect((await emit(host, "room:start", { roomId, startingMarket: "mea" })).ok).toBe(false);
    const joined = await emit(guest, "room:join", { roomId, name: "Guest", startingMarket: "africa" });
    if (!joined.ok) throw new Error("join failed");
    expect(joined.room.players[1].startingMarket).toBe("africa");
    await emit(guest, "room:ready", { roomId, ready: true });
    const started = await emit(host, "room:start", { roomId });
    if (!started.ok) throw new Error("start failed");
    expect(started.room.game!.players[1]).toMatchObject({ startingMarket: "africa", currentMarket: "africa", zone: "africa", cash: 100 });
    expect(started.room.game!.players[1]).not.toHaveProperty("nationality");
  });

  it("adapts old create/join country requests to real markets", async () => {
    const { port } = await setup();
    const host = await client(port);
    const guest = await client(port);
    const legacySeats = seats.slice(0, 2).map(({ startingMarket: _market, ...seat }, index) => ({ ...seat, nationality: index === 0 ? "france" : "japan" }));
    const created = await emit(host, "room:create", { seats: legacySeats });
    if (!created.ok) throw new Error("legacy create failed");
    expect(created.room.players.map((player) => player.startingMarket)).toEqual(["europe", "asia"]);
    const roomId = created.room.roomId;
    expect((await emit(guest, "room:join", { roomId, name: "Guest", nationality: "invalid" })).ok).toBe(false);
    const joined = await emit(guest, "room:join", { roomId, name: "Guest", nationality: "canada" });
    if (!joined.ok) throw new Error("legacy join failed");
    expect(joined.room.players[1].startingMarket).toBe("americas");
    await emit(guest, "room:ready", { roomId, ready: true });
    const started = await emit(host, "room:start", { roomId });
    if (!started.ok) throw new Error("legacy start failed");
    expect(started.room.game!.players[1]).toMatchObject({ startingMarket: "americas", currentMarket: "americas", nationality: "canada" });
  });

  it("rebalances AI locations after a remote human changes their starting market", async () => {
    const { port } = await setup();
    const host = await client(port);
    const guest = await client(port);
    const created = await emit(host, "room:create", { seats: [seats[0], seats[1], { ...seats[2], startingMarket: "europe" }] });
    if (!created.ok) throw new Error("create failed");
    const roomId = created.room.roomId;
    const botMarket = created.room.players[2].startingMarket;
    await emit(guest, "room:join", { roomId, name: "Guest", startingMarket: botMarket });
    await emit(guest, "room:ready", { roomId, ready: true });
    const started = await emit(host, "room:start", { roomId });
    if (!started.ok) throw new Error("start failed");
    expect(new Set(started.room.players.map((player) => player.startingMarket)).size).toBe(3);
    expect(started.room.players.map((player) => player.startingMarket)).toEqual(started.room.game!.players.map((player) => player.startingMarket));
  });

  it("creates local, remote, and AI seats; requires claimed remote readiness before host start", async () => {
    const { port } = await setup();
    const host = await client(port);
    const guest = await client(port);
    const created = await emit(host, "room:create", { seats });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.room.players.map((p) => p.kind)).toEqual([
      "local",
      "remote",
      "ai",
    ]);
    expect(JSON.stringify(created.room)).not.toContain(created.session?.token);
    const early = await emit(host, "room:start", {
      roomId: created.room.roomId,
    });
    expect(early.ok).toBe(false);
    const joined = await emit(guest, "room:join", {
      roomId: created.room.roomId,
      name: "Guest",
    });
    expect(joined.ok).toBe(true);
    if (!joined.ok || !joined.session) return;
    expect(joined.room.players[1].ready).toBe(false);
    expect(
      (await emit(host, "room:start", { roomId: created.room.roomId })).ok,
    ).toBe(false);
    expect(
      (
        await emit(guest, "room:ready", {
          roomId: created.room.roomId,
          ready: true,
        })
      ).ok,
    ).toBe(true);
    const disconnectedState = new Promise<RoomView>((resolve) =>
      host.once("room:state", resolve),
    );
    guest.disconnect();
    const afterDisconnect = await disconnectedState;
    expect(afterDisconnect.players[1]).toMatchObject({
      connected: false,
      ready: true,
    });
    const claimant = await client(port);
    expect(
      (
        await emit(claimant, "room:join", {
          roomId: created.room.roomId,
          name: "Intruder",
        })
      ).ok,
    ).toBe(false);
    const resumedSocket = await client(port);
    const resumed = await emit(resumedSocket, "room:resume", joined.session);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.room.players[1]).toMatchObject({
      connected: true,
      ready: true,
    });
    const started = await emit(host, "room:start", {
      roomId: created.room.roomId,
    });
    expect(started.ok).toBe(true);
    if (started.ok) expect(started.room.status).toBe("playing");
  });

  it("enforces seat control, revision, quantity, command deduplication, and resume tokens", async () => {
    const { port } = await setup();
    const host = await client(port);
    const guest = await client(port);
    const created = await emit(host, "room:create", { seats });
    if (!created.ok || !created.session) throw new Error("create failed");
    const joined = await emit(guest, "room:join", {
      roomId: created.room.roomId,
      name: "Guest",
    });
    if (!joined.ok || !joined.session) throw new Error("join failed");
    await emit(guest, "room:ready", {
      roomId: created.room.roomId,
      ready: true,
    });
    const started = await emit(host, "room:start", {
      roomId: created.room.roomId,
    });
    if (!started.ok) throw new Error("start failed");
    const currentRoom = await humanTurn(host, started);
    const roomId = currentRoom.roomId,
      activeId = currentRoom.game!.activePlayerId;
    const activeSocket = activeId === "p1" ? host : guest;
    const activeSession: Session =
      activeId === "p1" ? created.session : joined.session;
    const wrongSocket = activeSocket === host ? guest : host;
    const request = (
      commandId: string,
      expectedRevision: number,
      command: CommandRequest["command"],
    ): CommandRequest => ({
      roomId,
      playerId: activeId,
      commandId,
      expectedRevision,
      command,
    });
    const spoof = await emit(
      wrongSocket,
      "room:command",
      request("spoof", currentRoom.revision, { type: "ROLL" }),
    );
    expect(spoof).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
    const stale = await emit(
      activeSocket,
      "room:command",
      request("stale", currentRoom.revision - 1, { type: "ROLL" }),
    );
    expect(stale).toMatchObject({ ok: false, code: "STALE_REVISION" });
    const badQuantity = await emit(
      activeSocket,
      "room:command",
      request("bad-qty", currentRoom.revision, {
        type: "BUY_SHARE",
        companyId: "anything",
        quantity: 0,
      }),
    );
    expect(badQuantity.ok).toBe(false);
    const command: CommandRequest["command"] = { type: "ROLL" };
    const first = await emit(
      activeSocket,
      "room:command",
      request("roll-once", currentRoom.revision, command),
    );
    if (!first.ok) throw new Error(`roll rejected: ${first.error}`);
    const repeated = await emit(
      activeSocket,
      "room:command",
      request("roll-once", currentRoom.revision, command),
    );
    expect(repeated.ok).toBe(true);
    if (repeated.ok) expect(repeated.room.revision).toBe(first.room.revision);
    expect(
      await emit(
        wrongSocket,
        "room:command",
        request("roll-once", currentRoom.revision, command),
      ),
    ).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
    const resumedSocket = await client(port);
    expect(
      (
        await emit(resumedSocket, "room:resume", {
          ...activeSession,
          token: "invalid",
        })
      ).ok,
    ).toBe(false);
    const resumed = await emit(resumedSocket, "room:resume", activeSession);
    expect(resumed.ok).toBe(true);
    if (resumed.ok) expect(resumed.session).toBeUndefined();
  }, 20000);

  it("persists token hashes and lets a host resume a saved lobby after restart", async () => {
    const folder = mkdtempSync(join(tmpdir(), "global-fund-room-"));
    try {
      const storageFile = join(folder, "rooms.json");
      const first = await createServer({ storageFile });
      services.push(first);
      await first.app.listen({ host: "127.0.0.1", port: 0 });
      const address = first.app.server.address();
      if (!address || typeof address === "string")
        throw new Error("Expected TCP address");
      const host = await client(address.port);
      const created = await emit(host, "room:create", { seats });
      if (!created.ok || !created.session) throw new Error("create failed");
      host.disconnect();
      await first.close();
      services.splice(services.indexOf(first), 1);
      // Simulate a lobby written before startingMarket was introduced.
      const oldRooms = JSON.parse(readFileSync(storageFile, "utf8"));
      for (const player of oldRooms[0].players) {
        delete player.startingMarket;
        player.nationality = { p1: "france", p2: "japan", p3: "canada" }[player.id as "p1" | "p2" | "p3"];
      }
      writeFileSync(storageFile, JSON.stringify(oldRooms));
      const second = await createServer({ storageFile });
      services.push(second);
      await second.app.listen({ host: "127.0.0.1", port: 0 });
      const secondAddress = second.app.server.address();
      if (!secondAddress || typeof secondAddress === "string")
        throw new Error("Expected TCP address");
      const resumedHost = await client(secondAddress.port);
      const resumed = await emit(resumedHost, "room:resume", created.session);
      expect(resumed.ok).toBe(true);
      if (resumed.ok) {
        expect(resumed.room.players[0].connected).toBe(true);
        expect(resumed.room.players.map((player) => player.startingMarket)).toEqual(["europe", "asia", "americas"]);
      }
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }, 20000);

  it("keeps concurrent room snapshots and compact command IDs returns the current room on retries", async () => {
    const folder = mkdtempSync(join(tmpdir(), "global-fund-races-"));
    try {
      const storageFile = join(folder, "rooms.json");
      const service = await createServer({ storageFile });
      services.push(service);
      await service.app.listen({ host: "127.0.0.1", port: 0 });
      const address = service.app.server.address();
      if (!address || typeof address === "string")
        throw new Error("Expected TCP address");
      const left = await client(address.port),
        right = await client(address.port);
      const [a, b] = await Promise.all([
        emit(left, "room:create", { seats }),
        emit(right, "room:create", { seats }),
      ]);
      expect(a.ok && b.ok).toBe(true);
      const saved = JSON.parse(readFileSync(storageFile, "utf8")) as {
        roomId: string;
        commandIds: Record<string, unknown>;
      }[];
      expect(new Set(saved.map((room) => room.roomId)).size).toBe(2);

      if (!a.ok || !a.session) return;
      const room = a.room;
      const guest = await client(address.port);
      const joined = await emit(guest, "room:join", {
        roomId: room.roomId,
        name: "Guest",
      });
      if (!joined.ok) throw new Error("join failed");
      await emit(guest, "room:ready", { roomId: room.roomId, ready: true });
      const started = await emit(left, "room:start", { roomId: room.roomId });
      if (!started.ok) throw new Error("start failed");
      const current = await humanTurn(left, started);
      const activeId = current.game!.activePlayerId;
      const active = activeId === "p1" ? left : guest;
      const command: CommandRequest = {
        roomId: room.roomId,
        playerId: activeId,
        commandId: "compact-retry",
        expectedRevision: current.revision,
        command: { type: "ROLL" },
      };
      const first = await emit(active, "room:command", command);
      if (!first.ok) throw new Error("command failed");
      const chatted = await emit(active, "room:chat", {
        roomId: room.roomId,
        text: "mise à jour récente",
      });
      if (!chatted.ok) throw new Error("chat failed");
      const retry = await emit(active, "room:command", command);
      expect(retry.ok).toBe(true);
      if (retry.ok && chatted.ok) {
        expect(retry.room.revision).toBe(chatted.room.revision);
        expect(retry.room.messages.at(-1)?.text).toBe("mise à jour récente");
      }
      const afterCommand = JSON.parse(readFileSync(storageFile, "utf8")) as {
        roomId: string;
        commandIds: Record<string, unknown>;
      }[];
      const persistedRoom = afterCommand.find(
        (item) => item.roomId === room.roomId,
      )!;
      expect(persistedRoom.commandIds["compact-retry"]).toBe(true);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }, 20000);

  it("rejects malformed socket payloads and exposes a health check", async () => {
    const { service, port } = await setup();
    const host = await client(port);
    const health = await service.app.inject({ method: "GET", url: "/health" });
    expect(health.json()).toMatchObject({
      serviceName: "global-fund-evolve",
      version: "0.1.0",
      status: "ok",
    });
    expect(
      (
        await emit(host, "room:create", {
          seats: [{ ...seats[0], name: 12 }, seats[1]],
        })
      ).ok,
    ).toBe(false);
    expect((await emit(host, "room:create", { seats })).ok).toBe(true);
    expect(
      (
        await emit(host, "room:join", {
          roomId: "invalid",
          name: { unexpected: true },
        })
      ).ok,
    ).toBe(false);
    expect((await emit(host, "room:resume", null)).ok).toBe(false);
    expect(
      (
        await emit(host, "room:command", {
          roomId: "invalid",
          commandId: "__proto__",
        })
      ).ok,
    ).toBe(false);
  });

  it("resumes a persisted game with its bot turn scheduled after restart", async () => {
    const folder = mkdtempSync(join(tmpdir(), "global-fund-ai-restart-"));
    try {
      const storageFile = join(folder, "rooms.json");
      const firstService = await createServer({ storageFile });
      services.push(firstService);
      await firstService.app.listen({ host: "127.0.0.1", port: 0 });
      const firstAddress = firstService.app.server.address();
      if (!firstAddress || typeof firstAddress === "string")
        throw new Error("Expected TCP address");
      const host = await client(firstAddress.port);
      const aiSeats: SeatConfig[] = [seats[0], { ...seats[2], kind: "ai" }];
      const created = await emit(host, "room:create", { seats: aiSeats });
      if (!created.ok || !created.session) throw new Error("create failed");
      const started = await emit(host, "room:start", {
        roomId: created.room.roomId,
      });
      if (!started.ok) throw new Error("start failed");
      let current = started.room;
      for (
        let index = 0;
        index < 24 && current.game?.activePlayerId === "p1";
        index++
      ) {
        const state = firstService.rooms.get(current.roomId)?.state;
        if (!state) throw new Error("missing internal game state");
        const result = await emit(host, "room:command", {
          roomId: current.roomId,
          playerId: "p1",
          commandId: `advance-${index}`,
          expectedRevision: current.revision,
          command: chooseAiCommand(state, "normal"),
        });
        if (!result.ok) throw new Error(`advance failed: ${result.error}`);
        current = result.room;
      }
      expect(current.game?.activePlayerId).toBe("p2");
      await firstService.close();
      services.splice(services.indexOf(firstService), 1);

      const secondService = await createServer({ storageFile });
      services.push(secondService);
      await secondService.app.listen({ host: "127.0.0.1", port: 0 });
      const secondAddress = secondService.app.server.address();
      if (!secondAddress || typeof secondAddress === "string")
        throw new Error("Expected TCP address");
      const resumedHost = await client(secondAddress.port);
      const resumed = await emit(resumedHost, "room:resume", created.session);
      expect(resumed.ok).toBe(true);
      if (!resumed.ok) return;
      const botCommand = await new Promise<RoomView>((resolve, reject) => {
        const timeout = setTimeout(() => {
          resumedHost.off("room:state", onState);
          reject(new Error("AI turn did not resume"));
        }, 5000);
        const onState = (room: RoomView) => {
          clearTimeout(timeout);
          resumedHost.off("room:state", onState);
          resolve(room);
        };
        resumedHost.on("room:state", onState);
      });
      expect(botCommand.revision).toBeGreaterThan(resumed.room.revision);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }, 20000);

  it("does not commit a game command in memory when its durable save fails", async () => {
    const folder = mkdtempSync(join(tmpdir(), "global-fund-save-fail-"));
    const storageFile = join(folder, "state", "rooms.json");
    const service = await createServer({ storageFile });
    services.push(service);
    try {
      await service.app.listen({ host: "127.0.0.1", port: 0 });
      const address = service.app.server.address();
      if (!address || typeof address === "string")
        throw new Error("Expected TCP address");
      const host = await client(address.port),
        guest = await client(address.port);
      const created = await emit(host, "room:create", {
        seats: [seats[0], seats[1]],
      });
      if (!created.ok) throw new Error("create failed");
      const joined = await emit(guest, "room:join", {
        roomId: created.room.roomId,
        name: "Guest",
      });
      if (!joined.ok) throw new Error("join failed");
      await emit(guest, "room:ready", {
        roomId: created.room.roomId,
        ready: true,
      });
      const started = await emit(host, "room:start", {
        roomId: created.room.roomId,
      });
      if (!started.ok) throw new Error("start failed");
      const activeId = started.room.game!.activePlayerId;
      const active = activeId === "p1" ? host : guest;
      const savedState = JSON.stringify(
        service.rooms.get(created.room.roomId)?.state,
      );
      const savedRevision = service.rooms.get(created.room.roomId)?.revision;
      rmSync(storageFile);
      rmSync(join(folder, "state"), { recursive: true, force: true });
      writeFileSync(join(folder, "state"), "prevent-directory-creation");
      const failed = await emit(active, "room:command", {
        roomId: created.room.roomId,
        playerId: activeId,
        commandId: "disk-failure",
        expectedRevision: started.room.revision,
        command: { type: "ROLL" },
      });
      expect(failed).toMatchObject({ ok: false, code: "PERSISTENCE_ERROR" });
      expect(service.rooms.get(created.room.roomId)?.revision).toBe(
        savedRevision,
      );
      expect(
        JSON.stringify(service.rooms.get(created.room.roomId)?.state),
      ).toBe(savedState);
    } finally {
      await service.close();
      services.splice(services.indexOf(service), 1);
      rmSync(folder, { recursive: true, force: true });
    }
  }, 20000);
});
