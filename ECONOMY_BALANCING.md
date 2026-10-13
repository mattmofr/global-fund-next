# Équilibrage de l’économie

**12 octobre 2026 — chocs de marché** : Bull/Bear utilisent désormais une portée de zones déterministe, avec un niveau supplémentaire dans la zone du fonds actif ; Bear est en case 40. Les mesures de cette itération figurent dans [ENGINE_RULES.md](ENGINE_RULES.md) et [market-shock-simulation.json](docs/market-shock-simulation.json). Les anciennes campagnes ci-dessous conservent leurs paramètres et ne sont pas une validation des nouvelles règles.

**Règle actualisée le 9 octobre 2026** : le fonds actif ne perçoit plus de revenu sectoriel de la banque pour ses propres participations. Ses entreprises rapportent lorsqu’un autre fonds tombe sur le secteur. Les simulations et comparaisons ci-dessous ont précédé ce changement ; elles restent des résultats historiques et ne mesurent pas l’équilibre de cette nouvelle règle. Les prix et revenus de base ne sont pas recalibrés dans cette correction.

## Objectif et unités

Le fonds commence avec **100 M€**. La capitalisation réelle, exprimée en USD et sourcée dans `COMPANY_AUDIT.md`, sert à classer et ordonner les entreprises. Elle n’est pas convertie en euros du jeu. `basePrice` représente le prix des cinq parts à indices C/C ; le moteur conserve `basePrice / 5 × indice_zone × indice_secteur` pour une part. Les planchers de revenu des contrôles 5/5 (C/C) et des monopoles (A/A) restent inchangés.

Les catégories **Global Fund** adaptées à cet univers de grands groupes sont : Small sous 40 Md USD, Medium de 40 à moins de 200 Md USD, Large à partir de 200 Md USD. Ce ne sont pas les définitions boursières habituelles des petites capitalisations. Le classement relatif sert la progression avec 100 M€ : les seuils 10/100 Md USD ne donnent que six Small dans cet univers et aucune Small de départ en Europe ou en Asie. Une exploration 50/250 Md USD est documentée séparément ; les seuils retenus **40/200 Md USD** respectent l’exemple **Komatsu Medium** (43,63 Md USD) et **Toyota Large** (218,03 Md USD) tout en conservant des Small dans chaque place. Après les deux ajouts immobiliers, la matrice est : Amériques 2 Small / 13 Medium / 20 Large ; Europe 2 / 11 / 11 ; Asie 3 / 5 / 9 ; Afrique & Moyen-Orient 6 / 0 / 0 ; Océanie 7 / 2 / 0, soit **20 / 31 / 40** au total.

## Méthode reproductible

`packages/game-engine/src/economy.ts` contient `capCategoryFor`, `normalizeEconomy` et les scénarios testables. Dans chaque catégorie, la position normalisée est :

```
t = (log10(capitalisation) − log10(minimum_catégorie))
    / (log10(maximum_catégorie) − log10(minimum_catégorie))
basePrice = borne_basse + t × (borne_haute − borne_basse)
baseIncome = basePrice × rendement_catégorie
```

La fonction est monotone dans chaque catégorie. Le logarithme réduit l’influence d’un géant sans effacer la hiérarchie. Les bornes garantissent une séparation entre catégories. Une catégorie contenant une seule entreprise utilise le milieu de sa fourchette. Les valeurs sont arrondies au centième de M€. Les entreprises présentes et leurs capitalisations sont les entrées de la normalisation : une nouvelle composition du catalogue peut changer la position relative, mais uniquement pour les nouvelles parties.

Le « rendement » est le revenu des cinq parts à C/C divisé par leur prix à C/C **à chaque arrivée pertinente sur un secteur**, pas un rendement annuel. Les revenus proviennent de versements de la banque ou de transferts entre joueurs selon les règles du plateau. Les mesures indiquent les revenus reçus, y compris les transferts ; ce total ne représente donc pas uniquement de la création monétaire.

## Scénarios comparés avant sélection

| Scénario | Small, cinq parts / une part | Medium, cinq parts / une part | Large, cinq parts / une part | Revenus Small / Medium / Large |
|---|---|---|---|---|
| progression-growth | 25–100 / 5–20 M€ | 180–450 / 36–90 M€ | 550–1500 / 110–300 M€ | 10 % / 12 % / 14 % |
| progression | 25–100 / 5–20 M€ | 180–450 / 36–90 M€ | 550–1500 / 110–300 M€ | 6 % / 7 % / 8 % |
| conservative | 25–150 / 5–30 M€ | 200–600 / 40–120 M€ | 750–2500 / 150–500 M€ | 6 % / 5 % / 4 % |
| growth | 25–120 / 5–24 M€ | 180–500 / 36–100 M€ | 650–2000 / 130–400 M€ | 10 % / 8 % / 6 % |
| accessible | 25–100 / 5–20 M€ | 150–400 / 30–80 M€ | 500–1500 / 100–300 M€ | 14 % / 10 % / 8 % |

Ces scénarios sont des candidats à mesurer, pas une décision préalable. Le scénario progression augmente modérément le rendement avec la taille pour compenser l’investissement et éviter que les Small dominent toujours le choix rendement/prix de l’IA. Un cours peut ensuite baisser avec les indices : les fourchettes sont des prix de base à C/C. Le terminal montre le cours effectivement calculé par le moteur.

## Simulation

Commande : `npx tsx scripts/balance-economy.ts 100 baseline 20261006 600` ; remplacer `baseline` par un nom de scénario. Les paramètres sont le nombre de parties, le scénario, la graine et la limite de temps en secondes ; un sixième argument optionnel choisit le suffixe du fichier de rapport. Le scénario baseline reprend les prix/revenus originaux archivés par identifiant sur le catalogue courant. Chaque partie reçoit sa graine `graine + numéro − 1`. `Math.random` est remplacé uniquement dans le processus de simulation et restauré ensuite. Les commandes sont choisies par l’IA existante (`chooseAiCommand`) et appliquées par l’API serveur (`executeCommand`). Aucun dé n’est imposé, aucune carte n’est supprimée. Chaque partie emploie trois fonds IA easy/normal/hard répartis initialement entre Europe, Amériques et Asie ; les déplacements restent décidés par l’IA.

Le rapport `docs/economy-simulation-<scénario>.json` contient les résultats et les graines de chaque partie. Les phases d’achat sont début = cycles 1–10, milieu = 11–50, fin = 51 et suivants. Le cycle 1 est l’ouverture sans Contexte ; le cycle 101 correspond à la 100e carte Contexte tirée, pas à 101 cartes. Une élimination peut terminer la partie plus tôt. Les instantanés sont l’ouverture et les cycles 10, 35, 70, ainsi que la fin. La durée d’une partie est sa durée de calcul et le nombre de cycles ; il ne s’agit pas du temps d’une partie humaine. Les statistiques comprennent : NAV et cash moyens, achats et parts acquises, positions et parts détenues par catégorie, revenus de secteur reçus, dividendes d’événements, insolvabilités de fonds, sorties de cote, contrôles 5/5, monopoles et première acquisition d’une Large.

Les mesures définitives de revenus de secteur excluent les versements sans entreprise associée, notamment les apports de performance de 20 M€ au Départ. Les apports et retraits de performance sont mesurés séparément par `capitalFlows`. La référence initiale et les explorations 50/250 ont été annotées car leur ancien compteur réunissait revenus de secteur et apports positifs de performance.

Les revenus de secteur et dividendes sont comptés à partir des nouvelles notifications, avant leur suppression de l’historique. Les faillites d’entreprise sont comptées comme transitions coté → indisponible, y compris une nouvelle faillite après retour en cote. Les monopoles sont comptés une fois par groupe zone × secteur. Les contrôles et monopoles sont relevés à la fin et à leur maximum durant la partie.

Pour limiter le coût des copies, **le script de simulation seulement** conserve les deux derniers points du graphique après chaque commande. Le dernier point et son numéro de séquence restent disponibles pour la déduplication. Aucun historique n’est réduit dans le moteur, le serveur ou les parties réelles. Cette optimisation a été comparée au stockage normal de 180 points sur les graines 20261006, 20261007 et 20261008 avec les trois difficultés : 724, 763 et 674 commandes, jusqu’aux cycles 64, 76 et 64. Chaque commande, chaque phase, les grades, positions, PRU, cash et avoirs, ainsi que l’état final complet hors courbe, sont identiques. Le dernier point complet du graphique est également identique. Le calcul est environ 1,5–1,9 fois plus rapide dans ce contrôle ; détails dans `docs/economy-simulation-history-check.json`.

Une partie est arrêtée après 20 000 commandes ou la limite de temps ; le rapport conserve l’erreur et indique explicitement combien de parties ont terminé. Les résultats sans capitalisation disponible utilisent la catégorie `unknown` ; les scénarios refusent de fonctionner avec un catalogue dont la recherche est incomplète.

## Résultats et choix

La référence **100/100 parties** termine sans erreur en **307 s** (3,07 s/partie). Les parties finissent en moyenne au cycle **21,36**, avec **200 fonds insolvables sur 300** : l’élimination termine les parties bien avant les 100 cartes Contexte. NAV finale moyenne **141,91 M€**, cash **26,80 M€**, versements reçus de secteur et apports positifs de performance réunis **183,62 M€/fonds**, dividendes **2,30 M€/fonds**, **13,26 achats et 32,22 parts acquises/fonds**. Les entreprises subissent **51,44 sorties de cote/partie** ; pics moyens **9,51 contrôles 5/5** et **3,72 monopoles**.

Le catalogue de cette référence est archivé dans `docs/economy-baseline-catalog.json`. Seule la recherche européenne (24 entreprises sur 91) était disponible au lancement : 67 entreprises restent `unknown` dans les statistiques de catégorie, avec les seuils expérimentaux 10/100 Md USD. Parmi ces entreprises connues, 91 parties achètent une Large et leur premier achat arrive en moyenne au cycle 1,56. Cette classification partielle n’est pas comparée directement aux catégories finales. La référence révèle surtout des revenus très élevés, des achats précoces de grands groupes et une élimination rapide.

Les explorations de 20 parties aux seuils 50/250 Md USD sont conservées dans `docs/economy-simulation-exploratory-50-250-*.json` : conservative termine au cycle moyen 76,55 avec NAV 41,96 M€, versements reçus secteur + apports positifs de performance 64,01 M€/fonds et une Large achetée dans une seule partie (cycle 56) ; growth termine au cycle 68,80 avec NAV 88,72 M€, revenu 124,99 et zéro Large ; accessible termine au cycle 52,35 avec NAV 96,69 M€, revenu 124,96 et zéro Large. Les insolvabilités sont respectivement 36, 36 et 40 sur 60 fonds. Ces variantes ralentissent les achats et l’élimination, mais leur gradient de rendement décroissant favorise excessivement les Small pour l’IA.

Les scénarios comparables de 20 parties chacun aux seuils définitifs 40/200 Md USD incluent donc une variante progression avec rendements 6 % / 7 % / 8 %. La validation finale comprend 100 parties. Les NAV des survivants, leur médiane, la médiane de tous les fonds et la NAV des gagnants sont distinguées pour rendre visible le biais des fonds insolvables à valeur faible. Aucune valeur du catalogue n’est changée avant comparaison des résultats.

### Comparaison homogène, 20 parties par grille, seuils 40/200 Md USD

Toutes les lignes suivantes utilisent les mêmes graines et le même catalogue économique, avec l’IA d’origine (`legacy-geography`). Le revenu est ici exclusivement sectoriel, et les NAV moyennes comprennent les fonds insolvables.

| Grille | Small parmi les parts achetées aux cycles 1–10 | Parties ayant acheté une Large | Cycle moyen du premier achat Large | Revenu secteur / banque, par fonds | Cycles moyens | Insolvables / 60 | NAV moyenne / survivants / gagnants |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline-corrected | 68.8 % | 18 / 20 | 4.22 | 208.98 / 85.42 M€ | 26.50 | 40 | 168.65 / 505.96 / 505.96 M€ |
| conservative | 89.1 % | 0 / 20 | — | 35.25 / 13.96 M€ | 64.40 | 35 | 43.21 / 103.47 / 121.84 M€ |
| growth | 92.8 % | 1 / 20 | 63.00 | 76.33 / 27.43 M€ | 61.10 | 39 | 78.28 / 223.66 / 234.74 M€ |
| accessible | 92.8 % | 3 / 20 | 44.00 | 108.25 / 41.45 M€ | 51.25 | 40 | 90.92 / 272.52 / 272.52 M€ |
| progression | 51.4 % | 1 / 20 | 92.00 | 49.58 / 19.71 M€ | 69.00 | 34 | 53.31 / 122.91 / 140.26 M€ |

Aucune grille normalisée n’achète de Large aux cycles 1–10. Les Large restent cependant trop rares : au maximum 3 parties sur 20 pour accessible. La médiane de tous les fonds vaut 0 dans les cinq lignes car plus de la moitié des fonds sont insolvables. Les médianes des survivants valent respectivement 409,97 ; 79,01 ; 137,69 ; 265,13 et 82,88 M€. Les groupes contrôlés et les monopoles ne sont pas supprimés : leurs pics moyens sont 10,35 / 3,50 pour la référence, 0,85 / 0,20 pour conservative, 1,85 / 0,40 pour growth, 2,95 / 1,05 pour accessible et 0,75 / 0,25 pour progression.

Les positions moyennes Small / Medium / Large par fonds de progression passent de 0,77 / 0,75 / 0 au cycle 10 à 0,67 / 0,39 / 0 au cycle 35 et 0,70 / 0,44 / 0 au cycle 70. Les nombres de parties encore observables sont 20, 18 et 9 ; les fins par élimination n’ont pas d’instantané artificiel au-delà de leur fin. La variante accessible donne 1,28 / 0,23 / 0 puis 0,81 / 0,28 / 0 puis 0,87 / 0,67 / 0, sur 20, 12 et 5 parties. La progression de taille reste donc insuffisante avant le correctif géographique expliqué ci-dessous.

## Limite observée et correction du choix de voyage de l’IA

Les simulations initiales ont identifié un frein concret : 40,85 séances par partie pour le scénario progression se terminent sans achat malgré un titre abordable dans une autre place. L’IA classait les destinations par rendement sans vérifier le prix, par exemple IBM à 56,45 M€ pour un fonds de 39,37 M€ qui doit garder 30 M€ de réserve, alors qu’Orascom à 5 M€ était disponible ailleurs. Les quatre grilles initiales et la référence corrigée sont marquées `legacy-geography` dans les rapports.

Le classement des destinations normal/hard vérifie désormais les mêmes disponibilités, interdictions E/E et réserves qu’un achat, en retirant aussi 1 M€ pour un voyage. Le bonus de rester s’applique seulement si le marché contient une entreprise abordable ; aucun candidat abordable entraîne STAY. La formule de qualité, les réserves 30/18 M€, les règles de transaction et la stratégie easy sont inchangées. Le rapport suivant est marqué `affordable-geography`, pour distinguer l’effet de ce correctif du choix des prix. Onze tests ciblés dans `tests/economy-ai.test.ts` vérifient les deux difficultés, les destinations trop chères, le coût du voyage, les cas sans candidat, les titres indisponibles/E/E/déjà entièrement détenus et un achat légal à budget exact après le voyage.

## Grille retenue et validation finale

La grille **progression-growth**, avec l’IA respectant le budget de voyage, est retenue pour le catalogue d’économie **version 3** : Small 25–100 M€ les cinq parts, Medium 180–450 M€, Large 550–1500 M€, avec revenus de base respectifs 10 % / 12 % / 14 % par arrivée sectorielle. Une part Large à l’ouverture C/C coûte donc au minimum **110 M€**, au-delà du capital initial de 100 M€. Les cours déprimés peuvent ensuite ouvrir des possibilités plus tôt ; la réserve de l’IA n’est pas une contrainte imposée à un joueur humain.

| IA respectant le budget, 20 parties | Small parmi les parts achetées cycles 1–10 | Parties ayant acheté une Large | Premier achat Large minimum / médiane / moyenne | Revenu secteur / banque par fonds | NAV survivants / gagnants | Maximum / 95e percentile de NAV |
|---|---:|---:|---:|---:|---:|---:|
| progression | 65.8 % | 2 / 20 | 42 / 56.50 / 56.50 | 40.31 / 15.27 M€ | 149.89 / 151.54 M€ | 494.93 / 302.41 M€ |
| accessible | 93.5 % | 0 / 20 | — | 167.92 / 72.15 M€ | 436.15 / 478.96 M€ | 1409.81 / 902.28 M€ |
| progression-growth | 76.0 % | 5 / 20 | 22 / 28.00 / 40.20 | 88.37 / 35.89 M€ | 254.54 / 263.11 M€ | 866.83 / 339.60 M€ |

Le choix récompense les investissements Medium et Large, tout en gardant Small majoritaire au début. Sur cet échantillon, les premières Large arrivent aux cycles 22 à 85, avec une médiane de 28, et aucune aux cycles 1–10. Le revenu sectoriel moyen est 88,37 M€/fonds et les versements de la banque 35,89 M€, contre 208,98 et 85,42 pour la référence corrigée. La création monétaire observée baisse ainsi d’environ 58 %. Le maximum et le 95e percentile de NAV restent sous la référence corrigée (1141,99 / 853,09 M€). Le scénario accessible crée davantage de richesse mais ne produit aucun achat Large avec cette IA : la rentabilité supérieure des Small y empêche la progression recherchée.

Cette sélection est prudente : ce sont **trois IA sans vente opportuniste**, pas des joueurs humains. Seulement 5 des 20 parties du screening achètent une Large. Les insolvabilités demeurent élevées (39 fonds sur 60, contre 40 dans la référence corrigée), et les positions Medium peuvent diminuer après les crises. La grille améliore l’ordre et le moment des acquisitions ; elle ne garantit pas une croissance régulière de chaque fonds ni une diminution forte de l’élimination. Les humains peuvent arbitrer leurs plus-values et prendre des risques de liquidité que cette IA conservatrice ne prend pas.

Les 100 parties finales utilisent la graine 20261006 et sont enregistrées dans `docs/economy-simulation-final-progression-growth.json`. Leur compteur distingue par stade les séances où au moins une part Large cotée et libre est achetable : dans la zone actuelle avec cash brut, avec cash diminué de la réserve IA, ou dans une autre place après 1 M€ de voyage. Une séance est comptée une fois même si plusieurs commandes d’achat sont exécutées. La disponibilité ailleurs décrit une possibilité financière après voyage ; elle ne permet pas de voyager pendant une séance déjà commencée. Les résultats définitifs sont détaillés ci-dessous.

### Résultat réel des 100 parties finales

Commande de reproduction : `npx tsx scripts/balance-economy.ts 100 progression-growth 20261006 1800 final-progression-growth`.

**100 parties demandées, 100 terminées, aucune erreur**, 64 062 commandes en **708,14 s**. Durée moyenne **60,22 cycles** (7,08 s de calcul par partie), de 26 à 101 ; **8 parties atteignent le cycle 101**, soit la 100e carte Contexte. Les autres se terminent par élimination plus tôt.

| Indicateur final | Résultat |
|---|---:|
| NAV moyenne de tous les fonds / médiane | 89,35 / 0 M€ |
| NAV moyenne / médiane des 107 fonds solvables | 250,39 / 188,25 M€ |
| NAV moyenne du gagnant | 263,32 M€ |
| NAV maximale / 95e percentile, tous fonds | 1038,42 / 471,55 M€ |
| 95e percentile des fonds solvables | 777,95 M€ |
| Cash moyen, tous fonds | 14,57 M€ |
| Revenu sectoriel reçu / versements de la banque, par fonds | 95,20 / 37,37 M€ |
| Dividendes d’événement, par fonds | 2,25 M€ |
| Apports / retraits de performance, par fonds | +22,13 / −38,67 M€ |
| Achats / parts acquises, par fonds | 11,37 / 14,83 |
| Fonds insolvables | 193 / 300 |
| Sorties de cote, par partie, retours puis nouvelles faillites inclus | 161,36 |
| Contrôles 5/5, fin / pic moyen par partie | 2,03 / 2,93 |
| Monopoles, fin / pic moyen par partie | 1,08 / 1,40 |

Les revenus sectoriels et la monnaie versée par la banque sont environ **54 % et 56 % sous la référence corrigée de 20 parties** (208,98 et 85,42 M€/fonds). Les transferts entre joueurs expliquent l’écart entre revenu reçu et création monétaire. La NAV moyenne de tous les fonds est fortement abaissée par l’insolvabilité ; les valeurs des survivants et des gagnants sont donc essentielles pour interpréter l’économie. L’insolvabilité reste proche de la référence : 64,3 % des fonds, contre 66,7 % dans la référence initiale de 100 parties et dans la référence corrigée de 20 parties.

Ce taux final dépend aussi de la règle d'arrêt : une partie à trois fonds qui se termine avec un seul fonds solvable compte nécessairement deux fonds insolvables. Comme 92 des 100 parties finales se terminent avant la 100e carte Contexte, le pourcentage final ne mesure pas à lui seul le risque économique par tour. La durée avant élimination et les trajectoires des fonds doivent être examinées avec lui ; des essais humains et d'autres compositions restent nécessaires.

**Small représente 78,12 % des parts achetées aux cycles 1–10** (1057 Small, 292 Medium, 4 Large). Les cycles 11–50 comptent 2168 / 185 / 23 parts et les cycles 51 et suivants 634 / 78 / 7. **25 parties sur 100 achètent une Large**, 34 parts au total. Le premier achat arrive au cycle médian **28**, moyen **35,92**, minimum **6** ; les trois cas précoces sont aux cycles 6, 6 et 7. Le screening de 20 parties ne les avait pas observés. Un traçage court de ces seules graines montre des cours réduits par les indices : ICBC à D/E, 52,98 M€ contre 141,27 à C/C ; IBM à C/E, 56,45 contre 112,90 ; SAP à A/E, 90,62 contre 120,83. Ces opportunités en marché déprimé ne sont pas des achats à l’ouverture C/C. Elles constituent néanmoins une **exception réelle au déroulement Small puis Medium puis Large**, conservée explicitement dans l’audit plutôt que masquée par la moyenne. Détails dans `docs/economy-simulation-early-large-cases.json`.

| Instantané | Parties encore observables | Positions Small / Medium / Large par fonds | Parts Small / Medium / Large par fonds |
|---|---:|---:|---:|
| Cycle 10 | 100 | 1,50 / 0,70 / 0,01 | 2,74 / 0,70 / 0,01 |
| Cycle 35 | 95 | 1,51 / 0,32 / 0,02 | 3,98 / 0,40 / 0,02 |
| Cycle 70 | 31 | 1,35 / 0,27 / 0,02 | 4,60 / 0,39 / 0,02 |
| Fin de chaque partie | 100 | 1,19 / 0,33 / 0,05 | 4,40 / 0,46 / 0,05 |

Les Large deviennent accessibles et sont effectivement achetées dans une partie des simulations ; elles ne deviennent pas dominantes. Les positions Medium ne croissent pas régulièrement et peuvent être perdues dans les crises. La progression observée concerne donc surtout l’accès aux prix et le moment des acquisitions, sans garantir une migration continue de chaque portefeuille vers de plus grandes entreprises.

### Accessibilité effective des Large par stade

Les valeurs suivantes sont des **séances de marché uniques sur les 100 parties**, avec au moins une part libre, entreprise disponible et indices non E/E. Une même séance peut apparaître dans plusieurs colonnes. La colonne « ailleurs » teste uniquement la capacité financière après 1 M€ de voyage ; elle ne crée aucune règle de voyage pendant le marché.

| Stade | Zone actuelle, prix ≤ cash | Zone actuelle, prix ≤ cash − réserve IA | Au moins une place après voyage, cash brut | Au moins une place après voyage et réserve IA |
|---|---:|---:|---:|---:|
| Début, cycles 1–10 | 173 | 5 | 383 | 13 |
| Milieu, cycles 11–50 | 465 | 37 | 1408 | 82 |
| Fin, cycles 51 et suivants | 148 | 12 | 461 | 39 |
| Total | 786 | 54 | 2252 | 134 |

**58 parties** ont au moins une opportunité Large quelque part après voyage et réserve IA. L’écart entre 2252 opportunités avec cash brut et 134 après réserve montre que la prudence de l’IA restreint fortement les achats. L’écart entre opportunités et acquisitions distingue une entreprise financièrement accessible d’une entreprise effectivement choisie face à des positions déjà détenues. La simulation n’établit pas que les 75 parties sans achat Large manquent toutes de moyens.

Le catalogue actuel a été contrôlé après les simulations : **91 identifiants stables, normalisation strictement identique à `normalizeEconomy(..., SELECTED_ECONOMY_BANDS)`, économie version 3**. Lors de l’application, une comparaison profonde avait garanti que seuls `basePrice`, `baseIncome`, `capCategory` et `economyVersion` changeaient ; les autres métadonnées, noms, logos et contextes étaient préservés. Les **11 tests ciblés du choix géographique** sont passés ; l’intégration globale rapporte **101 tests unitaires passés** et le contrôle TypeScript est passé. Aucun nouveau lot de 100 simulations n’a été relancé pour écrire cette analyse.

## Sauvegardes

La version d’économie `3` accompagne la nouvelle normalisation. Une sauvegarde conserve ses entreprises et leurs `basePrice`/`baseIncome` embarqués : la version de catalogue ne doit pas recalculer les prix d’une partie commencée. La recherche de marché et les nouveaux paramètres ne s’appliquent qu’aux nouvelles parties.

## Itération règlement — 7 octobre 2026

Les rapports simulés ci-dessus précèdent la nouvelle phase de clearing : sélection humaine des actifs, offres de titres à cours figé, cash symétrique et priorité NAV/siège confirmée par l’utilisateur. Les paramètres de prix/revenus ne changent pas dans cette passe. Trois parties IA terminées valident l’absence de blocage ; ce petit contrôle ne remplace pas une nouvelle campagne d’équilibrage. Ne pas attribuer les 420 comparaisons ou les 100 parties finales à cette nouvelle mécanique.
