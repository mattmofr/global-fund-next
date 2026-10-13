# Développer Global Fund Evolve sur Mac

Le dépôt source conserve le nom `mattmofr/global-fund-next`. Pour créer un clone Evolve indépendant de l’archive V2 et récupérer la PR #1 :

```sh
git clone https://github.com/mattmofr/global-fund-next.git global-fund-evolve
cd global-fund-evolve
git fetch origin refs/pull/1/head:refs/remotes/origin/pr/1
git switch -c global-fund-evolve origin/pr/1
git config user.name mattmofr
git config user.email 60547926+mattmofr@users.noreply.github.com
```

La PR est encore en brouillon. Le commit récupéré le 11 octobre 2026 est `58493e0e805820a9c5ea29d39dad4c9229afceb2`. Les adaptations locales du nom et des ports sont documentées dans [README.md](../README.md) et [DECISIONS.md](../DECISIONS.md). Une fois ces adaptations appliquées, `npm ci`, `cp -n .env.example .env` puis `npm run dev` lancent Evolve sur <http://localhost:5175>, avec son serveur sur 3102.

Pour récupérer une mise à jour ultérieure de la PR dans un clone Evolve, conserver d’abord les modifications locales dans un commit, puis récupérer sa référence et examiner les changements avant intégration :

```sh
git fetch origin refs/pull/1/head:refs/remotes/origin/pr/1
git log --oneline HEAD..origin/pr/1
git diff HEAD...origin/pr/1
```

Le répertoire `global-fund-next` reste l’archive V2. Evolve est livré séparément sur <https://global-fund-evolve.213.199.40.67.sslip.io> depuis un instantané des sources locales, avec son service sur 3102 et sa base dédiés. Cette livraison ne passe pas par le workflow GitHub historique. Voir [VPS_DEPLOYMENT.md](VPS_DEPLOYMENT.md).

Pour une future livraison Evolve, `deploy.conf.example` prévoit `DEPLOY_REF=refs/heads/global-fund-evolve`. Cette branche doit contenir les adaptations Evolve et être publiée avant d’activer le déploiement. Le workflow GitHub historique reste lié à `main` et au VPS V2 ; il nécessite une configuration distincte pour Evolve.

## Historique — développement et livraison de V2 sur le VPS

Les sections suivantes conservent la procédure V2 et ses paramètres d’origine. Le déploiement existant sur `main` reste celui de V2 ; une publication d’Evolve nécessite une configuration distincte.

Ce dépôt est public : GitHub Actions peut donc récupérer le code sans clé de lecture du dépôt. Le workflow **CI** exécute les tests unitaires, le build et les tests Playwright avant toute livraison. Le workflow **Deploy VPS** démarre uniquement après la réussite d’un workflow CI déclenché par un push sur `main`; une CI de pull request ne peut pas déployer.

Le VPS est `213.199.40.67`, accessible en SSH sur le port 22 sous le compte `codex`. GitHub transmet uniquement le SHA du commit testé à une clé dédiée, limitée côté serveur à la commande `deploy <sha40>`. Le serveur récupère le code public depuis GitHub. Il n’y a donc pas besoin de clé GitHub de lecture dans les secrets Actions.

### Première installation sur Mac

Installez [Node.js](https://nodejs.org/en/download) 22.12 ou plus récent et Git. Clonez le dépôt public :

```sh
git clone https://github.com/mattmofr/global-fund-next.git
cd global-fund-next
git config user.name mattmofr
git config user.email 60547926+mattmofr@users.noreply.github.com
npm ci
cp -n .env.example .env
npm run dev
```

Ouvrez <http://localhost:5174>. Le fichier `.env` est local et ignoré par Git. Les deux commandes `git config` définissent l'auteur des commits uniquement pour ce clone et utilisent l'adresse GitHub qui masque votre e-mail personnel.

Pour pousser depuis le Terminal, installez [GitHub CLI pour Mac](https://github.com/cli/cli#installation), puis connectez votre compte dans le navigateur :

```sh
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git
```

Vous pouvez conserver votre méthode d'authentification Git existante si elle fonctionne déjà sur votre Mac. GitHub CLI n'est pas nécessaire pour lancer le jeu localement.

### Envoyer un changement

Travaillez dans le clone Mac, exécutez localement les vérifications utiles, puis commitez et poussez sur `main` :

```sh
git pull --ff-only
git status --short
git add <fichiers-voulus>
git commit -m "Décrire le changement"
git push origin main
```

N’ajoutez pas `.env`, des sauvegardes, des données de `runtime/` ou des secrets. Une PR vers `main` déclenche les tests CI, sans livraison. Un push direct ou un merge sur `main` déclenche d’abord la CI; si elle réussit, Actions demande au VPS de livrer le SHA précis testé. Si un commit plus récent est déjà sur `main` avant l’activation, le serveur ignore cette ancienne livraison.

### Configurer GitHub Actions

Dans **Settings → Environments → production**, les variables et secrets suivants configurent le déploiement :

| Nom | Type | Valeur |
| --- | --- | --- |
| `VPS_HOST` | Variable | `213.199.40.67` |
| `VPS_USER` | Variable | `codex` |
| `VPS_PORT` | Variable | `22` |
| `VPS_SSH_PRIVATE_KEY` | Secret | Clé privée dédiée au déploiement, dont la clé publique VPS est autorisée avec la commande forcée `ssh-deploy.sh` |
| `VPS_KNOWN_HOSTS` | Secret | Entrée `known_hosts` vérifiée pour l’adresse et le port du VPS |

Obtenez et vérifiez l’empreinte de la clé d’hôte par un canal de confiance avant de renseigner `VPS_KNOWN_HOSTS`; n’acceptez pas une empreinte affichée sans vérification. Ne réutilisez pas une clé personnelle. La clé dédiée ne doit permettre que `deploy <sha40>` et le workflow vérifie l’hôte strictement avec `StrictHostKeyChecking=yes`.

Le workflow attend exactement le nom CI `CI`. Gardez ce nom stable ou mettez à jour le filtre `workflow_run` du workflow de déploiement en même temps. Il vérifie également que le workflow réussi vient d’un push sur `main` dans ce dépôt, et ne lance aucun code de pull request sur le VPS.

### Ce que fait une livraison

Le checkout de développement historique `/home/codex/projects/global-fund-next` reste séparé et n’est pas utilisé comme répertoire de production. Le script serveur crée une release dans `/home/codex/deployments/global-fund-next/releases/<sha40>` puis fait pointer `current` vers elle. Chaque release reçoit des liens vers la configuration `.env` et le stockage `runtime` originaux, qui restent hors de Git. Les ressources web hashées de la release précédente sont conservées pour les navigateurs déjà ouverts.

Le serveur prépare et construit la release avant l’activation. Juste avant le redémarrage et l’exécution de la migration idempotente par systemd, il effectue un `pg_dump` PostgreSQL. Si la sauvegarde échoue, le déploiement s’arrête avant l’activation. Après le redémarrage, le script vérifie le service et `/health`, puis l’URL publique. En cas d’échec pendant l’activation, il remet `current` sur la release précédente et redémarre le service.

La sauvegarde protège les données, mais le déploiement ne restaure pas automatiquement la base si une migration a déjà modifié son schéma. Une restauration de base est une opération distincte à décider et à effectuer avec précaution; le retour de version du code ne l’annule pas.

Les releases et sauvegardes sont conservées sous `/home/codex/deployments/global-fund-next/`. Sur le VPS, elles nécessitent une politique de rétention et de vérification des sauvegardes; ne supprimez pas `current`, `previous-release`, le stockage `runtime` ou les seules sauvegardes disponibles.

### Vérifier ou annuler une livraison

Consultez l’exécution **Deploy VPS** dans l’onglet Actions. Sur le VPS, vérifiez le service et la santé HTTP :

```sh
sudo systemctl status global-fund-next.service
curl -fsS https://global-fund-next.213.199.40.67.sslip.io/health
sudo journalctl -u global-fund-next.service -n 50
```

Pour annuler une livraison, arrêtez d’abord les exécutions de déploiement Actions afin qu’aucune ne change `current` pendant le retour. Connectez-vous au VPS, puis exécutez le bloc ci-dessous. Le verrou `flock` sérialise le retour avec le script de livraison. Il remet le code sur la dernière release enregistrée comme précédente et redémarre systemd; il ne restaure pas PostgreSQL.

```sh
flock /home/codex/deployments/global-fund-next/deploy.lock bash -c '
  set -euo pipefail
  root=/home/codex/deployments/global-fund-next
  previous=$(cat "$root/previous-release")
  test -d "$previous"
  temporary=$(mktemp -d "$root/.rollback.XXXXXX")
  trap '\''rm -rf "$temporary"'\'' EXIT
  ln -s "$previous" "$temporary/current"
  mv -Tf "$temporary/current" "$root/current"
  sudo -n /usr/bin/systemctl restart global-fund-next.service
  curl --fail --silent --show-error --max-time 15 https://global-fund-next.213.199.40.67.sslip.io/health
'
```

Si le retour échoue, consultez `journalctl` et gardez la sauvegarde associée à la livraison. Une restauration PostgreSQL ne doit être faite qu’après avoir choisi explicitement le dump correspondant et évalué les écritures enregistrées depuis la migration.
