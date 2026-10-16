#!/usr/bin/env bash
# Clear a wedged dev daemon so dev-daemon.sh can start.
#
# The usual cause is Ctrl-Z in the terminal running dev-daemon.sh. The whole
# process group goes to state T; a suspended PID still passes the liveness check
# in packages/server/src/server/pid-lock.ts, so the lock looks held forever.
#
# Targets only the daemon on GRAVITY_LISTEN's port plus whatever holds this
# home's lock, so a second dev daemon on another port/home is left alone.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/dev-home.sh"

export GRAVITY_LISTEN="${GRAVITY_LISTEN:-127.0.0.1:6768}"
configure_dev_gravity_home

PORT="${GRAVITY_LISTEN##*:}"
PID_FILE="$GRAVITY_HOME/gravity.pid"

echo "Clearing dev daemon: home=$GRAVITY_HOME port=$PORT"

# Resume anything suspended first. A stopped process cannot service SIGTERM, and
# TERM-then-CONT lets the supervisor resurrect and re-bind the port.
resume_tree() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  kill -CONT "$pid" 2>/dev/null || true
  for child in $(pgrep -P "$pid" 2>/dev/null); do resume_tree "$child"; done
}

lock_pid=""
if [ -f "$PID_FILE" ]; then
  lock_pid="$(node -e '
    try {
      const l = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      if (Number.isInteger(l.pid) && l.pid > 0) process.stdout.write(String(l.pid));
    } catch {}
  ' "$PID_FILE" 2>/dev/null)"
fi

if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
  echo "  lock holder PID $lock_pid ($(ps -p "$lock_pid" -o stat= 2>/dev/null | tr -d ' ')) - resuming"
  resume_tree "$lock_pid"
fi

# Kill the worker that owns the port. The supervisor shuts itself down once its
# worker exits, so this drains the whole tree without SIGKILL.
for _ in 1 2 3; do
  # -sTCP:LISTEN matters: a bare `lsof -ti tcp:PORT` also returns every client
  # with an established connection, and terminating those kills connected apps.
  holders="$(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  [ -n "$holders" ] || break
  echo "  port $PORT held by: $(echo "$holders" | tr '\n' ' ')- terminating"
  # shellcheck disable=SC2086
  kill -CONT $holders 2>/dev/null || true
  # shellcheck disable=SC2086
  kill -TERM $holders 2>/dev/null || true
  sleep 1
done

if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
  kill -TERM "$lock_pid" 2>/dev/null || true
  sleep 1
fi

# Drop the lock only when nothing alive owns it.
if [ -f "$PID_FILE" ]; then
  if [ -z "$lock_pid" ] || ! kill -0 "$lock_pid" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "  removed stale $PID_FILE"
  else
    echo "  WARNING: PID $lock_pid still alive, lock left in place" >&2
  fi
fi

if [ -n "$(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null || true)" ]; then
  echo "  WARNING: port $PORT still held by: $(lsof -ti "tcp:$PORT" -sTCP:LISTEN | tr '\n' ' ')" >&2
  exit 1
fi

echo "Ready: port $PORT free, no lock. Start with ./scripts/dev-daemon.sh"
