# Global Fund — Refonte « simple et immersive » (front uniquement)

Branche : `refonte-front`. Cette refonte ne change **que la présentation**.

Trois directions ont été **rejetées** par le product owner. On ne les reproduit jamais :
- v1 « La table privée », en verre bleu nuit et laque : « très généré par IA, pas jeu de plateau, très dashboard, pas immersif » ;
- v2 « Club 1929 », en feutre, acajou et laiton : « pas beau », « pas texturé » ;
- v3 « Monaco noir & or texturé », en marbre, cuir et or photographiques : « atroce », puis « reviens dans la simplicité ».

**Brief actuel (v4)**, dans ses mots :
- « faut juste pas que ça fasse dashboard, et mettre de l'immersion » ;
- « le jeu doit rester joli » ;
- « des animations en fonction du type d'industrie » ;
- « UI/UX clean, simple mais impressionnante avec l'interactivité ».

S'y ajoutent ses demandes précédentes, toujours valables : un vrai avion pour les voyages, des animations propres partout et une vue plongeante sur le plateau.

---

## 0. Règles absolues

1. **Ne jamais toucher `main`.** On travaille uniquement sur `refonte-front`.
2. **Backend en lecture seule** : `apps/server/**`, `packages/game-engine/**` et `packages/shared/**` ne sont **jamais** modifiés. Le protocole, les commandes, les règles et les données restent identiques.
3. **Aucune feature perdue.** Chaque commande, chaque décision et chaque donnée visible aujourd'hui reste accessible. On peut la déplacer, la condenser ou la mettre derrière un survol ou un dépli, mais jamais la supprimer. L'inventaire est en §7.
4. **Logique client figée** : `store.ts`, `presentation/sequence.ts`, `presentation/useGamePresentation.ts`, `setupDraft.ts` et `trading/tradingSort.ts` gardent leur sémantique. Seules les durées de `PRESENTATION_TIMING` ont été retouchées, et uniquement par le lead.
5. **Contrat de test** : les tests E2E (`tests/e2e/*.spec.ts`) et le script de captures s'appuient sur des classes, des libellés, des rôles et des attributs. Ils sont listés par écran en §7 et doivent rester valides. Si un texte change, on garde au moins la chaîne exigée.
6. **Interface en français.** Les montants s'écrivent `1 234,50 M€` (`ui/format.ts`), avec un vrai signe moins `−`.

---

## 1. Vision

> Un jeu de plateau premium, posé dans la pénombre. Le plateau 3D, réaliste et vivant, occupe l'écran. L'interface est un habillage de jeu fin, sobre et solide, qui s'efface devant lui.

**Piliers**
1. **Le plateau est le héros.** Il est en plein écran, en vue plongeante. L'immersion et le réalisme viennent de la 3D (lumière, matières, animations), jamais de textures plaquées sur l'interface.
2. **Une interface de jeu, pas un dashboard.** Peu d'éléments, tous aux bords de l'écran :
   - en haut à gauche, le statut ;
   - en haut au centre, les joueurs ;
   - à gauche, les notations ;
   - en bas, la barre de tour ;
   - en bas à droite, les outils.

   Pas de grilles de tuiles, pas de rails d'étiquettes, pas de petites capitales partout.
3. **Simple et solide.**
   - Noirs neutres, jamais de bleu.
   - Surfaces pleines aux coins très arrondis.
   - Une seule couleur d'accent, l'or, réservée à l'action principale et à l'état actif.
   - Ni verre, ni texture, ni dégradé décoratif dans l'interface.
4. **L'interactivité répond dans la scène.** L'interface pilote la scène, sans commande ni mouvement de caméra :
   - survoler un secteur allume ses cases sur le plateau ;
   - survoler une zone fait pulser son épingle sur le globe ;
   - survoler un joueur met sa figurine dans la lumière.
5. **Des animations propres partout.** Elles s'adaptent au contenu (au secteur de la case, au type de carte), avec parité en mouvement réduit.

**Interdits**
- le bleu marine, le bleu nuit et tout fond teinté de bleu ;
- le glassmorphism, les textures photographiques dans l'interface et les dégradés « SaaS » ;
- le look dashboard : tuiles de KPI, tableaux de bord, étiquettes grises en capitales ;
- les textes qui répètent une information déjà visible.

---

## 2. Design system

Les tokens sont dans `apps/web/src/styles.css`. Les constantes partagées avec la 3D sont dans `apps/web/src/ui/theme.ts` : couleurs des secteurs, couleurs des notes, pions et villes.

| Usage | Tokens |
| --- | --- |
| Fonds | `--bg` (#0e0e0f), `--bg-2` |
| Surfaces pleines, de la plus basse à la plus haute | `--surface`, `--surface-2`, `--surface-3`, `--surface-4` ; filets `--line`, `--line-2` |
| Texte | `--text` (ivoire), `--text-2`, `--text-3` |
| Accent unique (or) | `--accent`, `--accent-hover`, `--accent-press`, `--accent-soft` ; texte sur l'accent : `--accent-ink` |
| Signaux | `--up` (vert), `--down` (rouge) |
| Notes A–E | `--grade-a…e`, `<GradeJewel/>`, `<GradeShift/>` |
| Rayons, ombres, durées, courbes | `--radius-*`, `--shadow-1/2/3`, `--dur-1…4`, `--ease-out`, `--ease-in-out`, `--ease-spring` |

Les anciens tokens (`--gold-*`, `--ink-*`, `--text-100…`, `--glass`, `--hairline…`) restent comme alias de compatibilité. On ne leur ajoute aucun nouvel usage.

**Typographie**
- `--font-ui` **Inter** partout : titres en 600–700, chiffres tabulaires.
- `--font-brand` **Cinzel**, uniquement pour la marque « GLOBAL FUND ».
- Montants : `<Money/>` ou `<AnimatedMoney/>`. Le texte reste exactement `1 234,50 M€` ; l'unité est dans `.money-unit`.

**Composants**
- Boutons en pilule :
  - `.gf-btn--primary` : or plein, pour l'action principale (une seule par vue) ;
  - `.gf-btn--ghost` : surface ;
  - `.gf-btn--quiet` : sans fond ;
  - `.gf-btn--up` / `.gf-btn--down` : signaux ;
  - tailles `--sm` / `--lg`, et `--block`.
- `.gf-icon-btn` : bouton rond.
- `.gf-panel` / `.gf-glass` : surface pleine. Les deux ont le même rendu ; le nom `gf-glass` est historique.
- `.gf-chip` et `kbd`.
- `.gf-jewel` : pastille de note (aplat de couleur, lettre blanche).
- `<Pawn/>` : portrait rendu de la figurine 3D. `.pawn-object` est un hook de test.
- Mouvement réduit : `html[data-motion="reduced"]`, `prefers-reduced-motion`, `usePresentationSettings().reducedMotion`.

---

## 3. Règles d'écriture (condensation)

1. **Une idée par ligne.** Un titre fait 4 mots au plus ; le texte d'appui tient en une phrase.
2. **Ne jamais répéter** une information déjà visible à l'écran.
3. **Masquer les zéros** (fonds non touchés), avec « Aucun autre fonds concerné » si nécessaire.
4. Les explications vont dans un `title`, une infobulle, une carte au survol ou un dépli `<details>`.
5. Pas de phrases entières en capitales.
6. Des verbes d'action courts : « Lancer le dé », « Négocier », « Voyager vers… ».
7. Les chaînes exigées par les tests (§7) restent mot pour mot.

---

## 4. Mouvement

| Moment | Mise en scène |
| --- | --- |
| Lancer | Le dé est lancé, roule et s'arrête sur la valeur du serveur (`PRESENTATION_TIMING.dice`, puis `result`). |
| Déplacement | Le pion saute case par case (220 ms), et la caméra l'accompagne doucement. |
| Arrivée | La case joue **l'animation de son secteur**, courte (moins d'une seconde) et dans la lumière de la case. Les corners et les cases Événement ont leur propre signal. |
| **Voyage** | **Cinématique d'environ 4,2 s** (`PRESENTATION_TIMING.travel`) : un avion 3D décolle de la ville de départ, suit un arc au-dessus du globe et se pose, puis la caméra revient. En mouvement réduit, l'arc est tracé d'un coup et l'avion apparaît à destination. |
| Carte tirée | La carte du dessus se soulève du paquet 3D, puis la carte s'ouvre au centre de l'écran. |
| Krach, Bull, Bear | La lumière de la scène change (rouge, vert ou froid), et le bandeau d'impact apparaît. |
| Notes (`MARKET_IMPACT`) | La case ou l'épingle du globe pulse en vert ou en rouge, et la pastille de note bascule dans le HUD. |
| Survols du HUD | De la lumière dans la scène (secteur, zone ou figurine), sans mouvement de caméra. |
| Panneaux | Entrées en 250–420 ms (fondu et légère translation), sorties plus rapides. |

Courbes : `--ease-out` et `--ease-spring`. On vise 60 fps.

---

## 5. Écran de jeu

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◎ Cycle 07/101       (●Amara 2 425 M€)(●Luca 961 M€)(●Mei …)    ● Serveur  ◌ ◌ │
│   Composer son portefeuille                                       Salon D00002 │
│ ┌─────────┐                                                                    │
│ │ Zones   │                PLATEAU 3D PLEIN ÉCRAN                              │
│ │ Secteurs│                (vue plongeante, globe au centre)                   │
│ └─────────┘                                                                    │
│  ⤢          ┌────────────── barre de tour ──────────────┐          ◌ ◌ ◌ ◌ ◌   │
│             │ ●Amara · À vous   [ Lancer le dé ␣ ]  185,00 M€ │                │
│ GLOBAL EXCHANGE · téléscripteur discret ────────────────────────────────────── │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Le décor**
- **Le canvas 3D est plein écran.**
- **Bureau (`.market-office`)** : la skyline de la ville du fonds, très loin derrière, en noir et blanc, floue et assombrie. On garde les attributs `data-*` et le fondu `.office-leaving`.

**Le HUD**
- **Statut** (`.world-status`, en haut à gauche) : la ligne du cycle, puis le titre de phase exact en `h1`. `pointer-events: none`.
- **Joueurs** (`.fund-dock`, en haut au centre) : une pilule par siège.
  - Contenu : figurine avec un anneau à la couleur du siège, nom et valeur du fonds. Les liquidités s'affichent quand la place le permet (container query).
  - Au survol, une carte montre la place, les liquidités et l'insolvabilité, et la figurine passe dans la lumière en 3D.
  - États :
    - fonds actif : anneau or et soulignement ;
    - fonds inspecté : filet ;
    - en détention : anneau rouge ;
    - insolvable : grisé.
- **Notations** (`.world-ratings`, à gauche) : une carte pleine et compacte, masquée en mode focus.
  - Zones : un clic centre la caméra, un survol fait pulser l'épingle du globe.
  - Secteurs : un survol allume les cases du secteur.
- **Barre de tour** (`.command-console`, en bas au centre) :
  - une ligne fine avec les étapes et la position ;
  - puis le fonds actif, **une seule action principale en or**, et les liquidités (`.console-fund`).
- **Outils** (`.world-tools`, en bas à droite) : boutons ronds avec infobulle. Les libellés restent dans le DOM. La **vue globale** est un bouton en bas à gauche.
- **Téléscripteur** (`.financial-ticker`) : discret, au bord inférieur de l'écran.

**Règles de mise en page**
- **Surfaces centrales** : elles utilisent `--center-*` (des px simples sur `.game-world`, lus par le script de captures). Elles ne recouvrent jamais `.command-console` ni `.fund-dock`.
- **Pointeurs** : les conteneurs du HUD sont en `pointer-events: none`, seuls les contrôles sont en `auto`, et rien n'est interactif en (100, 100).
- **Cadrage** : la caméra cadre le plateau dans la zone libre grâce aux `insets` mesurés par `useHudInsets` (statut et joueurs en haut, notations à gauche, barre et outils en bas).

**Responsive**
- 1366×768 : pilules compactes (figurine 32 px, nom et valeur).
- 1180 px et moins : notations réduites aux pastilles.
- Tablette 768×1024 : les joueurs défilent en bande, les notations forment une bande au-dessus de la barre de tour, et le bouton de fermeture des cartes est visible.
- Mobile : utilisable.

### Surfaces centrales

Elles suivent le même langage : surfaces pleines, une seule couleur d'accent, textes condensés. Elles seront reprises une à une après validation de l'écran de jeu :
- terminal de trading ;
- cartes (les familles gardent leur couleur signal, sur fond charbon : vert pour le Bull, rouge pour le Krach) ;
- panneau de voyage ;
- desk de règlement ;
- bandeau d'impact ;
- reçu de transaction ;
- victoire.

### Menus, configuration, salon

- Fond 3D `MenuHero` neutre.
- Menu simple, avec les boutons en pilule.
- Configuration et salon sur des surfaces pleines, sans bleu.

---

## 6. Direction 3D

- **Lumière** : une lumière clé chaude au-dessus du plateau, avec des ombres douces et une chute sombre vers les bords. Tonemapping ACES. Bloom léger, réservé aux points lumineux.
- **Matières** : réalistes mais retenues.
  - Cadre en bois sombre ou ébène, filets dorés satinés.
  - Cases sombres et mates, avec une bande de la couleur du secteur.
  - **Aucun bleu marine** : noirs neutres et charbon.
- **Cases** : bande de couleur, icône et libellé. Le survol d'un secteur dans le HUD (`highlightSector`) allume les cases avec un liseré lumineux de la couleur du secteur.
- **Animations de secteur** : une animation courte par secteur à l'arrivée du pion, en complément de l'onde d'arrivée.
- **Globe** : sombre avec des continents dorés, des épingles et l'arc d'aperçu de voyage. `highlightZone` fait pulser une épingle.
- **Avion** : voir §4.
- **Pions** : figurines (le lion est un vrai lion). `highlightPlayerId` met une figurine dans la lumière.
- **Caméra** : vue plongeante à environ 55–65°, cadrée avec les `insets`. Elle suit doucement le pion et se tourne vers le globe pour les voyages. En mouvement réduit, la caméra est fixe et le rendu se fait à la demande.
- **Contrats techniques inchangés** :
  - `BoardSceneProps`, avec en plus `highlightSector`, `highlightZone` et `highlightPlayerId`, qui ne servent qu'à la présentation ;
  - les attributs `data-*` ;
  - la liste accessible des 52 cases ;
  - le tier `low` en rendu logiciel ;
  - `data-scene-ready` et `data-fps`.

---

## 7. Inventaire des features et contrat de test par écran

> Les descriptions de cette section décrivent les **hooks** (classes, rôles, libellés, attributs) qui doivent survivre. La disposition visuelle et les matières sont celles des §5 et §6.

### 7.1 Coquille App, menus, configuration, salon — `App.tsx`, `game/MainMenu.tsx`, `game/StartingMarketPicker.tsx`, `game/Chat.tsx`
- Le texte **« Serveur connecté »** est visible sur tous les écrans, jeu compris. Sinon : « Reconnexion… ».
- Bascule son (`aria-label` « Activer le son » / « Couper le son »), bouton « Paramètres ».
- Menu : boutons dont le nom contient **NOUVELLE PARTIE**, **REJOINDRE**, **REPRENDRE** (si session), **RÈGLES** et **PARAMÈTRES**.
- Configuration, étape 1 (`data-testid="setup-step-funds"`) :
  - select `aria-label="Nombre de joueurs"` (valeurs 2–6) ;
  - par siège N : input `Nom du fonds N`, select `Type du joueur N` (local / remote / ai ; siège 1 désactivé), select `Difficulté de l’IA N` pour une IA (easy / normal / hard) ;
  - `role="radiogroup"` `aria-label="Pion du joueur N"`, avec des radios nommées par le nom du pion (Lion, Taureau, Globe, Cristal, Tour, Feuille) et `aria-checked` ;
  - bouton **« Choisir les places financières »** (texte exact).
- Configuration, étape 2 (`data-testid="setup-step-markets"`) :
  - `.market-player-tabs button` × humains, avec `data-testid="market-player-tab-{index}"` et `aria-pressed` ;
  - `StartingMarketPicker` : 5 `.starting-market-option` (`data-testid="market-option-{zone}"`, `aria-pressed`) dont le texte contient la région (Amériques, Europe, Asie, Afrique & Moyen-Orient, Océanie), la ville (New York, Londres, Hong Kong, Dubaï, Sydney) et **« Note C »** ;
  - liste des implantations IA automatiques ;
  - bouton dont le nom contient **« Configuration des fonds »** (retour) ;
  - bouton **« Créer ma partie »**.
- Bouton exact **« ← Retour au menu »**. Bascule « J’ai déjà un code d’invitation → » / « Créer une nouvelle partie → ».
- `.home-scene` ne contient jamais « nationalité », « nationality » ni « pays du joueur ».
- Rejoindre : `Code du salon`, `Nom pour rejoindre`, un `StartingMarketPicker`, select `Pion pour rejoindre`, bouton **« Rejoindre »**.
- Brouillon : le setup est sauvegardé via `saveSetupDraft` à chaque changement (logique existante à garder telle quelle).
- Salon :
  - titre **« Le capital vous attend. »** ;
  - **« CODE D’INVITATION »** ;
  - `.room-code b` contient le code ; bouton Inviter qui copie le lien ;
  - `.lobby-player` par fonds avec le nom, la place de marché de départ, la ville, le type (IA / DISTANT / LOCAL), le niveau d'IA et le statut : **« Prêt à investir »**, « Connexion établie · en attente » ou « En attente de votre invité » ;
  - le chat ;
  - **« Retour à l’accueil »** ;
  - pour l'hôte, **« Ouvrir le parquet »**, désactivé tant que les distants ne sont pas tous prêts, avec une note courte ;
  - pour l'invité, **« Je suis prêt »** / « Annuler mon état prêt ».
- Paramètres (dialogue) : son activé, volumes (général, musique, ambiance, effets), « Réduire les animations », select `Qualité graphique`, lien « Crédits et licences », bouton « Reprendre la séance ». Règles (dialogue) : les règles du jeu, à condenser en liste lisible sans perdre aucune règle.
- Bandeau d'erreur : bouton `Fermer le message d’erreur`, bouton « Nouvelle session ».

### 7.2 Monde de jeu (HUD) — `game/GameWorld.tsx`, `game/Geography.tsx`, `game/OfficeEnvironment.tsx`, `game/FinancialTicker.tsx`
- `.game-world` porte `data-presentation-stage`, `data-effects-started` (`"true"` seulement en `MARKET_IMPACT`) et `data-quality`, ainsi que les classes `motion-reduced`, `wealth-{id}` et `world-detained`.
- `.world-status h1` contient le **titre de phase exact** : « Règlement en cours », « Choisir son marché », « Le circuit des marchés », « Composer son portefeuille », « Clôture de la séance » ou « Passage de relais ». Au cycle 1, le texte **« OUVERTURE À C/C »** est affiché, puis « n / 100 CONTEXTES ».
- `.world-ratings` contient `.world-sectors` (9 secteurs, chacun avec icône, nom et note) et `.world-zones` (5 boutons `.economic-zone`, chacun avec `.rating-instrument > b` = lettre). Le clic sur une zone bascule la focalisation du plateau.
- `.command-console` :
  - `.active-fund h2` = nom du fonds actif, avec son statut (IA en réflexion, à vous, autre fonds) ;
  - les 3 étapes (Implantation, Dé & case, Trading) ;
  - `.active-location` = nom de la zone du fonds actif et sa semaine ;
  - `.turn-actions` :
    - « Lancer le dé » (`.action-dice`, raccourci ␣) ;
    - « Négocier » ;
    - « Terminer le marché », seulement quand le terminal est fermé ;
    - « Prochain investisseur » ;
    - « Choisir son marché » (`.action-travel`) ;
  - `.console-fund` : sa **dernière** `.animated-money` = liquidités du fonds actif ;
  - la détention (procès, sortie forcée à 5 M€) ;
  - pendant une présentation, le libellé d'étape, avec « Lire la carte » si le terminal masque une carte.
- `.fund-dock` : un `button.investor-card` par fonds, avec `.pawn-object`, le nom, IA/Humain, la valeur du fonds et les liquidités (`AnimatedMoney`). `.dock-place` est la carte au survol : la zone ou « Justice », « Insolvable », et les liquidités quand la pilule est compacte. La classe `is-active` marque le fonds actif, `inspecting` le fonds inspecté. Le clic inspecte ce fonds (`viewerId`) ; le survol éclaire sa figurine (`highlightPlayerId`).
- `.world-tools` : boutons contenant **Portefeuille**, **Marché**, **Analyse**, **Statistiques** et **Salon** (badge non lus). On y trouve aussi le nom du fonds inspecté, le nombre de participations et le nombre de contrôles 100 % (C/C).
- Raccourcis : **P** portefeuille, **M** marché, **Espace** lance le dé (en phase dé, si autorisé, hors champ de saisie ou de bouton). Échap ferme le terminal.
- `.trade-receipt` : reçu construit depuis deux états serveur, de titre « ACHAT VALIDÉ », « VENTE VALIDÉE », « CONTRÔLE TOTAL » ou « MONOPOLE CONSTITUÉ ».
- `.world-chat` : salon de discussion du jeu.
- Terminal : `.terminal-backdrop` > `.floating-terminal` (`role="dialog"`, `aria-modal="false"`, `aria-label="Terminal de trading"`) qui contient `TradingDesk`.
- Décision de voyage (`Geography`) :
  - `.decision-backdrop.central-decision` > `.geography-scene` ;
  - fermeture `aria-label="Consulter le plateau avant de décider"` ;
  - `.travel-market` (+ `.current-market`, `.selected`) avec `.travel-zone-select` (`role="radio"`, `aria-checked`, `aria-label="Choisir {zone}"`, contenant `<b>{zone}</b>`), plus `.travel-analyse` (`aria-label="Analyser le marché {zone}"`) ;
  - `.travel-choice-summary` : destination et coût (« 0,00 M€ » ou « 1,00 M€ ») ;
  - boutons « Rester en {zone} » et « Voyager vers {zone} » ;
  - en détention, « Lancer le dé du procès ».
- `ConsequenceRibbon` : `.consequence-ribbon`, avec un bouton `.impact-continue` « Valider les cours » quand une confirmation est attendue. Il affiche la note qui change ou le cours d'une société.
- Victoire : `.victory-stage` (dialogue), `h2` avec les noms des gagnants, le classement complet et le bouton « Nouvelle partie ».
- Bureau : `.market-office` avec `data-current-market`, `data-office-city` et `data-office-player`. `.office-leaving` n'existe que pendant le fondu. Le bureau suit le fonds humain du client et change **après** `TRAVEL_RESOLUTION`. L'indication de prestige (`wealthStage`) est conservée.
- Ticker `.financial-ticker` (« GLOBAL EXCHANGE ») : défilement lent, arrêt au survol, respect du mouvement réduit.

### 7.3 Cartes — `presentation/CardScene.tsx`
- `.cs-backdrop` (`.is-embedded` / `.is-modal`) > `section.cs-scene.is-context | .is-payments | .is-event`, avec `role="dialog"`, `aria-labelledby="cs-title"` (**`h1#cs-title` = titre exact de la notice**) et `aria-describedby="cs-summary"`.
- Bouton `.cs-close` `aria-label="Continuer et appliquer les conséquences"` (affiche « Échap »). Échap ferme la carte. **Aucun `.cs-footer`.** Le contenu défile dans `.cs-content`.
- Contexte : résumé, avec le texte complet en dépli ; une `.cs-grade-row` par changement de note ; impacts portefeuilles **non nuls uniquement** ; détention éventuelle ; carrousel `.cs-companies` > `.cs-rail` > `.cs-company` > `.cs-company-data` avec `strong` cours avant puis cours après (le 2e `strong` = cours après).
- Événement (« GF Financial Chronicle ») : catégorie, cible, condition judiciaire et conséquences (`effectLines`), impacts non nuls, bilan Départ (performance, rendement, flux de capital), sociétés.
- Bull / Bear / Crash : notes qui changent, variation de valeur de chaque fonds touché, sociétés.
- Règlement :
  - `.cs-settlement-results` > `.cs-settlement-receipt` (un par motif), `h2.cs-settlement-heading` (motif, par exemple « Revenus du secteur Industrie ») ;
  - lignes `.cs-settlement-cash` (« Payeur → Bénéficiaire » et montant), `.cs-settlement-assets` (titres transférés ou vendus) et revenus bancaires en `.cs-payment-list .cs-payment` ;
  - ensuite `.cs-global-totals` (« TOTAL RÉGLÉ », « Reste impayé »), puis `.cs-companies`, **dans cet ordre DOM** ;
  - titre (heading) **« Synthèse des règlements — {secteur} »** ;
  - interdits : les textes « RÈGLEMENT ENTRE INVESTISSEURS », « Liquidités · débiteur → créancier » et « créancier → débiteur », le heading « Règlement terminé » et l'élément `.cs-settlement-total`.
- Paiements simples : versements exécutés ou « à financer », obligations, flux de capital au Départ.

### 7.4 Terminal — `trading/TradingDesk.tsx`
- `section.trading-desk` (`aria-label="Salle des marchés"`).
- `.td-header h1` : « TRADING — {ZONE EN MAJUSCULES} » ou « PORTEFEUILLE ».
- `.td-capital strong` : cash du fonds affiché.
- Boutons d'en-tête : `aria-label` « Terminer le marché », « Retour à la décision de voyage » (phase voyage) et « Retour au plateau ».
- `.td-tabs` : boutons « Marché » (nom exact), « Portefeuille » (avec badge), « Analyse » et « Statistiques ». L'onglet actif porte la classe `active`.
- Filtres :
  - searchbox `aria-label="Rechercher une entreprise"` ;
  - select `Zone à consulter` (phase voyage) ;
  - select `Filtrer par secteur` ;
  - select `Filtrer par taille de capitalisation` (valeurs all / small / medium / large).
- `.td-table-scroll` > `.td-column-head` contient **7** `.td-column[role=columnheader][aria-sort]`, chacune avec un `button.td-sort-button`. `.td-rows` contient des `button.td-row`, avec `.selected`, `.has-control` et `.has-monopoly`. Cellules :
  - `.td-name b` : le premier nœud texte = nom de la société ;
  - `.td-sector` ;
  - `.td-cap-category` : texte « SMALL », « MEDIUM » ou « LARGE », ou bien `.unknown` ;
  - `.td-price b` ;
  - `.td-profit-loss` : `.unknown` si le texte est « — », sinon par exemple « +0,0 % » ;
  - `.td-held` ;
  - `.td-available`.
  - Les valeurs numériques restent analysables : nombre au début du texte.
- À 1366×768, les 7 colonnes tiennent sans défilement horizontal.
- `.td-focus` (fiche) : `h2` = nom de la société. `.td-quote` contient **exactement des `div` plats (sans `div` imbriqué)** dans cet ordre : cours, PRU, P/L, parts détenues (`strong` = « 1 / 5 »), valeur. Le `strong` du cours fait au moins 18 px.
- Ticket : `.td-quantity` avec « Réduire la quantité », « Augmenter la quantité » et `b` = quantité, puis les boutons **« Acheter »** et **« Vendre »** (noms exacts) et le montant. Un `.td-focus-details` contient `.td-price-chart` (au moins 150–180 px de haut). `.td-focus-order` reste dans `.td-focus`. Motifs d'indisponibilité dans `.td-disabled-reason`, dont « Consultation libre pendant la décision de voyage… ».
- Portefeuille : « VOS POSITIONS », groupes zone × secteur (`.td-portfolio-groups`), progression de contrôle, monopole.
- Analyse (`.td-analysis`) : répartition par zone et par secteur (anneaux), contrôles 5/5 C/C, monopoles A/A.
- Statistiques (`.td-statistics`) : au moins 3 `.td-card` enfants directs, chacun d'au moins 180 px de haut : historique de valeur du fonds, notations zones/secteurs, cours d'une société. Le terminal reste dans le viewport à 1920, 1440 et 1366.
- Graphiques : ECharts, avec des courbes or ou neutres et des grilles très discrètes.

### 7.5 Desk de règlement — `game/SettlementDesk.tsx`
- `main.settlement-desk` (`aria-label="Desk de règlement"`).
- Cause : texte « CASE INDUSTRIE » (« CASE {SECTEUR} »).
- Débiteur, montant restant, créancier dans `.sd-party-creditor` (cash), liquidités disponibles et manque.
- `.sd-priority` (plus d'un créancier) : `:scope > div > span` par créancier, avec le nom et la valeur figée, plus le texte « Valorisation au début du règlement ».
- Sélection : `.sd-assets-table tbody tr`, boutons « Ajouter une part de {société} » et « Retirer une part de {société} », `.sd-quantity b` ; valeur indicative et complément estimé.
- Boutons « Vendre au marché » et « Proposer au créancier ».
- Titres « Choisissez les actifs à céder » et « {Débiteur} vous propose un règlement ».
- Offre (`.sd-offer-main`) : textes « Le débiteur vous verse », « Vous versez au débiteur », « Aucun complément en cash » et « Les parts couvrent exactement… » ; boutons « Refuser », « Exiger du cash », « Accepter et payer {montant} » et « Accepter le règlement ».
- `.sd-cash-warning` : « Disponible : X » et « requis : Y ».
- États d'attente : la décision appartient à un autre fonds.

### 7.6 Plateau — `board/BoardScene.tsx` (+ `board/three/*`)
- `section.fund-board` avec `data-quality`, `data-reduced-motion`, `data-presentation-stage`, `data-dice-state` (`"rolling"` si et seulement si l'étape est `DICE_ROLLING` sans mouvement réduit, sinon `"stopped"`) et `data-pawn-state` (`"moving"` si et seulement si `PAWN_MOVING` sans mouvement réduit, sinon `"idle"`).
- `.fund-board-canvas` (`role="img"`, `aria-label` = résumé des positions) avec `data-camera`, `data-fps` et `data-scene-ready`. Son `<canvas>` a `pointer-events: none` et un curseur différent de `help`. **Jamais de `.fund-board-tooltip`.**
- `.fund-board-accessible` : `<details><summary>Explorer les 52 cases</summary>` avec un `<ol>` de **52 `li`** (boutons). Bouton `.fund-board-accessible-roll` « Lancer le dé » (visuellement masqué).

---

## 8. Organisation

- Un seul propriétaire par fichier à la fois. Un besoin partagé se signale au lead.
- **Lead** :
  - `styles.css`, `ui/*`, `board/types.ts` ;
  - le HUD : `game/GameWorld.tsx`, `game-world.css`, `geography.css`, `impact-ribbon.css`, `office-environment.css` et `FinancialTicker.css` ;
  - `app-shell.css`, la documentation et `scripts/redesign/shoot.ts`.
- **3D** : `board/BoardScene.tsx` et `board/three/*` (plateau, cases, animations de secteur, lumière). Le globe, l'avion, les pions et `MenuHero` peuvent être confiés à un second chantier.
- Les styles d'un écran vivent dans son fichier et sont préfixés par la racine de l'écran.

## 9. Vérification

- Typage : `npx tsc --noEmit -p .` depuis la racine, en filtrant ses propres fichiers (d'autres workstreams peuvent être en cours).
- Captures :
  ```
  npx tsx scripts/redesign/shoot.ts --scenes=<scènes> --sizes=1920x1080,1366x768 --out=<dossier> --cache=<workstream>
  ```
  Scènes : `menu`, `settings`, `rules`, `setup`, `setup-markets`, `join`, `lobby`, `board`, `hover` (survols du HUD), `chat`, `dice`, `roll` (avec `--motion=full`), `trading`, `portfolio`, `analysis`, `statistics`, `travel`, `jail`, `context`, `impact`, `event`, `prison`, `crash`, `bull`, `bear`, `payments`, `settlement-cash`, `settlement`, `creditor`, `ending`. Le rapport (`report.json`) liste aussi les erreurs console. Par défaut le GPU matériel (RTX) est utilisé ; `--swiftshader` reproduit le rendu logiciel des tests E2E (qualité `low` forcée). Regarder chaque PNG produit avec l'outil Read.
- Avant de rendre la main : zéro erreur console sur ses scènes, contrat §7 respecté, revue critique de ses propres captures à 1920 et 1366 (luxe, lisibilité, densité, alignements).
