import { useEffect, useMemo, useRef, useState } from "react";
import type { GameView, RoomView } from "@global-fund/shared";
import { PresentationSequence } from "./sequence";

/** Read a detached visual sequence while the store retains its authoritative room.
 * Acknowledgements release its revision queue after each card and market reveal finishes. */
export function useGamePresentation(room: RoomView, acknowledged: number[], acknowledge: (id: number) => void, reducedMotion: boolean) {
  const previous = useRef<{ roomId: string; game: GameView } | null>(null);
  const ack = useRef(acknowledge);
  ack.current = acknowledge;
  const [tick, redraw] = useState(0);
  const sequence = useMemo(() => {
    if (!room.game) return null;
    const prior = previous.current?.roomId === room.roomId ? previous.current.game : undefined;
    const next = new PresentationSequence(room.game, room.game.notices.filter(n => !acknowledged.includes(n.id)), prior, performance.now(), reducedMotion);
    return next;
    // Acknowledging one card must not restart the batch or replay its die.
    // Motion preference applies to each new server revision.
  }, [room.roomId, room.revision, room.game]);
  useEffect(() => {
    if (room.game) previous.current = { roomId: room.roomId, game: room.game };
  }, [room.roomId, room.revision, room.game]);
  useEffect(() => {
    if (!sequence) return;
    const completed = sequence.setReducedMotion(reducedMotion, performance.now());
    redraw(value => value + 1);
    completed.forEach(id => ack.current(id));
  }, [sequence, reducedMotion]);
  useEffect(() => {
    if (!sequence || sequence.deadline == null) return;
    sequence.commit(performance.now());
    const timer = window.setTimeout(() => {
      const completed = sequence.advance(performance.now());
      redraw(value => value + 1);
      completed.forEach(id => ack.current(id));
    }, Math.max(0, sequence.deadline - performance.now()));
    return () => window.clearTimeout(timer);
  }, [sequence, tick]);
  const views = useMemo(() => sequence?.view() ?? { viewGame: room.game, boardGame: room.game }, [sequence, tick, room.game]);
  const displayedStage = sequence?.stage;
  const displayedNoticeId = sequence?.notice?.id;
  return {
    ...views,
    notice: sequence?.notice ?? null,
    currentCard: sequence?.currentCard ?? null,
    stage: sequence?.stage ?? "TURN_START",
    busy: sequence?.busy ?? false,
    timeline: sequence?.timeline ?? null,
    gradeImpact: sequence?.gradeImpact ?? null,
    impacts: sequence?.notice ? { companies: sequence.notice.companyImpacts ?? [], players: sequence.notice.playerImpacts ?? [] } : null,
    continueCard: () => {
      if (!sequence || sequence.stage !== displayedStage || sequence.notice?.id !== displayedNoticeId) return;
      const completed = sequence.continueCard(performance.now());
      redraw(value => value + 1);
      completed.forEach(id => ack.current(id));
    },
  };
}
