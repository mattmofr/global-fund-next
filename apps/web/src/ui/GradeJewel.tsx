import type { Grade } from "@global-fund/shared";
import { GRADE_META } from "./theme";

/**
 * A rating rendered as a small cut jewel: letter + colour + level pips.
 * `label` names what is rated (e.g. "Énergie") for assistive technology.
 */
export function GradeJewel({ grade, label, size = "md", pips = false, className = "" }: {
  grade: Grade; label?: string; size?: "sm" | "md" | "lg"; pips?: boolean; className?: string;
}) {
  const meta = GRADE_META[grade] ?? GRADE_META.C;
  return (
    <span
      className={`gf-jewel gf-jewel--${size} grade-${grade} ${className}`}
      style={{ "--jewel": meta.color } as React.CSSProperties}
      title={label ? `${label} : ${grade} — ${meta.label}` : `${grade} — ${meta.label}`}
      aria-label={label ? `${label} : ${grade}, ${meta.label}` : `${grade}, ${meta.label}`}
    >
      <b>{grade}</b>
      {pips && <span className="gf-jewel__pips" aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <i key={i} className={i < meta.level ? "lit" : ""} />)}</span>}
    </span>
  );
}

/** "D → B" transition with direction colour. */
export function GradeShift({ before, after, label }: { before: Grade; after: Grade; label?: string }) {
  const direction = GRADE_META[after].level - GRADE_META[before].level;
  return (
    <span className={`gf-grade-shift ${direction > 0 ? "is-up" : direction < 0 ? "is-down" : "is-flat"}`} aria-label={`${label ? `${label} : ` : ""}${before} vers ${after}`}>
      <GradeJewel grade={before} size="sm" />
      <span className="gf-grade-shift__arrow" aria-hidden="true">→</span>
      <GradeJewel grade={after} size="sm" />
    </span>
  );
}
