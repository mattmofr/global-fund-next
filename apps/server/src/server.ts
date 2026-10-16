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
import { PLAYER_COLORS, PAWNS, MARKET_IDS, diversifyStartingMarkets, isMarketId, legacyStartingMarket, marketFromLegacyNationality, nextSuggestedFundName } from "@global-fund/shared";
import { rooms as roomsTable } from "./schema.js";
import { applyMigrations } from "./migrate.js";

type Slot = RoomPlayer & { tokenHash: string | null };
type StoredRoom = {
  roomId: string;
  mode?: RoomView["mode"];
  lobbyVersion?: number;
  nextSlotNumber?: number;
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
class PersistenceError extends Error {}

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
  let durableFileRooms = new Map<string, StoredRoom>();
  let closed = false;

  const view = (r: StoredRoom): RoomView => ({
    roomId: r.roomId,
    roomCode: r.roomId,
    mode: r.mode ?? "local",
    settings: { seatCount: r.players.length },
    status: r.status,
    hostId: r.hostPlayerId,
    players: r.players.map(({ tokenHash: secret, ...p }) => ({ ...p, claimed: p.kind !== "remote" || Boolean(secret) })),
    game: r.state ? getGameView(r.state) : null,
    messages: r.messages,
    revision: r.revision,
  });
  const persist = async (changed?: StoredRoom) => {
    try {
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
        // Queue immutable changes against the last successfully written snapshot.
        // Different rooms can persist concurrently, including newly created rooms.
        const immutable = changed ? structuredClone(changed) : undefined;
        const allRooms = immutable ? undefined : structuredClone([...roomMap.values()]);
        const write = fileWriteQueue
          .catch(() => {})
          .then(async () => {
            const next = allRooms
              ? new Map(allRooms.map((room) => [room.roomId, room]))
              : new Map(durableFileRooms);
            if (immutable) next.set(immutable.roomId, immutable);
            await mkdir(dirname(storageFile), { recursive: true });
            const tmp = `${storageFile}.${process.pid}.${randomUUID()}.tmp`;
            await writeFile(tmp, JSON.stringify([...next.values()]), "utf8");
            await rename(tmp, storageFile);
            durableFileRooms = next;
          });
        fileWriteQueue = write;
        await write;
      }
    } catch (cause) {
      throw new PersistenceError("Impossible d’enregistrer la salle.", { cause });
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
  durableFileRooms = new Map([...roomMap].map(([id, room]) => [id, structuredClone(room)]));
  function resetConnections(room: StoredRoom) {
    room.mode ??= room.players.some((p) => p.kind === "remote") ? "online" : "local";
    room.lobbyVersion ??= 1;
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
    const current = roomMap.get(r.roomId);
    if (current) Object.assign(current, r);
    else roomMap.set(r.roomId, r);
    io.to(r.roomId).emit("room:state", view(r));
  };
  const draftRoom = (roomId: string) => {
    const current = roomMap.get(roomId);
    return current ? structuredClone(current) : undefined;
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
            error instanceof PersistenceError
              ? fail("Impossible d’enregistrer la salle. Réessayez.", "PERSISTENCE_ERROR")
              : fail("La requête n’a pas pu être traitée."),
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
  const remotePresent = (p: Slot) => p.kind !== "remote" || Boolean(
    p.connected && p.controllerId && io.sockets.sockets.get(p.controllerId)?.connected,
  );
  const diversifyLobbyBots = (r: StoredRoom) => {
    const selected = r.players.filter((p) => p.bot || isMarketId(p.startingMarket)).map((p, index) => ({
      ...p, startingMarket: p.startingMarket ?? MARKET_IDS[index % MARKET_IDS.length],
    }));
    for (const balanced of diversifyStartingMarkets(selected)) {
      if (balanced.bot) r.players.find((p) => p.id === balanced.id)!.startingMarket = balanced.startingMarket;
    }
  };
  const aiStep = (r: StoredRoom) => {
    r = roomMap.get(r.roomId) ?? r;
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
        // Reserve generated codes serially until their room is durable.
        "new",
        async () => {
          if (!isRecord(body))
            return ack?.(fail("Configuration de salle invalide."));
          if (body.mode !== undefined && !["local", "online"].includes(String(body.mode)))
            return ack?.(fail("Mode de salon invalide."));
          const online = body.mode === "online";
          const seats = body.seats ?? (online ? [
            { name: nextSuggestedFundName([]), kind: "local", pawn: "lion", difficulty: "normal" },
            { name: "Invité 2", kind: "remote", pawn: "bull", difficulty: "normal" },
          ] : undefined);
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
                (online
                  ? (Object.hasOwn(s, "startingMarket") && !isMarketId(s.startingMarket)) || Object.hasOwn(s, "nationality")
                  : !requestedMarket(s)) ||
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
          const reservedNames: string[] = seats.filter((seat) => !online || seat.kind !== "remote").map((seat) => seat.name.trim());
          const playerNames = seats.map((seat) => {
            const name = online && seat.kind === "remote" ? nextSuggestedFundName(reservedNames) : seat.name.trim().slice(0, 40);
            reservedNames.push(name);
            return name;
          });
          const players: Slot[] = seats.map((s, i) => ({
            id: `p${i + 1}`,
            name: playerNames[i],
            kind: s.kind,
            bot: s.kind === "ai",
            pawn: s.pawn,
            startingMarket: online && s.kind !== "ai" ? null : requestedMarket(s) ?? MARKET_IDS[i % MARKET_IDS.length],
            // Only retain a real country when supplied by an old client.
            ...(!online && !Object.hasOwn(s, "startingMarket") ? { nationality: s.nationality } : {}),
            difficulty: s.difficulty,
            color: PLAYER_COLORS[i],
            ready: online ? s.kind === "ai" : s.kind !== "remote",
            connected: s.kind === "local" || s.kind === "ai",
            controllerId: s.kind === "local" ? hostId : null,
            tokenHash: null,
          }));
          const session: Session = {
            roomId,
            playerId: players[0].id,
            token: token(),
          };
          players[0].tokenHash = hash(session.token);
          const r: StoredRoom = {
            roomId,
            mode: online || players.some((p) => p.kind === "remote") ? "online" : "local",
            lobbyVersion: online ? 2 : 1,
            nextSlotNumber: players.length + 1,
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
          diversifyLobbyBots(r);
          await persist(r);
          roomMap.set(roomId, r);
          await socket.join(roomId);
          ack?.(roomResult(r, session));
        },
        ack,
      ),
    );
    socket.on("room:join", (body: unknown, ack?: (r: ApiResult) => void) =>
      safe(
        isRecord(body) ? text(body.roomId ?? body.roomCode, 16) : "",
        async () => {
          if (!isRecord(body)) return ack?.(fail("Informations de connexion invalides."));
          const roomId = body.roomId ?? body.roomCode;
          const r = validRoomId(roomId) ? draftRoom(roomId) : undefined;
          const online = r?.mode === "online";
          if (
            !validRoomId(roomId) ||
            (body.roomCode !== undefined && body.roomId !== undefined && body.roomCode !== body.roomId) ||
            (online
              ? body.name !== undefined && (typeof body.name !== "string" || !body.name.trim() || body.name.length > 40)
              : typeof body.name !== "string" || !body.name.trim() || body.name.length > 40) ||
            (r?.lobbyVersion === 2 && Object.hasOwn(body, "nationality")) ||
            ((Object.hasOwn(body, "startingMarket") || Object.hasOwn(body, "nationality")) &&
              !requestedMarket(body)) ||
            (body.pawn !== undefined &&
              (typeof body.pawn !== "string" ||
                !PAWNS.some((p) => p.id === body.pawn)))
          )
            return ack?.(fail("Informations de connexion invalides."));
          if (!r || r.status !== "lobby")
            return ack?.(
              fail("Salle introuvable ou déjà lancée.", "NOT_FOUND"),
            );
          const p = r.players.find((x) => x.kind === "remote" && !x.tokenHash);
          if (!p)
            return ack?.(fail("Aucune place distante disponible.", "FULL"));
          const name = body.name === undefined && online ? p.name : text(body.name, 40);
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
          diversifyLobbyBots(r);
          await publish(r);
          await socket.join(r.roomId);
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
          const r = draftRoom(text(session?.roomId, 16));
          const p = r?.players.find((x) => x.id === session?.playerId);
          if (
            !r ||
            !p?.tokenHash ||
            p.tokenHash !== hash(text(session.token, 300))
          )
            return ack?.(fail("Jeton de session invalide.", "UNAUTHORIZED"));
          if (r.status !== "lobby" && p.excluded)
            return ack?.(fail("Cette place absente n’a pas participé au lancement.", "NOT_PARTICIPATING"));
          const previous = p.controllerId;
          const previousHost = r.hostId;
          if (p.kind === "local") {
            r.hostId = socket.id;
            for (const local of r.players.filter((x) => x.kind === "local")) {
              local.controllerId = socket.id;
              local.connected = true;
            }
          } else {
            p.controllerId = socket.id;
            p.connected = true;
          }
          await publish(r);
          if (previous && previous !== socket.id)
            await io.sockets.sockets.get(previous)?.leave(r.roomId);
          if (p.kind === "local" && previousHost && previousHost !== socket.id)
            await io.sockets.sockets.get(previousHost)?.leave(r.roomId);
          await socket.join(r.roomId);
          ack?.(roomResult(r));
          aiStep(r);
        },
        ack,
      ),
    );
    socket.on("room:player:update", (body: unknown, ack?: (r: ApiResult) => void) =>
      safe(isRecord(body) ? text(body.roomId, 16) : "", async () => {
        if (!isRecord(body) || !validRoomId(body.roomId) || typeof body.playerId !== "string" ||
          Object.keys(body).some((key) => !["roomId", "playerId", "name", "startingMarket", "pawn"].includes(key)) ||
          (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim() || body.name.length > 40)) ||
          (Object.hasOwn(body, "startingMarket") && !isMarketId(body.startingMarket)) ||
          (body.pawn !== undefined && !PAWNS.some((pawn) => pawn.id === body.pawn)))
          return ack?.(fail("Préférences de fonds invalides."));
        const r = draftRoom(body.roomId);
        const p = r?.players.find((slot) => slot.id === body.playerId);
        if (!r || r.status !== "lobby" || !p ||
          !(authenticate(socket, r, p.id) || (p.bot && r.hostId === socket.id)))
          return ack?.(fail("Vous ne contrôlez pas cette place.", "UNAUTHORIZED"));
        if (p.bot && Object.hasOwn(body, "startingMarket"))
          return ack?.(fail("La place des IA est répartie automatiquement."));
        const changed = (body.name !== undefined && text(body.name, 40) !== p.name) ||
          (body.startingMarket !== undefined && body.startingMarket !== p.startingMarket) ||
          (body.pawn !== undefined && body.pawn !== p.pawn);
        if (body.name !== undefined) p.name = text(body.name, 40);
        if (isMarketId(body.startingMarket)) { p.startingMarket = body.startingMarket; delete p.nationality; }
        if (body.pawn !== undefined) p.pawn = body.pawn as typeof p.pawn;
        if (changed) {
          if (!p.bot) p.ready = false;
          diversifyLobbyBots(r);
          await publish(r);
        }
        ack?.(roomResult(r));
      }, ack),
    );
    socket.on("room:slots:update", (body: unknown, ack?: (r: ApiResult) => void) =>
      safe(isRecord(body) ? text(body.roomId, 16) : "", async () => {
        if (!isRecord(body) || !validRoomId(body.roomId) || !Number.isInteger(body.seatCount) ||
          Number(body.seatCount) < 2 || Number(body.seatCount) > 6 ||
          Object.keys(body).some((key) => !["roomId", "seatCount"].includes(key)))
          return ack?.(fail("Choisissez entre 2 et 6 places."));
        const r = draftRoom(body.roomId);
        if (!r || r.status !== "lobby" || r.hostId !== socket.id)
          return ack?.(fail("Seul l’hôte peut configurer les places.", "UNAUTHORIZED"));
        const count = Number(body.seatCount);
        if (r.players.slice(count).some((p) => p.kind === "remote" && p.tokenHash))
          return ack?.(fail("Une place attribuée doit rester disponible pour sa reconnexion."));
        r.nextSlotNumber ??= Math.max(...r.players.map((p) => Number(p.id.slice(1)))) + 1;
        r.players = r.players.slice(0, count);
        while (r.players.length < count) {
          const index = r.players.length;
          r.players.push({ id: `p${r.nextSlotNumber++}`, name: nextSuggestedFundName(r.players.map((player) => player.name)), kind: "remote", bot: false,
            pawn: PAWNS[index].id, startingMarket: r.mode === "online" ? null : MARKET_IDS[index % 5],
            difficulty: "normal", color: PLAYER_COLORS[index], ready: false, connected: false,
            controllerId: null, tokenHash: null });
        }
        diversifyLobbyBots(r);
        await publish(r);
        ack?.(roomResult(r));
      }, ack),
    );
    socket.on("room:slot:update", (body: unknown, ack?: (r: ApiResult) => void) =>
      safe(isRecord(body) ? text(body.roomId, 16) : "", async () => {
        if (!isRecord(body) || !validRoomId(body.roomId) || typeof body.playerId !== "string" ||
          Object.keys(body).some((key) => !["roomId", "playerId", "kind", "difficulty"].includes(key)) ||
          (body.kind !== undefined && !["local", "remote", "ai"].includes(String(body.kind))) ||
          (body.difficulty !== undefined && !["easy", "normal", "hard"].includes(String(body.difficulty))))
          return ack?.(fail("Configuration de place invalide."));
        const r = draftRoom(body.roomId), p = r?.players.find((slot) => slot.id === body.playerId);
        if (!r || r.status !== "lobby" || r.hostId !== socket.id || !p ||
          (p.kind === "remote" && p.tokenHash))
          return ack?.(fail("Seul l’hôte peut configurer une place libre ou une IA.", "UNAUTHORIZED"));
        if (body.difficulty !== undefined && (body.kind ?? p.kind) !== "ai")
          return ack?.(fail("La difficulté ne concerne que les IA."));
        if (body.kind !== undefined && body.kind !== p.kind) {
          if (p.id === r.hostPlayerId) return ack?.(fail("La place de l’hôte reste locale."));
          p.kind = body.kind as SlotKind; p.bot = p.kind === "ai";
          p.controllerId = p.kind === "local" ? socket.id : null;
          p.connected = p.kind !== "remote";
          p.ready = p.bot || (r.mode !== "online" && p.kind === "local");
          p.startingMarket = r.mode === "online" && !p.bot ? null : p.startingMarket ?? "europe";
          delete p.nationality;
        }
        if (body.difficulty !== undefined) {
          p.difficulty = body.difficulty as Difficulty;
        }
        diversifyLobbyBots(r);
        await publish(r);
        ack?.(roomResult(r));
      }, ack),
    );
    socket.on("room:ready", (body: unknown, ack?: (r: ApiResult) => void) =>
      safe(
        isRecord(body) ? text(body.roomId, 16) : "",
        async () => {
          if (
            !isRecord(body) ||
            !validRoomId(body.roomId) ||
            typeof body.ready !== "boolean" ||
            (body.playerId !== undefined && typeof body.playerId !== "string") ||
            Object.keys(body).some((key) => !["roomId", "playerId", "ready"].includes(key))
          )
            return ack?.(fail("Disponibilité invalide."));
          const r = draftRoom(text(body?.roomId, 16));
          const p = r?.players.find((x) => body.playerId !== undefined ? x.id === body.playerId : x.controllerId === socket.id);
          if (!r || r.status !== "lobby" || !p || p.bot || !authenticate(socket, r, p.id))
            return ack?.(
              fail(
                "Vous ne pouvez pas modifier la disponibilité de cette place.",
                "UNAUTHORIZED",
              ),
            );
          if (body.ready && (!isMarketId(p.startingMarket) || !p.name.trim()))
            return ack?.(fail("Choisissez votre place de départ avant de vous déclarer prêt.", "NOT_READY"));
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
            (Object.hasOwn(body, "startingMarket") && !isMarketId(body.startingMarket)) ||
            (body.omitAbsent !== undefined && typeof body.omitAbsent !== "boolean"))
            return ack?.(fail("Salle invalide."));
          const r = draftRoom(body.roomId);
          if (!r || r.hostId !== socket.id)
            return ack?.(fail("Seul l’hôte peut lancer la partie.", "UNAUTHORIZED"));
          if (r.status !== "lobby") return ack?.(fail("La partie est déjà lancée."));
          const participants = r.players.filter((p) => !(body.omitAbsent === true && !remotePresent(p)));
          if (participants.length < 2)
            return ack?.(fail("Il faut au moins deux participants, humains ou IA.", "NOT_READY"));
          if (participants.some((p) => !remotePresent(p) || !p.ready || !isMarketId(p.startingMarket)))
            return ack?.(fail("Chaque participant présent doit choisir sa place et être prêt.", "NOT_READY"));
          const state = createGame(participants.map((p) => ({
            name: p.name, kind: p.kind, startingMarket: p.startingMarket!,
            ...(p.nationality ? { nationality: p.nationality } : {}), pawn: p.pawn, difficulty: p.difficulty,
          })));
          // The engine's new-game factory allocates consecutive IDs. Preserve
          // authenticated slot identities when an absent seat leaves a gap.
          // This runs only on a brand-new state (empty portfolios and notices).
          const stableIds = new Map(state.players.map((p, index) => [p.id, participants[index].id]));
          state.players.forEach((p, index) => { p.id = participants[index].id; p.color = participants[index].color; });
          for (const point of state.marketHistory)
            point.funds = Object.fromEntries(Object.entries(point.funds).map(([id, value]) => [stableIds.get(id) ?? id, value]));
          r.state = state;
          for (const p of r.players) {
            const started = state.players.find((player) => player.id === p.id);
            p.excluded = !started;
            if (started) p.startingMarket = started.startingMarket;
          }
          r.status = "playing";
          await publish(r);
          aiStep(r);
          ack?.(roomResult(r));
        }, ack,
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
          const r = draftRoom(text(body?.roomId, 16));
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
      for (const current of roomMap.values()) {
        if (current.hostId !== socket.id && !current.players.some((p) => p.controllerId === socket.id)) continue;
        safe(current.roomId, async () => {
          // Re-read after earlier queued resume requests; an old socket must not
          // disconnect the new controller, or mutate an obsolete player object.
          const r = draftRoom(current.roomId);
          if (!r) return;
          let changed = false;
          if (r.hostId === socket.id) { r.hostId = ""; changed = true; }
          for (const p of r.players) {
            if (p.controllerId !== socket.id) continue;
            p.connected = false;
            p.controllerId = null;
            changed = true;
          }
          if (changed) await publish(r);
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
