# Décisions

## 13 octobre 2026 — répartition du plateau et équilibre des cartes

- Le plateau v3 garde 52 cases : 39 secteurs, 10 Événements, Bull et Bear, et Départ. Immobilier remplace Crash en case 26 ; Bull reste en case 14 et Bear en case 40.
- Finance, Technologie et Immobilier ont cinq cases chacun ; les six autres secteurs en ont quatre. Chaque quart de 13 cases contient les neuf secteurs, avec des écarts circulaires de 9 à 14 cases entre occurrences d’un même secteur.
- Le paquet de 50 Événements garde ses IDs et titres : cinq cartes par secteur et cinq cartes globales, réparties en 19 favorables, 19 défavorables et 12 mixtes. La sélection choisit uniformément une zone parmi celles présentes dans le pool prioritaire (sociétés détenues par l’actif, sinon par un joueur, sinon toutes disponibles), puis une société dans cette zone ; elle écarte les quatre dernières entreprises ciblées parmi les candidates de cette zone si une alternative existe.
- Les 100 Contextes gardent leurs quotas par type. Leur nouvelle distribution produit 70 rotations depuis C, 20 changements directionnels purs et 10 affectations neutres à C ; les zones sont couvertes 36 fois chacune et les secteurs 20 fois chacun. Les grades sont assignés en absolu, et non comme un déplacement relatif garanti.
- Les versions actives sont plateau 3, cartes 3 et règles de marché 2. La migration du plateau ne réordonne que les sauvegardes dont le plateau complet officiel est reconnu ; positions, historique et notifications résolues restent figés. Pour les paquets, les IDs connus sont remplacés à leur place sans réordonner le deck ; un Contexte déjà révélé ne change pas.
- Les audits et limites sont détaillés dans [BOARD_BALANCE_AUDIT.md](BOARD_BALANCE_AUDIT.md), [EVENT_BALANCE_AUDIT.md](EVENT_BALANCE_AUDIT.md), [CONTEXT_BALANCE_AUDIT.md](CONTEXT_BALANCE_AUDIT.md) et [ENGINE_RULES.md](ENGINE_RULES.md). **Validation finale** : 174 tests unitaires/intégration, TypeScript et build passent. Les neuf parcours navigateur (marchés, ancienne notification, Immobilier, Contextes et Événements) sont validés ; le navigateur public crée une partie, lance le dé, achète une action, passe au fonds suivant et reprend après rechargement. La campagne termine 20/20 parties et mesure 2 000 paquets de Contextes sans dérive marquée. Preuve : [board-deck-validation.json](docs/board-deck-validation.json), [simulation](docs/board-deck-simulation.json).

## 12 octobre 2026 — Bear case 40 et chocs prévisibles

Cette décision décrit l’itération précédente. La distribution active du 13 octobre remplace désormais le marché Crash par Immobilier en case 26 ; Bull/Bear ne changent pas.

- Bear et l'Événement adjacent échangent les cases 39/40, sans changer les 52 cases ni les répartitions. Bull et Crash gardent leurs positions.
- Bull/Bear déplacent les cinq notes de zone de ±1 niveau, avec ±2 niveaux au total dans la zone du fonds actif. Le sens, la portée et l'intensité sont prévisibles ; les notes sectorielles restent inchangées. Crash conserve sa règle.
- L'importance est symétrique en niveaux ; depuis C, le choc vaut ±25 % ailleurs et ±50 % dans la zone active. Les liquidations E/E restent celles du moteur, sans débit exceptionnel du cash ni déclaration d'insolvabilité sur la seule baisse de NAV.
- La migration n'échange que les cellules d'un ancien plateau officiel reconnu ; elle conserve les positions numériques et fige l'identité des notifications historiques. Une lecture minimale de cette identité côté UI suffit, sans changement graphique.
- Les règles, limites et mesures sont dans [ENGINE_RULES.md](ENGINE_RULES.md). L'archive V2 et les rapports historiques restent séparés.

## 11 octobre 2026 — mise en ligne d'Evolve

- Evolve possède son hôte HTTPS `global-fund-evolve.213.199.40.67.sslip.io`, son certificat Let's Encrypt, son service sur 3102 et sa base PostgreSQL `global_fund_evolve`. Les services et les données de V2 restent séparés.
- La livraison utilise un instantané des sources locales dans une release autonome, avec bascule du lien `current`. Aucun push ni workflow de livraison V2 n'est déclenché.
- Les navigateurs sans WebGL matériel utilisent le fond CSS des menus et le plateau 2D existant. Cela évite la saturation du rendu logiciel constatée pendant le chargement ; le rendu 3D est conservé sur GPU matériel.
- La disponibilité du plateau est conservée dans l'état React. Le chargement possède aussi une sortie temporisée indépendante de la cadence de rendu ; elle ne peut pas rouvrir un écran déjà terminé.

## 11 octobre 2026 — Global Fund Evolve et archive V2

- Le projet actif `global-fund-next-new` devient `global-fund-evolve`. Le répertoire `global-fund-next` est conservé intact comme version 2.
- La branche locale `global-fund-evolve` reprend la PR #1 du dépôt source `mattmofr/global-fund-next`, au commit `58493e0e805820a9c5ea29d39dad4c9229afceb2`. Cette PR est en brouillon ; son import ne fusionne pas `main` sur GitHub.
- Les ports par défaut sont 3102 et 5175. Les sessions navigateur, la base et le volume Compose ainsi que les exemples de service et de stockage utilisent le nom Evolve, sans reprendre les données V2.
- Les URL du dépôt source et les comptes rendus historiques gardent leur nom d’origine. Les modèles de déploiement Evolve sont préparés localement ; le VPS V2 reste inchangé.

## 7 octobre 2026 — terminal, implantation et économie

| Problème | Options | Décision | Raison et conséquence |
| --- | --- | --- | --- |
| Nationalité utilisée pour déterminer le départ | Garder le pays ; choisir directement une place | Cinq marchés explicites, placement IA diversifié côté serveur | `startingMarket` conserve l'origine ; `currentMarket` expose la position et les implantations restent historiques. Les anciens pays sont lus uniquement pour adapter les sauvegardes. |
| Bureau changeant au tour IA ou à l'inspection | Suivre l'acteur ; suivre le fonds inspecté ; conserver l'humain client | Ville du fonds humain local/client, cinq photos de skylines licenciées et locales | Le bureau change après le voyage et un préchargement ; fondu de 500 ms. Il ne change pas à l'inspection d'un autre portefeuille. |
| Variation de marché peu utile à une décision de vente | Variation depuis le cycle ; rentabilité du joueur | Cours + PRU + P/L %, `—` sans détention/PRU | Le PRU serveur est la référence ; aucun prix de revient n'est inventé pour une vieille sauvegarde. |
| Les colonnes finales disparaissent sur laptop | Garder le scroll horizontal ; réduire toute la police ; compacter les colonnes | Grille minimum de 596 px et filtres en une barre, cours et résumé prioritaires | Sept colonnes visibles à 1366×768, vérifiées avec leurs bornes DOM ; le défilement interne reste possible sur écrans plus étroits. |
| Groupes monopolistiques cachant les positions sur écran court | Supprimer les groupes ; tout faire défiler ; réserver la sélection des positions | Groupes limités à 64 px et défilables au clavier, table réservée et ticket compact | Contrôles et monopoles restent consultables ; sélectionner une autre entreprise et comprendre un ordre indisponible restent possibles. |
| Capitalisation réelle et prix de jeu confondus | Conversion directe ; grille sans sources ; normalisation séparée | CAP sourcée en USD et catégories GF 40/200 Md, valeurs de jeu interpolées logarithmiquement | Hiérarchie crédible dans un univers de grandes sociétés ; ces catégories diffèrent des catégories financières usuelles. Grille choisie après simulations comparables. |
| Immobilier absent en Asie et limité au Moyen-Orient | Ajouter des IDs ; remplacer deux titres | SHKP et Emaar remplacent deux lignes avec IDs conservés, nouvelles parties uniquement | 91 sociétés, industriels asiatiques conservés, sauvegardes incorporées inchangées. |
| Lecture des variations trop brève | Ralentir chaque action ; bloquer toute variation ; distinguer les impacts | Quatre secondes pour un impact majeur, bouton de reprise ; 650 ms pour les petits impacts | Le changement reste immédiat dans le moteur ; seul le rythme de présentation change. Réduit conserve la durée de lecture. |
| Carrousel Contexte repoussé sous le pied sur laptop | Masquer les fonds ; garder un défilement global ; compacter la composition | Héros de 104 px et vignettes plus courtes à hauteur ≤800 px | Texte, notes et premiers cours affectés restent visibles ensemble ; tous les fonds et le récit complet sont conservés. |
| Tous les rails visibles pendant chaque animation | Cadrage global constant ; caméra liée à la phase | Suivi de pion 1,22 pendant dé/parcours/arrivée, vue globale disponible | La case et le pion deviennent lisibles sur laptop, quitte à recadrer des rails éloignés. Projection commune et mode réduit conservés. |
| Allégations contre des sociétés réelles dans les récits | Reprendre un scandale nominatif ; scénarios historiques fictifs | 50 histoires Événement fictives à cibles dynamiques et 100 récits macro | IDs, effets et changements de notes inchangés ; sources d'inspiration et distributions documentées. |

## 5 octobre 2026 — scène de jeu immersive

| Problème | Options | Solution retenue et raison | Conséquence |
| --- | --- | --- | --- |
| Le plateau était un bloc d'une longue page | Recolorer la page ; changer la composition | Scène plein écran, plateau Pixi dominant, HUD et terminal flottants | Les transactions et analyses restent en HTML/ECharts ; le défilement se fait dans les fenêtres |
| Perspective et figurines aplaties | Incliner toute la scène ; séparer surface et objets | Surface affine 2.5D ; coordonnées d'ancrage projetées, sprites verticaux | Ombres, villes et six figurines gardent leur volume et leur place sur le plateau |
| Six mêmes pions d'échecs recolorés | Modèles libres disparates ; figurines originales cohérentes | Recherche CC0 documentée puis atlas originaux générés avec imagegen | Sprites locaux alpha ; pas de licence CC0 attribuée aux créations générées |
| Carte presque invisible | Aplats vectoriels seuls ; texture nocturne réelle | Natural Earth et composite NASA Black Marble, miniature de chaque métropole | Géographie lisible, relief et lumières ; crédit NASA local |
| Nomenclature des maquettes différente du moteur | Redistribuer les entreprises ; conserver les zones | Conservation des cinq zones du jeu validé | Les 91 entreprises, règles et sauvegardes restent compatibles ; aucune migration métier dans cette phase |
| Feedback d'ordre avant réponse serveur | Effet au clic ; effet après confirmation | Reçu construit par différence entre snapshots confirmés | Un ordre refusé ne génère pas de confirmation ; aucun nouveau calcul métier côté client |
| Interface entière en Canvas | Tout Pixi ; HTML partout ; séparation | Pixi pour monde/caméra/objets/effets, React pour données et fenêtres | Lisibilité, focus clavier et tableaux conservés |
| Audio sans licence claire ou obligatoire | Streaming distant ; sons libres locaux | Effets Kenney CC0 locaux, muet par défaut, geste de déverrouillage | Canaux général/musique/ambiance/effets ; aucune boucle musicale ou de salle de marché livrée |
| Coût du rendu logiciel | Animations permanentes ; budget adaptatif | Terrain en cache, résolution et particules selon qualité, pause hors onglet, rendu ponctuel réduit | Objectif 60 FPS sur GPU ; mesures SwiftShader documentées sans prétention d'universalité |
| Netteté et ancrage dans la revue visuelle | Agrandir tous les objets ; affiner les surfaces | Cache de terrain à résolution 2 en qualité haute, ombres de contact et contours de relief au-dessus de la carte | Meilleure lisibilité des plaques et profondeur des villes, sans ajouter de règle ni de simulation |
| Build supprimant des chunks pendant un test ou une partie | Écrire dans dist ; stage et release | Build isolé puis bascule atomique du lien dist, conservation des anciennes ressources hashées | Un build raté garde la version servie ; releases à nettoyer explicitement après contrôle des sessions |
| Lecture des effets et du graphique sous les commandes | Réduire les données ; ajuster la surface de lecture | Terminal plus haut sur grands desktops, carrousel Contexte dimensionné et défilable, indications de molette | Les informations restent accessibles sans réduire les montants essentiels ; mouvements réduits respectés dans le carrousel |
| Rendu logiciel simultané pendant les vérifications | Capturer et tester en parallèle ; séquencer les navigateurs | Captures et E2E séparés ; budget de 75 s pour le parcours distant à deux clients | Les assertions fonctionnelles restent à 10 s ; évite qu'une fermeture de navigateur lente invalide un parcours terminé |
| Échantillon initial à 0–1 FPS sur SwiftShader | Réduire immédiatement la qualité ; comparer après chauffe | Diagnostic A/B du cache à résolutions 1/2, avec/sans MSAA, puis mesure après 15 s d'échauffement | Cache stable et ticker actif ; 6–9 FPS observés à 1920 sur le rendu logiciel. Le faible gain ne justifie pas de réduire la netteté ; 60 FPS sur GPU reste à vérifier |


| Date | Problème et options | Décision et raison | Conséquence |
|---|---|---|---|
| 2026-10-04 | Refonte sur place ou projet séparé | Projet voisin autonome, comme demandé | Aucun lien d'exécution ni stockage partagé avec la référence |
| 2026-10-04 | Réécriture totale du métier ou extraction | Extraction du noyau éprouvé + façade TS stricte | Migration progressive des détails JS ; les contrats nouveaux sont typés |
| 2026-10-04 | Voyage indiqué avant et après le dé | Implantation avant le dé, choix confirmé par l'utilisateur | Nouvelle phase geography ; maintien de l'ouverture gratuite par nationalité |
| 2026-10-04 | Carte au premier cycle ou indices C à l'ouverture | Maintien du cycle d'ouverture sans Contexte | Cent cartes jouées collectivement dès le cycle 2 ; victoire à leur épuisement |
| 2026-10-04 | Rendement à Départ pollué par les apports | Variation de NAV corrigée des capitaux externes | Les 20 M€ influencent la valeur du fonds et le classement, jamais leur propre critère de performance |
| 2026-10-04 | Monopole sur moitié ou totalité du groupe | Contrôle de toutes les sociétés, conformément à la mission | Bonus A/A plus exigeant ; anciens tests adaptés |
| 2026-10-04 | Canvas partout, 3D complète ou rendu ciblé | Pixi 2.5D pour plateau ; HTML pour finances et menus | Accessibilité et lisibilité conservées ; charge graphique contenue |
| 2026-10-04 | Prisma ou Drizzle | Drizzle, schéma TS explicite et pilote PostgreSQL standard | Stockage JSONB versionné pour les salons, migrations SQL lisibles |
| 2026-10-04 | Imposer Docker au VPS ou préserver son infrastructure | Service isolé + nouvel hôte Nginx ; Compose fourni | Port 3101, référence sur 3001 inchangée |
| 2026-10-04 | Copier tous les logos ou vérifier leurs droits | Monogrammes et art interne réutilisé ; actifs libres sourcés | Aucun logo externe sans licence vérifiée ; registre de provenance local |
| 2026-10-04 | Production sonore commerciale immédiate | Architecture par canaux, premier son CC0 et signaux synthétisés | Audio facultatif ; catalogue enrichissable sans couplage au moteur |

| 2026-10-04 | Captures continues et rendu logiciel coûteux dans les tests | Traces DOM sans screencast, rendu ponctuel en mouvements réduits et pause hors écran | Les tests gardent les assertions métier et les erreurs de console ; les animations normales ciblent 60 FPS sans garantie matérielle universelle |
| 2026-10-04 | CLI Drizzle et versions initiales signalées par audit npm | Migrations SQL explicites via pg + Drizzle pour les requêtes ; versions Fastify static et Vitest corrigées | Pas de dépendance au CLI de génération ; audit npm à zéro vulnérabilité lors de la livraison |

## Itération plateau — 6 octobre 2026

| Problème | Options | Décision | Raison et conséquence |
| --- | --- | --- | --- |
| Projection incohérente entre surface et objets | Skew par élément ; scène 3D complète ; homographie commune | Surface Pixi tessellée avec BoardProjection/inverse, pieds et ombres communs | Conserve les assets et la carte ; supprime le cisaillement et donne une perspective de table modérée. |
| Voyage bloque la consultation | Modal avec piège de focus ; écran séparé ; fenêtre centrale consultable | Destination conservée par GameWorld, consultation libre via terminaux | Lire le marché ne transmet aucune commande ni coût ; seuls Stay/Move valident. |
| Les conséquences apparaissent avant la lecture | Ralentir le moteur ; serveur attendre chaque client ; chronologie de présentation | Moteur inchangé, snapshots détachés et FSM frontend, ack après conséquences | Autorité serveur préservée, file de révisions existante conservée, cartes lisibles sans révéler les valeurs trop tôt. |
| Ordre à double validation | Switch + confirmer ; deux actions directes | Quantité puis Acheter ou Vendre | Une commande immédiate, toujours contrôlée côté serveur, boutons bloqués pendant la requête. |
| Confusion contrôle/monopole | Couronne commune ; symboles distincts | Couronne 5/5 C/C, réseau groupe complet A/A | Les groupes partiels représentent une progression et ne changent pas la règle métier. |
| Statistiques coupées | Réduire tous les graphiques ; fenêtre qui recouvre le HUD ; défilement interne | Analyse/Statistiques distinctes, dimensions selon surface disponible, ResizeObserver | Axes et légendes conservent un espace réel ; actions et contexte restent autour. |
| Sociétés fictives/obsolètes et manque d’industrie en Asie | Ajouter des lignes ; migrer IDs et prix ; catalogue versionné | 91 lignes, métadonnées v2, mêmes IDs/prix/revenus, trois remplacements industriels | Les anciens états restent intacts et conservent leurs participations ; nouvelles parties adoptent v2. Les matrices montrent les écarts restants. |
| Logos de marques | Hotlink ; imitation ; copies locales vérifiées et monogrammes | Sources officielles/Commons et fichiers locaux, provenance explicite | Domaine public de texte/formes n’efface pas le droit des marques. Aucun faux emblème et aucun CDN nécessaire. |

| Rendu lent saute les phases de dé et mouvement | Rattraper toutes les échéances ; ralentir le moteur ; garantir chaque commit visuel | Une transition par callback normal, durées/epochs recalées après commit; réduit reste instantané | Le joueur voit le dé arrêté avant le pion même après un rendu coûteux. Test d’un retard de 100 secondes sans saut de phase. |
| Copies de snapshots régénèrent une texture identique | Régénérer par référence ; comparer le contenu imprimé | Empreinte des cases, plaques, notes, cycle, résultat et sélection | Réduit le travail Pixi aux changements utiles, sans retirer les informations. |
| Ticket masque le cours sur écran court | Tout faire défiler ; réduire tous les textes ; séparer résumé/détails/ordre | Cours et parts fixes, détails internes défilables, ticket fixe | Les actions Acheter/Vendre et la cotation restent visibles; historique accessible par défilement. |

## 7 octobre 2026 — règlement et terminal compact

| Problème | Options envisagées | Solution retenue / raison | Conséquence |
| --- | --- | --- | --- |
| Résultats disparaissent avant lecture | Délai plus long ; lecture manuelle | Résumés majeurs sans échéance, Reprendre la séance obligatoire ; mineurs 650 ms | Le joueur contrôle la lecture, y compris en animations réduites ; moteur et présentation restent séparés |
| Double branding du terminal absorbe la hauteur | Réduire uniquement la police ; supprimer un niveau | Un seul header dans TradingDesk, callbacks plateau/voyage/fin conservés | Plus de données visibles, aucun changement de commande métier |
| Graphiques coupés / peu lisibles | Tout faire défiler ; réserver cotation et ticket | Résumé et ordre fixes, une zone centrale défilante, historique 180–250 px (adapté laptop), grandes répartitions | ResizeObserver redimensionne ECharts ; tests des bornes réelles aux trois tailles |
| Cash insuffisant entraîne des ventes imposées arbitraires | Vente automatique ; sélection du débiteur | Phase dédiée, actifs sélectionnés par le joueur, ventes partielles possibles | Exception toutes zones/prison limitée au règlement, achats ordinaires interdits |
| Titres supérieurs à la dette | Interdire ; payer seulement la dette ; complément symétrique | Offre figée, cashDelta = dette − titres ; le créancier paie si négatif | Accepter exige le cash réel ; PRU du bénéficiaire au cours complet figé |
| Créancier hors du tour actif | Attendre son tour ; changer joueur actif ; acteur de décision distinct | decisionActorId dans le règlement, vérifié serveur pour humains et IA | Le tour reste celui du débiteur ; le créancier distant décide immédiatement |
| Concurrence et persistance | Mutation puis écriture ; état préparé sur copie | Exécution sur draft, sauvegarde avant commit/diffusion, file serveur par salon | Titre, cash et dette forment la même mutation ; révision et déduplication conservées |
| IA débitrice répète une offre refusée | Reproposer ; liquider au marché | Après refus humain, l’IA passe en marketOnly | Évite une boucle ; elle paie avec les produits de vente et garde le surplus |
| Brief contradictoire NAV/cash pour les créanciers | Valorisation ; cash | L’utilisateur confirme explicitement **valorisation croissante puis siège** | File et valorisations figées avant tout paiement, tests avec ordre de cash opposé |
| Journal de paiement confond obligation et cash exécuté | Afficher la dette comme transfert ; distinguer les deux | dueAmount pour montant à financer, amount pour montant versé, reçu structuré | Aucun créancier crédité fictivement ; l’impayé apparaît avec l’insolvabilité |
| Événement ressemble à une modal administrative | Image seule ; une de presse | GF Financial Chronicle, typographie éditoriale, illustration/récit/effets/date | Identité propre au jeu ; phrases « scénario fictif » supprimées sans changer les effets |
| Ticker trop court ou agressif | Animation JS par frame ; bande CSS doublée | Deux groupes identiques, durée adaptée au nombre de titres, cours/historique réels | Sans re-render par frame ; pause survol/focus et statique en mouvements réduits |
| Beaucoup de logos manquants | Hotlink ; imitation ; audit d’actifs locaux | 28 nouveaux assets actuels, statut copyright vérifié, provenance et copies locales | 47 logos actifs /91, 44 initiales restantes après retrait du lockup Telstra ancien ; aucun mapping vers une autre société |

### Fraîcheur finale des marques

Problème : Oracle conservait une ancienne couleur et le lockup horizontal Telstra n’était pas la marque principale actuelle. Options : conserver ; remplacer sans preuve ; vérifier et retirer si nécessaire. Décision : silhouette Oracle inchangée, rouge #C74634 conforme au guide officiel ; ancien Telstra retiré des nouvelles parties, initiales faute de ressource actuelle aux droits vérifiés. Conséquence : 47 logos actifs et 44 monogrammes, les 28 nouveaux logos sont conservés ; les sauvegardes gardent leur catalogue embarqué. Sources dans `docs/LOGO_AUDIT.md`.

### Validation des formats intermédiaires

Problème : les gardes initiales ciblaient le laptop 1366×768 ; la revue PNG a révélé des axes de portefeuille et des prix après Contexte masqués à 1440×900. Options : réduire tous les graphiques ; adapter la bande de hauteur intermédiaire. Décision : cotation sur une ligne et courbe de 180 px entre 801 et 950 px de hauteur ; dossier Contexte compact jusqu’à 950 px. Conséquence : contrôles de lecture du graphique, du ticket et des notes/prix Contexte étendus aux trois résolutions, puis neuf captures concernées régénérées. Les vues non affectées gardent leur provenance documentée.


## 8 octobre 2026 — configuration persistante et temps de lecture

| Problème | Options envisagées | Solution retenue / raison | Conséquence |
| --- | --- | --- | --- |
| Retour au menu efface une configuration | État React remonté ; brouillon navigateur ; sauvegarde serveur | Brouillon localStorage versionné, champs validés, repli si stockage indisponible ; conserver aussi les places temporairement masquées | Retour à l’accueil et rechargement retrouvent la configuration, sans modifier les sauvegardes de parties |
| Cartes encombrées de métadonnées et de pied de page | Réduire la police ; retirer les doublons | En-tête versement avec fonds du notice, métadonnées événement retirées, aucun bandeau inférieur ; conserver Échap et les conséquences utiles | Plus de hauteur pour la lecture ; fermer la carte utilise exactement la séquence d’application existante |
| Ajustements de cours disparaissent après un tour IA | Allonger le délai ; attendre un clic | Arrêt de MARKET_IMPACT après les notes, sans échéance, bouton Valider les cours ; animations réduites ne peuvent pas contourner cette étape | Temps de lecture identique pour humains et IA, accusé de lecture uniquement après les conséquences suivantes |
| Survol du plateau affiche un curseur d’aide sans action utile | Ajouter des infobulles ; désactiver le survol | Suppression du hit testing Pixi et pointer-events:none sur le canvas ; exploration textuelle au clavier conservée | Aucun zoom/effet au passage de la souris, caméra automatique et commandes HTML conservées |


## 8 octobre 2026 — correction du bilan financier après revenus

| Problème | Options envisagées | Solution retenue / raison | Conséquence |
| --- | --- | --- | --- |
| Versement sectoriel affiche un écran de marché sans évolution | Retirer toutes les animations de marché ; supprimer seulement les étapes vides | MARKET_IMPACT uniquement en présence de variation de note/cours, faillite ou retour de société | Un revenu ordinaire révèle directement les montants et valorisations ; les vrais changements de marché restent visibles |
| Petit bilan financier disparaît après 650 ms | Délai plus long ; validation systématique | PORTFOLIO_IMPACT sans échéance et bouton Continuer pour tous les montants | Lecture identique après humain ou IA et avec animations réduites ; accusé de lecture uniquement après clic |
| Clic répété peut fermer l’écran suivant | Temporisation ; valider le contexte du clic | Callback vérifie l’étape et le numéro du notice affichés | Une validation du marché ne peut pas fermer le bilan financier qui vient d’apparaître |

## 9 octobre 2026 — un reçu par opération

- **Problème** : une fiche par créancier, suivie d’un bilan financier redondant, ralentissait la séance et pouvait donner l’impression d’un paiement sans effet sur le fonds inspecté.
- **Options** : regrouper uniquement les notifications d’une révision dans le navigateur ; produire une synthèse côté moteur une fois la file de dettes terminée.
- **Solution** : conserver les résultats individuels dans l’historique et `pendingSettlement.completed`, puis émettre une seule notification `settlements`. L’état de départ et les revenus bancaires accompagnent la décision sauvegardée. Le client combine annonce/reçu pour les opérations immédiates et ouvre directement le desk pour les dettes non financées.
- **Raison** : les décisions peuvent traverser plusieurs commandes, connexions et révisions ; le moteur connaît la fin exacte de l’opération. Les droits et montants restent ceux du serveur.
- **Conséquence** : suppression de `PORTFOLIO_IMPACT`, retour direct après Échap ou confirmation réelle du marché ; HUD financier permanent conservé. Anciens reçus et anciennes décisions sans état de départ continuent de fonctionner sans migration destructive.

## 9 octobre 2026 — lecture par motif et mouvements nommés

- **Problème** : les titres secondaires et les libellés débiteur/créancier répétaient l’information et compliquaient la lecture du reçu.
- **Options** : conserver un encadré par créancier ; réunir les mouvements sous le motif qui les déclenche.
- **Solution** : une rubrique par motif sectoriel, avec noms réels sur les lignes de cash, revenus bancaires et transferts. Le complément payé par un créancier conserve son sens réel. Total réglé sous les lignes et carrousel conservé.
- **Raison** : la fiche explique directement la cause, puis qui paie qui et combien.
- **Conséquence** : aucun changement aux calculs, commandes, notes ou règles de règlement ; présentation compatible avec les reçus existants.


## 9 octobre 2026 — aucun revenu sectoriel sur ses propres participations

- **Problème** : la règle versait au fonds actif un revenu de la banque pour les entreprises détenues dans le secteur de sa case d’arrivée.
- **Options** : retirer uniquement le flux affiché ; supprimer effectivement le versement au niveau du moteur.
- **Solution** : ignorer les parts du fonds actif lors de la construction des paiements sectoriels, avant tout calcul ou crédit de liquidités.
- **Raison** : instruction explicite du joueur ; seul le serveur décide des flux effectifs.
- **Conséquence** : les autres détenteurs restent payés selon leurs parts et protections C/C ou A/A. Aucun crédit propre ne finance une dette ; les dividendes Événement, ventes, liquidations et flux au Départ restent distincts. Les flux déjà enregistrés dans les sauvegardes ne sont pas annulés rétroactivement ; les prochains déplacements appliquent la nouvelle règle.


## 9 octobre 2026 — ordre des joueurs fixe

- **Problème** : le premier investisseur changeait à chaque cycle, ce qui rendait les tours difficiles à suivre.
- **Options** : figer l’ancrage existant ; ajouter une liste d’ordre et une migration des sauvegardes.
- **Solution** : conserver `starterIndex`, désigné par le dé initial, puis reprendre à chaque cycle le premier fonds solvable dans l’ordre circulaire des places.
- **Raison** : instruction explicite de conserver l’ordre de départ ; l’ordre existant est déjà représenté par les places et l’ancrage.
- **Conséquence** : aucune nouvelle donnée de sauvegarde ni permutation des sièges. Les fonds insolvables sont sautés ; les détenus conservent leur tour et leur procès. Les anciennes parties figent l’ancrage actuellement enregistré : les éventuels départages initiaux ne sont pas tous conservés, donc l’ancien gagnant n’est pas deviné et aucun tour en cours n’est rejoué. Les cartes Contexte gardent un tirage unique par cycle.

## 13 octobre 2026 — progression et extrêmes sectoriels rares

- Garder 91 émetteurs et toutes les populations zone–secteur. Remplacer onze sociétés de slots existants par des sociétés cotées de 1,16–7,43 Md$; maintenir les identifiants opaques et les catalogues embarqués d’anciennes parties.
- Conserver les seuils de classes internes 40/200 Md$ et supprimer les sauts de prix par une courbe logarithmique unique à ancrages fixes. Les classes ne deviennent pas des barrières de tour ni de transaction.
- Rétablir un A et un E sectoriels par secteur sur neuf paires miroir. Le benchmark avait révélé que la v3 n’autorisait aucun E sectoriel et ne pouvait donc produire de faillite E/E. Maintenir quotas de types, couverture des axes, B=D par axe et C modal.
- Mesurer les cartes via le noyau réel, puis comparer l’économie sur les mêmes decks v4. Ne pas attribuer un changement dû aux nouveaux Contextes à la seule économie. Les portefeuilles de stress sont distingués des parties IA jouables.
- Garder la politique IA et les rendus existants. Les Large restent rares dans les 40 parties v4 mesurées; les quatre premiers achats observés ne constituent pas une trajectoire garantie pour tous les fonds.

## Lobby en ligne — préparation avant la partie

- Créer le salon et son code d’invitation avant que les humains choisissent leur marché; accepter uniquement les cinq marchés canoniques, tout en autorisant les choix identiques entre humains.
- Garder les préférences d’un joueur sous son contrôle et réinitialiser Prêt après tout changement effectif. L’hôte gère 2 à 6 places et les IA; les marchés IA sont redistribués automatiquement.
- N’omettre un invité absent qu’à la demande explicite de l’hôte. Refuser le lancement si moins de deux participants restent ou si un participant retenu n’est pas présent, prêt et configuré. Conserver les IDs de siège même lorsqu’une place crée un trou dans l’ordre.
- Persister la mutation avant commit et diffusion, avec sérialisation par salle; restaurer le siège, son état Prêt et ses préférences par session. Maintenir le parcours local et les adaptateurs historiques, mais ne pas exposer la nationalité dans le protocole online v2.
- Les contrats de partage, l’interface et le serveur portent ces étapes de lobby; le moteur de partie reste créé au lancement. Référence détaillée : [LOBBY_RULES.md](LOBBY_RULES.md).
