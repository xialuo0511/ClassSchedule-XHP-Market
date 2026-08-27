#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OUTPUT=${1:-"$SCRIPT_DIR/dist/gdufe-course-import-2.0.2.xhp"}

case "$OUTPUT" in
  *.xhp) ;;
  *) echo "Output path must end with .xhp" >&2; exit 1 ;;
esac

command -v zip >/dev/null 2>&1 || {
  echo "zip is required" >&2
  exit 1
}

test -s "$SCRIPT_DIR/plugin.json" || {
  echo "plugin.json is missing or empty" >&2
  exit 1
}
test -s "$SCRIPT_DIR/main.js" || {
  echo "main.js is missing or empty" >&2
  exit 1
}

mkdir -p "$(dirname -- "$OUTPUT")"
rm -f -- "$OUTPUT"

(
  cd "$SCRIPT_DIR"
  zip -q -j "$OUTPUT" plugin.json main.js
)

echo "Built XHP package: $OUTPUT"
