# Déploiement VPS de Global Fund Evolve

Evolve est installé séparément le 11 octobre 2026 sur le VPS `213.199.40.67`. La livraison reprend la PR #1 et les adaptations locales du projet ; elle ne déclenche pas le workflow GitHub de V2.

- URL : <https://global-fund-evolve.213.199.40.67.sslip.io>.
- Sources : `/home/codex/projects/global-fund-evolve`.
- Production : `/home/codex/deployments/global-fund-evolve/current`, lien vers une release autonome sous `releases/`.
- Service : `global-fund-evolve.service`, activé au démarrage ; écoute privée sur `127.0.0.1:3102`.
- Proxy : `/etc/nginx/sites-available/global-fund-evolve.conf`, avec WebSocket Socket.IO et redirection HTTP vers HTTPS.
- Certificat Let's Encrypt : `/etc/letsencrypt/live/global-fund-evolve.213.199.40.67.sslip.io/`, renouvellement Certbot/webroot et rechargement de Nginx.
- PostgreSQL : base et rôle dédiés `global_fund_evolve` ; migration idempotente avant le démarrage.
- Configuration privée : `/home/codex/deployments/global-fund-evolve/shared/evolve.env`, permissions `0600`.
- Données et sauvegardes : `/home/codex/deployments/global-fund-evolve/shared/runtime/`.

Le modèle installé pour systemd est [global-fund-evolve.vps.service.example](global-fund-evolve.vps.service.example). Le modèle Nginx est [nginx.conf.example](nginx.conf.example). Les exemples sous `/opt/` et Docker Compose restent des alternatives.

```sh
sudo systemctl status global-fund-evolve.service
curl -fsS https://global-fund-evolve.213.199.40.67.sslip.io/health
sudo journalctl -u global-fund-evolve.service -n 50
sudo nginx -t
```

La session navigateur permet de reprendre sa place ; les salons sont conservés dans PostgreSQL lors des redémarrages. Les secrets, données et dépendances sont séparés du checkout. La branche Evolve doit être publiée et son workflow configuré séparément avant d'utiliser le déploiement automatique décrit dans [GITHUB_WORKFLOW.md](GITHUB_WORKFLOW.md).

La release livrée est `20261011T191339Z-58493e0-online`. Un parcours sur l'URL publique valide création, dé, achat, passage de tour, rechargement et reprise après redémarrage du service, avec l'achat toujours enregistré dans PostgreSQL. La provenance, la validation et le contrôle d'intégrité V2 figurent dans [evolve-online-validation.json](../docs/evolve-online-validation.json).

## Archive — installation historique de Global Fund Next (version 2)

Le répertoire `/home/codex/projects/global-fund-next` est conservé comme archive V2. Son service, sa base, ses fichiers de configuration et son déploiement restent indépendants d'Evolve. Les informations suivantes documentent son installation historique ; les commandes V2 ne doivent pas être utilisées pour livrer Evolve.

- URL : https://global-fund-next.213.199.40.67.sslip.io
- Sources : `/home/codex/projects/global-fund-next`
- Dépôt public : <https://github.com/mattmofr/global-fund-next> ; `main` est livrée automatiquement après les tests GitHub Actions.
- Production : `/home/codex/deployments/global-fund-next/current`, lien vers une release construite dans `releases/<sha>`. Le checkout de sources ci-dessus reste disponible pour le développement.
- Service : `/etc/systemd/system/global-fund-next.service`, activé au démarrage, redémarrage automatique.
- Écoute privée : `127.0.0.1:3101`.
- Proxy : `/etc/nginx/sites-available/global-fund-next.conf`, lien dédié dans `sites-enabled`.
- Certificat : `/etc/letsencrypt/live/global-fund-next.213.199.40.67.sslip.io/`, renouvellement Certbot/webroot. Le chemin ACME HTTP est conservé dans le nouvel hôte.
- Stockage : PostgreSQL 16 existant, base et rôle applicatif dédiés `global_fund_next`. Les autres bases restent séparées.
- Configuration privée : `.env`, permissions `0600`, ignoré par Git ; chargée par systemd et les commandes locales. Aucun secret dans ces documents.

## Commandes de maintenance

```sh
npm ci
npm run build
npm test
npm run test:e2e
# Après un changement de code, commiter et pousser sur main pour déployer.
sudo systemctl status global-fund-next.service
curl -fsS https://global-fund-next.213.199.40.67.sslip.io/health
sudo journalctl -u global-fund-next.service -n 50
```

Le service applique la migration SQL idempotente avant son démarrage. Les salons sont sauvés avant diffusion des commandes ; les jetons de session sont stockés sous forme d'empreintes. Une reprise après redémarrage a été vérifiée avec une transaction réelle. Le navigateur doit conserver sa session locale pour reprendre sa place.

Le service de référence `global-fund.service`, son port 3001, son hôte et ses fichiers ne sont pas modifiés par ces opérations. Le manifeste d'intégrité de ses sources figure dans `docs/reference-integrity.json`. Ne lancez pas ces commandes depuis son répertoire.

Compose et les exemples génériques sous `/opt/` sont des alternatives documentées dans README.md ; le VPS utilise le compte `codex` et le lien `current` ci-dessus. La scène reste prévue pour un seul processus serveur autoritaire. Chaque livraison sauvegarde PostgreSQL avant activation, puis vérifie le service et la santé HTTPS. La procédure et ses paramètres figurent dans [GITHUB_WORKFLOW.md](GITHUB_WORKFLOW.md). La rétention des sauvegardes, leur copie externe et la validation d'une restauration complète restent à organiser.
