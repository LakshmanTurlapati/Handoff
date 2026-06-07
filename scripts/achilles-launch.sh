#!/usr/bin/env bash
# Local-test launcher for Achilles.
# Sources secrets/elevenlabs.env (gitignored) so ELEVENLABS_API_KEY and
# ELEVENLABS_VOICE_ID are available to the Electron app, then exec's the
# installed `achilles` CLI. Pass through any flags (--debug, etc.).

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${REPO_ROOT}/secrets/elevenlabs.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "[achilles-launch] secrets/elevenlabs.env not found at ${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

if [[ -z "${ELEVENLABS_API_KEY:-}" ]]; then
  echo "[achilles-launch] ELEVENLABS_API_KEY is empty after sourcing ${ENV_FILE}" >&2
  exit 1
fi

exec achilles "$@"
