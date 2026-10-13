# Global Fund Evolve — Architecture

## Isolation

Le projet actif est `/home/codex/projects/global-fund-evolve`, anciennement `global-fund-next-new`. Le répertoire `/home/codex/projects/global-fund-next` est conservé intact comme archive de la version 2. La référence initiale `/home/codex/projects/trading-game` reste également séparée. Evolve possède ses sources et ressources locales, ses ports 3102/5175 et ses propres identifiants de service, sessions navigateur, base et volume Compose. Aucun chemin de configuration ou de stockage actif ne cible l’archive V2.

La branche locale `global-fund-evolve` part du commit `58493e0e805820a9c5ea29d39dad4c9229afceb2` de la PR #1 du dépôt source `mattmofr/global-fund-next`, récupéré le 11 octobre 2026. La PR est en brouillon ; aucune fusion ou publication GitHub n’a été effectuée.

## Responsabilités

```text
apps/web       React 19 + TypeScript + Vite + Tailwind CSS 4
  board/       React Three Fiber + Three.js : plateau 3D, pions, dé, voyages
  trading/     React/HTML + ECharts : titres, portefeuille, diversification
  presentation/ cartes, résultats et audio
apps/server    Fastify 5 + Socket.IO : sessions, salons, commandes, IA
packages/game-engine calculs et transitions métier, sans dépendance UI/réseau
packages/shared contrats TypeScript et données d'identité
packages/ui    composants React communs, formatage
assets/        ressources locales et provenance dans ASSET_LICENSES.md
```

Le client est un outil de présentation. Il soumet une commande, ne modifie jamais le portefeuille ni les dés. Zustand conserve la connexion, la session et les instantanés serveur. Les animations utilisent une copie d'affichage ; les instantanés suivants attendent que leurs conséquences aient été présentées.

## Migration progressive du moteur

Les formules, récits, paiements, liquidations, ventes forcées et règles de justice de la version éprouvée sont extraits dans un noyau JavaScript local. Une façade TypeScript expose `createGame`, `executeCommand`, `getGameView` et `chooseAiCommand`. Elle définit les contrats et copie l'état avant chaque commande, pour qu'un refus ne laisse pas une mutation partielle. Le noyau sera typé progressivement par domaines ; une conversion mécanique immédiate de toutes ses lignes aurait accru les risques sans améliorer la première scène.

Le moteur ne dépend que de ses données et du package partagé. Il tourne dans les tests, le serveur ou une simulation sans DOM, React, PixiJS ou Socket.IO. Les simulations utilisent le même protocole que les humains. Les commandes publiques ne permettent pas de fournir un résultat de dé.

## Protocole autoritaire

Une partie possède une révision monotone. Une commande contient un identifiant unique, la révision attendue, le joueur visé et l'action. Le serveur authentifie le contrôleur, vérifie la place, le tour et la révision. Une même commande ne s'exécute qu'une fois. Le moteur vérifie prison, phase, zone, quantité, liquidités, disponibilité et règles spéciales. La nouvelle révision n'est diffusée qu'après une exécution réussie.

Un contrôleur humain peut piloter plusieurs places locales ; une place distante possède son contrôleur propre. Les IA utilisent les mêmes commandes côté serveur. Les vues publiques ne contiennent ni jetons ni paquets futurs de cartes. Les jetons de session sont comparés à leurs empreintes conservées côté serveur. Le salon expose les places, leur état prêt/connexion et un chat limité en fréquence et en longueur.

## Persistance

**PostgreSQL + Drizzle** est retenu : les schémas sont de simples définitions TypeScript, l'accès SQL reste explicite, et aucun service de génération supplémentaire n'est nécessaire. Le schéma initial conserve les salons et leur état versionné en JSONB ; une normalisation des historiques pourra suivre les mesures d'usage. `DATABASE_URL` active ce stockage. Un adaptateur fichier atomique indépendant est prévu pour développer sans base et pour les tests.

Les données de la version actuelle ne sont pas importées automatiquement. Le nouveau jeu change le plateau et les règles ; une reprise transparente de ses parties serait trompeuse.

## Règles Evolve

- Cycle 1 : indices C/C, placement gratuit sur la place de marché choisie par chaque humain, IA réparties côté serveur, sans carte Contexte ni voyage. `startingMarket` conserve l'origine et `currentMarket` expose la position courante ; `nationality` reste seulement une métadonnée de compatibilité des anciens états.
- Dès le cycle 2 : une carte Contexte collective, puis implantation → dé → case → transactions. L'ordre implantation avant dé a été confirmé par l'utilisateur le 4 octobre 2026.
- Plateau de 52 semaines. Paquet de 50 Événements distinct des 100 Contextes.
- Le contrôle 5/5 garantit au minimum C/C. Un monopole nécessite le contrôle 5/5 de **toutes** les sociétés du groupe zone/secteur et garantit au minimum A/A.
- Départ compare la valeur courante du fonds à celle de son précédent passage, en neutralisant les apports/retraits de capitaux. Une performance positive apporte 20 M€, négative retire 20 M€, nulle ne produit aucun flux. La nouvelle référence est fixée après ce flux, avant la résolution de la case d'arrivée. Le premier tour compare au capital initial de 100 M€.
- La faillite E/E liquide au prix E/E les parts détenues puis ferme la société jusqu'à l'amélioration d'au moins une note. La banque reste illimitée, conformément à l'implémentation de référence ; aucune réserve initiale n'est spécifiée dans la mission.
- La détention bloque les transactions et la perception de revenus ; la valorisation continue. Le premier procès se joue au tour suivant l'arrestation.

## Rendu et audio

React Three Fiber et Three.js rendent le plateau 3D, ses objets et la cinématique de voyage. Les menus, tableaux et décisions restent des composants HTML. La refonte du front et ses conventions sont décrites dans [REDESIGN.md](docs/REDESIGN.md). Le serveur, le moteur et le protocole issus de V2 sont conservés.

ECharts affiche uniquement l'historique réel du moteur et se libère à la fermeture des composants. Les graphiques ont un résumé HTML. Les mouvements réduits désactivent les transitions et délais superflus. L'audio démarre après un geste, reste facultatif et propose plusieurs volumes.

## Déploiement

Evolve écoute sur `127.0.0.1:3102`, avec Vite sur 5175 en développement, séparément de V2 sur 3101 et de la référence sur 3001. Le service `global-fund-evolve.service` sert une release autonome derrière Nginx à <https://global-fund-evolve.213.199.40.67.sslip.io>. PostgreSQL utilise la base et le rôle `global_fund_evolve` ; la configuration privée et le stockage sont sous `/home/codex/deployments/global-fund-evolve/shared/`. [VPS_DEPLOYMENT.md](deploy/VPS_DEPLOYMENT.md) décrit Evolve et conserve l’installation historique de V2. Docker Compose est fourni pour une installation indépendante.

## Sources techniques

- [Pixi React](https://github.com/pixijs/pixi-react), [PixiJS Assets](https://pixijs.com/8.x/guides/components/assets)
- [Fastify TypeScript](https://fastify.dev/docs/latest/Reference/TypeScript/)
- [Drizzle PostgreSQL](https://orm.drizzle.team/docs/get-started/postgresql-existing), [migrations](https://orm.drizzle.team/docs/migrations)
- [ECharts import modulaire](https://echarts.apache.org/handbook/en/basics/import/), [accessibilité](https://echarts.apache.org/handbook/en/best-practices/aria/)
- [Vite : installation et version Node](https://vite.dev/guide/)

## Validation de la première scène

La compilation et les 36 tests moteur/serveur passent. Trois parcours Playwright contrôlent aussi la console, les ordres locaux, la synchronisation distante et le rechargement. Un redémarrage du service avec PostgreSQL a conservé une transaction réelle. Le rendu est suspendu hors écran ; en mode mouvements réduits, une image est produite aux changements d'état, après l'initialisation Pixi. Les détails d'exploitation figurent dans deploy/VPS_DEPLOYMENT.md.

## Règlement-livraison — octobre 2026

La nouvelle phase métier `settlement` conserve `activePlayerId` pour le tour et expose `decisionActorId` pour la décision attendue. `getDecisionPlayerId` sert à l’authentification serveur et au choix de l’IA. Le frontend ne décide ni cours, ni valeur de transfert, ni solvabilité.

Le serveur sérialise la commande par salon, vérifie révision/contrôleur/champs, exécute sur une copie et persiste le draft avant de modifier la salle diffusée. Les offres, cours figés et files sont dans le même JSON d’état déjà sauvegardé ; aucune nouvelle table PostgreSQL ni migration destructive n’est requise. Le chemin IA suit désormais la même règle de commit après persistance.

Le desk React utilise l’état autoritaire. Les cartes/rubans continuent d’utiliser les snapshots détachés de présentation : la lecture importante ne possède plus de deadline automatique. Cette lecture ne peut ni modifier la dette ni réordonner les créanciers. Le choix confirmé pour leur ordre est NAV croissante, puis siège stable.
