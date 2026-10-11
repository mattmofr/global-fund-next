import { useState } from "react";
import { Crown, TrendingUp, Globe2, Gem, Landmark, Leaf } from "lucide-react";
import type { PawnId } from "@global-fund/shared";
import { PAWN_META, pawnLegacyPortrait, pawnPortrait } from "../ui/theme";

const pawnIcons = { lion: Crown, bull: TrendingUp, globe: Globe2, crystal: Gem, tower: Landmark, leaf: Leaf };

/**
 * Figurine portrait rendered from the 3D piece. `.pawn-object` is a stable hook
 * (visual captures count the fund pawns). `color` is the seat colour ring.
 */
export default function Pawn({ id, color, size }: { id: PawnId; color?: string; size?: number }) {
  const Icon = pawnIcons[id] ?? Globe2;
  const [source, setSource] = useState<0 | 1 | 2>(0);
  const src = source === 0 ? pawnPortrait(id) : source === 1 ? pawnLegacyPortrait(id) : null;
  return (
    <span
      className={`pawn-object pawn-${id}`}
      style={{ "--seat-color": color, ...(size ? { width: size, height: size } : {}) } as React.CSSProperties}
      title={PAWN_META[id]?.name}
    >
      {src && <img src={src} alt="" draggable={false} onError={() => setSource((value) => (value + 1) as 0 | 1 | 2)} />}
      {!src && <Icon aria-hidden="true" />}
    </span>
  );
}
