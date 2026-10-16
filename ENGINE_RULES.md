# Global Fund Evolve — règles du plateau et des chocs de marché

Règles de la version active : plateau et paquet Événement v3, catalogue Context v4, chocs de marché v2. Cette itération équilibre les cases sectorielles, les Événements et les Contextes. L'analyse initiale reste dans [ENGINE_AUDIT.md](ENGINE_AUDIT.md).

## Position canonique de Bear Market

**Bear Market est en case 40**, soit l'**indice 39** du tableau moteur indexé à partir de zéro.

| Case | Indice moteur | Contenu final | Contenu historique |
|---|---:|---|---|
| 14 | 13 | Bull Market | Bull Market |
| 26 | 25 | Immobilier | Market Crash |
| 39 | 38 | Événement | Bear Market avant v2 |
| **40** | **39** | **Bear Market** | Événement avant v2 |

Le plateau conserve **52 cases**, dont **39 secteurs**, **10 Événements**, **2 marchés** et **1 Départ**. Technologie, Finance et Immobilier ont cinq cases, les six autres secteurs quatre. Les neuf secteurs sont présents dans chacun des quatre quarts de treize cases ; deux cases du même secteur sont séparées de 9 à 14 positions, y compris à la jonction 52/1. Le tableau complet et les limites de l'équilibre spatial figurent dans [BOARD_BALANCE_AUDIT.md](BOARD_BALANCE_AUDIT.md).

Le référentiel actif est [gameData.json](packages/game-engine/legacy/data/gameData.json). Bull et Bear portent `marketEffect: bull|bear`. **Aucune case officielle ne déclenche Crash.** Sa règle reste reconnue pour les plateaux personnalisés et ses anciennes notifications restent lisibles.

## Analyse des effets précédents

Bull et Bear tiraient au hasard une portée — toutes les zones ou tous les secteurs — puis amélioraient/dégradaient cette portée d'un seul niveau. À C/C, les prix changeaient de **+25 % / −25 %**. Quand les notes de départ étaient uniformes, toutes les entreprises subissaient le même facteur : l'effet différenciait peu les portefeuilles ou les destinations. Le tirage de portée rendait aussi les cibles difficiles à prévoir.

La règle finale renforce une zone identifiable tout en gardant un mouvement commun. Elle utilise les indices existants, sans nouveau multiplicateur, bonus de cash, prélèvement exceptionnel ou règle de transaction.

## Règles finales de Bull et Bear

La **zone renforcée est le marché où se trouve le fonds actif au moment de son arrivée sur la case**. Il s'agit de son implantation actuelle, pas de son marché initial, ni du portefeuille inspecté à l'écran, ni d'une cible tirée au hasard.

| Effet | Toutes les autres zones | Zone du fonds actif | Secteurs |
|---|---|---|---|
| **Bull Market** | Amélioration de **1 niveau** | Amélioration de **2 niveaux au total** | Inchangés |
| **Bear Market** | Dégradation de **1 niveau** | Dégradation de **2 niveaux au total** | Inchangés |

L'ordre des notes est **A, B, C, D, E**, de la meilleure à la pire. Toute variation est bornée à A/E. Le choc n'utilise **aucun tirage aléatoire de cible ou d'intensité** ; seul le dé de déplacement reste aléatoire et décidé par le serveur.

Les nouveaux indices affectent immédiatement les cours et les revenus de toutes les entreprises concernées, pour tous leurs détenteurs. Le choc n'est pas un avantage ou une amende réservés au joueur ayant lancé le dé. Les notes restent à leur nouvelle valeur jusqu'à un autre effet moteur : il n'y a ni durée cachée, ni retour automatique.

### Importance et symétrie

Les deux effets ont la même portée et la même amplitude en niveaux, avec un signe opposé. À partir de C, leur variation de prix est aussi symétrique :

| Entreprises, depuis C/C | Bull | Bear |
|---|---|---|
| Dans la zone active | Zone C → A, prix **×1,50 (+50 %)** | Zone C → E, prix **×0,50 (−50 %)** |
| Dans les autres zones | Zone C → B, prix **×1,25 (+25 %)** | Zone C → D, prix **×0,75 (−25 %)** |

Les facteurs A/B/C/D/E sont **1,50 / 1,25 / 1 / 0,75 / 0,50**. Une part vaut `basePrice / 5 × facteur_zone × facteur_secteur`, arrondie au centième de M€. Hors C et près des bornes, les pourcentages ne sont pas universellement ±25/±50 : ils dépendent des notes initiales. Les arrondis peuvent aussi produire un petit écart sur le cours affiché.

| Note initiale de zone | Bull, autre zone | Bull, zone active | Bear, autre zone | Bear, zone active |
|---|---|---|---|---|
| A | A | A | B | C |
| B | A | A | C | D |
| C | B | A | D | E |
| D | C | B | E | E |
| E | D | C | E | E |

Une note déjà à la borne peut donc rester stable. Le choc ne franchit jamais les limites du système pour garantir artificiellement un changement.

### Conséquences stratégiques

Deux portefeuilles de valeur proche, exposés à des zones différentes, peuvent inverser leur classement. Depuis C/C, un fonds avec 100 M€ de titres de la zone active dépasse après Bull un fonds avec 110 M€ de titres d'une autre zone : **150 contre 137,50 M€**. Avec Bear, un fonds exposé à 110 M€ dans la zone active passe derrière un fonds exposé à 100 M€ ailleurs : **55 contre 75 M€**. Ces exemples supposent des sociétés disponibles et aucun cash.

Le marché où le fonds s'implante **avant le dé** devient donc un choix tactique visible. Bull valorise davantage les titres de cette zone et les rend plus chers ; Bear les déprécie davantage, ce qui peut ouvrir des possibilités d'achat tout en réduisant les portefeuilles déjà exposés. Les Contextes continuent à modifier les notes sectorielles ; les autres règles gardent leur rôle.

## Limites et liquidations

- Bull/Bear ne débitent pas directement le cash et n'en distribuent pas directement. Ils ne confisquent aucun titre et n'emprisonnent personne.
- Les planchers de revenu existants sont conservés : contrôle 5/5 au minimum C/C, monopole complet au minimum A/A. Ils ne garantissent pas le cours des titres ni la survie d'une société E/E.
- **Bear peut provoquer une faillite si une zone devient E et que le secteur de la société est déjà E.** La règle E/E existante rembourse les participations à leur valeur E/E (`basePrice / 5 × 0,50 × 0,50` par part), efface participations/PRU, puis ferme la société.
- Une liquidation ne paie qu'une fois. Une société déjà fermée ne verse pas un second remboursement lors d'un autre Bear.
- Bull peut rouvrir une société E/E en améliorant sa zone. Les anciennes parts ne sont pas restituées : elles ont déjà été remboursées ; la société redevient achetable.
- Un choc ne déclare pas un fonds insolvable à cause de la seule baisse de sa NAV. Les dettes et l'insolvabilité conservent leurs mécanismes existants. L'exposition préalable peut néanmoins provoquer des pertes importantes et plusieurs liquidations.
- Un Bull suivi d'un Bear n'annule pas forcément toute conséquence : les bornes et les liquidations empêchent cette réversibilité.

Ces limites évitent un prélèvement instantané destructeur et la dégradation simultanée des deux axes par Bull/Bear. Elles ne rendent pas Bear inoffensif : les secteurs déjà en E constituent un risque connu avant le dé.

## Événements et Contextes

Bull et Bear ne consomment **ni Contexte ni Événement**. Ils ne changent ni le cycle, ni l'ordre des fonds, ni le nombre de parts émises. Ils conservent l'ouverture à C/C et n'altèrent pas les prix/revenus de base du catalogue de 91 sociétés.

Les **50 Événements** agissent sur les espèces, les titres, les rachats, amendes, primes et monopoles. **Ils n'affectent aucune note de zone ou de secteur et ne consomment pas le deck Contexte.** Le catalogue garde les identifiants et titres : 45 cartes sectorielles, cinq par secteur (deux favorables, deux défavorables, une mixte), plus cinq globales, soit **19 favorables / 19 défavorables / 12 mixtes**, dont trois neutres sans transfert. Une carte apparaît une fois par paquet de 50 ; le paquet est remélangé après épuisement.

La cible est choisie parmi les sociétés disponibles du secteur visé : participations du fonds actif prioritaires, sinon titres détenus par un fonds, sinon toutes les sociétés admissibles. Une zone est tirée uniformément parmi celles du pool, puis une entreprise de cette zone. Les quatre dernières entreprises ciblées sont exclues s'il reste une autre candidate dans la zone ; sinon une répétition est permise. Les zones dépourvues d'entreprises dans un secteur ne peuvent pas être visées par ses cartes. La matrice, les intensités, les effets conditionnels et les limites figurent dans [EVENT_BALANCE_AUDIT.md](EVENT_BALANCE_AUDIT.md).

Les **100 Contextes** affectent directement des grades **absolus**, sans ajouter de mécanisme de variation. Une cible B peut donc baisser depuis A, monter depuis D ou rester B. Depuis C, le catalogue v4 contient **70 rotations mixtes**, **10 cartes favorables à deux axes**, **10 cartes défavorables à deux axes** et **10 cartes ramenant leurs quatre axes à C**. Les cartes affectent deux ou quatre axes, avec 36 cibles par zone et 20 par secteur. Les 360 affectations comprennent **A 19 / B 71 / C 180 / D 71 / E 19**, équilibrées en 50 paires miroir; chaque zone reçoit deux A et deux E. Chaque secteur reçoit une cible A et une E, avec autant de B que de D; C est modal et varie de 8 à 12 cibles par secteur. Le détail des marges est dans [CONTEXT_BALANCE_AUDIT.md](CONTEXT_BALANCE_AUDIT.md). Les quotas de types sont conservés (35 positives, 35 négatives, 10 neutres, 10 prison, 10 régulation). Les types prison et régulation sont des catégories narratives : ils ne déclenchent ni détention ni vente imposée.

Cette symétrie ne garantit pas une égalité de NAV ou de gains : les notes initiales, les bornes, les participations, les E/E et l'ordre des cartes influencent le résultat. La couverture, chaque carte et les définitions d'intensité sont dans [CONTEXT_BALANCE_AUDIT.md](CONTEXT_BALANCE_AUDIT.md). Les simulations mesurent les grades réellement atteints, pas uniquement les affectations théoriques.

Le résultat est diffusé dans une notification avec la case résolue, le fonds actif, les notes avant/après, les variations de cours/NAV et les liquidations éventuelles. Après la lecture de la carte, les animations de notes et de cours se terminent automatiquement, sans notification finale ni bouton « Valider les cours ». La lecture des cartes, le dé et le déplacement gardent leur séquencement.

## Lecture des valeurs dans le portefeuille

La fiche affiche la note du secteur et de la zone de l’entreprise, ainsi que le revenu potentiel **par part de 20 %**, reçu lorsqu’un autre fonds s’arrête sur le secteur. En détention, le versement revient à la banque. Le bouton « Abaque prix/revenu » ouvre les 25 combinaisons zone × secteur et met en évidence les notes actuelles, sans exécuter d’ordre.

Le prix indicatif d’une part vaut `basePrice / 5 × facteurZone × facteurSecteur`; le revenu repose sur `baseIncome / 5` avec les mêmes facteurs (A=1,5; B=1,25; C=1; D=0,75; E=0,5). Les bases enregistrées dans la sauvegarde sont utilisées. Le revenu conserve le plancher C/C lorsqu’une société est contrôlée à 5/5 et le plancher A/A pour le détenteur du monopole zone × secteur. Les arrondis reproduisent ceux du moteur; les tests comparent chaque combinaison aux fonctions canoniques. E/E signifie liquidation : la valeur affichée est indicative et non négociable, le revenu devient nul et les planchers ne protègent pas les titres.

## Lobby en ligne

Le lobby online v2 crée une salle et son code avant la sélection du marché initial; les cinq marchés canoniques sont les seules options, et plusieurs humains peuvent choisir le même. L’hôte gère 2 à 6 places, les IA et leur difficulté. Chaque humain édite son propre nom, pion et marché; une modification effective remet son état Prêt à faux. Le marché IA est réparti automatiquement.

L’hôte peut lancer quand au moins deux participants sont présents, configurés et prêts. Une place distante absente est omise uniquement par une action explicite; les participants restants doivent satisfaire les mêmes conditions et rester au moins deux. Les IDs des sièges retenus et les clés d’historique ne sont pas renumérotés. La session restaure le même siège, son état Prêt et ses préférences.

Les mutations sont sérialisées par salle et sauvegardées avant commit et diffusion. PostgreSQL écrit la ligne de salle; le stockage fichier applique des écritures séquencées et un renommage atomique. Le parcours local historique demeure disponible. Les salons historiques gardent leur adaptateur de nationalité; online v2 n’en accepte pas. Voir [LOBBY_RULES.md](LOBBY_RULES.md) pour les validations et cas de compatibilité.

## Parties déjà sauvegardées

`boardLayoutVersion = 3`, `cardRulesVersion = 4` et `marketRulesVersion = 2` identifient les règles actuelles. La migration reconnaît l'**ordre complet des 52 cases officielles** v1/v2 avant de remplacer le plateau par v3. Elle est idempotente.

- Les positions numériques des fonds restent identiques : aucun pion n'avance ou ne recule et aucune ancienne arrivée n'est rejouée.
- Les portefeuilles, PRU, cash, indices, historiques et règlements en attente restent conservés. Les Contextes encore à tirer et les Événements en défausse sont remplacés par leur catalogue courant selon leur identifiant, sans modifier leur ordre ni leur nombre. Les cartes personnalisées inconnues, le Contexte déjà révélé et les notifications restent tels que résolus.
- Les notifications historiques gardent leur position et leur résultat, et conservent une identité de case figée. Une ancienne arrivée sur Bear en indice 38 reste lue comme un Bear ; une ancienne arrivée Crash en indice 25 reste un Crash historique même si la case contient désormais Immobilier.
- La vue publique est migrée sur une copie ; la sauvegarde du nouvel état se fait lors de la prochaine commande validée.
- Les plateaux personnalisés et les anciens plateaux non reconnus ne sont pas réordonnés automatiquement. Une case de marché personnalisée sans identité connue conserve son ancien comportement.
- Une version de plateau/règles supérieure à celles prises en charge n'est pas abaissée ; ses commandes sont refusées plutôt que réinterprétées.

L’itération précédente du plateau n’a modifié aucun composant visuel, style, layout, HUD, asset ou animation. La présentation (`CardScene.tsx`) lit déjà l’identité figée des notifications historiques.

## Vérifications des références

Les moteurs et simulations utilisent les cases du référentiel ou des recherches par label/type. Aucun indice Bear codé en dur n'a été trouvé dans les fixtures existantes. Les assets et labels graphiques suivent les données du plateau. Les nouveaux tests fixent explicitement **Bear = indice 39 / case 40**, Événement = indice 38, Bull = 13 et Immobilier = 25, sans Crash officiel.

Les copies de catalogue sous `docs/company-catalog-v1.json`, `docs/economy-baseline-catalog.json` et les anciens rapports de simulation sont historiques ; ils ne sont pas réécrits. La comparaison avant/après et la migration ne modifient pas l'archive V2.

## Validation et mesure

Les tests de moteur vérifient le plateau, l'espacement circulaire, les marges des decks, les effets réels sur participations et espèces, l'absence d'effet Événement sur les grades, les rotations Contexte, les bornes, les migrations et les règles Bull/Bear. Les tests serveur couvrent diffusion, persistance et déduplication des commandes.

Commande de simulation reproductible :

```sh
npx tsx scripts/simulate-board-decks.ts 20 20261013 600
```

[board-deck-simulation.json](docs/board-deck-simulation.json) contient une campagne archivée avec les empreintes de ses sources. [board-deck-validation.json](docs/board-deck-validation.json) rassemble les validations de la livraison plateau v3, antérieure au catalogue Context v4. Les mesures de campagne et de deck ci-dessous datent du catalogue Context v3; elles ne constituent pas une validation statistique du catalogue actuel. La commande ci-dessus relance la simulation avec les règles présentes dans le workspace. Les rapports `market-shock-*` conservent la mesure historique du plateau précédent avec Crash ; ils ne décrivent pas le plateau v3.

La campagne archivée termine **20/20 parties**, sans erreur, avec **68 Bull, 64 Bear et 0 Crash**. Ses 2 000 paquets de Contextes v3 gardent des notes moyennes proches de C après 100 tirages : écart −0,0142 niveau pour les zones et −0,0012 pour les secteurs. Les parties comportent 716 Événements et 1 426 Contextes, avec des mouvements dans les deux directions et des rotations de classement. Aucun E/E n'est observé dans cet échantillon ; 34 fonds sur 60 finissent insolvables selon les règles de dettes existantes. Ces résultats historiques attestent l'exécution de la version simulée, pas les marges ou le comportement statistique du catalogue Context v4.

Validation historique de la livraison plateau v3 : **174 tests**, TypeScript, build et parcours navigateur passent. La release `20261012T222344Z-board-decks-v3` est en ligne sur [Evolve](https://global-fund-evolve.213.199.40.67.sslip.io). Ces vérifications précèdent Context v4 et ne valent pas validation de son catalogue. Reprise ancienne partie, migration des cartes et vrai lancer de dé avaient été vérifiés en HTTPS/WebSocket ; nouvelle partie jouable et achat confirmé. L’archive V2, ses configurations et son service restent inchangés.

## Entreprises et économie v4

Les nouvelles parties utilisent 91 sociétés : **31 Small / 24 Medium / 36 Large**. Onze sociétés cotées remplacent des entrées dans les mêmes zones et secteurs, en conservant les identifiants internes hérités. Les cinq marchés offrent respectivement 7 / 5 / 6 / 6 / 7 Small; les neuf secteurs ont une offre Small. Les 36 combinaisons zone–secteur occupées et les neuf absentes sont conservées pour maintenir rareté, voyages et compétition.

Les seuils de capitalisation approximative sont **Small <40 Md$**, **Medium de 40 à <200 Md$**, **Large ≥200 Md$**. Il s'agit de catégories de jeu, distinctes des définitions boursières usuelles. Les sources et leurs dates figurent dans [COMPANY_AUDIT.md](COMPANY_AUDIT.md).

Pour une capitalisation `capUSD`, les cinq parts à C/C coûtent `round2(clamp(25,1500,500*ln(1+capUSD/50e9)/ln(5)))` M€. Le revenu de base vaut `round2(basePrice*(0.10+0.04*(1-exp(-capUSD/200e9))))`, par arrivée d'un autre fonds sur le secteur. Prix et rendement sont continus aux seuils : aucune marche imposée entre catégories. Les facteurs de grades et les planchers de revenu des contrôles/monopoles continuent à s'appliquer. Les cours sous différentes conditions de marché se chevauchent entre catégories.

Les onze remplacements coûtent **5 à moins de 9 M€ la première part à C/C**. Les Small proches de 40 Md$ sont plus coûteuses; la classe ne garantit pas le contrôle de cinq parts avec le capital initial. Une Large coûte au moins 100 M€ la part à C/C; au seuil exact, un humain peut engager tout son cash. Les réserves des IA ne sont pas une interdiction moteur.

Les sociétés embarquées dans une partie déjà sauvegardée ne sont ni renommées ni repricées. Les versions 1/2/3 de leur catalogue restent lisibles. Les futurs Contextes reconnus passent en v4 sans rejouer les cartes déjà résolues. Résultats mesurés : [CARD_BALANCE_REPORT.md](CARD_BALANCE_REPORT.md) et [ECONOMY_BALANCING.md](ECONOMY_BALANCING.md).
