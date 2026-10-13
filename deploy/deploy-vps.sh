#!/usr/bin/env bash
set -Eeuo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin
umask 077

if [[ $# != 1 || ! "$1" =~ ^[a-f0-9]{40}$ ]]; then
  echo 'Usage: deploy-vps.sh <40-character commit SHA>' >&2
  exit 64
fi
commit=$1
# This configuration and these helpers are installed by root, outside releases.
source /etc/global-fund-evolve/deploy.conf
: "${DEPLOY_REF:?Configure the published Evolve branch in deploy.conf}"
helpers=/usr/local/libexec/global-fund-evolve
service=global-fund-evolve.service
stage=''
switched=false
previous=''
link_temp=''

mkdir -p "$DEPLOY_ROOT/releases" "$DEPLOY_ROOT/backups"
exec 9> "$DEPLOY_ROOT/deploy.lock"
flock -w 900 9

cleanup() {
  if [[ -n "$stage" && "$stage" == "$DEPLOY_ROOT/releases/.stage-"* ]]; then
    rm -rf -- "$stage"
  fi
  if [[ -n "$link_temp" ]]; then rm -f -- "$link_temp"; fi
}

switch_release() {
  link_temp="$DEPLOY_ROOT/.current-$$-$RANDOM"
  ln -s -- "$1" "$link_temp" || return
  mv -Tf -- "$link_temp" "$DEPLOY_ROOT/current" || return
  link_temp=''
}

finish() {
  local result=$?
  trap - EXIT INT TERM HUP
  set +e
  if [[ "$switched" == true && -d "$previous" ]]; then
    echo 'Activation failed; restoring the previous code version.' >&2
    if ! switch_release "$previous"; then
      echo 'Could not restore the previous release link; inspect current.' >&2
    elif ! sudo -n /usr/bin/systemctl restart "$service"; then
      echo 'Previous service could not restart; inspect its journal.' >&2
    fi
  fi
  cleanup
  exit "$result"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

repository="$DEPLOY_ROOT/repository.git"
if [[ ! -d "$repository" ]]; then
  git init --bare "$repository"
  git --git-dir="$repository" remote add origin "$REPOSITORY_URL"
fi
git --git-dir="$repository" fetch --no-tags --depth=1 origin \
  "+$DEPLOY_REF:refs/heads/deployment"
head=$(git --git-dir="$repository" rev-parse refs/heads/deployment)
if [[ "$head" != "$commit" ]]; then
  echo 'A newer commit exists on the deployment ref; this outdated deployment is skipped.'
  exit 0
fi

previous=$(readlink -f "$DEPLOY_ROOT/current")
test -d "$previous"
test -r "$ENV_FILE"
test -d "$RUNTIME_DIR"
release="$DEPLOY_ROOT/releases/$commit"
if [[ "$previous" == "$release" ]]; then
  curl --fail --silent --show-error --max-time 10 "$HEALTH_URL" > /dev/null
  echo "Already deployed: $commit"
  exit 0
fi

if [[ ! -f "$release/.deployment-ready" ]]; then
  stage=$(mktemp -d "$DEPLOY_ROOT/releases/.stage-$commit.XXXXXX")
  git --git-dir="$repository" archive "$commit" | tar -xf - -C "$stage"
  ln -s "$ENV_FILE" "$stage/.env"
  ln -s "$RUNTIME_DIR" "$stage/runtime"
  # Preserve the hashed assets used by browsers opened before this deployment.
  if [[ -d "$previous/apps/web/dist" ]]; then
    ln -s "$previous/apps/web/dist" "$stage/apps/web/dist"
  fi
  (
    cd "$stage"
    npm ci --no-audit --no-fund
    npm run build
  )
  printf '%s\n' "$commit" > "$stage/.deployment-ready"
  test ! -e "$release"
  mv "$stage" "$release"
  stage=''
fi

backup="$DEPLOY_ROOT/backups/$(date -u +%Y%m%dT%H%M%SZ)-$commit.dump"
/usr/local/bin/node "$helpers/backup-database.mjs" "$ENV_FILE" "$backup"

# Check the deployment ref again before migrating or restarting anything.
git --git-dir="$repository" fetch --no-tags --depth=1 origin \
  "+$DEPLOY_REF:refs/heads/deployment"
if [[ "$(git --git-dir="$repository" rev-parse refs/heads/deployment)" != "$commit" ]]; then
  echo 'The deployment ref changed during preparation; activation is skipped.'
  exit 0
fi

switched=true
switch_release "$release"
# systemd applies the existing idempotent SQL migration in ExecStartPre.
sudo -n /usr/bin/systemctl restart "$service"

healthy=false
for attempt in {1..30}; do
  if /usr/bin/systemctl is-active --quiet "$service" && \
    curl --fail --silent --max-time 2 "$HEALTH_URL" > /dev/null; then
    healthy=true
    break
  fi
  sleep 1
done
if [[ "$healthy" != true ]]; then
  echo 'The new service failed its health check.' >&2
  false
fi
curl --fail --silent --show-error --max-time 15 "$PUBLIC_HEALTH_URL" > /dev/null
printf '%s\n' "$previous" > "$DEPLOY_ROOT/previous-release"
printf '%s\n' "$commit" > "$DEPLOY_ROOT/deployed-commit"
switched=false
echo "Deployed and verified: $commit"
# Releases and database backups remain available for manual rollback/recovery.
