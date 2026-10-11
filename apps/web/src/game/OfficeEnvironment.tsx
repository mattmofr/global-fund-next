import { useEffect, useState } from "react";
import type { ZoneId } from "@global-fund/shared";
import { marketPlaceVisuals } from "./marketPlaceVisuals";
import "./office-environment.css";

/**
 * The night view behind the 3D table: the photographic skyline of the client's
 * office city, darkened and softly defocused. A client keeps its human's office
 * while another fund plays. Travel completes before the fade.
 */
export default function OfficeEnvironment({ market, playerId, travelling, reducedMotion }: {
  market: ZoneId; playerId: string; travelling: boolean; reducedMotion: boolean;
}) {
  const [visible, setVisible] = useState(market);
  const [previous, setPrevious] = useState<ZoneId | null>(null);
  useEffect(() => {
    if (travelling || market === visible) return;
    const next = new Image();
    next.src = marketPlaceVisuals[market].background;
    let live = true;
    const show = () => {
      if (!live) return;
      setPrevious(reducedMotion ? null : visible);
      setVisible(market);
    };
    if (next.complete) show();
    else { next.onload = show; next.onerror = show; }
    return () => { live = false; next.onload = null; next.onerror = null; };
  }, [market, visible, travelling, reducedMotion]);
  useEffect(() => {
    if (!previous) return;
    const timer = setTimeout(() => setPrevious(null), reducedMotion ? 0 : 550);
    return () => clearTimeout(timer);
  }, [previous, visible, reducedMotion]);
  const pane = (id: ZoneId, leaving = false) => <div className={`office-pane ${leaving ? "office-leaving" : "office-current"}`} key={`${id}-${leaving}`}>
    <div className="office-skyline" style={{ backgroundImage: `url('${marketPlaceVisuals[id].background}')` }} />
  </div>;
  return <div className="room-depth market-office" aria-hidden="true" data-current-market={visible} data-office-player={playerId} data-office-city={marketPlaceVisuals[visible].city}>
    {pane(visible)}{previous && pane(previous, true)}
    <div className="office-grade" />
    <div className="office-glow" />
    <div className="office-vignette" />
  </div>;
}
