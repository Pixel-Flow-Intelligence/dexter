# Shared SSH defaults for Dexter remote targets.
# Same host/key as nofx; Dexter lives in a separate directory.

REMOTE_HOST="${REMOTE_HOST:-45.76.149.53}"
REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_PORT="${REMOTE_PORT:-22}"
REMOTE_KEY="${REMOTE_KEY:-$HOME/.ssh/nofx}"
REMOTE_PROJECT_DIR="${REMOTE_PROJECT_DIR:-/root/Project/dexter}"
LAST_SESSION_FILE="${REMOTE_PROJECT_DIR}/.dexter/last-session"
REMOTE_ENV_FILE="${REMOTE_ENV_FILE:-${REMOTE_PROJECT_DIR}/.env}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SESSION_CLI=(bun "${REPO_ROOT}/src/remote/session-cli.ts")

SSH_ARGS=(
  -i "${REMOTE_KEY}"
  -p "${REMOTE_PORT}"
  -o BatchMode=yes
  -o StrictHostKeyChecking=no
  -o ConnectTimeout=15
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=3
  -o TCPKeepAlive=yes
  -o IdentitiesOnly=yes
)

SCP_ARGS=(
  -i "${REMOTE_KEY}"
  -P "${REMOTE_PORT}"
  -o BatchMode=yes
  -o StrictHostKeyChecking=no
  -o ConnectTimeout=15
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=3
  -o TCPKeepAlive=yes
  -o IdentitiesOnly=yes
)

normalize_git_url() {
  printf '%s\n' "$1" | sed -E 's#^git@github\.com[^:]+:#git@github.com:#'
}

ssh_run() {
  ssh "${SSH_ARGS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" "$@"
}

ssh_tty() {
  ssh -t "${SSH_ARGS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" "$@"
}

scp_file() {
  scp "${SCP_ARGS[@]}" "$@"
}

remote_live_sessions() {
  ssh_run "tmux list-sessions -F '#{session_name}' 2>/dev/null | grep '^dexter-' || true"
}

remote_last_session() {
  ssh_run "cat '${LAST_SESSION_FILE}' 2>/dev/null || true"
}

require_remote_tools() {
  ssh_run 'bash -s' <<'EOS'
set -euo pipefail
export PATH="$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
missing=0
if ! command -v tmux >/dev/null 2>&1; then
  echo "❌ Remote host is missing tmux. Install it first (e.g. apt install tmux)."
  missing=1
fi
if ! command -v bun >/dev/null 2>&1; then
  echo "❌ Remote host is missing bun. Install it first: curl -fsSL https://bun.com/install | bash"
  missing=1
fi
if [ "$missing" -ne 0 ]; then
  exit 1
fi
EOS
}

require_remote_repo() {
  if ! ssh_run "test -d '${REMOTE_PROJECT_DIR}/.git'"; then
    echo "❌ Remote Dexter checkout is missing at ${REMOTE_PROJECT_DIR}."
    echo "   Run: make remote-sync"
    exit 1
  fi
  if ! ssh_run "test -f '${REMOTE_ENV_FILE}'"; then
    echo "❌ Remote ${REMOTE_ENV_FILE} is missing."
    echo "   Copy env.example into .tmp-remote-env/.env, fill keys, then: make remote-push-env"
    exit 1
  fi
}
