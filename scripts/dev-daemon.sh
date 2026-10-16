#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/../node_modules/.bin:$PATH"

source "$SCRIPT_DIR/dev-home.sh"

export GRAVITY_LISTEN="${GRAVITY_LISTEN:-127.0.0.1:6768}"
configure_dev_gravity_home

if [ -z "${GRAVITY_LOCAL_MODELS_DIR}" ]; then
  export GRAVITY_LOCAL_MODELS_DIR="$HOME/.gravity/models/local-speech"
  mkdir -p "$GRAVITY_LOCAL_MODELS_DIR"
fi

echo "══════════════════════════════════════════════════════"
echo "  Gravity Dev Daemon"
echo "══════════════════════════════════════════════════════"
echo "  Home:    ${GRAVITY_HOME}"
echo "  Models:  ${GRAVITY_LOCAL_MODELS_DIR}"
echo "  Listen:  ${GRAVITY_LISTEN}"
echo "══════════════════════════════════════════════════════"

export GRAVITY_CORS_ORIGINS="${GRAVITY_CORS_ORIGINS:-*}"
export GRAVITY_NODE_INSPECT="${GRAVITY_NODE_INSPECT:---inspect=0}"

if [ "${GRAVITY_SKIP_DEV_SERVER_BUILD:-0}" = "1" ]; then
  exec npm run dev:server:watch
fi

exec sh -c 'npm run build:server-deps && npm run dev:server:watch'
