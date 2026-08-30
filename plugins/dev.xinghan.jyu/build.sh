#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OUTPUT=${1:-"$ROOT/dist/jyu-course-import-1.0.0.xhp"}
mkdir -p "$(dirname -- "$OUTPUT")"
cd "$ROOT"
zip -j -9 "$OUTPUT" plugin.json main.js
printf 'Built XHP package: %s\n' "$OUTPUT"
