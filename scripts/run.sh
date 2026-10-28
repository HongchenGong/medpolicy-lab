#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ "$#" -eq 0 ]; then set -- dev; fi
if ! command -v node >/dev/null 2>&1; then
  BUNDLED_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
  export PATH="$BUNDLED_NODE:$PATH"
fi
if command -v pnpm >/dev/null 2>&1; then
  case "${1:-dev}" in
    install|exec) exec pnpm "$@" ;;
    *) exec pnpm run "$@" ;;
  esac
elif command -v npm >/dev/null 2>&1; then
  case "${1:-dev}" in
    install) shift; exec npm install "$@" ;;
    exec) shift; exec npx "$@" ;;
    *) TASK_COMMAND="$1"; shift; exec npm run "$TASK_COMMAND" -- "$@" ;;
  esac
else
  case "${1:-dev}" in
    install|exec) exec "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm" "$@" ;;
    *) exec "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm" run "$@" ;;
  esac
fi
