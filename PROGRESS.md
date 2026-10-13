# Équilibrage du plateau et des paquets — 13 octobre 2026

**Moteur et données** : le plateau actif compte 39 secteurs, 10 Événements, deux marchés (Bull en case 14, Bear en case 40) et Départ. Immobilier remplace Crash à la case 26. Finance, Technologie et Immobilier apparaissent cinq fois ; les six autres secteurs quatre fois. Chaque quart contient les neuf secteurs, avec des écarts circulaires de 9 à 14 cases.

**Événements** : 50 cartes, cinq par secteur et cinq globales ; 19 favorables, 19 défavorables et 12 mixtes. Les cibles sont choisies dans un pool prioritaire de sociétés détenues puis disponibles, avec sélection uniforme de la zone, et un cooldown de quatre cibles dans la zone lorsque des alternatives existent.

**Contextes** : 100 cartes et quotas par type conservés (35 positives, 35 négatives, 10 neutres, 10 prison, 10 régulation). La distribution équilibrée couvre chaque zone 36 fois et chaque secteur 20 fois ; elle comprend 70 rotations depuis C, 20 effets directionnels purs et 10 affectations neutres à C. Les cartes assignent des grades absolus.

**Compatibilité** : plateau v3, cartes v3, règles de marché v2. Les plateaux officiels reconnus v1/v2 migrent vers la disposition courante tout en conservant les positions, historiques et identités figées des notifications. La migration des paquets remplace les cartes connues à leur place sans modifier leur ordre et préserve le Contexte révélé.

**Documentation** : [BOARD_BALANCE_AUDIT.md](BOARD_BALANCE_AUDIT.md), [EVENT_BALANCE_AUDIT.md](EVENT_BALANCE_AUDIT.md), [CONTEXT_BALANCE_AUDIT.md](CONTEXT_BALANCE_AUDIT.md), [ENGINE_RULES.md](ENGINE_RULES.md) et l’addendum de [ENGINE_AUDIT.md](ENGINE_AUDIT.md). **Validation finale** : 174 tests unitaires/intégration, TypeScript et build passent. Les neuf parcours navigateur (marchés, ancienne notification, Immobilier, Contextes et Événements) sont validés ; le navigateur public crée une partie, lance le dé, achète une action, passe au fonds suivant et reprend après rechargement. La campagne termine 20/20 parties et mesure 2 000 paquets de Contextes sans dérive marquée. Preuve : [board-deck-validation.json](docs/board-deck-validation.json), [simulation](docs/board-deck-simulation.json).

**Livré** : release `20261012T222344Z-board-decks-v3`, HTTPS et WebSocket validés, sauvegarde PostgreSQL dédiée vérifiée. Une ancienne partie reprend en v3 ; les cartes restantes sont actualisées sans changement d’ordre. L’archive V2 conserve ses 39 872 entrées, ses configurations et son service. Aucun fichier front-end n’a changé dans cette itération.

---

# Bear case 40 et chocs de marché — 12 octobre 2026

Cette entrée garde le suivi de l’itération précédente ; depuis le 13 octobre, Immobilier a remplacé le marché Crash en case 26. Les faits propres à la distribution de plateau et aux paquets décrivent leur état à cette date.

**Moteur et données** : Bear échange sa case 39 avec l'Événement en case 40. Les 52 cases et toutes les répartitions sont conservées. Bull/Bear appliquent ±1 niveau aux cinq zones, avec ±2 niveaux au total dans la zone actuelle du fonds actif ; secteurs inchangés, bornage A–E, Crash conservé. L'effet est prévisible et atteint ±50 % dans la zone active depuis C/C, contre ±25 % ailleurs. Les liquidations E/E et les planchers restent ceux du moteur.

**Compatibilité** : les anciens plateaux officiels sont reconnus avant migration. Positions numériques, portefeuilles, cash, historiques et règlements sont conservés. Les anciennes notifications figent leur identité ; un seul ajustement de lecture côté `CardScene` permet de les afficher après déplacement de Bear. Aucun style, layout, asset, HUD ou animation n'est changé.

**Validation** : 150 tests unitaires/intégration, TypeScript et build passent. Le navigateur valide Bull, Bear et une ancienne notification, puis le retour au trading. La campagne de 20 parties seedées termine sans erreur (11 732 commandes), avec 30 inversions de paires de rang et aucune insolvabilité immédiate sur un choc. Bear provoque néanmoins des liquidations E/E et 39 des 60 fonds finissent insolvables plus tard ; ce screening ne démontre pas un équilibre universel.

**Livré** : release `20261012T215056Z-market-v2`, sauvegarde PostgreSQL vérifiée, HTTPS et WebSocket sains. Une partie créée avant livraison reprend avec Bear en case 40, positions/cash conservés ; commande de dé réelle acceptée, nouvelles parties en règles v2. L'archive V2 conserve ses 39 872 entrées et son service n'est pas redémarré. Règles : [ENGINE_RULES.md](ENGINE_RULES.md). Preuves : [market-shock-validation.json](docs/market-shock-validation.json), [market-shock-simulation.json](docs/market-shock-simulation.json).

---

# Global Fund Evolve en ligne — 11 octobre 2026

**Livré** : <https://global-fund-evolve.213.199.40.67.sslip.io>, certificat Let's Encrypt valide, redirection HTTPS, Nginx/WebSocket, service `global-fund-evolve.service` activé au démarrage sur 3102. La release `20261011T191339Z-58493e0-online` reprend la PR #1 avec les adaptations locales, sans push GitHub. PostgreSQL, configuration et données Evolve sont dédiés ; une sauvegarde avant activation est vérifiée.

**Jeu** : la saturation du rendu logiciel des menus est évitée par le fond CSS ; le plateau 2D existant prend le relais sans GPU matériel. La disponibilité du plateau est conservée dans l'état React, et le chargement possède une sortie temporisée indépendante du rendu. La 3D reste utilisée avec un GPU matériel.

**Validation publique** : Chromium ouvre l'URL en HTTPS, se connecte à Socket.IO, crée une partie, affiche le plateau, lance le dé, achète une part, termine le marché et passe au joueur suivant. Rechargement puis redémarrage du seul service Evolve : même salon repris et achat toujours présent dans PostgreSQL. Aucun échec JavaScript ; plateau prêt en environ trois secondes en rendu logiciel. Les 135 tests unitaires/intégration, TypeScript, le build et la revue indépendante passent. Les captures du plateau et de l'achat sont sous `screenshots/online-validation/`. La 3D sur GPU matériel n'est pas mesurée sur ce serveur.

**V2 préservée** : 39 872 entrées de `/home/codex/projects/global-fund-next` comparées sans différence. Configurations V2 identiques ; même PID et même date de démarrage de son service, santé HTTPS OK. Preuve : [evolve-online-validation.json](docs/evolve-online-validation.json).

---

# Import de Global Fund Evolve — 11 octobre 2026

**Réalisé** : le projet actif `global-fund-next-new` est renommé `global-fund-evolve`. La dernière PR GitHub, [#1 — refonte du front 3D](https://github.com/mattmofr/global-fund-next/pull/1), est récupérée sur la branche locale `global-fund-evolve`, au commit `58493e0e805820a9c5ea29d39dad4c9229afceb2`. La PR reste en brouillon sur GitHub.

**Isolation** : `/home/codex/projects/global-fund-next` est conservé comme archive de la version 2. Evolve utilise les ports 3102/5175 et ses propres identifiants de service, sessions navigateur, base et volume Compose. Les modèles de déploiement sont adaptés à Evolve ; le VPS V2 n’est pas modifié. Les documents et preuves historiques conservent leurs références d’origine.

**Validation** : `npm ci`, les 135 tests unitaires/intégration, TypeScript et le build passent. Un lancement temporaire confirme le serveur Evolve sur 3102, Vite et son proxy sur 5175, tandis que V2 reste saine sur 3101. Le manifeste SHA-256 compare 39 872 entrées de l’archive V2 avant/après : aucune différence. La suite navigateur est arrêtée après quatre échecs répétés : le plateau 3D ne signale pas `data-scene-ready=true` dans le délai attendu. Un parcours est interrompu et seize ne sont pas exécutés. Preuve : [evolve-import-validation.json](docs/evolve-import-validation.json).

---

# Règle du 9 octobre 2026 — ordre de jeu fixe

## ENGINE

**Réalisé** : le dé initial désigne le premier joueur une seule fois. L’ordre circulaire des places est conservé à chaque cycle ; les insolvables sont sautés sans déplacer l’ancrage. Les détenus jouent leur procès à leur place habituelle. Tests de 2 à 6 joueurs sur plusieurs cycles, sauvegarde JSON et disparition du premier fonds.

## NETWORK

**Réalisé** : état et commandes existants conservés ; aucun schéma de données ajouté. Les anciennes parties figent leur ancrage actuellement enregistré sans modifier le tour en cours.

## GAMEPLAY

**Réalisé** : README, documentation moteur et aide du jeu indiquent un ordre constant. Une seule carte Contexte reste tirée au début de chaque cycle après l’ouverture.

## GRAPHICS / AUDIO / UX

**Réalisé** : plateau, HUD, notifications et sons conservés. Deux parcours navigateur vérifient explicitement le même premier joueur au cycle suivant après lecture de la carte.

**Validation** : 135 tests unitaires/intégration passent dans neuf fichiers ; typecheck et build passent. Deux parcours navigateur, en animations réduites/normales, confirment le même premier fonds au cycle 2 après lecture du Contexte et valident toujours voyage/confirmation de marché. Revue indépendante sans défaut concret restant.

**Livré** : serveur redémarré après sauvegarde PostgreSQL vérifiée (`runtime/backups/fixed-turn-order-oct9.dump`). Release `apps/web/.releases/2026-10-09T17-13-48-975Z-418940`, index HTTPS identique et health OK ; Next et historique actifs. Les 157 fichiers et deux configurations historiques restent inchangés. Provenance : [fixed-turn-order-validation.json](docs/fixed-turn-order-validation.json).

**Reste à faire** : essais joueurs ; aucune correction requise ouverte sur cette demande.

**Prochain objectif** : essais joueurs.

---

# Règle du 9 octobre 2026 — aucun revenu sectoriel propre

## ENGINE

**Réalisé** : la case secteur ne crédite plus le fonds actif pour ses propres participations, y compris 5/5 et monopoles. Paiements aux autres détenteurs, redirection des détenus vers la banque et calculs de revenus conservés. Régressions : participations partielles, contrôle total, monopole, deux détenteurs et dette qui ne peut pas être financée par un revenu fictif.

## NETWORK

**Réalisé** : serveur autoritaire redémarré après sauvegarde PostgreSQL vérifiée (`runtime/backups/no-self-sector-income-oct9.dump`). Les données et le schéma de sauvegarde ne changent pas ; les flux déjà exécutés restent historiques.

## GAMEPLAY

**Réalisé** : nouvelle règle documentée dans README, règles du règlement, moteur et aide du jeu. Les tests utilisent des paiements réels entre fonds, sans dépendance au revenu propre supprimé.

## GRAPHICS / AUDIO / UX

**Réalisé** : fiche de synthèse, noms des mouvements, total et carrousel conservés. Les cartes restent lisibles jusqu’à fermeture explicite. Aucun effet audio ou mise en page supplémentaire.

**Validation** : 128 tests unitaires/intégration dans neuf fichiers, build et typecheck passent. Cinq parcours navigateur distincts validés : paiement IA sans revenu propre en animations normales/réduites, deux créanciers cash, paiement initial puis titres/reconnexion, deux décisions de financement. Les attentes des anciens revenus propres et un sélecteur absent ont été corrigés dans les tests puis les parcours concernés relancés. Quatre captures actualisées et reçu cash revu visuellement. Revue indépendante du moteur effectuée.

**Livré** : release `apps/web/.releases/2026-10-09T16-48-22-069Z-412895`, index HTTPS identique et health OK. Next et historique actifs ; 157 fichiers et deux configurations historiques inchangés. Provenance : [no-self-sector-income-validation.json](docs/no-self-sector-income-validation.json).

**Reste à faire** : essais joueurs ; aucune correction requise ouverte sur cette demande. Les simulations économiques précédentes sont identifiées comme historiques.

**Prochain objectif** : essais joueurs.

---

# Ajustement du 9 octobre 2026 — lignes de règlement

**ENGINE / NETWORK / GAMEPLAY** : présentation seule ; les résultats, sens du cash, parts et reprises de séance sont conservés.

**GRAPHICS / UX — réalisé** : les règlements sont regroupés sous leur motif sectoriel. Les titres intermédiaires répétés sont retirés ; chaque mouvement affiche les fonds concernés au lieu des rôles génériques débiteur/créancier. Le total est placé après les mouvements, avant le carrousel des sociétés. Même rendu pour les anciens reçus singuliers et les synthèses collectives.

**AUDIO** : sons et préférences conservés.

**Validation** : 123 tests unitaires/intégration passent ; trois parcours navigateur ciblés validés (cash multi-créanciers, complément du créancier et reconnexion, deux décisions de financement). Le scénario cash a été relancé après retrait des sous-totaux répétés. Build et typecheck passent. Quatre captures de la version finale : reçu cash multi-créanciers et fiche aux trois tailles desktop. Revue visuelle et revue indépendante sans défaut restant dans cette présentation.

**Livré** : index HTTPS identique à la release `apps/web/.releases/2026-10-08T22-32-55-887Z-381966`, health OK ; services Next et historique actifs. Les 157 fichiers et deux configurations de la référence sont inchangés. Provenance : [receipt-lines-validation.json](docs/receipt-lines-validation.json).

**Reste à faire** : essais joueurs ; aucune correction requise ouverte sur cette demande.

**Prochain objectif** : essais joueurs.

---

# Itération du 9 octobre 2026 — synthèse globale des règlements

## ENGINE

**Réalisé** : l’historique financier conserve chaque dette ; une notification finale réunit toute l’opération. Son état de départ et les revenus bancaires sont conservés avec les décisions en attente. Les liquidations partielles alimentent ce reçu final, sans ouvrir de fiche supplémentaire. Les calculs, commandes et priorités NAV/siège sont conservés.

## NETWORK

**Réalisé** : format de notification additionnel compatible avec les anciens reçus singuliers. Les décisions restent autoritaires, sauvegardées et soumises aux mêmes révisions/droits. Aucun changement de schéma PostgreSQL requis.

## GAMEPLAY

**Réalisé** : plus d’écran « Les fonds sont revalorisés ». Une opération réglée immédiatement combine annonce et reçu en une seule fiche ; une dette non financée ouvre le desk après le dé/pion, puis une seule synthèse globale quand toutes les décisions sont terminées. Les changements réels de marché gardent leur confirmation avant retour direct au jeu.

## GRAPHICS

**Réalisé** : fiche globale compacte avec tous les créanciers, total réglé, cash échangé, titres et ventes. Revenus de la banque présentés séparément, sans compter deux fois une dette. Le HUD permanent conserve les liquidités et valeurs de chaque fonds.

## AUDIO

**Réalisé** : retour financier raccordé à la fermeture de la fiche ; sons et réglages existants conservés.

## UX

**Réalisé** : une fermeture de fiche/confirmation de marché suffit ; protection contre une ancienne fermeture appliquée à la fiche suivante. Échap reste la commande de fermeture, sans bandeau inférieur réintroduit.

**Validation** : 123 tests moteur/serveur/présentation passent ; neuf parcours navigateur distincts validés, dont cash multi-créanciers, titres, deux décisions successives, reconnexion et animations normales/réduites. Build et typecheck passent. Les assertions financières antérieures sont conservées ; un problème initial de harnais sur le compteur animé a été corrigé puis relancé.

**Réalisé** : sept captures vérifiées, dont le reçu aux trois tailles desktop. Revue indépendante, protection du choix de titres au changement de créancier et restauration des valeurs avant dé après reconnexion validées. Version en ligne, serveur redémarré après sauvegarde PostgreSQL ; HTTPS et index de release vérifiés. Référence : 157 fichiers et deux configurations historiques inchangés. Provenance : [global-settlement-validation.json](docs/global-settlement-validation.json).

**Reste à faire** : essais joueurs ; aucun travail requis ouvert sur cette correction.

**Problèmes identifiés** : les anciens reçus individuels restent lisibles ; les nouvelles opérations emploient le reçu groupé. Aucun changement de règle économique.

**Prochain objectif** : essais joueurs.

---

# Itération du 8 octobre 2026 — lecture et configuration

## ENGINE

Règles et commandes conservées. Validation : 123 tests unitaires/intégration passent, dont la séquence d’ajustements après un tour IA et les accusés de lecture.

## NETWORK

Serveur autoritaire et sauvegardes inchangés. Les confirmations ne font avancer que la présentation locale ; les résultats restent ceux reçus du serveur.

## GAMEPLAY

Les véritables ajustements de marché attendent Valider les cours. Les versements sans changement de marché passent directement au bilan financier. Tous les bilans attendent Continuer, sans expiration, même pour un petit montant après IA et en animations réduites. Les clics d’un écran fermé ne peuvent pas valider le suivant.

## GRAPHICS

Fiches compactes : fonds dans l’en-tête des versements, suppression des métadonnées ordinaires de journal et du bandeau inférieur de toutes les cartes. Plateau insensible au survol, curseur d’aide retiré.

## AUDIO

Aucun changement aux sons ni aux préférences audio.

## UX

Brouillon de création/connexion validé et sauvegardé dans le navigateur. Retour au menu, rechargement et nombre de joueurs temporairement réduit conservent les choix. Fermeture des cartes par Échap avec révélation des conséquences conservée.

**Validation précédente (avant la correction du bilan)** : 123 tests unitaires/intégration et 16 parcours navigateur distincts validés ; build de production et typecheck passent. 11 nouvelles captures : Contexte/Événement aux trois tailles, versement aux trois tailles, ajustements de cours et fonds en 1366×768. Les premiers échecs de harnais (ancien libellé de fermeture, simulation de temps et retour du salon vers la création) ont été corrigés puis les parcours concernés relancés.

**Réalisé** : revue visuelle des cartes et du bouton de confirmation, gardes de mise en page/carrousel passées. La release est servie en HTTPS ; référence historique : 157 fichiers et deux configurations d’infrastructure inchangés.

**Problèmes identifiés** : la persistance locale dépend de la disponibilité du stockage du navigateur ; les données invalides reviennent aux valeurs par défaut.

**Correction du bilan validée** : 123 tests unitaires/intégration passent ; trois scénarios navigateur ciblés vérifient le Contexte réel et le revenu IA de 1 M€ en animations normales/réduites. Les deux captures du bilan affichent Continuer après 35 secondes simulées, sans écran intermédiaire de marché. Build, revue indépendante et mise en ligne validés. Provenance : [portfolio-reading-validation.json](docs/portfolio-reading-validation.json).

**Prochain objectif** : essais joueurs. Provenance de cette itération : [ux-reading-validation.json](docs/ux-reading-validation.json). Captures : `screenshots/current/{context,event-newspaper,payment-card,market-impact,portfolio-impact}.png`.

---

# Progression — règlement et immersion, 7 octobre 2026

Projet : **Global Fund Next**. État antérieur archivé dans [progress-before-clearing](docs/progress-2026-10-07-before-clearing.md) et `baseline/clearing-2026-10-07/` (sources, captures et documents). La référence historique reste indépendante.

## ENGINE

**Réalisé** : phase `settlement` pour une obligation non couverte par le cash ; sélection d’actifs, liquidations partielles, offres aux cours figés, complément cash symétrique, PRU pondéré au cours complet de transfert, droits de propriété et contrôles recalculés. Les paiements ne créent aucun cash manquant. Après épuisement des actifs, l’insolvabilité distingue payé et impayé. Les obligations de voyage, prison, événements et Départ reprennent leur phase sans rejouer l’action.

**Validation** : 122 tests unitaires/intégration passent ; 67 ciblés couvrent notamment 18 scénarios de règlement. Trois parties IA complètes (2 122 commandes) terminées sans blocage. Revue indépendante des flux, PRU, acteurs et persistance sans défaut concret trouvé.

**Reste** : nouvelle campagne d’équilibrage humain/IA. Les 420 comparaisons économiques antérieures, dont 100 finales, précèdent ce nouveau mécanisme et ne prouvent pas son équilibre.

## NETWORK

**Réalisé** : le décideur est le débiteur ou le créancier attendu, même hors de son tour. Authentification, phase, révision, champs de commande et déduplication restent contrôlés serveur. Mutation sur copie, persistance avant commit/diffusion pour humains et IA. File, offre, cours figés et ordre sont sauvegardés. Ordre multi-créanciers : **valorisation croissante puis siège**, explicitement confirmé par l’utilisateur.

**Validation** : test de reprise d’une offre, droits du créancier distant, prix client refusé, double commande et mauvais acteur ; 15 parcours Playwright passent, dont les trois workflows de règlement. HTTPS et deux services actifs. 157 fichiers historiques et deux configurations d’infrastructure inchangés.

**Reste** : tests de charge et comptes publics, hors de cette itération.

## GAMEPLAY

**Réalisé** : dette expliquée par la case/secteur, portefeuille complet utilisable pour un règlement exceptionnel (toutes zones/prison, aucun achat). Les humains peuvent accepter, refuser, demander le cash ou proposer autre chose. Une IA débitrice liquide après refus. L’IA créancière vérifie budget et intérêt stratégique. Les dettes multiples restent dans l’ordre figé de NAV/siège. Les conséquences importantes attendent **Reprendre la séance**, sans délai d’expiration.

**Reste** : tests utilisateurs ; les autres règles et l’ouverture C/C sont conservées.

## GRAPHICS

**Réalisé** : terminal à en-tête unique, cadre de moniteur fin, cotation fixe, historique agrandi, espace de lecture accru ; deux grandes répartitions dans Analyse, contrôles en dessous. Événements en dépêches du GF Financial Chronicle, texte immersif direct, suppression du masque latéral du Contexte. Ticker modéré en boucle, pause au survol/focus, mode réduit respecté. 47 logos réels locaux (20 auparavant), 44 monogrammes sans imitation.

**Validation** : 33 images distinctes aux trois résolutions : 18 terminaux/cartes et 15 règlements. Les dix alias demandés dans `screenshots/current/` utilisent le format prioritaire 1366×768. Revue visuelle laptop, intermédiaire et wide effectuée. La revue a détecté puis corrigé deux rognages en 1440×900 : axes du portefeuille et prix après Contexte. Les gardes couvrent désormais les trois tailles. Oracle recoloré selon le guide officiel, ancien Telstra retiré faute de marque actuelle aux droits vérifiés.

**Limite** : cible 60 FPS sur GPU réel à mesurer. La mesure SwiftShader précédente reste documentée ; aucun nouveau benchmark graphique n’est revendiqué.

## AUDIO

**Réalisé** : effets locaux CC0, mute et réglages conservés. Aucun nouveau son sans licence ni piste en boucle ajouté.

## UX

**Réalisé** : desk de clearing central avec dette, cause, cash manquant, sélection de parts, offre figée et sens du complément. Acceptation désactivée avec explication si le créancier ne peut pas payer. Actions normales bloquées pendant le règlement ; les décisions n’attendent pas le tour du créancier. Résumés lisibles jusqu’au clic explicite. Un seul scroll de détails dans la fiche ; ResizeObserver ECharts conservé.

**Validation** : 15 parcours Playwright passent (6,8 min), dont les trois workflows de règlement. Les parcours antérieurs ont été adaptés au header unique et aux places initiales sans supprimer leurs assertions.

**Validation** : captures sans erreur de console/page et sans débordement horizontal. Dette, secteur, sélection, complément cash et actions restent visibles ; graphiques complets à 250/180/155 px selon la résolution. Le Portefeuille 1366 offre 195 px de liste, 11 lignes sélectionnables et un ticket avec motif de désactivation visible.

## Livraison et prochain objectif

**Itération livrée** : 122 tests unitaires/intégration, 15 parcours Playwright et build/typecheck passent. Le build `.releases/2026-10-07T21-22-53-574Z-337339` est servi sur [l’accès HTTPS Next](https://global-fund-next.213.199.40.67.sslip.io/), avec index public identique au build et health OK. Les deux services sont actifs ; 157 fichiers et deux configurations historiques sont inchangés.

Prochain objectif : essais joueurs et campagne d’équilibrage du règlement, puis mesures sur GPU réel. La provenance des 33 images, les empreintes et les résultats sont consignés dans [VISUAL_VALIDATION.md](docs/VISUAL_VALIDATION.md) et [clearing-visual-validation.json](docs/clearing-visual-validation.json). Règles : [SETTLEMENT_RULES.md](SETTLEMENT_RULES.md). Logos : [LOGO_AUDIT](docs/LOGO_AUDIT.md) et [COMPANIES_WITHOUT_LOGO.md](COMPANIES_WITHOUT_LOGO.md).

## 13 octobre 2026 — cartes, Small Caps et économie v4

Projet actif consolidé : `global-fund-evolve-integration` / branche `global-fund-evolve`; Evolve historique et V2 préservés. L’audit économique a trouvé 20 Small, dont 2 Amériques, 2 Europe et 3 Asie. Onze substitutions cotées, sourcées et datées portent le catalogue à 31 Small/24 Medium/36 Large, toujours 91 sociétés et 36 cellules zone–secteur occupées. Les anciens logos ne sont pas affectés à de nouvelles identités; le rendu monogramme existant est utilisé.

Courbe prix/revenus continue aux frontières; aucun repricing des parties sauvegardées. Le benchmark des Contextes a détecté zéro A/E sectoriel, rendant E/E inaccessible; neuf paires miroir sont corrigées en catalogue v4. Les Événements ne modifient toujours aucune note. Rapports : `MARKET_DISTRIBUTION.md`, `CARD_BALANCE_REPORT.md`, `ECONOMY_BALANCING.md` et JSON reproductibles.

Comparaison IA : 40 parties complètes par campagne, trois difficultés et rotation des cinq marchés. Premier achat cycle 1 pour 120/120 fonds; Small 120/120 en v4; Large 4/120, premier achat moyen cycle 38,75 (0/120 référence). Aucun fonds ne conserve 100 M€ dix cycles sans achat. Contrôles : 181 tests unitaires/intégration, 21 Playwright, typecheck et build. Aucun frontend, style, layout, animation ou lobby modifié.

## LOBBY — nouveau parcours en ligne

**Comportement documenté** : création avant choix du marché, code canonique à huit caractères, préférences individuelles avec remise à zéro de Prêt, places de 2 à 6 gérées par l’hôte, IA diversifiées, lancement après préparation ou omission explicite des invités absents, IDs conservés malgré les trous, reconnexion et persistance atomique. Le parcours local et l’adaptateur de nationalité des salons historiques restent distincts du protocole online v2. Détails : [LOBBY_RULES.md](LOBBY_RULES.md).

**Validation finale** : 192 tests unitaires/intégration, 22 Playwright sans échec/skip/flaky, typecheck et build production réussis. Migrations PostgreSQL idempotentes, reprise du lobby/partie et achat persistant vérifiés sur base isolée. Contrôle visuel 2/6 fonds et mobile réussi sans CSS modifié. Preuve : [docs/evolve-lobby-validation.json](docs/evolve-lobby-validation.json).

**Couverture** : `tests/lobby-server.test.ts` couvre création, marchés humains en doublon, préférences, autorisation, slots/IA, omission et IDs, concurrence, reconnexion fichier, compatibilité locale, rollback et créations concurrentes. `tests/e2e/gameplay.spec.ts` couvre synchronisation/reconnexion et lancement avec place absente.
