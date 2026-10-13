import { afterEach, describe, expect, it } from "vitest";
import { io as clientIo, type Socket } from "socket.io-client";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../apps/server/src/server.js";
import type { ApiResult, LobbySeatConfig, RoomView } from "@global-fund/shared";
import { MARKET_IDS } from "@global-fund/shared";

const services: Awaited<ReturnType<typeof createServer>>[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.disconnect());
  await Promise.all(services.splice(0).map((service) => service.close()));
});

function emit<T = ApiResult>(socket: Socket, event: string, body?: unknown): Promise<T> {
  return new Promise((resolve, reject) =>
    socket.timeout(5000).emit(event, body, (error: Error | null, result: T) =>
      error ? reject(error) : resolve(result),
    ),
  );
}

async function client(port: number) {
  const socket = clientIo("http://127.0.0.1:" + port, {
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

async function setup(storageFile: string | false = false) {
  const service = await createServer({ storageFile });
  services.push(service);
  await service.app.listen({ host: "127.0.0.1", port: 0 });
  const address = service.app.server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address");
  return { service, port: address.port };
}

function blockStorageTarget(storageFile: string) {
  const backup = storageFile + ".saved";
  renameSync(storageFile, backup);
  mkdirSync(storageFile);
  return () => {
    rmSync(storageFile, { recursive: true, force: true });
    renameSync(backup, storageFile);
  };
}

const seat = (name: string, kind: LobbySeatConfig["kind"], pawn: LobbySeatConfig["pawn"]): LobbySeatConfig => ({
  name,
  kind,
  pawn,
  difficulty: "normal",
});

describe("online lobby contract", () => {
  it("creates before market selection and permits duplicate human markets", async () => {
    const { port } = await setup();
    const host = await client(port);
    const remoteA = await client(port);
    const remoteB = await client(port);
    const created = await emit(host, "room:create", {
      mode: "online",
      seats: [
        { ...seat("Host", "local", "lion"), startingMarket: "europe" },
        { ...seat("Remote A", "remote", "bull"), startingMarket: "asia" },
        seat("Remote B", "remote", "globe"),
        seat("Bot 1", "ai", "crystal"),
        seat("Bot 2", "ai", "tower"),
        seat("Bot 3", "ai", "leaf"),
      ],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("online create failed");
    expect(created.room).toMatchObject({ mode: "online", roomCode: expect.stringMatching(/^[0-9A-F]{8}$/) });
    expect(created.room.players.slice(0, 3).map((player) => player.startingMarket)).toEqual([null, null, null]);
    expect(created.room.players.slice(3).every((player) => MARKET_IDS.includes(player.startingMarket!))).toBe(true);

    const hostOwnProfile = await emit(host, "room:player:update", {
      roomId: created.room.roomId,
      playerId: "p1",
      name: "Host owner",
      startingMarket: "asia",
      pawn: "lion",
    });
    expect(hostOwnProfile.ok).toBe(true);
    expect((await emit(host, "room:ready", { roomId: created.room.roomId, ready: true })).ok).toBe(true);
    const deniedHostRemoteEdit = await emit(host, "room:player:update", {
      roomId: created.room.roomId,
      playerId: "p2",
      name: "Taken over",
      startingMarket: "europe",
    });
    expect(deniedHostRemoteEdit).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
    expect(await emit(host, "room:ready", { roomId: created.room.roomId, playerId: "p2", ready: true }))
      .toMatchObject({ ok: false, code: "UNAUTHORIZED" });

    const joinedA = await emit(remoteA, "room:join", { roomId: created.room.roomCode });
    const joinedB = await emit(remoteB, "room:join", { roomId: created.room.roomCode });
    expect(joinedA.ok && joinedB.ok).toBe(true);
    if (!joinedA.ok || !joinedB.ok) throw new Error("remote claim failed");
    expect(await emit(remoteA, "room:player:update", {
      roomId: created.room.roomId,
      playerId: "p3",
      name: "Impersonated",
      startingMarket: "europe",
    })).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
    for (const [socket, playerId] of [[remoteA, "p2"], [remoteB, "p3"]] as const) {
      const profile = await emit(socket, "room:player:update", {
        roomId: created.room.roomId,
        playerId,
        name: "Investor " + playerId,
        startingMarket: "asia",
        pawn: playerId === "p2" ? "bull" : "globe",
      });
      expect(profile.ok).toBe(true);
      expect((await emit(socket, "room:ready", { roomId: created.room.roomId, ready: true })).ok).toBe(true);
    }
    const started = await emit(host, "room:start", { roomId: created.room.roomId });
    expect(started.ok).toBe(true);
    if (started.ok) {
      expect(started.room.game?.players.slice(0, 3).map((player) => player.startingMarket)).toEqual(["asia", "asia", "asia"]);
    }
  });

  it("rejects invalid profile targets and malformed/prototype payload values", async () => {
    const { port } = await setup();
    const host = await client(port);
    const guest = await client(port);
    const created = await emit(host, "room:create", {
      mode: "online",
      seats: [seat("Host", "local", "lion"), seat("Remote", "remote", "bull")],
    });
    if (!created.ok) throw new Error("create failed");
    const joined = await emit(guest, "room:join", { roomId: created.room.roomCode });
    if (!joined.ok) throw new Error("join failed");
    const polluted = JSON.parse('{"roomId":"' + created.room.roomId + '","playerId":"p2","name":"Polluted","startingMarket":"asia","__proto__":{"admin":true}}');
    for (const body of [
      { roomId: created.room.roomId, playerId: "p99", name: "Unknown", startingMarket: "asia" },
      { roomId: created.room.roomId, playerId: "p2", name: "Bad market", startingMarket: "unknown-zone" },
      { roomId: created.room.roomId, playerId: "p2", name: { nested: true }, startingMarket: "asia" },
      polluted,
    ]) {
      expect((await emit(guest, "room:player:update", body)).ok).toBe(false);
    }
    expect((await emit(guest, "room:player:update", {
      roomId: created.room.roomId,
      playerId: "p2",
      startingMarket: "asia",
      pawn: "bad-pawn",
    })).ok).toBe(false);
  });

  it("lets the host manage only unclaimed slots and never removes a claimed remote seat", async () => {
    const { port } = await setup();
    const host = await client(port);
    const guestA = await client(port);
    const guestB = await client(port);
    const created = await emit(host, "room:create", {
      mode: "online",
      seats: [seat("Host", "local", "lion"), seat("Remote A", "remote", "bull")],
    });
    if (!created.ok) throw new Error("create failed");
    expect((await emit(host, "room:slots:update", { roomId: created.room.roomId, seatCount: 1 })).ok).toBe(false);
    expect((await emit(host, "room:slots:update", { roomId: created.room.roomId, seatCount: 7 })).ok).toBe(false);
    const expanded = await emit(host, "room:slots:update", {
      roomId: created.room.roomId,
      seatCount: 4,
    });
    expect(expanded.ok).toBe(true);
    if (!expanded.ok) return;
    expect(expanded.room.players.map((player) => player.id)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(new Set(expanded.room.players.map((player) => player.id)).size).toBe(4);

    expect((await emit(host, "room:slot:update", {
      roomId: created.room.roomId,
      playerId: "p3",
      kind: "ai",
      difficulty: "hard",
    })).ok).toBe(true);
    expect((await emit(host, "room:slot:update", {
      roomId: created.room.roomId,
      playerId: "p2",
      kind: "invalid",
    })).ok).toBe(false);
    expect((await emit(host, "room:slot:update", {
      roomId: created.room.roomId,
      playerId: "p99",
      difficulty: "easy",
    })).ok).toBe(false);
    expect((await emit(host, "room:slots:update", {
      roomId: created.room.roomId,
      seatCount: 3,
    })).ok).toBe(true);
    const reexpanded = await emit(host, "room:slots:update", {
      roomId: created.room.roomId,
      seatCount: 4,
    });
    expect(reexpanded.ok).toBe(true);
    if (reexpanded.ok) expect(reexpanded.room.players.map((player) => player.id)).toEqual(["p1", "p2", "p3", "p5"]);

    expect((await emit(guestA, "room:join", { roomId: created.room.roomCode })).ok).toBe(true);
    expect((await emit(guestB, "room:join", { roomId: created.room.roomCode })).ok).toBe(true);
    expect(await emit(host, "room:slot:update", {
      roomId: created.room.roomId,
      playerId: "p2",
      difficulty: "easy",
    })).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
    expect((await emit(host, "room:slots:update", {
      roomId: created.room.roomId,
      seatCount: 3,
    })).ok).toBe(false);
  });

  it("spreads five AI seats across all canonical markets", async () => {
    const { port } = await setup();
    const host = await client(port);
    const created = await emit(host, "room:create", {
      mode: "online",
      seats: [
        seat("Host", "local", "lion"),
        ...(["bull", "globe", "crystal", "tower", "leaf"] as const).map((pawn, index) =>
          seat("AI " + (index + 1), "ai", pawn),
        ),
      ],
    });
    expect(created.ok).toBe(true);
    if (created.ok) {
      const markets = created.room.players.slice(1).map((player) => player.startingMarket);
      expect(markets.every((market) => market !== null && MARKET_IDS.includes(market))).toBe(true);
      expect(new Set(markets).size).toBe(5);
    }
  });

  it("preserves seat IDs and history keys when an absent remote is omitted at start", async () => {
    const { port } = await setup();
    const host = await client(port);
    const absentRemote = await client(port);
    const presentRemote = await client(port);
    const created = await emit(host, "room:create", {
      mode: "online",
      seats: [
        seat("Host", "local", "lion"),
        seat("Vacant", "remote", "bull"),
        seat("Present", "remote", "globe"),
        seat("Bot", "ai", "crystal"),
      ],
    });
    if (!created.ok) throw new Error("create failed");
    expect((await emit(host, "room:player:update", {
      roomId: created.room.roomId,
      playerId: "p1",
      startingMarket: "europe",
      pawn: "lion",
    })).ok).toBe(true);
    expect((await emit(host, "room:ready", { roomId: created.room.roomId, ready: true })).ok).toBe(true);
    const absentJoin = await emit(absentRemote, "room:join", { roomId: created.room.roomCode });
    if (!absentJoin.ok || !absentJoin.session) throw new Error("absent remote claim failed");
    expect((await emit(absentRemote, "room:player:update", {
      roomId: created.room.roomId,
      playerId: "p2",
      name: "Absent",
      startingMarket: "europe",
      pawn: "bull",
    })).ok).toBe(true);
    expect((await emit(absentRemote, "room:ready", { roomId: created.room.roomId, ready: true })).ok).toBe(true);

    const joined = await emit(presentRemote, "room:join", { roomId: created.room.roomCode });
    expect(joined.ok).toBe(true);
    expect((await emit(presentRemote, "room:player:update", {
      roomId: created.room.roomId,
      playerId: "p3",
      name: "Present",
      startingMarket: "africa",
      pawn: "globe",
    })).ok).toBe(true);
    expect((await emit(presentRemote, "room:ready", { roomId: created.room.roomId, playerId: "p3", ready: true })).ok).toBe(true);
    const disconnectedState = new Promise<RoomView>((resolve) => host.once("room:state", resolve));
    absentRemote.disconnect();
    await disconnectedState;
    const started = await emit(host, "room:start", { roomId: created.room.roomId, omitAbsent: true });
    expect(started.ok).toBe(true);
    if (started.ok) {
      expect(started.room.players.map((player) => player.id)).toEqual(["p1", "p2", "p3", "p4"]);
      expect(started.room.players[1]).toMatchObject({ excluded: true, connected: false, startingMarket: "europe" });
      expect(started.room.game?.players.map((player) => player.id)).toEqual(["p1", "p3", "p4"]);
      const fundSnapshot = started.room.game?.marketHistory.at(-1)?.funds;
      expect(fundSnapshot).toHaveProperty("p1");
      expect(fundSnapshot).toHaveProperty("p3");
      expect(fundSnapshot).toHaveProperty("p4");
      expect(fundSnapshot).not.toHaveProperty("p2");
    }
    const absentResumer = await client(port);
    expect(await emit(absentResumer, "room:resume", absentJoin.session)).toMatchObject({
      ok: false,
      code: "NOT_PARTICIPATING",
    });
  });

  it("serializes concurrent readiness and start without starting an unconfigured room", async () => {
    const { port } = await setup();
    const host = await client(port);
    const guest = await client(port);
    const created = await emit(host, "room:create", {
      mode: "online",
      seats: [seat("Host", "local", "lion"), seat("Remote", "remote", "bull"), seat("AI", "ai", "globe")],
    });
    if (!created.ok) throw new Error("create failed");
    expect((await emit(host, "room:player:update", {
      roomId: created.room.roomId,
      playerId: "p1",
      startingMarket: "europe",
      pawn: "lion",
    })).ok).toBe(true);
    expect((await emit(host, "room:ready", { roomId: created.room.roomId, ready: true })).ok).toBe(true);
    const joined = await emit(guest, "room:join", { roomId: created.room.roomCode });
    if (!joined.ok) throw new Error("join failed");
    expect(await emit(host, "room:start", { roomId: created.room.roomId, omitAbsent: true }))
      .toMatchObject({ ok: false });
    expect((await emit(guest, "room:player:update", {
      roomId: created.room.roomId,
      playerId: "p2",
      name: "Configured",
      startingMarket: "asia",
      pawn: "bull",
    })).ok).toBe(true);
    expect(await emit(host, "room:start", { roomId: created.room.roomId, omitAbsent: true }))
      .toMatchObject({ ok: false });
    const [ready, firstStart] = await Promise.all([
      emit(guest, "room:ready", { roomId: created.room.roomId, playerId: "p2", ready: true }),
      emit(host, "room:start", { roomId: created.room.roomId }),
    ]);
    expect(ready.ok).toBe(true);
    if (firstStart.ok) {
      expect(firstStart.room.status).toBe("playing");
      expect(firstStart.room.game?.players.map((player) => player.id)).toContain("p2");
    } else {
      const retried = await emit(host, "room:start", { roomId: created.room.roomId });
      expect(retried.ok).toBe(true);
      if (retried.ok) expect(retried.room.game?.players.map((player) => player.id)).toContain("p2");
    }
  });

  it("serializes a concurrent remote claim against omission at start", async () => {
    const { port } = await setup();
    const host = await client(port);
    const guest = await client(port);
    const created = await emit(host, "room:create", {
      mode: "online",
      seats: [seat("Host", "local", "lion"), seat("Remote", "remote", "bull"), seat("AI", "ai", "globe")],
    });
    if (!created.ok) throw new Error("create failed");
    expect((await emit(host, "room:player:update", {
      roomId: created.room.roomId,
      playerId: "p1",
      startingMarket: "europe",
      pawn: "lion",
    })).ok).toBe(true);
    expect((await emit(host, "room:ready", { roomId: created.room.roomId, ready: true })).ok).toBe(true);

    const [joined, firstStart] = await Promise.all([
      emit(guest, "room:join", { roomId: created.room.roomCode }),
      emit(host, "room:start", { roomId: created.room.roomId, omitAbsent: true }),
    ]);
    if (firstStart.ok) {
      expect(firstStart.room.players[1]).toMatchObject({ id: "p2", excluded: true });
      expect(firstStart.room.game?.players.map((player) => player.id)).toEqual(["p1", "p3"]);
      expect(joined).toMatchObject({ ok: false });
    } else {
      expect(joined.ok).toBe(true);
      if (!joined.ok) throw new Error("serialized claim was lost");
      expect(firstStart.code).toBe("NOT_READY");
      expect((await emit(guest, "room:player:update", {
        roomId: created.room.roomId,
        playerId: "p2",
        name: "Claimed",
        startingMarket: "asia",
        pawn: "bull",
      })).ok).toBe(true);
      expect((await emit(guest, "room:ready", { roomId: created.room.roomId, ready: true })).ok).toBe(true);
      const started = await emit(host, "room:start", { roomId: created.room.roomId });
      expect(started.ok).toBe(true);
      if (started.ok) expect(started.room.game?.players.map((player) => player.id)).toEqual(["p1", "p2", "p3"]);
    }
  });

  it("keeps ready and profile data across disconnect, file persistence, and resume", async () => {
    const folder = mkdtempSync(join(tmpdir(), "global-fund-lobby-ready-"));
    const storageFile = join(folder, "rooms.json");
    try {
      const first = await setup(storageFile);
      const host = await client(first.port);
      const guest = await client(first.port);
      const created = await emit(host, "room:create", {
        mode: "online",
        seats: [seat("Host", "local", "lion"), seat("Remote", "remote", "bull"), seat("AI", "ai", "globe")],
      });
      if (!created.ok) throw new Error("create failed");
      const joined = await emit(guest, "room:join", { roomId: created.room.roomCode });
      if (!joined.ok || !joined.session) throw new Error("join failed");
      expect((await emit(guest, "room:player:update", {
        roomId: created.room.roomId,
        playerId: joined.session.playerId,
        name: "Persistent name",
        startingMarket: "oceania",
        pawn: "bull",
      })).ok).toBe(true);
      expect((await emit(guest, "room:ready", { roomId: created.room.roomId, ready: true })).ok).toBe(true);
      const disconnectedState = new Promise<RoomView>((resolve) => host.once("room:state", resolve));
      guest.disconnect();
      const afterDisconnect = await disconnectedState;
      expect(afterDisconnect.players[1]).toMatchObject({ ready: true, connected: false, startingMarket: "oceania", name: "Persistent name" });
      const saved = JSON.parse(readFileSync(storageFile, "utf8")) as { players: Array<{ id: string; ready: boolean; startingMarket: string | null }> }[];
      expect(saved[0].players.find((player) => player.id === "p2")).toMatchObject({ ready: true, startingMarket: "oceania" });

      await first.service.close();
      services.splice(services.indexOf(first.service), 1);
      const second = await setup(storageFile);
      const resumedSocket = await client(second.port);
      const resumed = await emit(resumedSocket, "room:resume", joined.session);
      expect(resumed.ok).toBe(true);
      if (resumed.ok) {
        expect(resumed.room.players[1]).toMatchObject({ ready: true, connected: true, startingMarket: "oceania", name: "Persistent name" });
      }
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }, 20000);

  it("requires two participants after omission and keeps legacy local setup", async () => {
    const { port } = await setup();
    const host = await client(port);
    const online = await emit(host, "room:create", {
      mode: "online",
      seats: [seat("Host", "local", "lion"), seat("Absent", "remote", "bull")],
    });
    if (!online.ok) throw new Error("create failed");
    expect(await emit(host, "room:start", { roomId: online.room.roomId, omitAbsent: true }))
      .toMatchObject({ ok: false });

    const local = await emit(host, "room:create", {
      seats: [
        { ...seat("Local host", "local", "lion"), startingMarket: "europe" },
        { ...seat("AI", "ai", "bull"), startingMarket: "asia" },
      ],
    });
    expect(local.ok).toBe(true);
    if (local.ok) expect(local.room.mode).toBe("local");
  });

  it("rolls back failed lobby persistence for profile, slots, join, ready, and start", async () => {
    const folder = mkdtempSync(join(tmpdir(), "global-fund-lobby-save-fail-"));
    const storageFile = join(folder, "rooms.json");
    try {
      const { service, port } = await setup(storageFile);
      const host = await client(port);
      const guest = await client(port);
      const created = await emit(host, "room:create", {
        mode: "online",
        seats: [seat("Host", "local", "lion"), seat("Remote", "remote", "bull"), seat("AI", "ai", "globe")],
      });
      if (!created.ok) throw new Error("create failed");

      const failAndRestore = async (socket: Socket, event: string, body: unknown) => {
        const before = JSON.stringify(service.rooms.get(created.room.roomId));
        const durableBefore = readFileSync(storageFile, "utf8");
        const restore = blockStorageTarget(storageFile);
        const failed = await emit(socket, event, body);
        expect(failed).toMatchObject({ ok: false, code: "PERSISTENCE_ERROR" });
        expect(JSON.stringify(service.rooms.get(created.room.roomId))).toBe(before);
        expect(readFileSync(storageFile + ".saved", "utf8")).toBe(durableBefore);
        restore();
      };

      await failAndRestore(host, "room:player:update", {
        roomId: created.room.roomId,
        playerId: "p1",
        name: "Must roll back",
        startingMarket: "europe",
      });
      await failAndRestore(host, "room:slots:update", {
        roomId: created.room.roomId,
        seatCount: 4,
      });

      expect((await emit(host, "room:player:update", {
        roomId: created.room.roomId,
        playerId: "p1",
        startingMarket: "europe",
      })).ok).toBe(true);
      await failAndRestore(host, "room:ready", {
        roomId: created.room.roomId,
        ready: true,
      });

      const beforeJoin = JSON.stringify(service.rooms.get(created.room.roomId));
      const durableBeforeJoin = readFileSync(storageFile, "utf8");
      const restoreJoin = blockStorageTarget(storageFile);
      const failedJoin = await emit(guest, "room:join", { roomId: created.room.roomCode });
      expect(failedJoin).toMatchObject({ ok: false, code: "PERSISTENCE_ERROR" });
      expect(JSON.stringify(service.rooms.get(created.room.roomId))).toBe(beforeJoin);
      expect(readFileSync(storageFile + ".saved", "utf8")).toBe(durableBeforeJoin);
      const guestSocketId = guest.id;
      if (!guestSocketId) throw new Error("guest socket has no ID");
      expect(service.io.sockets.adapter.rooms.get(created.room.roomId)?.has(guestSocketId)).toBe(false);
      restoreJoin();

      const joined = await emit(guest, "room:join", { roomId: created.room.roomCode });
      if (!joined.ok) throw new Error("join after storage recovery failed");
      expect((await emit(guest, "room:player:update", {
        roomId: created.room.roomId,
        playerId: "p2",
        name: "Ready guest",
        startingMarket: "asia",
      })).ok).toBe(true);
      expect((await emit(guest, "room:ready", { roomId: created.room.roomId, ready: true })).ok).toBe(true);
      expect((await emit(host, "room:ready", { roomId: created.room.roomId, ready: true })).ok).toBe(true);

      const beforeStart = JSON.stringify(service.rooms.get(created.room.roomId));
      await failAndRestore(host, "room:start", { roomId: created.room.roomId });
      expect(JSON.stringify(service.rooms.get(created.room.roomId))).toBe(beforeStart);
      expect(service.rooms.get(created.room.roomId)?.status).toBe("lobby");
      expect(service.rooms.get(created.room.roomId)?.state).toBeNull();
      const started = await emit(host, "room:start", { roomId: created.room.roomId });
      expect(started.ok).toBe(true);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }, 20000);

  it("does not leave a ghost room on failed create and persists concurrent creates together", async () => {
    const folder = mkdtempSync(join(tmpdir(), "global-fund-lobby-create-fail-"));
    const storageFile = join(folder, "rooms.json");
    try {
      const failedServer = await setup(storageFile);
      const failedHost = await client(failedServer.port);
      mkdirSync(storageFile);
      const failedCreate = await emit(failedHost, "room:create", {
        mode: "online",
        seats: [seat("Host", "local", "lion"), seat("Remote", "remote", "bull")],
      });
      expect(failedCreate).toMatchObject({ ok: false, code: "PERSISTENCE_ERROR" });
      expect(failedServer.service.rooms.size).toBe(0);
      rmSync(storageFile, { recursive: true, force: true });

      const concurrentFolder = join(folder, "concurrent");
      mkdirSync(concurrentFolder);
      const concurrentFile = join(concurrentFolder, "rooms.json");
      const { port } = await setup(concurrentFile);
      const firstHost = await client(port);
      const secondHost = await client(port);
      const [first, second] = await Promise.all([
        emit(firstHost, "room:create", {
          mode: "online",
          seats: [seat("First", "local", "lion"), seat("Remote", "remote", "bull")],
        }),
        emit(secondHost, "room:create", {
          mode: "online",
          seats: [seat("Second", "local", "globe"), seat("Remote", "remote", "tower")],
        }),
      ]);
      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      const persisted = JSON.parse(readFileSync(concurrentFile, "utf8")) as Array<{ roomId: string }>;
      expect(new Set(persisted.map((room) => room.roomId))).toEqual(
        new Set([first.room.roomId, second.room.roomId]),
      );
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }, 20000);
});
