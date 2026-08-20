#!/usr/bin/env bash
# Clone or fast-forward the remote Dexter checkout, install Node dependencies, and build.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=remote-common.sh
source "${SCRIPT_DIR}/remote-common.sh"

if [ -n "${REMOTE_GIT_URL:-}" ]; then
  GIT_URL="$(normalize_git_url "${REMOTE_GIT_URL}")"
else
  GIT_URL="$(normalize_git_url "$(git -C "${REPO_ROOT}" remote get-url origin)")"
fi

echo "🚀 Syncing Dexter on ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PROJECT_DIR}"
echo "   git: ${GIT_URL}"

ssh_run "bash -s" <<EOS
set -euo pipefail
export PATH="/usr/local/bin:/usr/bin:/bin:\$PATH"
if ! command -v git >/dev/null 2>&1; then
  echo "❌ Remote host is missing git."
  exit 1
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "❌ Remote host is missing node or npm. Install Node.js first."
  exit 1
fi

if [ -d '${REMOTE_PROJECT_DIR}/.git' ]; then
  echo "🔧 Ensuring root owns ${REMOTE_PROJECT_DIR} (avoids git dubious ownership)"
  chown -R root:root '${REMOTE_PROJECT_DIR}'
  if ! git config --global --get-all safe.directory 2>/dev/null | grep -Fxq '${REMOTE_PROJECT_DIR}'; then
    git config --global --add safe.directory '${REMOTE_PROJECT_DIR}'
  fi
  cd '${REMOTE_PROJECT_DIR}'
  echo "⬇️  git fetch + reset to origin (keeps .env / .dexter)"
  git -c safe.directory='${REMOTE_PROJECT_DIR}' fetch origin
  branch="\$(git -c safe.directory='${REMOTE_PROJECT_DIR}' rev-parse --abbrev-ref HEAD)"
  git -c safe.directory='${REMOTE_PROJECT_DIR}' reset --hard "origin/\${branch}"
  git -c safe.directory='${REMOTE_PROJECT_DIR}' clean -fd -e .env -e .dexter -e node_modules
elif [ -e '${REMOTE_PROJECT_DIR}' ]; then
  echo "❌ ${REMOTE_PROJECT_DIR} exists but is not a git checkout."
  exit 1
else
  mkdir -p "\$(dirname '${REMOTE_PROJECT_DIR}')"
  echo "⬇️  git clone"
  git clone '${GIT_URL}' '${REMOTE_PROJECT_DIR}'
  chown -R root:root '${REMOTE_PROJECT_DIR}'
  cd '${REMOTE_PROJECT_DIR}'
fi

echo "📦 npm install"
npm install --no-package-lock --no-audit --no-fund
echo "🔨 npm run build"
npm run build
echo "✅ Remote Dexter is synced at \$(git -c safe.directory='${REMOTE_PROJECT_DIR}' rev-parse --short HEAD)"
if [ ! -f '${REMOTE_ENV_FILE}' ]; then
  echo "⚠️  Remote .env is missing. Copy env.example to .tmp-remote-env/.env, fill keys, then: make remote-push-env"
fi
EOS
