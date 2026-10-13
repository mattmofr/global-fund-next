# Rapport de consolidation Global Fund Evolve

Date : 2026-10-13. Intégration préparée et validée dans `/home/codex/projects/global-fund-evolve-integration`. Le projet historique Evolve reste conservé avec son working tree d'origine.

## Sources

- Repository : [mattmofr/global-fund-next](https://github.com/mattmofr/global-fund-next).
- PR : [#1 — Refonte front](https://github.com/mattmofr/global-fund-next/pull/1), auteur **armineba**.
- Branche source : `armineba/global-fund-next:refonte-front`.
- Branche cible originale : `main`.
- Dernier commit PR audité : `58493e0e805820a9c5ea29d39dad4c9229afceb2`.
- État : ouverte, brouillon, non fusionnée ; **mergeable : oui** selon GitHub. Checks GitHub : workflow CI `38152459134`, conclusion **action_required** ; aucune check-run ni status de succès attaché au head. Les tests locaux de la PR ont été exécutés séparément.
- Projet local Evolve : `/home/codex/projects/global-fund-evolve`, branche locale `global-fund-evolve`, HEAD initial `58493e0`, 44 chemins suivis modifiés/supprimés et 21 nouveaux fichiers, aucun commit Evolve local préexistant.
- Projet V2 : `/home/codex/projects/global-fund-next`, `main` à `8f241a3`, working tree propre à l'audit.
- Copie PR pristine : `/home/codex/projects/global-fund-pr1-audit`, worktree détaché au head PR, conservé.
- Remotes de la copie d'intégration : `origin=https://github.com/mattmofr/global-fund-next.git` ; `local-evolve=/home/codex/projects/global-fund-evolve`, lecture de la source historique.

## Audit Git et base retenue

La branche par défaut GitHub est `main`. Il n'existait **aucune branche distante nommée global-fund-next**, seulement le repository de ce nom et sa version V2 sur `main`. Les projets local V2 et Evolve ont été identifiés par leurs chemins, remotes, branches, historiques et diffs. Le nom conceptuel « Global Fund Next » désigne donc la base V2 vérifiée, sans inventer ou déplacer une branche distante.

- Commit Global Fund Next / V2 : `8f241a3bd0b4bdb56c9c6e0d876221242b6e3178`.
- Commit contenant la PR entière : `58493e0e805820a9c5ea29d39dad4c9229afceb2`.
- Meilleur ancêtre commun local Evolve / PR : ce même head `58493e0` ; l'ancêtre entre Next et PR est `8f241a3`.
- La PR contient les trois commits suivants, avec auteurs et hashes originaux conservés :

```text
450a126a1b72bc1f32820ac2bbaab9169f35d698 — Claude (refonte front) — Refonte front : fondations du design system et de la scène 3D
58e3d6163e743e3fababb9f9fb24f35cd273448a — Claude (refonte front) — Refonte front : plateau 3D, interface de verre et écrans condensés
58493e0e805820a9c5ea29d39dad4c9229afceb2 — Armine Barshi — Refonte front v4 : interface simple et immersive, cinématique d'avion, animations par secteur
```

Le head de la PR descend directement de la dernière base Next, et la copie locale Evolve avait déjà ce même head. La nouvelle branche part exactement du head PR ; seul le delta local post-PR est appliqué. Aucun fichier de la PR n'est remplacé par une ancienne copie de projet.

**Choix d'intégration :** accepter le contenu de la PR directement dans Evolve, sans merge officiel de la PR sur main. La PR est en brouillon et sa CI attend une autorisation ; main peut en outre déclencher le workflow de production V2. La conservation des branches stables et de l'archive prime. La PR, son fork et main restent tels quels.

## Sauvegarde et méthode de portage

Avant le portage, le diff binaire suivi, la liste des nouveaux fichiers, l'état du working tree et 576 empreintes de fichiers ont été conservés dans `/home/codex/backups/global-fund-evolve-git/20261013T100513Z`. La branche locale de sécurité `backup/global-fund-evolve-before-pr-merge`, commit `503f7a20803f11f34e23e61801d7003bd1c1fec3`, représente toutes les modifications locales pertinentes. Le bundle autonome `evolve-local-changes.bundle` a été vérifié avec `git bundle verify` et contient l'historique complet. Le premier bundle de base est également conservé.

Le delta a été reconstitué par `git apply --index` et ajout de la liste explicite des nouveaux fichiers, puis récupéré avec `git cherry-pick --no-commit` sur la branche issue du head PR. Les changements ont été répartis en trois commits lisibles : identité/runtime et correctifs de chargement, règles/données/tests moteur, documentation et mesures. Aucun `cp -r` ou rsync de projet, `reset --hard`, suppression de branche ni force-push n'a été utilisé.

Le CLI n'étant pas authentifié pour le push, la publication utilise le **connecteur GitHub connecté**, via les objets tree/commit et la création d'une seule nouvelle ref. Chaque tree créé sur GitHub est comparé exactement à son tree local testé. Les auteurs originaux de la PR restent inchangés ; seuls les commits Evolve nouveaux portent les métadonnées générées par le connecteur. Les commits locaux de préparation sont conservés dans une branche de sécurité.

| Étape | Commit local préparé | Commit GitHub du même arbre | Contenu |
|---|---|---|---|
| 1 | `2ea55b350c790935b4c1d6607d614962fc1a5526` | `779ba4546e730a1339f2823903b8cc23f3fc3986` | Prepare isolated Evolve runtime and preserve PR interface |
| 2 | `415fd0f22cb4e16a81433df82437f6f814c70ce3` | `9275d4e47d5d592d97ccdda174139eefdf05f9d4` | Port Evolve board, market shocks and balanced card decks |
| 3 | `1f0786f2a14521d35c16462cf39a41194f3ff05f` | `fc65dbbc3a54a8bc4541887e1cfa28ae85f4aa27` | Document Evolve rules, audits and balancing evidence |

## Modifications Evolve récupérées

La checklist [EVOLVE_ENGINE_CHANGES.md](EVOLVE_ENGINE_CHANGES.md) confirme **zéro règle moteur perdue**. Elle associe chaque changement à ses fichiers et tests.

- Plateau de 52 cases : 39 cases sectorielles, 10 Événements, Bull en 14, Bear en 40, Immobilier en 26 à la place du Crash ; quatre/cinq occurrences par secteur et espacement circulaire contrôlé.
- Bull/Bear déterministes : toutes les zones ±1 niveau, zone active ±2 au total, secteurs inchangés, bornes A/E et traitement E/E conservés.
- Migration des layouts officiels v1/v2, positions/cash/historique conservés, notices figées, layouts personnalisés et versions futures protégés.
- 50 Événements, quotas 19/19/12 et cinq par secteur ; cash/titres/rachats/amendes/régulation, sans modifier les notes ou consommer le paquet Contexte.
- Ciblage par détention puis zone uniforme ; historique privé des quatre dernières entreprises, exclusion dans la zone tirée lorsque possible.
- 100 Contextes à grades absolus, 70 rotations depuis C, couverture de tous les axes et marges miroir équilibrées ; descriptions fondées sur tous les résultats réellement appliqués.
- Migration des paquets par ID, ordre et cartes inconnues conservés, Contexte révélé inchangé, protection des versions cartes/textes futures.
- Types partagés et wiring de l'identité historique des notices, suites moteur/serveur et simulateurs associés.
- Renommage Evolve, ports/origines/identifiants de session et déploiement dédiés ; correctifs de disponibilité du plateau et rendu de secours déjà présents localement. Le frontend de la PR est conservé, sans refonte supplémentaire.
- Audits, règles et rapports de validation historiques conservés comme documentation. Les sorties locales de tests, images temporaires et builds ne sont pas ajoutés.

Liste complète des fichiers du delta porté :

- `M — .env.example`
- `M — ARCHITECTURE.md`
- `A — BOARD_BALANCE_AUDIT.md`
- `A — CONTEXT_BALANCE_AUDIT.md`
- `M — DECISIONS.md`
- `M — Dockerfile`
- `M — ECONOMY_BALANCING.md`
- `A — ENGINE_AUDIT.md`
- `A — ENGINE_RULES.md`
- `A — EVENT_BALANCE_AUDIT.md`
- `M — PROGRESS.md`
- `M — README.md`
- `M — apps/server/src/index.ts`
- `M — apps/server/src/server.ts`
- `M — apps/web/index.html`
- `M — apps/web/package.json`
- `M — apps/web/public/THIRD_PARTY_NOTICES.txt`
- `M — apps/web/src/board/BoardScene.tsx`
- `M — apps/web/src/board/three/MenuHero.tsx`
- `M — apps/web/src/game/SceneLoader.tsx`
- `M — apps/web/src/presentation/CardScene.tsx`
- `M — apps/web/src/store.ts`
- `M — apps/web/vite.config.ts`
- `M — compose.yaml`
- `M — deploy/GITHUB_WORKFLOW.md`
- `M — deploy/VPS_DEPLOYMENT.md`
- `M — deploy/deploy-vps.sh`
- `M — deploy/deploy.conf.example`
- `M — deploy/github-deploy.service.conf.example`
- `A — deploy/global-fund-evolve.service.example`
- `A — deploy/global-fund-evolve.vps.service.example`
- `M — deploy/nginx.conf.example`
- `M — deploy/ssh-deploy.sh`
- `A — docs/board-deck-simulation.json`
- `A — docs/board-deck-validation.json`
- `A — docs/evolve-import-validation.json`
- `A — docs/evolve-online-validation.json`
- `A — docs/market-shock-simulation.json`
- `A — docs/market-shock-validation.json`
- `M — package-lock.json`
- `M — package.json`
- `M — packages/game-engine/README.md`
- `M — packages/game-engine/legacy/boardEventCards.cjs`
- `A — packages/game-engine/legacy/data/board-layout-v2.json`
- `M — packages/game-engine/legacy/data/gameData.json`
- `A — packages/game-engine/legacy/deckRules.cjs`
- `M — packages/game-engine/legacy/eventStories.cjs`
- `M — packages/game-engine/legacy/game.cjs`
- `A — packages/game-engine/legacy/marketRules.cjs`
- `M — packages/shared/src/index.ts`
- `M — scripts/capture-settlement.ts`
- `M — scripts/capture-visuals.ts`
- `M — scripts/redesign/shoot.ts`
- `A — scripts/simulate-board-decks.ts`
- `A — scripts/simulate-market-shocks.ts`
- `A — tests/board-balance.test.ts`
- `A — tests/card-balance.test.ts`
- `M — tests/e2e/board-game.spec.ts`
- `M — tests/e2e/financial-reading.spec.ts`
- `M — tests/e2e/settlement.spec.ts`
- `M — tests/engine.test.ts`
- `M — tests/fixtures/settlement.ts`
- `A — tests/market-shocks.test.ts`
- `A — tests/server-market-shocks.test.ts`
- `M — tests/server.test.ts`

## Conflits et décisions

**Conflits Git : aucun.** La base locale est le head exact de la PR. Aucun choix automatique ours/theirs n'a été utilisé.

| Fichier / sujet | Nature | Décision |
|---|---|---|
| `deploy/global-fund-next.service.example` | Supprimé par le renommage local antérieur, remplacé par deux exemples Evolve. | L'ancien exemple V2 est conservé dans la branche finale, en plus des exemples Evolve, pour ne rien supprimer. Le projet historique local reste dans son état initial. |
| `screenshots/terminal-preview-1366.png` | Un test Playwright réécrit une capture déjà suivie. | Capture de cette exécution sauvegardée hors Git dans le dossier de backup ; fichier suivi remis à son contenu de base, aucun artefact temporaire importé. |
| `.github/workflows/*` | Workflows partagés limités à main, avec déploiement historique. | Workflows inchangés ; aucun nouveau déclenchement de production ou modification de leur cible. |
| Dépendances | PR : Three/Fiber/Motion ; Evolve : renommage des manifestes. | Le lockfile npm de la PR est conservé, seul le nom racine Evolve change. `npm ci` réussi dans les deux copies ; un seul lockfile. |

## Migrations PostgreSQL

La migration partagée `apps/server/migrations/0000_rooms.sql` est identique dans Next, la PR et Evolve. Aucune migration supprimée ou ajoutée. Les évolutions de sauvegarde du jeu sont des migrations de payload JSON, testées au niveau moteur et serveur.

Base de validation dédiée : `gf_evolve_merge_check_20261013_102159`. Création neuve, migration puis seconde application idempotente, démarrage de l'application, salon distant/join/ready/start, lancer, achat, persistance PostgreSQL, arrêt et reprise serveur ont tous réussi. Aucune base de production utilisée. Il n'existe pas de seed séparé : `createGame` charge les données initiales. La base de validation et sa configuration privée hors repository sont conservées.

## Tests

| Validation | Résultat |
|---|---|
| PR pristine : Vitest | **135/135**, succès |
| PR pristine : typecheck et build | Succès |
| Branche intégrée : typecheck | Succès |
| Lint | Non applicable : aucun script configuré |
| Tests moteur, serveur, frontend et intégration (Vitest) | **174/174**, 13 fichiers, zéro échec |
| Playwright complet | **21/21**, zéro échec, zéro ignoré, zéro flaky, environ 230 s |
| Build production | Succès |
| PostgreSQL neuf et idempotent / sauvegarde-reprise | Succès sur base isolée |
| Création, plateau, tours, transactions, cartes, IA et multijoueur | Couvert par les suites complètes et le parcours PostgreSQL |
| Préservation moteur | Contenus runtime/types/tests/scripts identiques au backup |
| Simulation de référence | Rapports 20 parties / 2 000 paquets conservés ; empreintes des sources moteur identiques à la branche |

Preuve synthétique committée : [docs/evolve-merge-validation.json](docs/evolve-merge-validation.json). Logs détaillés et rapports des nouvelles exécutions sous `/tmp/evolve-integration-*` et `/tmp/evolve-pr1-*`, hors Git.

## Résultat

- Branche : **global-fund-evolve**.
- Remote : **origin/global-fund-evolve**.
- URL : [branche Evolve](https://github.com/mattmofr/global-fund-next/tree/global-fund-evolve).
- Commit final du code validé, avant le commit de documents de clôture : **`fc65dbbc3a54a8bc4541887e1cfa28ae85f4aa27`**.
- Arbre du code validé : `22138af59230bf97ad68c52b08b1922d075cf0e7`.
- Le commit de clôture ajoute ce rapport, la checklist et la preuve, sans changer le code validé. Son SHA final se résout avec `git rev-parse origin/global-fund-evolve` et figure dans le compte-rendu de fin de mission ; il ne peut pas être inclus dans le contenu de son propre commit sans changer ce SHA.
- Aucun force-push, merge sur main, changement de PR, suppression de projet/branche ni modification du déploiement de production.
- Le projet Evolve historique, la version V2 et les branches existantes sont conservés. La copie d'intégration sert à la revue de la branche publiée.

## Graphe Git

La filiation publiée est linéaire :

```text
Next main 8f241a3
  └─ PR 450a126 → 58e3d61 → 58493e0 (armineba/refonte-front)
       └─ 779ba45 runtime Evolve
            └─ 9275d4e règles moteur Evolve
                 └─ fc65dbb audits et mesures Evolve
                      └─ documents de clôture (origin/global-fund-evolve)
```

Les commits locaux de préparation et le WIP de sécurité sont également conservés. Commande complète : `git log --graph --oneline --decorate --all`.
