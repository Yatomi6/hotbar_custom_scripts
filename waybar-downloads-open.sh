#!/usr/bin/env bash
set -euo pipefail

STATE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/waybar-downloads"
CURRENT_DIR_FILE="$STATE_DIR/current_dir"
fallback="$HOME/Downloads"

target=""
if [[ -f "$CURRENT_DIR_FILE" ]]; then
  target=$(cat "$CURRENT_DIR_FILE")
fi
if [[ -z "$target" ]]; then
  target="$fallback"
fi
if [[ -f "$target" ]]; then
  target=$(dirname -- "$target")
fi
if [[ ! -d "$target" ]]; then
  target="$fallback"
fi

xdg-open "$target" >/dev/null 2>&1 &
