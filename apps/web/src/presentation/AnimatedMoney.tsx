import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@global-fund/ui";
import { usePresentationSettings } from "./settings";

/** Anime uniquement la présentation ; la valeur cible vient toujours du serveur. */
export default function AnimatedMoney({ value, className = "" }: { value: number; className?: string }) {
  const { reducedMotion } = usePresentationSettings();
  const current = useRef(value);
  const [display, setDisplay] = useState(value);
  const [direction, setDirection] = useState(0);
  useEffect(() => {
    const from = current.current;
    setDirection(Math.sign(value - from));
    if (reducedMotion || from === value) { current.current = value; setDisplay(value); return; }
    const start = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      const t = Math.min(1, (now - start) / 520);
      current.current = from + (value - from) * (1 - (1 - t) ** 3);
      setDisplay(current.current);
      if (t < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [value, reducedMotion]);
  const text = formatMoney(display);
  // Figures and unit are split so the unit can use a legible face; the text content is unchanged.
  return <span className={`animated-money ${direction > 0 ? "money-up" : direction < 0 ? "money-down" : ""} ${className}`} aria-label={formatMoney(value)}>{text.slice(0, -3)}<span className="money-unit"> M€</span></span>;
}
