#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$DESKTOP_DIR/../.." && pwd)"

source "$ROOT_DIR/scripts/dev-home.sh"

export PATH="$ROOT_DIR/node_modules/.bin:$PATH"
export GRAVITY_LISTEN="${GRAVITY_LISTEN:-127.0.0.1:6768}"
configure_dev_gravity_home

DEV_ROOT="${GRAVITY_DEV_ROOT:-$(default_dev_gravity_root)}"
export GRAVITY_DEV_ROOT="$DEV_ROOT"
export GRAVITY_DEV_RUNTIME_FALLBACK_ROOT="$DEV_ROOT"
DEV_RUNTIME="$(node "$SCRIPT_DIR/dev-runtime.mjs")"
export GRAVITY_ELECTRON_FLAGS="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).electronFlags)' "$DEV_RUNTIME")"
export GRAVITY_ELECTRON_USER_DATA_DIR="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).userDataDir)' "$DEV_RUNTIME")"
unset GRAVITY_DEV_RUNTIME_FALLBACK_ROOT
mkdir -p "$GRAVITY_ELECTRON_USER_DATA_DIR"

if [ -z "${EXPO_PORT:-}" ]; then
  EXPO_PORT=$(NO_COLOR=1 FORCE_COLOR=0 "$ROOT_DIR/node_modules/.bin/get-port" 8082 8083 8084 8085 8086 8087 8088 8089)
fi
export EXPO_PORT
export EXPO_DEV_URL="http://localhost:${EXPO_PORT}"

DAEMON_ENDPOINT="$(resolve_dev_daemon_endpoint)"
export GRAVITY_DAEMON_ENDPOINT="$DAEMON_ENDPOINT"

export GRAVITY_CORS_ORIGINS="${GRAVITY_CORS_ORIGINS:-*}"

npm --prefix "$ROOT_DIR" run build:server
npm --prefix "$DESKTOP_DIR" run build:main

echo "══════════════════════════════════════════════════════"
echo "  Gravity Desktop Dev"
echo "══════════════════════════════════════════════════════"
echo "  Metro:      ${EXPO_DEV_URL}"
echo "  Daemon:     ${GRAVITY_LISTEN}"
echo "  Home:       ${GRAVITY_HOME}"
echo "  userData:   ${GRAVITY_ELECTRON_USER_DATA_DIR}"
echo "══════════════════════════════════════════════════════"

exec node "$SCRIPT_DIR/dev-runner.mjs"
