import type { GameView, GradeChange } from "@global-fund/shared";
import type { BoardTimeline, PresentationStage } from "../presentation/sequence";

export type BoardQuality = "high" | "medium" | "low";
export type BoardPresentation = "context" | "event" | "bull" | "bear" | "crash" | null;
/** Screen margins (CSS px) covered by the HUD. The camera frames the board inside the rest. */
export interface BoardInsets { top: number; right: number; bottom: number; left: number }

/**
 * Contract between GameWorld (HUD) and the 3D board. The board is presentation
 * only: it never mutates the game and its only command callback is onRoll.
 */
export interface BoardSceneProps {
  game: GameView;
  onRoll?: () => void;
  disabled?: boolean;
  reducedMotion?: boolean;
  focusZone?: string | null;
  quality?: BoardQuality;
  presentation?: BoardPresentation;
  overview?: boolean;
  timeline?: BoardTimeline | null;
  stage?: PresentationStage;
  /** Destination preview while the active fund weighs a move (no command is sent). */
  travelPreview?: { from: string | null; to: string } | null;
  /** Grade change currently revealed during MARKET_IMPACT (sector tiles / zone pin react). */
  marketImpact?: GradeChange | null;
  /** HUD-covered margins in CSS px. */
  insets?: BoardInsets;
  /** Fund inspected by this client (used for subtle emphasis only). */
  viewerId?: string;
  /** HUD hover: the board lights this sector's cells (no command, no camera move). */
  highlightSector?: string | null;
  /** HUD hover: the globe pulses this zone's pin. */
  highlightZone?: string | null;
  /** HUD hover: this fund's figurine is put in the light. */
  highlightPlayerId?: string | null;
}
