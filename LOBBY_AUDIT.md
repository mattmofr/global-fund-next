# Audit du lobby distant — avant modification, 13 octobre 2026

Projet actif : `/home/codex/projects/global-fund-evolve-integration`, branche `global-fund-evolve`, base `0e20bf3b807f3e0d15abe1c5a5fe5d89295d36e1`. Arbre propre avant cette itération. Le projet Evolve historique et l’archive V2 sont exclus.

Le frontend `apps/web/src/App.tsx` attend les étapes Fonds puis Places avant `store.ts:createRoom`; les invités renseignent également leur marché avant `room:join`. `server.ts:room:create` exige actuellement un marché pour chaque siège et fournit le code huit caractères. Le serveur instancie le moteur seulement à `room:start`.

`RoomView`/`RoomPlayer` dans `packages/shared/src/index.ts` portent l’état public; `StoredRoom` et ses tokens hachés sont persistés en JSONB ou fichier par le serveur. `room:resume` retrouve un siège via son jeton. Une déconnexion en lobby efface actuellement Prêt. Il n’existe aucun événement de modification des préférences après création.

Le moteur autorise les doublons de marchés humains. `diversifyStartingMarkets` ne déplace que les IA; la terminologie canonique est Amériques, Europe, Asie, Afrique & Moyen-Orient, Océanie. Les nationalités sont uniquement un adaptateur de lecture/protocole ancien.

Les 181 tests moteur/serveur et 21 parcours Playwright de la base précédente passent. `tests/server.test.ts` exige actuellement tous les invités prêts et attend Prêt=false après déconnexion; `tests/e2e/gameplay.spec.ts` choisit des marchés avant création/join. Ces attentes doivent évoluer pour le nouveau chemin en ligne, avec conservation du chemin local.

Fichiers à modifier : contrats partagés, serveur (création/préférences/slots/Prêt/lancement/reconnexion), App/store/MainMenu pour le wiring minimal, tests serveur et navigateur. Aucun CSS, asset, animation, plateau, HUD, modèle économique ou migration SQL n’est concerné. Risque identifié : omission d’un siège p2 et maintien de p3 nécessite la conservation explicite des IDs de slots dans le nouvel état moteur et dans son historique initial.
