# Règles du lobby en ligne

Ce document décrit le nouveau lobby en ligne et sa compatibilité avec l’ancien parcours local et les sauvegardes. Le client web, les contrats partagés et le serveur portent le flux de préparation; le moteur de jeu n’est créé qu’au lancement.

## Création et code d’invitation

Le bouton **Nouvelle partie en ligne** ouvre un salon avant le choix des marchés. Le serveur génère un identifiant aléatoire de quatre octets affiché comme code canonique de huit caractères hexadécimaux majuscules (`roomCode`); le code et l’identifiant du salon désignent la même salle. Le lien d’invitation transmet ce code.

Les cinq marchés initiaux valides sont Amériques (`americas`), Europe (`europe`), Asie (`asia`), Afrique & Moyen-Orient (`africa`) et Océanie (`oceania`). Aucun sixième marché n’est accepté. Un humain choisit son marché dans le lobby; deux humains peuvent choisir le même. Le serveur n’impose pas de diversité aux choix humains. Une place IA reçoit une place automatiquement répartie parmi les marchés afin de diversifier la table.

Les nouvelles salles en ligne utilisent le protocole de lobby v2 : elles n’utilisent pas la nationalité pour choisir le marché. Les anciens salons/sauvegardes gardent le chemin historique v1, qui sait encore adapter une nationalité enregistrée à un marché canonique. Les demandes de nationalité ne sont pas acceptées dans un lobby v2.

## Places et préférences

L’hôte peut configurer de deux à six places, en ajoutant ou retirant des places non attribuées et en convertissant une place libre entre humain local, invité distant et IA. Il peut régler la difficulté d’une IA. La place de l’hôte reste locale; une place distante réclamée ne peut être ni supprimée ni convertie, afin de préserver sa session de reconnexion. La numérotation des places ajoutées est monotone : après une suppression, un nouvel ID n’est pas réutilisé.

Chaque joueur contrôle uniquement ses propres préférences (nom, marché de départ, pion). L’hôte peut modifier les préférences d’une IA. Une modification réelle des préférences d’un humain annule son état Prêt; il doit le confirmer à nouveau. Le serveur refuse Prêt si le nom ou le marché de départ manque. Les places IA sont prêtes automatiquement et leur marché est recalculé lorsque la composition ou les marchés humains changent.

Le bouton **Configurer le fonds** ouvre la fenêtre de paramètres existante, avec les contrôles autorisés pour cette place. Le nom saisi est enregistré avant Fermer ou Prêt. Le code reste affiché dans le lobby; aucune feuille de styles, animation ou direction artistique n’est modifiée. Lorsqu’une place distante est absente, le bouton de lancement indique **Lancer sans N invité(s)** et l’état du lobby explique cette absence; cette action envoie explicitement `omitAbsent: true`.

## Attribution des invités et lancement

Un invité prend la première place distante non réclamée et reçoit une session secrète liée à son ID de place. Le code de salon seul ne permet pas de contrôler une place déjà attribuée. Seul l’hôte lance. Le lancement normal exige au moins deux participants, tous connectés, configurés avec un nom et un marché, et prêts. Les IA comptent comme participantes et sont prêtes automatiquement.

Si un invité est absent, le lobby propose une action explicite de lancement sans les places distantes absentes. Le serveur exclut alors ces places, puis exige qu’il reste au moins deux participants et que chacun des participants retenus soit présent, prêt et configuré. L’omission n’est jamais implicite. Les places absentes restent visibles dans la salle marquées comme exclues. Leurs IDs ne sont pas renumérotés : si `p2` est omis et `p3` participe, le jeu et les clés de l’historique de marché conservent `p3`. Une session associée à une place exclue ne peut pas rejoindre la partie lancée.

## Reconnexion, persistance et compatibilité

Une reconnexion authentifiée par le jeton de session restaure le même siège, ses préférences, son marché et son état Prêt. Le nouvel onglet reprend l’état de partie; un second contrôle remplace l’ancien contrôleur pour ce siège. Le jeton brut n’est pas diffusé dans la vue de salle, seul son hachage est persisté.

Les mutations de salle sont sérialisées par ID, appliquées sur une copie, persistées avant leur commit en mémoire et avant la diffusion aux autres clients. PostgreSQL enregistre la salle par upsert de sa ligne JSONB. Le stockage fichier séquence les écritures depuis le dernier snapshot durable et remplace le fichier au moyen d’un temporaire puis d’un renommage atomique; une erreur de sauvegarde renvoie `PERSISTENCE_ERROR` sans publier la mutation. La création n’ajoute pas de salle en mémoire avant sa sauvegarde réussie et les créations sont sérialisées pour garantir l’unicité du code.

Le parcours local historique reste disponible et conserve son choix de marché avant le lancement. Les adaptations de nationalité et les payloads de salons v1 restent compatibles; elles ne sont pas un mécanisme du nouveau lobby online v2.

## Couverture de test recensée

Validation finale : 192 tests unitaires/intégration et 22 parcours Playwright réussis, typecheck et build réussis. Les 11 tests lobby ci-dessous passent. Les essais PostgreSQL et visuels sont consignés dans [docs/evolve-lobby-validation.json](docs/evolve-lobby-validation.json).

Dans `tests/lobby-server.test.ts` :

- `creates before market selection and permits duplicate human markets`
- `rejects invalid profile targets and malformed/prototype payload values`
- `lets the host manage only unclaimed slots and never removes a claimed remote seat`
- `spreads five AI seats across all canonical markets`
- `preserves seat IDs and history keys when an absent remote is omitted at start`
- `serializes concurrent readiness and start without starting an unconfigured room`
- `serializes a concurrent remote claim against omission at start`
- `keeps ready and profile data across disconnect, file persistence, and resume`
- `requires two participants after omission and keeps legacy local setup`
- `rolls back failed lobby persistence for profile, slots, join, ready, and start`
- `does not leave a ghost room on failed create and persists concurrent creates together`

Parcours navigateur correspondants dans `tests/e2e/gameplay.spec.ts` : `un salon distant synchronise état prêt, lancement et reconnexion après rechargement` et `l’hôte peut lancer avec une IA et une place distante absente sans renuméroter les fonds`. Les tests de compatibilité restent aussi dans `tests/server.test.ts`.
