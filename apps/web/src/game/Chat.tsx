import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ArrowUp } from "lucide-react";
import type { RoomView } from "@global-fund/shared";
import { request } from "../store";
import "./app-shell.css";

/**
 * Room chat (lobby and in-game panel). Messages come from the server room view;
 * sending goes through request("room:chat"). `title={false}` hides the header
 * when the host surface already names the panel.
 */
export default function Chat({ room, title = "Salon" }: { room: RoomView; title?: string | false }) {
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const messages = room.messages.slice(-12);
  const lastId = messages.at(-1)?.id;
  useEffect(() => {
    const node = list.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lastId]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    void request("room:chat", { roomId: room.roomId, text });
    setText("");
  };
  // Each author carries their seat colour, as on the table.
  const seatColor = (playerId: string) => room.players.find((player) => player.id === playerId)?.color;
  return (
    <section className="chat-panel" aria-label="Discussion du salon">
      {title !== false && (
        <header className="chat-panel__head">
          <span className="chat-panel__title">{title}</span>
          {room.messages.length > 0 && <span className="chat-panel__count gf-num">{room.messages.length}</span>}
        </header>
      )}
      <div className="chat-messages" ref={list} aria-live="polite">
        {messages.length ? (
          messages.map((m) => (
            <p key={m.id} className="chat-message" style={{ "--seat-color": seatColor(m.playerId) } as CSSProperties}>
              <b>{m.name}</b>
              <span>{m.text}</span>
            </p>
          ))
        ) : (
          <p className="chat-empty">Aucun message.</p>
        )}
      </div>
      <form className="chat-form" onSubmit={submit}>
        <input
          aria-label="Message du salon"
          placeholder="Écrire au salon…"
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="chat-send" aria-label="Envoyer le message" disabled={!text.trim()}>
          <ArrowUp size={16} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}
