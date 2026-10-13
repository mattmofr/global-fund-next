# Audit du nouvel équilibre du plateau

Le plateau canonique version 3 compte 52 cases, dont 39 secteurs. Market Crash est remplacé par Immobilier en case 26; les cases spéciales sont conservées : Départ 1, Bull Market 14, Bear Market 40 et dix Événements.

| Case | Type | Secteur ou case spéciale | Spéciale |
|---:|---|---|:---:|
| 1 | Départ | Départ | Oui |
| 2 | Secteur | Industrie | Non |
| 3 | Secteur | Technologie | Non |
| 4 | Événement | Événement | Oui |
| 5 | Secteur | Transports | Non |
| 6 | Secteur | Immobilier | Non |
| 7 | Secteur | Énergie | Non |
| 8 | Secteur | Communication | Non |
| 9 | Événement | Événement | Oui |
| 10 | Secteur | Finance | Non |
| 11 | Secteur | Agroalimentaire | Non |
| 12 | Secteur | Santé | Non |
| 13 | Secteur | Technologie | Non |
| 14 | Marché | Bull Market | Oui |
| 15 | Secteur | Industrie | Non |
| 16 | Secteur | Immobilier | Non |
| 17 | Événement | Événement | Oui |
| 18 | Secteur | Transports | Non |
| 19 | Secteur | Énergie | Non |
| 20 | Secteur | Finance | Non |
| 21 | Secteur | Communication | Non |
| 22 | Événement | Événement | Oui |
| 23 | Secteur | Technologie | Non |
| 24 | Secteur | Agroalimentaire | Non |
| 25 | Secteur | Santé | Non |
| 26 | Secteur | Immobilier | Non |
| 27 | Événement | Événement | Oui |
| 28 | Secteur | Industrie | Non |
| 29 | Secteur | Transports | Non |
| 30 | Secteur | Finance | Non |
| 31 | Événement | Événement | Oui |
| 32 | Secteur | Énergie | Non |
| 33 | Secteur | Technologie | Non |
| 34 | Secteur | Communication | Non |
| 35 | Secteur | Immobilier | Non |
| 36 | Événement | Événement | Oui |
| 37 | Secteur | Agroalimentaire | Non |
| 38 | Secteur | Santé | Non |
| 39 | Événement | Événement | Oui |
| 40 | Marché | Bear Market | Oui |
| 41 | Secteur | Finance | Non |
| 42 | Secteur | Industrie | Non |
| 43 | Secteur | Transports | Non |
| 44 | Événement | Événement | Oui |
| 45 | Secteur | Technologie | Non |
| 46 | Secteur | Énergie | Non |
| 47 | Secteur | Immobilier | Non |
| 48 | Secteur | Communication | Non |
| 49 | Événement | Événement | Oui |
| 50 | Secteur | Agroalimentaire | Non |
| 51 | Secteur | Santé | Non |
| 52 | Secteur | Finance | Non |

## Mesures de répartition

Le plateau compte 39 cases de secteur. Finance, Technologie et Immobilier en occupent cinq chacune; les six autres secteurs en occupent quatre. Cinq cases représentent 25 % de plus que quatre, une différence structurelle de fréquence de visite potentielle. La répartition n’établit pas une égalité exacte de rendement ou de stratégie entre les secteurs : le nombre de sociétés, leurs valeurs, leurs notes et les règles de revenu diffèrent. Aucun résultat d’équilibre économique exact n’est revendiqué sans simulation dédiée.

Les quarts de 13 cases contiennent respectivement 10, 10, 9 et 10 cases de secteur, car les positions spéciales restent fixes. Chacun contient les neuf secteurs distincts; les quarts 1, 2 et 4 ont un seul doublon, et le quart 3 n’en a pas. La suite complète est contrôlée par [le test d’équilibrage](tests/board-balance.test.ts).

Pour chaque secteur, les écarts circulaires entre occurrences, y compris celui qui traverse la case 52 vers la case 1, sont compris entre 9 et 14 cases. Aucun secteur ne se répète dans les quatre cases suivantes, avec retour circulaire inclus. Le plus grand intervalle d’un même secteur est donc 14; le plus petit est 9. Les positions du Départ et des cases spéciales ne changent pas.

## Parcours au dé uniforme

Dans le modèle simplifié où chaque lancer indépendant vaut uniformément 1 à 6 et où le pion avance depuis le Départ sans détention ni autre règle, le premier lancer ne peut atteindre que les cases 2 à 7. Il donne une probabilité de 1/6 à chacune : cinq cases de secteur et une case Événement. Il est donc impossible de visiter les neuf secteurs au premier lancer; les secteurs hors cases 2, 3, 5, 6 et 7 n’y sont pas accessibles.

Sur un parcours circulaire répété, chaque lancer avance toujours dans le même sens. Le pion franchit le Départ après environ 15,33 lancers en moyenne dans ce modèle. Franchir le Départ ne signifie pas y tomber : la probabilité d’atterrir exactement sur la case 1 lors du premier tour est d’environ 28,57 %; dans les autres parcours, le pion la dépasse. Le moteur règle le bilan de tour au franchissement. Ces mesures décrivent seulement le dé uniforme et les déplacements; la détention et les décisions de jeu changent le parcours réel.
