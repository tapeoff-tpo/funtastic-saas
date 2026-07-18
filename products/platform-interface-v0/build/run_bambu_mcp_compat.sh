#!/bin/sh
set -eu

CONFIG="$HOME/.config/funtastic/bambu.env"
SERVER="$HOME/.local/share/funtastic/bambu-printer-mcp/dist/index.js"
CHATGPT_NODE="/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"
CODEX_NODE="/Applications/Codex.app/Contents/Resources/cua_node/bin/node"

if [ -x "$CHATGPT_NODE" ]; then
  NODE="$CHATGPT_NODE"
elif [ -x "$CODEX_NODE" ]; then
  NODE="$CODEX_NODE"
else
  NODE=$(command -v node)
fi

[ -f "$CONFIG" ] || {
  printf 'Missing %s. Run configure_bambu.sh first.\n' "$CONFIG" >&2
  exit 1
}

[ -f "$SERVER" ] || {
  printf 'Missing Bambu MCP build: %s\n' "$SERVER" >&2
  exit 1
}

set -a
. "$CONFIG"
set +a

BAMBU_PRINTER_ACCESS_TOKEN=$(
  security find-generic-password -s "FUN-TASTIC Bambu P2S" -a "$USER" -w
)
export BAMBU_PRINTER_ACCESS_TOKEN
export MCP_TRANSPORT=stdio
export SLICER_TYPE=bambustudio
export SLICER_PATH="/Applications/BambuStudio.app/Contents/MacOS/BambuStudio"
export BAMBU_PROFILES_ROOT="/Applications/BambuStudio.app/Contents/Resources/profiles"
export BAMBU_CLI_FLATTEN=true
export BAMBU_TEMPLATE_DIR="$HOME/Library/Application Support/FUN-TASTIC/BambuTemplates"

mkdir -p "$BAMBU_TEMPLATE_DIR"
exec "$NODE" "$SERVER"
