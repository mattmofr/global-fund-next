# Simulation de l’équilibre des cartes

Résultats détaillés dans [docs/card-balance-simulation.json](docs/card-balance-simulation.json). Les deux campagnes appellent les actions du moteur mutable CJS; les résolutions ne rejouent pas manuellement les grades.

## Méthode et exposition contrôlée

- Contextes : 10 000 decks indépendants de 100 cartes (1 000 000 résolutions), via core.applyAction(state, playerId, nextTurn). L’action appelle drawContext, bankruptCompanies, marketImpacts et produit les notices habituelles. Le shuffle d’usine et son ordre sont conservés; chaque deck est consommé dans son ordre initial.
- Portefeuille Context expérimental : 91 sociétés, une action détenue par chacun des 2 fonds, 182 actions au total; 1 000 000 M€ de liquidités par fonds. Ce portefeuille dense et les liquidités élevées isolent les effets de fermeture/liquidation; ils ne représentent pas une partie normale.
- Événements de plateau : 1 000 scénarios de 100 lancers réels (100 000 événements), avec deux actions de chaque société détenues par le fonds actif, aucune action chez les autres fonds et les mêmes liquidités élevées. Le premier appel RNG fournit un dé de 1 pour atteindre une case événement; les appels suivants, le choix zone/société et les remélanges suivent le flux pseudo-aléatoire seedé. Les effets font évoluer le portefeuille entre tirages.
- Aucun achat, revenu de secteur ni choc de marché n’intervient. Les lancers atterrissent sur une case événement. Les mises à jour Context n’interviennent pas pendant la campagne événements; les grades et l’ordre du deck Context sont contrôlés après chaque événement.
- Les séquences événements comptent les remises en prison et réinitialisent seulement la détention et la zone de départ avant le tirage suivant. À 100 tirages pour un deck de 50 cartes, chaque séquence consomme le deck initial puis effectue un remélange exact. Le script vérifie à chaque tirage que deck + défausse contiennent une fois chaque ID du catalogue et que l’ordre courant est respecté avant épuisement.

## Fréquences finales par entité

Indice moyen : A=0, B=1, C=2, D=3, E=4. Les colonnes A à E donnent la part des séquences où l’entité termine avec cette note.

| Entité | A | B | C | D | E | Indice moyen (A=0…E=4) |
|---|---:|---:|---:|---:|---:|---:|
| Amériques (americas) | 5.8% | 19.2% | 50.2% | 19.2% | 5.6% | 1.995 |
| Europe (europe) | 5.4% | 19.0% | 49.8% | 20.1% | 5.8% | 2.018 |
| Asie (asia) | 5.5% | 18.7% | 50.8% | 19.3% | 5.8% | 2.011 |
| Afrique & Moyen-Orient (africa) | 5.2% | 19.2% | 51.1% | 19.5% | 5.0% | 1.997 |
| Océanie (oceania) | 5.5% | 20.4% | 49.2% | 19.4% | 5.6% | 1.992 |
| Technologie (technology) | 4.6% | 14.9% | 61.3% | 14.8% | 4.5% | 1.997 |
| Finance (finance) | 4.8% | 19.3% | 51.4% | 19.7% | 4.8% | 2.006 |
| Industrie (industry) | 5.1% | 14.3% | 59.9% | 15.9% | 4.8% | 2.008 |
| Santé (health) | 5.0% | 20.6% | 50.1% | 19.6% | 4.9% | 1.988 |
| Énergie (energy) | 4.9% | 20.2% | 50.0% | 20.1% | 4.8% | 1.998 |
| Immobilier & infrastructures (realestate) | 5.0% | 25.8% | 39.9% | 24.9% | 4.5% | 1.981 |
| Agroalimentaire & ressources (agrifood) | 5.1% | 19.5% | 50.0% | 20.3% | 5.0% | 2.005 |
| Communication & médias (media) | 5.1% | 24.2% | 40.5% | 25.3% | 4.9% | 2.005 |
| Transports & logistique (transport) | 5.0% | 19.4% | 50.4% | 19.9% | 5.3% | 2.011 |

Moyenne de l’indice final sur les entités : zones **2.003**, secteurs **2.000**.

## Évolution temporelle des notes

Fréquences en pourcentage A / B / C / D / E, agrégées sur toutes les séquences et les entités de l’axe.

| Cartes appliquées | Zones A/B/C/D/E | Secteurs A/B/C/D/E |
|---:|---|---|
| 0 | 0.0% / 0.0% / 100.0% / 0.0% / 0.0% | 0.0% / 0.0% / 100.0% / 0.0% / 0.0% |
| 10 | 5.5% / 19.4% / 50.3% / 19.2% / 5.6% | 4.5% / 18.3% / 54.8% / 17.9% / 4.5% |
| 25 | 5.6% / 19.6% / 49.9% / 19.3% / 5.6% | 5.0% / 19.9% / 50.2% / 19.9% / 5.0% |
| 50 | 5.7% / 19.6% / 49.7% / 19.7% / 5.3% | 4.8% / 20.0% / 50.3% / 20.0% / 5.0% |
| 75 | 5.8% / 19.0% / 50.0% / 19.5% / 5.6% | 5.0% / 19.9% / 50.2% / 19.8% / 5.1% |
| 100 | 5.5% / 19.3% / 50.2% / 19.5% / 5.5% | 5.0% / 19.8% / 50.4% / 20.0% / 4.8% |

## Transitions et dispersion

| Axe | Progressions | Baisses | Stables |
|---|---:|---:|---:|
| Zones | 616 465 | 616 407 | 567 128 |
| Secteurs | 614 787 | 614 383 | 570 830 |

Dispersion transversale moyenne (écart-type des 14 notes) : **0.846** niveaux. Écart moyen zone-secteur sur les 91 sociétés : **0.937** niveaux. Déplacement absolu moyen par axe et carte : **0.251**. Exposition moyenne à E/E : **0.205 sociétés par étape**.

## Fermetures, liquidations et retours

Fermetures E/E : **99 303**; fermetures qui ont liquidé des actions détenues : **97 448**; actions liquidées : **194 896**; liquidités effectivement versées : **4026110.87 M€**; retours après sortie de E/E : **97 185**.
Les secteurs ont terminé A=4.96%, E=4.82% des observations finales. Le benchmark v3 avait montré zéro fermeture E/E : aucune carte ne ciblait A/E sur un secteur. Neuf paires miroir ont rétabli ces extrêmes rares. La v4 mesurée conserve C dans environ 50 % des observations finales, avec une moyenne proche de 2 (C) sur zones et secteurs. Les notes ne dérivent pas mécaniquement vers A ou E.

## Événements de plateau : activité, cibles et effets économiques

Catalogue source : 50 cartes; catégories favorables 19, mixtes 12, défavorables 19; 5 cartes sans secteur cible. Les fréquences observées sur 100 000 tirages sont 38000 favorables, 24000 mixtes et 38000 défavorables. Effets exécutés : fine 18000, forcedSale 6000, dividend 14000, marginCall 10000, cash 18000, regulation 18000, buyback 12000, prison 4000.

| Catégorie du catalogue | Tirages | NAV positive | NAV neutre | NAV négative | Delta cash actif (M€) | Actions actives gagnées/perdues |
|---|---:|---:|---:|---:|---:|---:|
| favorable | 38 000 | 38 000 | 0 | 0 | 671849.59 | -12 000 |
| mixed | 24 000 | 18 000 | 6 000 | 0 | 18000.00 | 0 |
| unfavorable | 38 000 | 0 | 0 | 38 000 | 572094.27 | -8 000 |

Au total, NAV active positive **56 000**, neutre **6 000**, négative **38 000**; delta cash cumulé de l’exposition active **1261943.86 M€**. Le cash seul ne mesure pas la valeur : ventes forcées et rachats peuvent échanger des actions contre des liquidités; le classement NAV compare la valeur du fonds avant/après chaque carte.

Remélanges vérifiés : **1 000**; checks de partition : **100 000**; détentions réinitialisées après prison : **3 960**. Répétitions de cible immédiates : 864; cibles revenues dans les quatre précédentes : 3309; règle de cooldown vérifiée dans une zone avec alternative fraîche : 96691/96691. La sélection de zone reste prioritaire; un répétition locale est admise lorsqu’il n’existe pas de cible fraîche dans la zone choisie.

| Zone / secteur cible | Technologie | Finance | Industrie | Santé | Énergie | Immobilier & infrastructures | Agroalimentaire & ressources | Communication & médias | Transports & logistique |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Amériques | 3 278 | 2 364 | 2 744 | 3 478 | 2 199 | 0 | 4 010 | 2 184 | 2 549 |
| Europe | 2 176 | 2 173 | 2 963 | 3 883 | 2 291 | 0 | 3 833 | 2 074 | 2 747 |
| Asie | 3 287 | 2 480 | 2 851 | 0 | 2 231 | 3 253 | 0 | 2 128 | 2 616 |
| Afrique & Moyen-Orient | 0 | 2 257 | 0 | 0 | 2 362 | 4 415 | 0 | 2 676 | 0 |
| Océanie | 2 309 | 2 302 | 2 787 | 3 450 | 2 216 | 3 297 | 3 077 | 2 295 | 2 765 |

## Reproductibilité et limites

Commande : npx tsx scripts/simulate-card-balance.ts 10000 1000 20261013. La graine, les empreintes SHA-256 du moteur, des catalogues et du script, les empreintes des ordres mélangés et les observations sont consignées dans le JSON. Durée totale : 1248.93 s.
Les événements sont mesurés dans une exposition contrôlée avec deux actions initiales par société; les effets de carte modifient ensuite les détentions et la détention après prison est remise à zéro entre observations, avec compteur explicite. La campagne Context conserve les changements de grades et les liquidations au fil des 100 cartes. Les résultats décrivent ces scénarios déterministes et ne prédisent pas les résultats d’une partie ordinaire.

Les 40 parties IA jouables de référence et les 40 parties avec économie v4, incluant revenus sectoriels, Bull/Bear, transactions, prisons et insolvabilités, sont mesurées séparément dans [ECONOMY_BALANCING.md](ECONOMY_BALANCING.md). Elles ne sont pas assimilées au portefeuille dense de stress ci-dessus.
