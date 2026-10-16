/** Friendly defaults shared by setup and authoritative online lobby slots. */
const suggestions = [
  "Pépite Capital", "Les Audacieux", "Horizon Doré", "Aurore Capital", "Boussole Financière",
  "Élan Patrimoine", "Les Éclaireurs", "Nouvel Essor", "Cime Invest", "Étoile du Nord",
  "Les Bâtisseurs", "Rivage Capital", "Plein Cap", "Lumière Finance", "Les Visionnaires",
  "Sillage Invest", "Belle Envolée", "Cap Avenir", "Les Curieux", "Clair Horizon",
  "Grand Angle Capital", "Les Optimistes", "Voie Royale", "Matin Calme", "Les Stratèges",
  "Source Vive", "Altitude Capital", "Les Pionniers", "Jardin d’Or", "Mille Possibles",
  "Cœur Vaillant", "Les Voyageurs", "Équilibre Invest", "Vent Favorable", "Les Inventifs",
  "Phare Capital", "Rêve en Grand", "Les Défricheurs", "Ligne d’Horizon", "Soleil Levant",
  "Les Visionnaires du Monde", "Pas de Géant", "Voilier Capital", "Belle Boussole", "L’Avenir en Main",
  "Les Navigateurs", "Horizon Bleu", "Pollen Capital", "Les Curateurs", "Clé des Champs",
];

const normalize = (name: string) => name.trim().toLocaleLowerCase("fr");
export function nextSuggestedFundName(existing: readonly string[]): string {
  const used = new Set(existing.map(normalize));
  const available = suggestions.filter((name) => !used.has(normalize(name)));
  if (available.length) return available[Math.floor(Math.random() * available.length)]!;

  for (let suffix = 2; ; suffix++) {
    const fallback = `Les Associés ${suffix}`;
    if (!used.has(normalize(fallback))) return fallback;
  }
}

