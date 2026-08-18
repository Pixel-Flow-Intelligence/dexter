#!/usr/bin/env bash
# Clone or fast-forward the remote Dexter checkout, then bun install.
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
export PATH="\$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:\$PATH"
if ! command -v git >/dev/null 2>&1; then
  echo "❌ Remote host is missing git."
  exit 1
fi
if ! command -v bun >/dev/null 2>&1; then
  echo "❌ Remote host is missing bun. Install it first: curl -fsSL https://bun.com/install | bash"
  exit 1
fi

if [ -d '${REMOTE_PROJECT_DIR}/.git' ]; then
  cd '${REMOTE_PROJECT_DIR}'
  echo "⬇️  git pull --ff-only"
  git pull --ff-only
elif [ -e '${REMOTE_PROJECT_DIR}' ]; then
  echo "❌ ${REMOTE_PROJECT_DIR} exists but is not a git checkout."
  exit 1
else
  mkdir -p "\$(dirname '${REMOTE_PROJECT_DIR}')"
  echo "⬇️  git clone"
  git clone '${GIT_URL}' '${REMOTE_PROJECT_DIR}'
  cd '${REMOTE_PROJECT_DIR}'
fi

echo "📦 bun install"
bun install
echo "✅ Remote Dexter is synced at \$(git rev-parse --short HEAD)"
if [ ! -f '${REMOTE_ENV_FILE}' ]; then
  echo "⚠️  Remote .env is missing. Copy env.example to .tmp-remote-env/.env, fill keys, then: make remote-push-env"
fi
EOS
