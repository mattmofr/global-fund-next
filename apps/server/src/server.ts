import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { Server as SocketServer, type Socket } from "socket.io";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createGame,
  executeCommand,
  getGameView,
  chooseAiCommand,
  getDecisionPlayerId,
} from "@global-fund/game-engine";
import type {
  ApiResult,
  ChatMessage,
  CommandRequest,
  Difficulty,
  GameCommand,
  GameState,
  RoomPlayer,
  RoomView,
  SeatConfig,
  Session,
  SlotKind,
  ZoneId,
} from "@global-fund/shared";
import { PLAYER_COLORS, PAWNS, diversifyStartingMarkets, isMarketId, legacyStartingMarket, marketFromLegacyNationality } from "@global-fund/shared";
import { rooms as roomsTable } from "./schema.js";
import { applyMigrations } from "./migrate.js";

type Slot = RoomPlayer & { tokenHash: string | null };
type StoredRoom = {
  roomId: string;
  status: RoomView["status"];
  hostId: string;
  hostPlayerId: string;
  players: Slot[];
  state: GameState | null;
  messages: ChatMessage[];
  revision: number;
  commandIds: Record<string, true>;
  chatTimes: Record<string, number[]>;
};
type Options = { storageFile?: string | false; logger?: boolean };
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const fail = (error: string, code = "BAD_REQUEST"): ApiResult => ({
  ok: false,
  error,
  code,
});
const ok = (room: RoomView, session?: Session): ApiResult => ({
  ok: true,
  room,
  ...(session ? { session } : {}),
});
const text = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const validRoomId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-F0-9]{8}$/.test(value);
/** Canonical IDs are strict; an explicit invalid ID must never fall back to an old country. */
function requestedMarket(record: Record<string, unknown>): ZoneId | undefined {
  if (Object.hasOwn(record, "startingMarket"))
    return isMarketId(record.startingMarket) ? record.startingMarket : undefined;
  return marketFromLegacyNationality(record.nationality);
}

export async function createServer(options: Options = {}) {
  const app: FastifyInstance = Fastify({ logger: options.logger ?? false });
  const allowedOrigins = new Set(
    [
      process.env.PUBLIC_ORIGIN,
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:5175",
      "http://127.0.0.1:5175",
    ].filter((x): x is string => Boolean(x)),
  );
  const io = new SocketServer(app.server, {
    cors: {
      origin: (origin, callback) =>
        callback(null, !origin || allowedOrigins.has(origin)),
    },
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      callback(null, !origin || allowedOrigins.has(origin));
    },
  });
  const roomMap = new Map<string, StoredRoom>();
  const queues = new Map<string, Promise<unknown>>();
  const aiTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const pool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL })
    : null;
  const db = pool ? drizzle(pool) : null;
  const projectRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../..",
  );
  const storageFile =
    options.storageFile === undefined
      ? resolve(projectRoot, "runtime/rooms.json")
      : options.storageFile;
  let fileWriteQueue: Promise<void> = Promise.resolve();
  let closed = false;

  const view = (r: StoredRoom): RoomView => ({
    roomId: r.roomId,
    status: r.status,
    hostId: r.hostPlayerId,
    players: r.players.map(({ tokenHash: _secret, ...p }) => p),
    game: r.state ? getGameView(r.state) : null,
    messages: r.messages,
    revision: r.revision,
  });
  const persist = async (changed?: StoredRoom) => {
    if (db) {
      if (changed) {
        const immutable = JSON.parse(JSON.stringify(changed)) as StoredRoom;
        await db
          .insert(roomsTable)
          .values({ id: immutable.roomId, data: immutable as never })
          .onConflictDoUpdate({
            target: roomsTable.id,
            set: { data: immutable as never, updatedAt: new Date() },
          });
      }
    } else if (storageFile) {
      // Capture the whole snapshot synchronously; later room mutations cannot alter this queued write.
      const contents = JSON.stringify(
        [...roomMap.values()].map((room) =>
          room.roomId === changed?.roomId ? changed : room,
        ),
      );
      const write = fileWriteQueue
        .catch(() => {})
        .then(async () => {
          await mkdir(dirname(storageFile), { recursive: true });
          const tmp = `${storageFile}.${process.pid}.${randomUUID()}.tmp`;
          await writeFile(tmp, contents, "utf8");
          await rename(tmp, storageFile);
        });
      fileWriteQueue = write;
      await write;
    }
  };
  if (db) {
    await applyMigrations(pool!);
    const rows = await db.select().from(roomsTable);
    rows.forEach((row) => {
      const room = row.data as StoredRoom;
      resetConnections(room);
      roomMap.set(row.id, room);
    });
  } else if (storageFile) {
    try {
      const parsed = JSON.parse(
        await readFile(storageFile, "utf8"),
      ) as StoredRoom[];
      parsed.forEach((r) => {
        resetConnections(r);
        roomMap.set(r.roomId, r);
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  function resetConnections(room: StoredRoom) {
    room.hostId = "";
    for (const p of room.players) {
      if (p.startingMarket === undefined) {
        const savedPlayer = room.state?.players.find((item) => item.id === p.id);
        p.startingMarket = legacyStartingMarket({
          nationality: p.nationality,
          ...savedPlayer,
        });
      }
      p.controllerId = null;
      p.connected = p.bot;
      if (p.bot) p.ready = true;
    }
    const ids = Object.keys(room.commandIds ?? {});
    room.commandIds = Object.assign(
      Object.create(null),
      Object.fromEntries(ids.map((id) => [id, true])),
    ) as Record<string, true>;
    room.chatTimes ??= Object.create(null);
  }
  const publish = async (r: StoredRoom) => {
    r.revision++;
    await persist(r);
    io.to(r.roomId).emit("room:state", view(r));
  };
  const serialize = <T>(
    roomId: string,
    action: () => Promise<T> | T,
  ): Promise<T> => {
    const before = queues.get(roomId) ?? Promise.resolve();
    const current = before.catch(() => {}).then(action);
    queues.set(roomId, current);
    return current.finally(() => {
      if (queues.get(roomId) === current) queues.delete(roomId);
    });
  };
  const roomResult = (r: StoredRoom, session?: Session) => ok(view(r), session);
  const safe = (
    roomKey: string,
    action: () => Promise<unknown> | unknown,
    ack?: unknown,
  ) => {
    void serialize(roomKey, action).catch((error) => {
      app.log.error({ err: error }, "Socket request failed");
      if (typeof ack === "function") {
        try {
          (ack as (result: ApiResult) => void)(
            fail("La requête n’a pas pu être traitée."),
          );
        } catch {
          /* disconnected client */
        }
      }
    });
  };
  const sessionFor = (r: StoredRoom, p: Slot): Session => ({
    roomId: r.roomId,
    playerId: p.id,
    token: token(),
  });
  const authenticate = (socket: Socket, r: StoredRoom, playerId: string) => {
    const p = r.players.find((x) => x.id === playerId);
    return p &&
      (p.kind === "local"
        ? socket.id === r.hostId
        : p.controllerId === socket.id)
      ? p
      : undefined;
  };
  const aiStep = (r: StoredRoom) => {
    if (closed || r.status !== "playing" || !r.state) return;
    const active = r.players.find((p) => p.id === getDecisionPlayerId(r.state!));
    if (!active?.bot || aiTimers.has(r.roomId)) return;
    const timer = setTimeout(() => {
      aiTimers.delete(r.roomId);
      void serialize(r.roomId, async () => {
        if (r.status !== "playing" || !r.state) return;
        if (getDecisionPlayerId(r.state) !== active.id) { aiStep(r); return; }
        const command = chooseAiCommand(r.state, active.difficulty);
        if (!command) return;
        const next = executeCommand(r.state, active.id, command);
        const draft: StoredRoom = { ...r, state: next, status: next.finished ? "finished" : r.status, revision: r.revision + 1 };
        await persist(draft);
        Object.assign(r, draft);
        io.to(r.roomId).emit("room:state", view(r));
        aiStep(r);
      }).catch((error) =>
        app.log.error(
          { err: error },
          "Échec de la commande du joueur automatique.",
        ),
      );
    }, 850);
    aiTimers.set(r.roomId, timer);
  };
  const cleanAi = (roomId: string) => {
    const timer = aiTimers.get(roomId);
    if (timer) clearTimeout(timer);
    aiTimers.delete(roomId);
  };

  io.on("connection", (socket) => {
    socket.on("room:create", (body: unknown, ack?: (r: ApiResult) => void) =>
      safe(
        `new:${socket.id}`,
        async () => {
          if (!isRecord(body))
            return ack?.(fail("Configuration de salle invalide."));
          const seats = body?.seats;
          if (
            !Array.isArray(seats) ||
            seats.length < 2 ||
            seats.length > 6 ||
            !isRecord(seats[0]) ||
            seats[0].kind !== "local" ||
            !seats.some((s) => isRecord(s) && s.kind !== "ai")
          )
            return ack?.(
              fail(
                "Choisissez 2 à 6 places, avec une place locale en premier et au moins une personne.",
              ),
            );
          if (
            seats.some(
              (s) =>
                !isRecord(s) ||
                typeof s.name !== "string" ||
                !s.name.trim() ||
                s.name.length > 40 ||
                !["local", "remote", "ai"].includes(String(s.kind)) ||
                !requestedMarket(s) ||
                !PAWNS.some((p) => p.id === s.pawn) ||
                !["easy", "normal", "hard"].includes(String(s.difficulty)),
            )
          )
            return ack?.(fail("Configuration des places invalide."));
          let roomId: string;
          do {
            roomId = randomBytes(4).toString("hex").toUpperCase();
          } while (roomMap.has(roomId));
          const hostId = socket.id;
          const players: Slot[] = diversifyStartingMarkets(seats.map((s, i) => ({
            id: `p${i + 1}`,
            name: s.name.trim().slice(0, 40),
            kind: s.kind,
            bot: s.kind === "ai",
            pawn: s.pawn,
            startingMarket: requestedMarket(s)!,
            // Only retain a real country when supplied by an old client.
            ...(!Object.hasOwn(s, "startingMarket") ? { nationality: s.nationality } : {}),
            difficulty: s.difficulty,
            color: PLAYER_COLORS[i],
            ready: s.kind !== "remote",
            connected: s.kind === "local" || s.kind === "ai",
            controllerId: s.kind === "local" ? hostId : null,
            tokenHash: null,
          })));
          const session: Session = {
            roomId,
            playerId: players[0].id,
            token: token(),
          };
          players[0].tokenHash = hash(session.token);
          const r: StoredRoom = {
            roomId,
            status: "lobby",
            hostId,
            hostPlayerId: players[0].id,
            players,
            state: null,
            messages: [],
            revision: 1,
            commandIds: Object.create(null),
            chatTimes: Object.create(null),
          };
          roomMap.set(roomId, r);
          socket.join(roomId);
          await persist(r);
          ack?.(roomResult(r, session));
        },
        ack,
      ),
    );
    socket.on("room:join", (body: unknown, ack?: (r: ApiResult) => void) =>
      safe(
        isRecord(body) ? text(body.roomId, 16) : "",
        async () => {
          if (
            !isRecord(body) ||
            !validRoomId(body.roomId) ||
            typeof body.name !== "string" ||
            !body.name.trim() ||
            body.name.length > 40 ||
            ((Object.hasOwn(body, "startingMarket") || Object.hasOwn(body, "nationality")) &&
              !requestedMarket(body)) ||
            (body.pawn !== undefined &&
              (typeof body.pawn !== "string" ||
                !PAWNS.some((p) => p.id === body.pawn)))
          )
            return ack?.(fail("Informations de connexion invalides."));
          const r = roomMap.get(text(body?.roomId, 16));
          if (!r || r.status !== "lobby")
            return ack?.(
              fail("Salle introuvable ou déjà lancée.", "NOT_FOUND"),
            );
          const p = r.players.find((x) => x.kind === "remote" && !x.tokenHash);
          if (!p)
            return ack?.(fail("Aucune place distante disponible.", "FULL"));
          const name = text(body?.name, 40);
          if (!name) return ack?.(fail("Le nom est obligatoire."));
          if (Object.hasOwn(body, "startingMarket") || Object.hasOwn(body, "nationality")) {
            p.startingMarket = requestedMarket(body)!;
            if (!Object.hasOwn(body, "startingMarket") && typeof body.nationality === "string")
              p.nationality = body.nationality;
            else delete p.nationality;
          }
          if (body.pawn) p.pawn = body.pawn as typeof p.pawn;
          const session = sessionFor(r, p);
          p.tokenHash = hash(session.token);
          p.controllerId = socket.id;
          p.connected = true;
          p.name = name;
          p.ready = false;
          socket.join(r.roomId);
          await publish(r);
          ack?.(roomResult(r, session));
        },
        ack,
      ),
    );
    socket.on("room:resume", (session: unknown, ack?: (r: ApiResult) => void) =>
      safe(
        isRecord(session) ? text(session.roomId, 16) : "",
        async () => {
          if (
            !isRecord(session) ||
            !validRoomId(session.roomId) ||
            typeof session.playerId !== "string" ||
            typeof session.token !== "string"
          )
            return ack?.(fail("Session invalide.", "UNAUTHORIZED"));
          const r = roomMap.get(text(session?.roomId, 16));
          const p = r?.players.find((x) => x.id === session?.playerId);
          if (
            !r ||
            !p?.tokenHash ||
            p.tokenHash !== hash(text(session.token, 300))
          )
            return ack?.(fail("Jeton de session invalide.", "UNAUTHORIZED"));
          const previous = p.controllerId;
          if (previous && previous !== socket.id)
            io.sockets.sockets.get(previous)?.leave(r.roomId);
          if (p.kind === "local") {
            if (r.hostId && r.hostId !== socket.id)
              io.sockets.sockets.get(r.hostId)?.leave(r.roomId);
            r.hostId = socket.id;
            for (const local of r.players.filter((x) => x.kind === "local")) {
              local.controllerId = socket.id;
              local.connected = true;
            }
          } else {
            p.controllerId = socket.id;
            p.connected = true;
          }
          socket.join(r.roomId);
          await publish(r);
          ack?.(roomResult(r));
          aiStep(r);
        },
        ack,
      ),
    );
    socket.on("room:ready", (body: unknown, ack?: (r: ApiResult) => void) =>
      safe(
        isRecord(body) ? text(body.roomId, 16) : "",
        async () => {
          if (
            !isRecord(body) ||
            !validRoomId(body.roomId) ||
            typeof body.ready !== "boolean"
          )
            return ack?.(fail("Disponibilité invalide."));
          const r = roomMap.get(text(body?.roomId, 16));
          const p = r?.players.find((x) => x.controllerId === socket.id);
          if (!r || r.status !== "lobby" || !p || p.kind !== "remote")
            return ack?.(
              fail(
                "Vous ne pouvez pas modifier la disponibilité de cette place.",
                "UNAUTHORIZED",
              ),
            );
          p.ready = body.ready;
          await publish(r);
          ack?.(roomResult(r));
        },
        ack,
      ),
    );
    socket.on("room:start", (body: unknown, ack?: (r: ApiResult) => void) =>
      safe(
        isRecord(body) ? text(body.roomId, 16) : "",
        async () => {
          if (!isRecord(body) || !validRoomId(body.roomId) ||
            (Object.hasOwn(body, "startingMarket") && !isMarketId(body.startingMarket)))
            return ack?.(fail("Salle invalide."));
          const r = roomMap.get(text(body?.roomId, 16));
          if (!r || r.hostId !== socket.id)
            return ack?.(
              fail("Seul l’hôte peut lancer la partie.", "UNAUTHORIZED"),
            );
          if (
            r.status !== "lobby" ||
            r.players.some(
              (p) => p.kind === "remote" && (!p.controllerId || !p.ready),
            )
          )
            return ack?.(
              fail(
                "Chaque place distante doit être attribuée et prête.",
                "NOT_READY",
              ),
            );
          r.state = createGame(
            r.players.map((p) => ({
              name: p.name,
              kind: p.kind,
              startingMarket: p.startingMarket,
              ...(p.nationality ? { nationality: p.nationality } : {}),
              pawn: p.pawn,
              difficulty: p.difficulty,
            })),
          ) as GameState;
          // A remote player's selection can change occupancy since room creation.
          for (const p of r.players) p.startingMarket = r.state.players.find((player) => player.id === p.id)!.startingMarket;
          r.status = "playing";
          await publish(r);
          aiStep(r);
          ack?.(roomResult(r));
        },
        ack,
      ),
    );
    socket.on(
      "room:command",
      (request: unknown, ack?: (r: ApiResult) => void) =>
        safe(
          isRecord(request) ? text(request.roomId, 16) : "",
          async () => {
            if (!validRequest(request))
              return ack?.(fail("Commande invalide."));
            const r = roomMap.get(text(request.roomId, 16));
            if (!r || r.status !== "playing" || !r.state)
              return ack?.(fail("La partie n’est pas active.", "NOT_FOUND"));
            const p = authenticate(socket, r, request.playerId);
            if (!p || p.bot)
              return ack?.(
                fail("Vous ne contrôlez pas ce joueur.", "UNAUTHORIZED"),
              );
            if (Object.hasOwn(r.commandIds, request.commandId))
              return ack?.(roomResult(r));
            if (request.expectedRevision !== r.revision)
              return ack?.(
                fail(
                  "L’état de la salle a changé. Actualisez avant de rejouer.",
                  "STALE_REVISION",
                ),
              );
            if (getDecisionPlayerId(r.state) !== p.id)
              return ack?.(
                fail("Ce joueur n’a pas la décision en cours.", "NOT_ACTIVE"),
              );
            let next: GameState;
            try {
              next = executeCommand(r.state, p.id, request.command);
            } catch (e) {
              ack?.(
                fail(
                  e instanceof Error ? e.message : "Commande invalide.",
                  "INVALID_COMMAND",
                ),
              );
              return;
            }
            if (!next || next === r.state)
              return ack?.(
                fail("La commande a été refusée.", "INVALID_COMMAND"),
              );
            const commandIds = Object.assign(
              Object.create(null),
              r.commandIds,
            ) as Record<string, true>;
            commandIds[request.commandId] = true;
            const ids = Object.keys(commandIds);
            if (ids.length > 200) delete commandIds[ids[0]];
            const draft: StoredRoom = {
              ...r,
              state: next,
              status: next.finished ? "finished" : r.status,
              revision: r.revision + 1,
              commandIds,
            };
            try {
              await persist(draft);
            } catch (error) {
              app.log.error(
                { err: error, roomId: r.roomId },
                "Impossible de persister la commande",
              );
              return ack?.(
                fail(
                  "Impossible d’enregistrer la commande. Réessayez.",
                  "PERSISTENCE_ERROR",
                ),
              );
            }
            Object.assign(r, draft);
            io.to(r.roomId).emit("room:state", view(r));
            ack?.(roomResult(r));
            aiStep(r);
          },
          ack,
        ),
    );
    socket.on("room:chat", (body: unknown, ack?: (r: ApiResult) => void) =>
      safe(
        isRecord(body) ? text(body.roomId, 16) : "",
        async () => {
          if (
            !isRecord(body) ||
            !validRoomId(body.roomId) ||
            typeof body.text !== "string" ||
            !body.text.trim() ||
            body.text.length > 500
          )
            return ack?.(fail("Message invalide."));
          const r = roomMap.get(text(body?.roomId, 16));
          const p = r?.players.find((x) => x.controllerId === socket.id);
          if (!r || !p || !p.connected)
            return ack?.(
              fail(
                "Rejoignez la salle avant d’envoyer un message.",
                "UNAUTHORIZED",
              ),
            );
          const now = Date.now(),
            times = (r.chatTimes[p.id] ?? []).filter((t) => now - t < 10_000);
          if (times.length >= 8)
            return ack?.(fail("Limite de messages atteinte.", "RATE_LIMIT"));
          const message = body.text.trim();
          if (!message) return ack?.(fail("Le message ne peut pas être vide."));
          times.push(now);
          r.chatTimes[p.id] = times;
          r.messages.push({
            id: randomUUID(),
            playerId: p.id,
            name: p.name,
            text: message,
            createdAt: new Date(now).toISOString(),
          });
          if (r.messages.length > 100) r.messages.shift();
          await publish(r);
          ack?.(roomResult(r));
        },
        ack,
      ),
    );
    socket.on("disconnect", () => {
      for (const r of roomMap.values()) {
        if (r.hostId === socket.id)
          safe(r.roomId, async () => {
            if (r.hostId !== socket.id) return;
            r.hostId = "";
            for (const local of r.players.filter((x) => x.kind === "local")) {
              local.connected = false;
              local.controllerId = null;
            }
            await publish(r);
          });
        const p = r.players.find(
          (x) => x.controllerId === socket.id && x.kind !== "local",
        );
        if (p)
          safe(r.roomId, async () => {
            if (p.controllerId !== socket.id) return;
            p.connected = false;
            p.controllerId = null;
            if (r.status === "lobby") p.ready = false;
            await publish(r);
          });
      }
    });
  });

  function validCommand(c: GameCommand): boolean {
    if (!c || typeof c !== "object") return false;
    switch (c.type) {
      case "STAY":
      case "ROLL":
      case "PRISON_ROLL":
      case "END_TURN":
      case "NEXT_TURN":
      case "ACCEPT_SETTLEMENT":
      case "REJECT_SETTLEMENT":
      case "REQUIRE_CASH":
        return Object.keys(c).length === 1;
      case "LIQUIDATE_ASSETS":
      case "PROPOSE_SETTLEMENT":
        return Object.keys(c).length === 2 && Array.isArray(c.assets) && c.assets.length > 0 && c.assets.length <= 91 && c.assets.every(asset =>
          isRecord(asset) && Object.keys(asset).length === 2 && typeof asset.companyId === "string" && asset.companyId.length > 0 && asset.companyId.length <= 100 && Number.isInteger(asset.quantity) && asset.quantity >= 1 && asset.quantity <= 5);
      case "MOVE":
        return (
          Object.keys(c).length === 2 &&
          typeof c.zoneId === "string" &&
          c.zoneId.length > 0 &&
          c.zoneId.length <= 40
        );
      case "BUY_SHARE":
      case "SELL_SHARE":
        return (
          Object.keys(c).length === 3 &&
          typeof c.companyId === "string" &&
          c.companyId.length > 0 &&
          c.companyId.length <= 100 &&
          Number.isInteger(c.quantity) &&
          c.quantity > 0 &&
          c.quantity <= 100
        );
      default:
        return false;
    }
  }
  function validRequest(value: unknown): value is CommandRequest {
    if (
      !isRecord(value) ||
      Object.keys(value).length !== 5 ||
      !["roomId", "commandId", "expectedRevision", "playerId", "command"].every(
        (k) => Object.hasOwn(value, k),
      )
    )
      return false;
    return (
      typeof value.roomId === "string" &&
      value.roomId.length > 0 &&
      value.roomId.length <= 16 &&
      validRoomId(value.roomId) &&
      typeof value.commandId === "string" &&
      /^[A-Za-z0-9:_-]{1,128}$/.test(value.commandId) &&
      !["__proto__", "constructor", "prototype"].includes(value.commandId) &&
      Number.isInteger(value.expectedRevision) &&
      typeof value.playerId === "string" &&
      value.playerId.length > 0 &&
      value.playerId.length <= 20 &&
      isRecord(value.command) &&
      validCommand(value.command as GameCommand)
    );
  }
  const webRoot = resolve(projectRoot, "apps/web/dist");
  await app.register(fastifyStatic, {
    root: existsSync(webRoot) ? webRoot : resolve(projectRoot, "apps/web"),
    wildcard: true,
    decorateReply: true,
  });
  app.get("/health", async () => ({
    serviceName: "global-fund-evolve",
    version: "0.1.0",
    status: "ok",
  }));
  app.setNotFoundHandler(async (request, reply) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (
      request.method === "GET" &&
      !request.url.startsWith("/socket.io") &&
      !extname(pathname)
    )
      return reply.sendFile("index.html");
    return reply.code(404).send({ error: "Page introuvable." });
  });
  for (const room of roomMap.values()) aiStep(room);
  const close = async () => {
    closed = true;
    for (const id of aiTimers.keys()) cleanAi(id);
    await new Promise<void>((resolveClose) => io.close(() => resolveClose()));
    await Promise.allSettled([...queues.values()]);
    await app.close();
    await pool?.end();
  };
  return { app, io, rooms: roomMap, close };
}
