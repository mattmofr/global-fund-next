# Audit d’équilibrage des cartes Context

Ce document décrit le catalogue Context v4 intégré dans `packages/game-engine/legacy/data/gameData.json`. La colonne « baseline historique » reprend les expositions avant le rééquilibrage v4 (catalogue v3); elle ne décrit pas la distribution actuelle. Les cartes gardent leurs IDs, titres et types. Chaque changement reste une affectation absolue (`setGrade`) : la direction « depuis C » ne vaut que si l’axe est encore au niveau C lorsque la carte est tirée.

## Équilibre global

| Mesure | Baseline historique | Catalogue intégré v4 |
|---|---:|---:|
| Cartes | 100 | 100 |
| Cibles de grade | 190 | 360 |
| Grades A / B / C / D / E | 42 / 31 / 24 / 42 / 51 | 19 / 71 / 180 / 71 / 19 |
| Depuis C : favorables / neutres / défavorables | 73 / 24 / 93 | 90 / 180 / 90 |
| Pas de grade depuis C : amélioration / recul | 115 / 144 | 109 / 109 |
| Note moyenne (A=1 … E=5) | 3.153 | 3.000 |

La baseline historique penchait vers les grades défavorables depuis C : 115 pas favorables contre 144 pas défavorables, un solde de −29 sur 190 cibles; sa note moyenne était 3,153. Le catalogue intégré v4 équilibre les pas d’intensité à 109 de chaque côté et conserve une note moyenne de 3,000 (C). Depuis C, 90 affectations favorisent un axe, 90 le défavorisent et 180 le ramènent ou le maintiennent à C. Les grades A et E restent rares (19 chacun), tandis que B et D représentent 71 affectations chacun.

Les quotas de types restent à 35 positives, 35 négatives, 10 neutres, 10 prison et 10 régulation. La structure comprend 20 cartes à deux axes et 80 cartes à quatre axes.

## Exposition des zones et secteurs

| Zone | Baseline historique | Catalogue intégré |
|---|---:|---:|
| Amériques | 13 | 36 |
| Europe | 23 | 36 |
| Asie | 18 | 36 |
| Afrique & Moyen-Orient | 17 | 36 |
| Océanie | 19 | 36 |

| Secteur | Baseline historique | Catalogue intégré |
|---|---:|---:|
| Technologie | 15 | 20 |
| Finance | 29 | 20 |
| Industrie | 20 | 20 |
| Santé | 17 | 20 |
| Énergie | 19 | 20 |
| Immobilier & infrastructures | 0 | 20 |
| Agroalimentaire & ressources | 0 | 20 |
| Communication & médias | 0 | 20 |
| Transports & logistique | 0 | 20 |

Le catalogue intégré répartit les 180 cibles de zone à raison de 36 dans chacune des cinq zones, puis les 180 cibles de secteur à raison de 20 dans chacun des neuf secteurs. Dans la baseline v3, Immobilier, Agroalimentaire, Communication & médias et Transports n’étaient jamais ciblés; Finance représentait 29 des 100 cibles sectorielles. Chaque zone reçoit deux cibles A et deux E. Chaque secteur reçoit une cible A et une E, et ses comptes B et D sont égaux. C reste le grade le plus fréquent, mais sa part varie selon le secteur : de 8 à 12 cibles sur 20.

| Secteur | A | B | C | D | E |
|---|---:|---:|---:|---:|---:|
| Technologie | 1 | 3 | 12 | 3 | 1 |
| Finance | 1 | 4 | 10 | 4 | 1 |
| Industrie | 1 | 3 | 12 | 3 | 1 |
| Santé | 1 | 4 | 10 | 4 | 1 |
| Énergie | 1 | 4 | 10 | 4 | 1 |
| Immobilier & infrastructures | 1 | 5 | 8 | 5 | 1 |
| Agroalimentaire & ressources | 1 | 4 | 10 | 4 | 1 |
| Communication & médias | 1 | 5 | 8 | 5 | 1 |
| Transports & logistique | 1 | 4 | 10 | 4 | 1 |

## Paires miroir et rotations

Chaque paire conserve les mêmes axes et inverse les grades A↔E, B↔D, C↔C. Les cartes 11–19 et 46–54 portent sur les mêmes cibles; leurs deux grades non-C sont A et E dans chaque carte, avec l’ordre inversé entre les membres de chaque paire.

| IDs miroir | Forme | Profil depuis C |
|---|---|---|
| 1–10 ↔ 36–45 | 2 axes (1 zone, 1 secteur) | B/B ↔ D/D : mouvements modérés purs |
| 11–19 ↔ 46–54 | 4 axes (2 zones, 2 secteurs) | A, E et 2 C ↔ E, A et 2 C : rotation mixte à deux extrêmes opposés |
| 20 ↔ 55 | 4 axes (2 zones, 2 secteurs) | A, D et 2 C ↔ E, B et 2 C : rotation mixte à extrême rare |
| 21–35 ↔ 56–70 | 4 axes (2 zones, 2 secteurs) | B, D et 2 C ↔ D, B et 2 C : rotation mixte modérée |
| 71–75 ↔ 76–80 | 4 axes (2 zones, 2 secteurs) | C×4 ↔ C×4 : ancrage neutre |
| 81–85 ↔ 86–90 | 4 axes (2 zones, 2 secteurs) | B, D et 2 C ↔ D, B et 2 C : rotation mixte modérée |
| 91–95 ↔ 96–100 | 4 axes (2 zones, 2 secteurs) | B, D et 2 C ↔ D, B et 2 C : rotation mixte modérée |

Le catalogue comprend 70 rotations mixtes (dont les 18 cartes 11–19 et 46–54 qui combinent un A et un E opposés), 10 cartes favorables à deux axes, 10 cartes défavorables à deux axes et 10 cartes qui affectent quatre axes au niveau C. Les directions et intensités réelles dépendent des grades en vigueur au tirage : chaque entrée de catalogue est une valeur absolue.

## Catalogue carte par carte

Les grades ci-dessous sont les valeurs absolues écrites par la carte. Depuis C, ↑A représente deux crans favorables, ↑B un cran favorable, ↔C aucun changement, ↓D un cran défavorable et ↓E deux crans défavorables. L’intensité se lit axe par axe; la dernière colonne compte les cibles de grade.

| ID | Titre | Type | Effet zones | Effet secteurs | Direction depuis C | Intensité | Axes |
|---:|---|---|---|---|---|---|---:|
| 1 | Hausse des commandes | positive | Amériques B | Technologie B | ↑B×2 | modérée ×2 | 2 |
| 2 | Relance des infrastructures | positive | Europe B | Finance B | ↑B×2 | modérée ×2 | 2 |
| 3 | Relance budgétaire | positive | Asie B | Industrie B | ↑B×2 | modérée ×2 | 2 |
| 4 | Découverte énergétique | positive | Afrique & Moyen-Orient B | Santé B | ↑B×2 | modérée ×2 | 2 |
| 5 | Rebond manufacturier | positive | Océanie B | Énergie B | ↑B×2 | modérée ×2 | 2 |
| 6 | Dynamisme des marchés émergents | positive | Amériques B | Immobilier & infrastructures B | ↑B×2 | modérée ×2 | 2 |
| 7 | Croissance au-dessus des attentes | positive | Europe B | Agroalimentaire & ressources B | ↑B×2 | modérée ×2 | 2 |
| 8 | Percée technologique | positive | Asie B | Communication & médias B | ↑B×2 | modérée ×2 | 2 |
| 9 | Accords énergétiques | positive | Afrique & Moyen-Orient B | Transports & logistique B | ↑B×2 | modérée ×2 | 2 |
| 10 | Résultats supérieurs aux attentes | positive | Océanie B | Transports & logistique B | ↑B×2 | modérée ×2 | 2 |
| 11 | Accord commercial majeur | positive | Amériques A; Europe C | Technologie C; Finance E | ↑A×1, ↔C×2, ↓E×1 | forte ×2, neutre ×2 | 4 |
| 12 | Succès des introductions en bourse | positive | Europe A; Asie C | Finance C; Industrie E | ↑A×1, ↔C×2, ↓E×1 | forte ×2, neutre ×2 | 4 |
| 13 | Plan climat ambitieux | positive | Asie A; Afrique & Moyen-Orient C | Industrie C; Santé E | ↑A×1, ↔C×2, ↓E×1 | forte ×2, neutre ×2 | 4 |
| 14 | Amélioration du crédit | positive | Afrique & Moyen-Orient A; Océanie C | Santé C; Énergie E | ↑A×1, ↔C×2, ↓E×1 | forte ×2, neutre ×2 | 4 |
| 15 | Boom des semi-conducteurs | positive | Océanie A; Amériques C | Énergie C; Immobilier & infrastructures E | ↑A×1, ↔C×2, ↓E×1 | forte ×2, neutre ×2 | 4 |
| 16 | Accès élargi au financement | positive | Amériques A; Europe C | Immobilier & infrastructures C; Agroalimentaire & ressources E | ↑A×1, ↔C×2, ↓E×1 | forte ×2, neutre ×2 | 4 |
| 17 | Baisse surprise des taux | positive | Europe A; Asie C | Agroalimentaire & ressources C; Communication & médias E | ↑A×1, ↔C×2, ↓E×1 | forte ×2, neutre ×2 | 4 |
| 18 | Optimisme des entreprises | positive | Asie A; Afrique & Moyen-Orient C | Communication & médias C; Transports & logistique E | ↑A×1, ↔C×2, ↓E×1 | forte ×2, neutre ×2 | 4 |
| 19 | Stabilisation des devises | positive | Afrique & Moyen-Orient A; Océanie C | Transports & logistique C; Technologie E | ↑A×1, ↔C×2, ↓E×1 | forte ×2, neutre ×2 | 4 |
| 20 | Cadre réglementaire favorable | positive | Océanie A; Amériques C | Technologie C; Finance D | ↑A×1, ↔C×2, ↓D×1 | forte ×1, neutre ×2, modérée ×1 | 4 |
| 21 | Plan d'investissement public | positive | Amériques B; Europe C | Finance C; Industrie D | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 22 | Exportations agricoles dynamiques | positive | Europe B; Asie C | Industrie C; Santé D | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 23 | Partenariat public-privé | positive | Asie B; Afrique & Moyen-Orient C | Santé C; Énergie D | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 24 | Appétit pour le risque | positive | Afrique & Moyen-Orient B; Océanie C | Énergie C; Immobilier & infrastructures D | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 25 | Reprise immobilière | positive | Océanie B; Amériques C | Immobilier & infrastructures C; Agroalimentaire & ressources D | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 26 | Rebond des matières premières | positive | Amériques B; Europe C | Agroalimentaire & ressources C; Communication & médias D | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 27 | Rallye boursier | positive | Europe B; Asie C | Communication & médias C; Transports & logistique D | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 28 | Innovation médicale | positive | Asie B; Afrique & Moyen-Orient C | Transports & logistique C; Technologie D | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 29 | Amélioration de la confiance | positive | Afrique & Moyen-Orient B; Océanie C | Technologie C; Finance D | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 30 | Allègement fiscal | positive | Océanie B; Amériques C | Finance C; Industrie D | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 31 | Reprise du tourisme | positive | Amériques B; Europe C | Industrie C; Santé D | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 32 | Flux d'investissements entrants | positive | Europe B; Asie C | Santé C; Énergie D | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 33 | Accélération des exportations | positive | Asie B; Afrique & Moyen-Orient C | Énergie C; Immobilier & infrastructures D | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 34 | Records de productivité | positive | Afrique & Moyen-Orient B; Océanie C | Immobilier & infrastructures C; Agroalimentaire & ressources D | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 35 | Rebond industriel | positive | Océanie B; Amériques C | Agroalimentaire & ressources C; Communication & médias D | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 36 | Pénurie d'énergie | negative | Amériques D | Technologie D | ↓D×2 | modérée ×2 | 2 |
| 37 | Récession technique | negative | Europe D | Finance D | ↓D×2 | modérée ×2 | 2 |
| 38 | Crise industrielle | negative | Asie D | Industrie D | ↓D×2 | modérée ×2 | 2 |
| 39 | Détérioration du crédit | negative | Afrique & Moyen-Orient D | Santé D | ↓D×2 | modérée ×2 | 2 |
| 40 | Pénuries alimentaires | negative | Océanie D | Énergie D | ↓D×2 | modérée ×2 | 2 |
| 41 | Effondrement sectoriel | negative | Amériques D | Immobilier & infrastructures D | ↓D×2 | modérée ×2 | 2 |
| 42 | Crise climatique aiguë | negative | Europe D | Agroalimentaire & ressources D | ↓D×2 | modérée ×2 | 2 |
| 43 | Inflation persistante | negative | Asie D | Communication & médias D | ↓D×2 | modérée ×2 | 2 |
| 44 | Régime de change instable | negative | Afrique & Moyen-Orient D | Transports & logistique D | ↓D×2 | modérée ×2 | 2 |
| 45 | Dérive réglementaire | negative | Océanie D | Transports & logistique D | ↓D×2 | modérée ×2 | 2 |
| 46 | Fuite des capitaux | negative | Amériques E; Europe C | Technologie C; Finance A | ↑A×1, ↔C×2, ↓E×1 | forte ×2, neutre ×2 | 4 |
| 47 | Crise immobilière | negative | Europe E; Asie C | Finance C; Industrie A | ↑A×1, ↔C×2, ↓E×1 | forte ×2, neutre ×2 | 4 |
| 48 | Rupture logistique | negative | Asie E; Afrique & Moyen-Orient C | Industrie C; Santé A | ↑A×1, ↔C×2, ↓E×1 | forte ×2, neutre ×2 | 4 |
| 49 | Mauvais résultats | negative | Afrique & Moyen-Orient E; Océanie C | Santé C; Énergie A | ↑A×1, ↔C×2, ↓E×1 | forte ×2, neutre ×2 | 4 |
| 50 | Rappel massif de produits | negative | Océanie E; Amériques C | Énergie C; Immobilier & infrastructures A | ↑A×1, ↔C×2, ↓E×1 | forte ×2, neutre ×2 | 4 |
| 51 | Dérive des coûts | negative | Amériques E; Europe C | Immobilier & infrastructures C; Agroalimentaire & ressources A | ↑A×1, ↔C×2, ↓E×1 | forte ×2, neutre ×2 | 4 |
| 52 | Retrait des investisseurs | negative | Europe E; Asie C | Agroalimentaire & ressources C; Communication & médias A | ↑A×1, ↔C×2, ↓E×1 | forte ×2, neutre ×2 | 4 |
| 53 | Changement politique brusque | negative | Asie E; Afrique & Moyen-Orient C | Communication & médias C; Transports & logistique A | ↑A×1, ↔C×2, ↓E×1 | forte ×2, neutre ×2 | 4 |
| 54 | Stress de liquidité | negative | Afrique & Moyen-Orient E; Océanie C | Transports & logistique C; Technologie A | ↑A×1, ↔C×2, ↓E×1 | forte ×2, neutre ×2 | 4 |
| 55 | Confiance en berne | negative | Océanie E; Amériques C | Technologie C; Finance B | ↑B×1, ↔C×2, ↓E×1 | modérée ×1, neutre ×2, forte ×1 | 4 |
| 56 | Déficit budgétaire record | negative | Amériques D; Europe C | Finance C; Industrie B | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 57 | Hausse des taux brutale | negative | Europe D; Asie C | Industrie C; Santé B | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 58 | Sanctions économiques | negative | Asie D; Afrique & Moyen-Orient C | Santé C; Énergie B | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 59 | Choc pétrolier | negative | Afrique & Moyen-Orient D; Océanie C | Énergie C; Immobilier & infrastructures B | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 60 | Faillite bancaire | negative | Océanie D; Amériques C | Immobilier & infrastructures C; Agroalimentaire & ressources B | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 61 | Guerre commerciale | negative | Amériques D; Europe C | Agroalimentaire & ressources C; Communication & médias B | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 62 | Chute des devises | negative | Europe D; Asie C | Communication & médias C; Transports & logistique B | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 63 | Grève générale | negative | Asie D; Afrique & Moyen-Orient C | Transports & logistique C; Technologie B | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 64 | Affaiblissement des exportations | negative | Afrique & Moyen-Orient D; Océanie C | Technologie C; Finance B | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 65 | Échec de négociations | negative | Océanie D; Amériques C | Finance C; Industrie B | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 66 | Cyberattaque systémique | negative | Amériques D; Europe C | Industrie C; Santé B | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 67 | Krach boursier | negative | Europe D; Asie C | Santé C; Énergie B | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 68 | Désordre politique | negative | Asie D; Afrique & Moyen-Orient C | Énergie C; Immobilier & infrastructures B | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 69 | Crise de la dette | negative | Afrique & Moyen-Orient D; Océanie C | Immobilier & infrastructures C; Agroalimentaire & ressources B | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 70 | Volatilité extrême | negative | Océanie D; Amériques C | Agroalimentaire & ressources C; Communication & médias B | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 71 | Flux commerciaux stables | neutral | Amériques C; Europe C | Communication & médias C; Transports & logistique C | ↔C×4 | neutre ×4 | 4 |
| 72 | Marchés prudents | neutral | Europe C; Asie C | Transports & logistique C; Technologie C | ↔C×4 | neutre ×4 | 4 |
| 73 | Volatilité contenue | neutral | Asie C; Afrique & Moyen-Orient C | Technologie C; Finance C | ↔C×4 | neutre ×4 | 4 |
| 74 | Rééquilibrage régional | neutral | Afrique & Moyen-Orient C; Océanie C | Finance C; Industrie C | ↔C×4 | neutre ×4 | 4 |
| 75 | Transition ordonnée | neutral | Océanie C; Amériques C | Industrie C; Santé C | ↔C×4 | neutre ×4 | 4 |
| 76 | Stabilisation des marchés | neutral | Amériques C; Europe C | Communication & médias C; Transports & logistique C | ↔C×4 | neutre ×4 | 4 |
| 77 | Pause réglementaire | neutral | Europe C; Asie C | Transports & logistique C; Technologie C | ↔C×4 | neutre ×4 | 4 |
| 78 | Indicateurs contrastés | neutral | Asie C; Afrique & Moyen-Orient C | Technologie C; Finance C | ↔C×4 | neutre ×4 | 4 |
| 79 | Attentisme monétaire | neutral | Afrique & Moyen-Orient C; Océanie C | Finance C; Industrie C | ↔C×4 | neutre ×4 | 4 |
| 80 | Neutralité budgétaire | neutral | Océanie C; Amériques C | Industrie C; Santé C | ↔C×4 | neutre ×4 | 4 |
| 81 | Détournement de fonds | prison | Amériques B; Europe C | Santé C; Énergie D | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 82 | Créances inexpliquées | prison | Europe B; Asie C | Énergie C; Immobilier & infrastructures D | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 83 | Fuite d'informations confidentielles | prison | Asie B; Afrique & Moyen-Orient C | Immobilier & infrastructures C; Agroalimentaire & ressources D | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 84 | Soupçons d'abus de marché | prison | Afrique & Moyen-Orient B; Océanie C | Agroalimentaire & ressources C; Communication & médias D | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 85 | Perte dissimulée | prison | Océanie B; Amériques C | Communication & médias C; Transports & logistique D | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 86 | Conflit d'intérêts | prison | Amériques D; Europe C | Santé C; Énergie B | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 87 | Manipulation de marché présumée | prison | Europe D; Asie C | Énergie C; Immobilier & infrastructures B | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 88 | Enquête pour délit d'initié | prison | Asie D; Afrique & Moyen-Orient C | Immobilier & infrastructures C; Agroalimentaire & ressources B | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 89 | Fraude comptable révélée | prison | Afrique & Moyen-Orient D; Océanie C | Agroalimentaire & ressources C; Communication & médias B | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 90 | Blanchiment présumé | prison | Océanie D; Amériques C | Communication & médias C; Transports & logistique B | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 91 | Démantèlement d'un conglomérat | regulation | Amériques B; Europe C | Transports & logistique C; Technologie D | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 92 | Supervision accrue des monopoles | regulation | Europe B; Asie C | Technologie C; Finance D | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 93 | Examen de concentration | regulation | Asie B; Afrique & Moyen-Orient C | Industrie C; Santé D | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 94 | Garde-fous sectoriels | regulation | Afrique & Moyen-Orient B; Océanie C | Énergie C; Immobilier & infrastructures D | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 95 | Encadrement des acquisitions | regulation | Océanie B; Amériques C | Agroalimentaire & ressources C; Communication & médias D | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 96 | Durcissement des règles concurrentielles | regulation | Amériques D; Europe C | Transports & logistique C; Technologie B | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 97 | Contrôle des prix | regulation | Europe D; Asie C | Technologie C; Finance B | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 98 | Limitation des positions dominantes | regulation | Asie D; Afrique & Moyen-Orient C | Industrie C; Santé B | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 99 | Action antitrust renforcée | regulation | Afrique & Moyen-Orient D; Océanie C | Énergie C; Immobilier & infrastructures B | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |
| 100 | Surveillance des plateformes | regulation | Océanie D; Amériques C | Agroalimentaire & ressources C; Communication & médias B | ↑B×1, ↔C×2, ↓D×1 | modérée ×2, neutre ×2 | 4 |

Les descriptions narratives des IDs 11–19 et 46–54 ont été alignées sur leurs grades absolus intégrés. Les résultats de séance indiquent les notes réellement avant/après, qui peuvent différer de la direction calculée depuis C.
