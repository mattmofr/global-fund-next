#!/usr/bin/env bash
set -euo pipefail

# Installed root-owned outside the checkout. This key grants only this command.
if [[ ! "${SSH_ORIGINAL_COMMAND:-}" =~ ^deploy\ ([a-f0-9]{40})$ ]]; then
  echo 'Only "deploy <40-character commit SHA>" is allowed.' >&2
  exit 64
fi

exec /usr/bin/env -i HOME=/home/codex PATH=/usr/local/bin:/usr/bin:/bin \
  /usr/bin/bash /usr/local/libexec/global-fund-evolve/deploy-vps.sh "${BASH_REMATCH[1]}"
