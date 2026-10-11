import { ArrowRight, BookOpen, Settings2 } from "lucide-react";
import "./main-menu.css";

export interface MainMenuProps {
  onNew: () => void;
  onJoin: () => void;
  onResume?: () => void;
  /** Room code of the saved session, shown on REPRENDRE. */
  resumeCode?: string;
  onSettings: () => void;
  onRules?: () => void;
}

/** The Global Fund mark: a flat armillary ring drawn in currentColor (decorative). */
export function Emblem({ className = "" }: { className?: string }) {
  return (
    <svg className={`gf-emblem ${className}`} viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
      <circle cx="24" cy="24" r="22.4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M24 1.6v3.6M24 42.8v3.6M1.6 24h3.6M42.8 24h3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <ellipse cx="24" cy="24" rx="7.4" ry="15.4" stroke="currentColor" strokeWidth="1.3" />
      <ellipse cx="24" cy="24" rx="15.4" ry="5.2" stroke="currentColor" strokeWidth="1.3" transform="rotate(-23 24 24)" />
      <circle cx="24" cy="24" r="2.8" fill="currentColor" />
    </svg>
  );
}

/** Title screen. The 3D hero (MenuHero) lives behind it, on the right half. */
export default function MainMenu({ onNew, onJoin, onResume, resumeCode, onSettings, onRules }: MainMenuProps) {
  return (
    <main id="main-menu" className="main-menu" aria-labelledby="main-menu-title">
      <section className="mm-stage">
        <header className="mm-title">
          <Emblem className="mm-emblem" />
          <h1 id="main-menu-title" className="mm-wordmark">
            Global <span>Fund</span>
          </h1>
          <p className="mm-tagline">Le monde est votre marché.</p>
        </header>

        <nav className="mm-actions" aria-label="Menu principal">
          <button type="button" className="gf-btn gf-btn--primary gf-btn--lg mm-action mm-action--primary" title="2 à 6 fonds, humains ou IA" onClick={onNew}>
            <span className="mm-action__label">NOUVELLE PARTIE</span>
            <ArrowRight className="mm-action__arrow" size={18} strokeWidth={2} aria-hidden="true" />
          </button>
          <button type="button" className="gf-btn gf-btn--quiet gf-btn--lg mm-action" title="Avec un code d’invitation" onClick={onJoin}>
            <span className="mm-action__label">REJOINDRE</span>
            <ArrowRight className="mm-action__arrow" size={17} strokeWidth={2} aria-hidden="true" />
          </button>
          {onResume && (
            <button type="button" className="gf-btn gf-btn--quiet gf-btn--lg mm-action" title="Dernière séance" onClick={onResume}>
              <span className="mm-action__label">REPRENDRE</span>
              {resumeCode && <span className="mm-action__code">Salon {resumeCode}</span>}
              <ArrowRight className="mm-action__arrow" size={17} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
          <div className="mm-utility">
            {onRules && (
              <button type="button" className="gf-btn gf-btn--quiet gf-btn--sm" onClick={onRules}>
                <BookOpen size={15} strokeWidth={1.7} aria-hidden="true" /> RÈGLES
              </button>
            )}
            <button type="button" className="gf-btn gf-btn--quiet gf-btn--sm" onClick={onSettings}>
              <Settings2 size={15} strokeWidth={1.7} aria-hidden="true" /> PARAMÈTRES
            </button>
          </div>
        </nav>
      </section>
    </main>
  );
}
