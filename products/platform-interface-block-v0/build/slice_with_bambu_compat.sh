#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  printf 'Usage: %s INPUT_STL OUTPUT_DIRECTORY\n' "$0" >&2
  exit 2
fi

INPUT=$1
OUTPUT_DIR=$2
STUDIO="/Applications/BambuStudio.app/Contents/MacOS/BambuStudio"
FUNTASTIC_BIN="$HOME/.local/bin/funtastic"
TOOL_DIR=$(CDPATH= cd -- "$(dirname -- "$(realpath "$FUNTASTIC_BIN")")" && pwd)

if [ -x "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" ]; then
  NODE="/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"
elif [ -x "/Applications/Codex.app/Contents/Resources/cua_node/bin/node" ]; then
  NODE="/Applications/Codex.app/Contents/Resources/cua_node/bin/node"
elif command -v node >/dev/null 2>&1; then
  NODE=$(command -v node)
else
  printf 'Node runtime not found in ChatGPT.app, Codex.app, or PATH.\n' >&2
  exit 1
fi

MACHINE_LEAF="${BAMBU_MACHINE_PROFILE:-Bambu Lab P2S 0.4 nozzle}"
PROCESS_LEAF="${BAMBU_PROCESS_PROFILE:-0.20mm Standard @BBL P2S}"
FILAMENT_LEAF="${BAMBU_FILAMENT_PROFILE:-Generic PLA @BBL P2S}"
NAME=$(basename "$INPUT")
NAME=${NAME%.*}
CURRENT_DIR=$(pwd)
case "$INPUT" in
  /*) INPUT_PATH=$INPUT ;;
  *) INPUT_PATH="$CURRENT_DIR/$INPUT" ;;
esac

mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR=$(CDPATH= cd -- "$OUTPUT_DIR" && pwd)
PROFILE_DIR="$OUTPUT_DIR/flattened-profiles"
rm -rf "$PROFILE_DIR"

"$NODE" "$TOOL_DIR/flatten_bambu_profiles.mjs" \
  "$PROFILE_DIR" \
  "$MACHINE_LEAF" \
  "$PROCESS_LEAF" \
  "$FILAMENT_LEAF"

MACHINE=$(find "$PROFILE_DIR" -maxdepth 1 -type f -name 'flat-machine-*' -print -quit)
PROCESS=$(find "$PROFILE_DIR" -maxdepth 1 -type f -name 'flat-process-*' -print -quit)
FILAMENT=$(find "$PROFILE_DIR" -maxdepth 1 -type f -name 'flat-filament-*' -print -quit)

[ -n "$MACHINE" ] && [ -n "$PROCESS" ] && [ -n "$FILAMENT" ] || {
  printf 'Flattened Bambu profiles were not generated.\n' >&2
  exit 1
}

cd "$OUTPUT_DIR"
"$STUDIO" \
  --slice 0 \
  --ensure-on-bed \
  --arrange 1 \
  --outputdir "$OUTPUT_DIR" \
  --export-3mf "${NAME}_P2S_sliced.3mf" \
  --load-settings "$MACHINE;$PROCESS" \
  --load-filaments "$FILAMENT" \
  --load-defaultfila \
  "$INPUT_PATH"

test -f "$OUTPUT_DIR/${NAME}_P2S_sliced.3mf"
"$TOOL_DIR/summarize_slice.py" \
  "$OUTPUT_DIR/plate_1.gcode" \
  "$OUTPUT_DIR/slice-summary.json"
printf 'Created %s\n' "$OUTPUT_DIR/${NAME}_P2S_sliced.3mf"
