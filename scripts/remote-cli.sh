#!/usr/bin/env bash
# Attach to or create a remote Dexter CLI tmux session.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=remote-common.sh
source "${SCRIPT_DIR}/remote-common.sh"

usage() {
  cat <<'EOF'
Usage: scripts/remote-cli.sh [attach|new|list|kill|status] [session]

  attach [session]  Attach to the last session, or a named one
  new               Create an auto-named session and attach
  list              List live dexter-* sessions
  kill [session]    Kill the last session, or a named one
  status            Check remote tmux/bun/repo/.env
EOF
}

write_last_session() {
  local session=$1
  ssh_run "bash -s" <<EOS
set -euo pipefail
mkdir -p '${REMOTE_PROJECT_DIR}/.dexter'
printf '%s\n' '${session}' > '${LAST_SESSION_FILE}'
EOS
}

pane_command() {
  local session=$1
  ssh_run "tmux display-message -t '${session}' -p '#{pane_current_command}' 2>/dev/null || true"
}

start_bun_in_session() {
  local session=$1
  ssh_run "bash -s" <<EOS
set -euo pipefail
export PATH="\$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:\$PATH"
tmux send-keys -t '${session}' C-c
tmux send-keys -t '${session}' "export PATH=\"\$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:\$PATH\"; export DEXTER_HOME=\".dexter/sessions/${session}\"; bun start" C-m
EOS
}

ensure_bun_running() {
  local session=$1
  local current
  current="$(pane_command "${session}")"
  if [ "${current}" = "bun" ]; then
    return 0
  fi
  echo "↺ Dexter is not running in ${session}; restarting bun start"
  start_bun_in_session "${session}"
}

attach_tty() {
  local session=$1
  write_last_session "${session}"
  echo "🔗 Attaching to ${session} (detach with tmux prefix + d, default Ctrl-b d)"
  ssh_tty "export PATH=\"\$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:\$PATH\"; tmux attach -t '${session}'"
}

attach_session() {
  local session=$1
  if ! ssh_run "tmux has-session -t '${session}' 2>/dev/null"; then
    echo "❌ Remote session '${session}' is not running."
    echo "   Run: scripts/remote-cli.sh list"
    exit 1
  fi
  ensure_bun_running "${session}"
  attach_tty "${session}"
}

create_session() {
  local live existing name
  live="$(remote_live_sessions)"
  existing="$(printf '%s' "${live}" | tr '\n' ',')"
  name="$("${SESSION_CLI[@]}" name --existing "${existing}")"
  ssh_run "bash -s" <<EOS
set -euo pipefail
export PATH="\$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:\$PATH"
mkdir -p '${REMOTE_PROJECT_DIR}/.dexter/sessions/${name}'
cd '${REMOTE_PROJECT_DIR}'
tmux new-session -d -s '${name}' -c '${REMOTE_PROJECT_DIR}' "export PATH=\"\$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:\$PATH\"; export DEXTER_HOME=\".dexter/sessions/${name}\"; bun start; exec bash"
EOS
  echo "✨ Created session ${name}"
  attach_tty "${name}"
}

cmd_attach() {
  local requested=${1:-}
  require_remote_tools
  require_remote_repo
  if [ -n "${requested}" ]; then
    attach_session "${requested}"
    return
  fi

  local last live decision
  last="$(remote_last_session | tr -d '\r')"
  live="$(remote_live_sessions)"
  decision="$("${SESSION_CLI[@]}" resolve --last "${last}" --live "${live}")"
  if [ "${decision}" = "create" ]; then
    create_session
    return
  fi
  attach_session "${decision#attach }"
}

cmd_list() {
  require_remote_tools
  local last live
  last="$(remote_last_session | tr -d '\r')"
  live="$(remote_live_sessions)"
  if [ -z "${live}" ]; then
    echo "No remote Dexter sessions."
    return
  fi
  echo "Remote Dexter sessions (* = last):"
  while IFS= read -r session; do
    [ -z "${session}" ] && continue
    if [ "${session}" = "${last}" ]; then
      echo " * ${session}"
    else
      echo "   ${session}"
    fi
  done <<< "${live}"
}

cmd_kill() {
  local requested=${1:-}
  require_remote_tools
  local last session
  last="$(remote_last_session | tr -d '\r')"
  session="${requested:-${last}}"
  if [ -z "${session}" ]; then
    echo "❌ No session to kill."
    exit 1
  fi
  if ! ssh_run "tmux has-session -t '${session}' 2>/dev/null"; then
    echo "❌ Remote session '${session}' is not running."
    exit 1
  fi
  ssh_run "tmux kill-session -t '${session}'"
  echo "🗑  Killed ${session}"

  local remaining next
  remaining="$(remote_live_sessions)"
  if [ "${session}" = "${last}" ]; then
    next="$(printf '%s\n' "${remaining}" | awk 'NF{n=$0} END{print n}')"
    if [ -n "${next}" ]; then
      write_last_session "${next}"
    else
      ssh_run "rm -f '${LAST_SESSION_FILE}'"
    fi
  fi
}

cmd_status() {
  echo "🔎 Remote ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PROJECT_DIR}"
  ssh_run "bash -s" <<EOS
set -euo pipefail
export PATH="\$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:\$PATH"
echo -n "tmux: "; command -v tmux >/dev/null && echo "ok" || echo "missing"
echo -n "bun:  "; command -v bun >/dev/null && bun --version || echo "missing"
echo -n "repo: "; if [ -d '${REMOTE_PROJECT_DIR}/.git' ]; then git -c safe.directory='${REMOTE_PROJECT_DIR}' -C '${REMOTE_PROJECT_DIR}' rev-parse --short HEAD; else echo "missing"; fi
echo -n ".env: "; if [ -f '${REMOTE_ENV_FILE}' ]; then echo "present"; else echo "missing"; fi
echo "sessions:"
tmux list-sessions -F '  #{session_name} (#{?session_attached,attached,detached})' 2>/dev/null | grep 'dexter-' || echo "  (none)"
EOS
}

cmd=${1:-attach}
session_arg=${2:-}

case "${cmd}" in
  attach) cmd_attach "${session_arg}" ;;
  new) require_remote_tools; require_remote_repo; create_session ;;
  list) cmd_list ;;
  kill) cmd_kill "${session_arg}" ;;
  status) cmd_status ;;
  -h|--help|help) usage ;;
  *) usage; exit 2 ;;
esac
