import { create } from "zustand";
import { io } from "socket.io-client";
import type {
  ApiResult,
  CommandRequest,
  GameCommand,
  RoomView,
  SeatConfig,
  Session,
  ZoneId,
} from "@global-fund/shared";

const SESSION_KEY = "global-fund-evolve:session";
function savedSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}
function savedAcks(roomId: string): number[] {
  try {
    return JSON.parse(
      localStorage.getItem(`global-fund-evolve:read:${roomId}`) || "[]",
    );
  } catch {
    return [];
  }
}
export const socket = io({
  autoConnect: true,
  transports: ["websocket", "polling"],
});
interface ClientStore {
  room: RoomView | null;
  latestRoom: RoomView | null;
  session: Session | null;
  connected: boolean;
  pending: boolean;
  error: string;
  queue: RoomView[];
  acknowledged: number[];
  ping: number | null;
  receive: (room: RoomView) => void;
  acceptSession: (session: Session) => void;
  acknowledge: (id: number) => void;
  reset: () => void;
}
export const useGameStore = create<ClientStore>((set, get) => ({
  room: null,
  latestRoom: null,
  session: savedSession(),
  connected: false,
  pending: false,
  error: "",
  queue: [],
  acknowledged: [],
  ping: null,
  acceptSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    set({ session, acknowledged: savedAcks(session.roomId) });
  },
  receive(next) {
    const current = get();
    if (current.room && current.room.roomId !== next.roomId)
      set({ room: null, queue: [], acknowledged: savedAcks(next.roomId) });
    const state = get();
    if (state.room && next.revision <= state.room.revision) return;
    set({ latestRoom: next });
    const unread = state.room?.game?.notices.some(
      (n) => !state.acknowledged.includes(n.id),
    );
    if (unread) {
      if (!state.queue.some((item) => item.revision === next.revision))
        set({ queue: [...state.queue, next] });
    } else set({ room: next });
  },
  acknowledge(id) {
    const state = get();
    const acknowledged = [...new Set([...state.acknowledged, id])].slice(-500);
    if (state.room)
      localStorage.setItem(
        `global-fund-evolve:read:${state.room.roomId}`,
        JSON.stringify(acknowledged),
      );
    set({ acknowledged });
    if (state.room?.game?.notices.some((n) => !acknowledged.includes(n.id)))
      return;
    const queue = [...state.queue].sort((a, b) => a.revision - b.revision);
    let room = state.room;
    while (queue.length) {
      const next = queue.shift()!;
      if (next.revision <= (room?.revision ?? 0)) continue;
      room = next;
      if (next.game?.notices.some((n) => !acknowledged.includes(n.id))) break;
    }
    set({ room, queue });
  },
  reset() {
    // Une nouvelle connexion quitte les abonnements de l'ancien salon.
    socket.disconnect();
    localStorage.removeItem(SESSION_KEY);
    set({
      room: null,
      latestRoom: null,
      session: null,
      acknowledged: [],
      queue: [],
      pending: false,
      error: "",
    });
    socket.connect();
  },
}));
export async function request(
  event: string,
  payload: unknown,
): Promise<ApiResult | null> {
  if (!socket.connected) {
    useGameStore.setState({
      error: "Connexion interrompue. Le jeu se reconnecte automatiquement.",
    });
    return null;
  }
  useGameStore.setState({ pending: true, error: "" });
  return new Promise((resolve) =>
    socket
      .timeout(8000)
      .emit(event, payload, (error: Error | null, result: ApiResult) => {
        useGameStore.setState({ pending: false });
        if (error || !result) {
          useGameStore.setState({
            error:
              "Le serveur ne répond pas. Vous pouvez reprendre votre session après reconnexion.",
          });
          resolve(null);
          return;
        }
        if (!result.ok) useGameStore.setState({ error: result.error });
        else {
          if (result.session)
            useGameStore.getState().acceptSession(result.session);
          useGameStore.getState().receive(result.room);
        }
        resolve(result);
      }),
  );
}
export const createRoom = (seats: SeatConfig[]) =>
  request("room:create", { seats });
export const joinRoom = (
  roomId: string,
  name: string,
  startingMarket: ZoneId,
  pawn: SeatConfig["pawn"],
) =>
  request("room:join", {
    roomId: roomId.trim().toUpperCase(),
    name,
    startingMarket,
    pawn,
  });
export function command(command: GameCommand, playerId: string) {
  const state = useGameStore.getState();
  if (
    !state.room ||
    state.pending ||
    state.queue.length ||
    state.room.game?.notices.some((n) => !state.acknowledged.includes(n.id))
  )
    return;
  const payload: CommandRequest = {
    roomId: state.room.roomId,
    expectedRevision: state.room.revision,
    commandId: crypto.randomUUID(),
    playerId,
    command,
  };
  return request("room:command", payload);
}
socket.on("connect", () => {
  useGameStore.setState({ connected: true });
  const session = useGameStore.getState().session;
  if (session) {
    useGameStore.setState({ acknowledged: savedAcks(session.roomId) });
    void request("room:resume", session);
  }
});
socket.on("disconnect", () =>
  useGameStore.setState({ connected: false, ping: null }),
);
socket.on("room:state", (room: RoomView) =>
  useGameStore.getState().receive(room),
);
socket.io.engine?.on("packet", () => {
  /* Socket.IO heartbeat handles reconnection. */
});
