import { Building2, Cpu, Factory, Flame, Globe2, HeartPulse, Landmark, Plane, Radio, Wheat, type LucideIcon } from "lucide-react";
import { SECTOR_META, type SectorId } from "./theme";

const ICONS: Record<(typeof SECTOR_META)[SectorId]["icon"], LucideIcon> = {
  cpu: Cpu, landmark: Landmark, factory: Factory, heart: HeartPulse, flame: Flame,
  building: Building2, wheat: Wheat, radio: Radio, plane: Plane,
};

export const sectorIcon = (id: string): LucideIcon => {
  const meta = SECTOR_META[id as SectorId];
  return meta ? ICONS[meta.icon] : Globe2;
};

/** Sector glyph in its jewel colour. */
export function SectorIcon({ id, size = 16, className = "" }: { id: string; size?: number; className?: string }) {
  const Icon = sectorIcon(id);
  const color = SECTOR_META[id as SectorId]?.color;
  return <Icon size={size} strokeWidth={1.6} className={`gf-sector-icon ${className}`} style={color ? { color } : undefined} aria-hidden="true" />;
}
