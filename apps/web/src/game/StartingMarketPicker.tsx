import { useId } from "react";
import { Check } from "lucide-react";
import type { PawnId, ZoneId } from "@global-fund/shared";
import { MARKET_PLACES, marketOverview } from "./marketPlaceVisuals";
import { ZONE_META } from "../ui/theme";
import { SectorIcon } from "../ui/SectorIcon";
import Pawn from "./Pawn";
import "./starting-market-picker.css";

/** Fund shown on the city it will open from (setup overview). */
export interface MarketOccupant { pawn: PawnId; name: string; color?: string }

/**
 * Land mask sampled every 3° from Natural Earth 110 m (public domain), one bit
 * per cell, rows from 79.5° N to 55.5° S. Drawn as gold dust on each city globe.
 */
const LAND = {
  step: 3, cols: 120, rows: 46, latTop: 79.5,
  b64: "AAAAD+P//ADQAAAYAAAAAAAZL8f/+AAAACADgAAAAAAYvsB/+AAAAgH/9BAAA8ADy/g/4AAMADf///+Ah////64/gAB/z/f/////A////7wcBgDv///////+B///+DAMAAPf//////9cAIP/+DoAACLP/////+BAAAD//j8AACCf/////4DAAAB//7+AAF////////CAAAAf//wAAB////////AAAAAf//wAAB/9e////9AAAAAf//gAAF34d////5AAAAAf/+AAAHBz+///9gAAAAAf/+AAAHCX+///+iAAAAAP/8AAAD4A////8MAAAAAH/4AAAH+Y////+QAAAAAB8IAAAP/+9///+AAAAAAA8AAAAf//+P//8AAAAAAAYEAAAf//fx/fwAAAAAAAcggAAf//Pg8egAAAAAAAHgAAA///vA4fCAAAAAAAAwAAA///8AYHAAAAAAAAAR0AAf//+AYBAAAAAAAAAD8AAP//+AAABAAAAAAAAD/gAEP/8AAIMAAAAAAAAD/gAAH/4AAG4AAAAAAAAH/4AAH/wAACaIAAAAAAAH/+AAD/gAACAHAAAAAAAH//AAD/gAAAwDgAAAAAAD//AAD/gAAAAAAAAAAAAB/+AAD/yAAAAZAAAAAAAA/+AAD/mAAAB9gAAAAAAAf+AAD/EAAAD/gAAAAAAAf8AAB/MAAAP/wAAAAAAA/wAAB+AAAAP/4AAAAAAA/wAAB+AAAAP/4AAAAAAA/gAAA8AAAAH/4AAAAAAA/AAAAgAAAAEDwAAAAAAB+AAAAAAAAAABwCAAAAAB4AAAAAAAAAAAACAAAAAAwAAAAAAAAAAAAEAAAAABwAAAAAAAAAAAAIAAAAABgAAAAAAAAAAAAAAAAAABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
};
let landCells: Array<[number, number]> | null = null;
function land() {
  if (landCells) return landCells;
  const bits = atob(LAND.b64);
  const cells: Array<[number, number]> = [];
  for (let row = 0; row < LAND.rows; row += 1) {
    for (let col = 0; col < LAND.cols; col += 1) {
      const index = row * LAND.cols + col;
      if (bits.charCodeAt(index >> 3) & (1 << (7 - (index & 7)))) {
        cells.push([-180 + LAND.step / 2 + col * LAND.step, LAND.latTop - row * LAND.step]);
      }
    }
  }
  return (landCells = cells);
}

interface GlobeGeometry { dots: [string, string, string]; graticule: string; pin: [number, number] }
const RADIUS = 46;
const CENTER = 50;
const D2R = Math.PI / 180;
const globes = new Map<ZoneId, GlobeGeometry>();
const r1 = (value: number) => Math.round(value * 10) / 10;

/** Orthographic projection centred on the zone's financial city (tilted towards the equator). */
function globeGeometry(zone: ZoneId): GlobeGeometry {
  const cached = globes.get(zone);
  if (cached) return cached;
  const { lat, lon } = ZONE_META[zone];
  const phi0 = Math.max(-18, Math.min(24, lat * 0.5)) * D2R;
  const lambda0 = lon * D2R;
  const sin0 = Math.sin(phi0), cos0 = Math.cos(phi0);
  const project = (lonDeg: number, latDeg: number) => {
    const phi = latDeg * D2R, dl = lonDeg * D2R - lambda0;
    const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi), cosDl = Math.cos(dl);
    const depth = sin0 * sinPhi + cos0 * cosPhi * cosDl;
    return { x: CENTER + RADIUS * cosPhi * Math.sin(dl), y: CENTER - RADIUS * (cos0 * sinPhi - sin0 * cosPhi * cosDl), depth };
  };
  const dots: [string, string, string] = ["", "", ""];
  for (const [cellLon, cellLat] of land()) {
    const point = project(cellLon, cellLat);
    if (point.depth < 0.08) continue;
    const bucket = point.depth < 0.42 ? 0 : point.depth < 0.78 ? 1 : 2;
    dots[bucket] += `M${r1(point.x)} ${r1(point.y)}h0`;
  }
  // Engraved graticule: meridians every 30°, parallels every 30°, front face only.
  let graticule = "";
  const trace = (points: Array<{ x: number; y: number; depth: number }>) => {
    let open = false;
    for (const point of points) {
      if (point.depth <= 0) { open = false; continue; }
      graticule += `${open ? "L" : "M"}${r1(point.x)} ${r1(point.y)}`;
      open = true;
    }
  };
  for (let meridian = -180; meridian < 180; meridian += 30) {
    trace(Array.from({ length: 37 }, (_, i) => project(meridian, -90 + i * 5)));
  }
  for (const parallel of [-60, -30, 0, 30, 60]) {
    trace(Array.from({ length: 73 }, (_, i) => project(-180 + i * 5, parallel)));
  }
  const city = project(lon, lat);
  const geometry: GlobeGeometry = { dots, graticule, pin: [r1(city.x), r1(city.y)] };
  globes.set(zone, geometry);
  return geometry;
}

function CityGlobe({ zone }: { zone: ZoneId }) {
  const id = useId().replace(/:/g, "");
  const { dots, graticule, pin } = globeGeometry(zone);
  return (
    <svg className="smo-globe" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        {/* Sphere shading only: a lit pole fading to the night side. */}
        <radialGradient id={`${id}-disc`} cx="38%" cy="30%" r="75%">
          <stop offset="0" stopColor="#2a2a2c" />
          <stop offset="0.62" stopColor="#141415" />
          <stop offset="1" stopColor="#09090a" />
        </radialGradient>
      </defs>
      <circle cx={CENTER} cy={CENTER} r={RADIUS} fill={`url(#${id}-disc)`} />
      <path className="smo-globe__graticule" d={graticule} />
      <path className="smo-globe__land is-far" d={dots[0]} />
      <path className="smo-globe__land is-mid" d={dots[1]} />
      <path className="smo-globe__land is-near" d={dots[2]} />
      <circle className="smo-globe__rim" cx={CENTER} cy={CENTER} r={RADIUS} />
      <circle className="smo-globe__halo" cx={pin[0]} cy={pin[1]} r="6.5" />
      <circle className="smo-globe__pin" cx={pin[0]} cy={pin[1]} r="2.6" />
    </svg>
  );
}

const coordinate = (value: number, positive: string, negative: string) =>
  `${Math.abs(value).toFixed(2).replace(".", ",")}° ${value >= 0 ? positive : negative}`;
const coordinates = (zone: ZoneId) => `${coordinate(ZONE_META[zone].lat, "N", "S")} · ${coordinate(ZONE_META[zone].lon, "E", "O")}`;

const CAPS_HINT = "Classes de taille Global Fund fondées sur les capitalisations approximatives ; les prix du jeu sont normalisés séparément.";

export default function StartingMarketPicker({
  value,
  onChange,
  onPreview,
  label = "Place de marché initiale",
  hideLegend = false,
  occupants,
}: {
  value: ZoneId;
  onChange: (market: ZoneId) => void;
  /** Hover / focus preview (presentation only): the 3D globe turns to that city. `null` when it ends. */
  onPreview?: (market: ZoneId | null) => void;
  label?: string;
  /** Keep the legend for assistive technology only (the surrounding UI already names it). */
  hideLegend?: boolean;
  /** Funds already planned on each city (figurines shown on the card). */
  occupants?: Partial<Record<ZoneId, MarketOccupant[]>>;
}) {
  return (
    <fieldset className="starting-market-picker" data-testid="starting-market-picker">
      <legend className={hideLegend ? "sr-only" : "smp-legend"}>{label}</legend>
      <div className="smp-options">
        {MARKET_PLACES.map((place, index) => {
          const overview = marketOverview(place.id);
          const selected = value === place.id;
          const total = Math.max(1, overview.caps.small + overview.caps.medium + overview.caps.large);
          const here = occupants?.[place.id] ?? [];
          // Preview on pointermove, not pointerenter: a pointer left resting over a card
          // after a step change must not swing the globe away from the chosen city.
          return (
            <button
              key={place.id}
              data-testid={`market-option-${place.id}`}
              type="button"
              className={`starting-market-option${selected ? " is-selected" : ""}`}
              aria-pressed={selected}
              title={`${place.city} · ${coordinates(place.id)}\n${place.description}`}
              style={{ "--smo-i": index } as React.CSSProperties}
              onClick={() => onChange(place.id)}
              onPointerMove={onPreview && (() => onPreview(place.id))}
              onPointerLeave={onPreview && (() => onPreview(null))}
              onFocus={onPreview && (() => onPreview(place.id))}
              onBlur={onPreview && (() => onPreview(null))}
            >
              <span className="smo-visual" aria-hidden="true">
                <CityGlobe zone={place.id} />
                {selected && <span className="smo-check"><Check size={12} strokeWidth={2.6} /></span>}
                {here.length > 0 && (
                  <span className="smo-occupants" title={here.map((fund) => fund.name).join(" · ")}>
                    {here.slice(0, 6).map((fund, i) => (
                      <span key={`${fund.pawn}-${i}`} className="smo-occupant" style={{ "--seat-color": fund.color } as React.CSSProperties}>
                        <Pawn id={fund.pawn} color={fund.color} size={22} />
                      </span>
                    ))}
                  </span>
                )}
              </span>
              <span className="smo-place">
                <strong className="smo-city">{place.city}</strong>
                <span className="smo-region">{place.name}</span>
              </span>
              <span className="smo-facts">
                <span className="smo-grade">Note <span className="gf-jewel gf-jewel--sm grade-C"><b>C</b></span></span>
                <span className="smo-count"><b className="gf-num">{overview.companyCount}</b> entreprises</span>
              </span>
              <span className="smo-sectors">
                {overview.sectors.slice(0, 3).map((sector) => (
                  <span key={sector.id} className="smo-sector" title={`${sector.name} : ${sector.count}`}>
                    <SectorIcon id={sector.id} size={13} />
                    <b className="gf-num">{sector.count}</b>
                  </span>
                ))}
              </span>
              <span className="smo-caps" title={CAPS_HINT}>
                <span className="smo-caps__bar" aria-hidden="true">
                  {overview.caps.small > 0 && <i className="is-small" style={{ flexGrow: overview.caps.small / total }} />}
                  {overview.caps.medium > 0 && <i className="is-medium" style={{ flexGrow: overview.caps.medium / total }} />}
                  {overview.caps.large > 0 && <i className="is-large" style={{ flexGrow: overview.caps.large / total }} />}
                </span>
                <span className="smo-caps__legend gf-num">
                  <span>S <b>{overview.caps.small}</b></span>
                  <span>M <b>{overview.caps.medium}</b></span>
                  <span>L <b>{overview.caps.large}</b></span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
