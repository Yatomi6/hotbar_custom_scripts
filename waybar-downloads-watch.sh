#!/usr/bin/env bash
set -euo pipefail

ICON=""
CONFIG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/waybar/download-dirs.conf"
USER_DIRS_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/user-dirs.dirs"
MAX_ITEMS="${DOWNLOADS_MAX_ITEMS:-6}"
MAX_DEPTH="${DOWNLOADS_MAX_DEPTH:-3}"
USE_LSOF="${DOWNLOADS_USE_LSOF:-0}"
BAR_WIDTH="${DOWNLOADS_BAR_WIDTH:-24}"
TEXT_HEIGHT_CAP="${DOWNLOADS_TEXT_MAX_HEIGHT:-30}"
SCAN_HOME="${DOWNLOADS_SCAN_HOME:-1}"
HOME_SCAN_MAX_DEPTH="${DOWNLOADS_HOME_MAX_DEPTH:-0}"
HOME_PRUNE_NAMES="${DOWNLOADS_HOME_PRUNE_NAMES:-cache,Cache,tmp,temp,Temp,logs,Logs,log,Log,__pycache__}"

IFS=',' read -r -a HOME_PRUNE_NAMES_ARR <<< "$HOME_PRUNE_NAMES"

STATE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/waybar-downloads"
STATE_FILE="$STATE_DIR/state.tsv"
META_FILE="$STATE_DIR/meta.env"
OUTPUT_FILE="$STATE_DIR/last_output.json"
IDLE_INTERVAL="${DOWNLOADS_IDLE_INTERVAL:-5}"
ACTIVE_INTERVAL="${DOWNLOADS_ACTIVE_INTERVAL:-1}"
HOME_SCAN_INTERVAL="${DOWNLOADS_HOME_SCAN_INTERVAL:-5}"
ACTIVE_FILE="$STATE_DIR/active_items.tsv"

trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

json_escape() {
  local s="$1"
  s=${s//\\/\\\\}
  s=${s//"/\\"}
  s=${s//$'\n'/\\n}
  printf '%s' "$s"
}

pango_escape() {
  local s="$1"
  s=${s//&/&amp;}
  s=${s//</&lt;}
  s=${s//>/&gt;}
  printf '%s' "$s"
}

path_is_pruned() {
  local path="$1"
  local name=""

  if [[ "$path" == *"/."* ]]; then
    return 0
  fi

  for name in "${HOME_PRUNE_NAMES_ARR[@]}"; do
    [[ -z "$name" ]] && continue
    case "$path" in
      */$name|*/$name/*) return 0 ;;
    esac
  done

  return 1
}

format_bytes() {
  local b="$1"
  awk -v b="$b" 'BEGIN{split("B KB MB GB TB",u," ");i=1;while(b>=1024&&i<5){b/=1024;i++}printf "%.1f%s",b,u[i]}'
}

format_speed() {
  local bps="$1"
  if [[ "$bps" -le 0 ]]; then
    printf '0 B/s'
  else
    printf '%s/s' "$(format_bytes "$bps")"
  fi
}

repeat_char() {
  local char="$1"
  local count="$2"
  local out=""
  while [[ "$count" -gt 0 ]]; do
    out+="$char"
    count=$((count - 1))
  done
  printf '%s' "$out"
}

make_bar() {
  local current="$1"
  local total="$2"
  local width="$3"
  local pos=0
  local left=0
  local right=0
  local bar=""

  if [[ "$width" -lt 3 ]]; then
    width=3
  fi

  if [[ "$total" -gt 0 ]]; then
    pos=$(( current * (width - 1) / total ))
    if [[ "$pos" -lt 0 ]]; then
      pos=0
    elif [[ "$pos" -gt $((width - 1)) ]]; then
      pos=$((width - 1))
    fi
  else
    pos=0
  fi

  left="$pos"
  right=$(( width - pos - 1 ))

  bar=$(repeat_char "━" "$left")
  bar+="●"
  bar+=$(repeat_char "━" "$right")
  printf '%s' "$bar"
}

shorten() {
  local s="$1"
  local max="$2"
  if (( ${#s} > max )); then
    printf '%s...' "${s:0:max-3}"
  else
    printf '%s' "$s"
  fi
}

shorten_filename() {
  local name="$1"
  local head_len="$2"
  local base="$name"
  local ext=""

  if [[ "$name" == *.* && "$name" != .* ]]; then
    base="${name%.*}"
    ext="${name##*.}"
    if [[ -n "$ext" ]]; then
      ext=".$ext"
    fi
    if [[ -z "$base" ]]; then
      base="$name"
      ext=""
    fi
  fi

  if (( ${#base} > head_len )); then
    printf '%s...%s' "${base:0:head_len}" "$ext"
  else
    printf '%s%s' "$base" "$ext"
  fi
}

normalize_path() {
  local p="$1"
  for ext in .crdownload .part .download .partial .filepart .tmp .aria2; do
    if [[ "$p" == *"$ext" ]]; then
      p="${p%$ext}"
      break
    fi
  done
  printf '%s' "$p"
}

add_dir() {
  local d="$1"
  [[ -z "$d" ]] && return 0
  if [[ -d "$d" && -z "${dir_seen[$d]:-}" ]]; then
    dir_seen["$d"]=1
    dirs+=("$d")
  fi
}

read_prev_state() {
  if [[ -f "$STATE_FILE" ]]; then
    while IFS=$'\t' read -r key bytes ts; do
      [[ -z "$key" ]] && continue
      prev_bytes["$key"]="$bytes"
      prev_time["$key"]="$ts"
    done < "$STATE_FILE"
  fi
}

record_state() {
  mkdir -p "$STATE_DIR"
  : > "$STATE_FILE"
  local idx
  for idx in "${!item_key[@]}"; do
    printf '%s\t%s\t%s\n' "${item_key[$idx]}" "${item_bytes[$idx]}" "$now" >> "$STATE_FILE"
  done
}

write_cache() {
  local active="$1"
  local output="$2"
  local home_scan_ts="${3:-$last_home_scan}"
  mkdir -p "$STATE_DIR"
  printf 'last_scan=%s\nlast_active=%s\nlast_home_scan=%s\n' "$now" "$active" "$home_scan_ts" > "$META_FILE"
  printf '%s' "$output" > "$OUTPUT_FILE"
}

save_active_file_items() {
  mkdir -p "$STATE_DIR"
  : > "$ACTIVE_FILE"
  local i
  for i in "${!item_key[@]}"; do
    if [[ "${item_key[$i]}" == file:* ]]; then
      printf '%s\t%s\t%s\n' "${item_path[$i]}" "${item_norm[$i]}" "${item_name[$i]}" >> "$ACTIVE_FILE"
    fi
  done
}

load_active_file_items() {
  [[ -f "$ACTIVE_FILE" ]] || return 0
  while IFS=$'\t' read -r path norm name; do
    [[ -z "$path" ]] && continue
    [[ -f "$path" ]] || continue
    if path_is_pruned "$path"; then
      continue
    fi
    if [[ -n "$norm" && -n "${seen_norm[$norm]:-}" ]]; then
      continue
    fi
    bytes=$(stat -c %s "$path" 2>/dev/null || echo 0)
    disp_name="$name"
    if [[ -z "$disp_name" ]]; then
      if [[ -n "$norm" ]]; then
        disp_name=$(basename -- "$norm")
      else
        disp_name=$(basename -- "$path")
      fi
    fi
    add_item "file:${path}" "$disp_name" "$path" "$bytes" 0 "Dossier" "$norm"
  done < "$ACTIVE_FILE"
}

add_item() {
  local key="$1"
  local name="$2"
  local path="$3"
  local bytes="$4"
  local total="$5"
  local source="$6"
  local norm="$7"

  if [[ -z "$bytes" || "$bytes" -lt 0 ]]; then
    bytes=0
  fi
  if [[ -z "$total" || "$total" -lt 0 ]]; then
    total=0
  fi

  local prev_b="${prev_bytes[$key]:-}"
  local prev_t="${prev_time[$key]:-}"
  local spd=0
  if [[ -n "$prev_b" && -n "$prev_t" && "$now" -gt "$prev_t" && "$bytes" -ge "$prev_b" ]]; then
    spd=$(( (bytes - prev_b) / (now - prev_t) ))
  fi

  local idx=${#item_key[@]}
  item_key[$idx]="$key"
  item_name[$idx]="$name"
  item_path[$idx]="$path"
  item_source[$idx]="$source"
  item_bytes[$idx]="$bytes"
  item_total[$idx]="$total"
  item_speed[$idx]="$spd"
  item_norm[$idx]="$norm"
}

scan_dir_with_depth() {
  local dir="$1"
  local depth="$2"
  local allow_lsof="$3"
  local prune_hidden="${4:-0}"
  local find_cmd=()
  local prune_expr=()
  local have_prune=0

  [[ -d "$dir" ]] || return 0
  find_cmd=(find "$dir")
  if [[ "$depth" -gt 0 ]]; then
    find_cmd+=(-maxdepth "$depth")
  fi

  if [[ "$prune_hidden" == "1" ]]; then
    prune_expr+=( -type d -name ".*" )
    have_prune=1
  fi
  if [[ "$prune_hidden" == "1" && ${#HOME_PRUNE_NAMES_ARR[@]} -gt 0 ]]; then
    for name in "${HOME_PRUNE_NAMES_ARR[@]}"; do
      [[ -z "$name" ]] && continue
      if [[ "$have_prune" -eq 1 ]]; then
        prune_expr+=( -o )
      fi
      prune_expr+=( -type d -iname "$name" )
      have_prune=1
    done
  fi

  if [[ "$have_prune" -eq 1 ]]; then
    find_cmd+=( \( "${prune_expr[@]}" \) -prune -o )
  fi

  find_cmd+=( -type f
    \( -iname "*.part" -o -iname "*.crdownload" -o -iname "*.aria2"
       -o -iname "*.download" -o -iname "*.partial" -o -iname "*.filepart"
       -o -iname "*.tmp" \)
    -print0
  )

  while IFS= read -r -d '' file; do
    local path="$file"
    local name
    name=$(basename "$path")
    local norm
    norm=$(normalize_path "$path")
    if [[ -n "${seen_norm[$norm]:-}" ]]; then
      continue
    fi

    if [[ "$path" == *.aria2 ]]; then
      local base_path="${path%.aria2}"
      if [[ -f "$base_path" ]]; then
        path="$base_path"
        name=$(basename "$path")
        norm=$(normalize_path "$path")
      fi
    fi

    local bytes
    bytes=$(stat -c %s "$path" 2>/dev/null || echo 0)
    add_item "file:${path}" "$name" "$path" "$bytes" 0 "Dossier" "$norm"
  done < <("${find_cmd[@]}" 2>/dev/null || true)

  if [[ "$allow_lsof" == "1" && "$USE_LSOF" == "1" ]] && command -v lsof >/dev/null 2>&1; then
    fd=""
    while IFS= read -r line; do
      case "$line" in
        f*) fd="${line#f}" ;;
        n*)
          if [[ "$fd" == *w* || "$fd" == *u* ]]; then
            path="${line#n}"
            [[ -z "$path" ]] && continue
            name=$(basename "$path")
            norm=$(normalize_path "$path")
            if [[ -n "${seen_norm[$norm]:-}" ]]; then
              continue
            fi
            bytes=$(stat -c %s "$path" 2>/dev/null || echo 0)
            add_item "file:${path}" "$name" "$path" "$bytes" 0 "Dossier" "$norm"
          fi
          ;;
      esac
    done < <(lsof -nP -F fn +D "$dir" 2>/dev/null || true)
  fi
}

scan_chromium_db() {
  local db="$1"
  local label="$2"
  local tmp
  tmp=$(mktemp)
  if ! cp -f "$db" "$tmp" 2>/dev/null; then
    rm -f "$tmp"
    return
  fi

  if ! sqlite3 "$tmp" "SELECT 1 FROM sqlite_master WHERE type='table' AND name='downloads';" | grep -q 1; then
    rm -f "$tmp"
    return
  fi

  while IFS=$'\t' read -r id path total received state; do
    [[ -z "$id" ]] && continue
    [[ -z "$path" ]] && continue
    if [[ "$state" != "0" ]]; then
      continue
    fi
    local name
    name=$(basename "$path")
    local norm
    norm=$(normalize_path "$path")
    if [[ -n "${seen_norm[$norm]:-}" ]]; then
      continue
    fi
    seen_norm["$norm"]=1
    add_item "chromium:${db}:${id}" "$name" "$path" "$received" "$total" "$label" "$norm"
  done < <(sqlite3 -separator $'\t' "$tmp" "SELECT id, target_path, total_bytes, received_bytes, state FROM downloads WHERE state=0;" 2>/dev/null || true)

  rm -f "$tmp"
}

scan_chromium_family() {
  local base="$1"
  local label="$2"
  [[ -d "$base" ]] || return 0
  shopt -s nullglob
  local profile
  for profile in "$base"/Default "$base"/Profile* "$base"/Guest\ Profile "$base"/System\ Profile; do
    local db="$profile/History"
    [[ -f "$db" ]] || continue
    scan_chromium_db "$db" "$label"
  done
  shopt -u nullglob
}

scan_steam() {
  local steam_root="$HOME/.local/share/Steam"
  local downloading="$steam_root/steamapps/downloading"
  [[ -d "$downloading" ]] || return 0

  shopt -s nullglob
  local d
  for d in "$downloading"/*; do
    [[ -d "$d" ]] || continue
    local appid
    appid=$(basename "$d")
    local manifest="$steam_root/steamapps/appmanifest_${appid}.acf"
    [[ -f "$manifest" ]] || continue
    local name bytes_dl bytes_total
    name=$(awk -F'"' '/"name"/ {print $4; exit}' "$manifest")
    bytes_dl=$(awk -F'"' '/"BytesDownloaded"/ {print $4; exit}' "$manifest")
    bytes_total=$(awk -F'"' '/"BytesToDownload"/ {print $4; exit}' "$manifest")
    [[ -z "$name" ]] && name="Steam $appid"
    bytes_dl=${bytes_dl:-0}
    bytes_total=${bytes_total:-0}
    add_item "steam:${appid}" "$name" "$d" "$bytes_dl" "$bytes_total" "Steam" ""
  done
  shopt -u nullglob
}

scan_folders() {
  local dir
  for dir in "${dirs[@]}"; do
    scan_dir_with_depth "$dir" "$MAX_DEPTH" 1 0
  done
}

# Build directory list
xdg_download_dir=""
if [[ -f "$USER_DIRS_FILE" ]]; then
  xdg_download_dir=$(awk -F= '/^XDG_DOWNLOAD_DIR=/{gsub(/"/,"",$2);print $2}' "$USER_DIRS_FILE" | head -n1)
  xdg_download_dir="${xdg_download_dir/\$HOME/$HOME}"
fi

declare -a dirs=()
declare -A dir_seen=()
if [[ -n "$xdg_download_dir" ]]; then
  add_dir "$xdg_download_dir"
fi

if [[ -f "$CONFIG_FILE" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="$(trim "$line")"
    [[ -z "$line" ]] && continue
    line="${line//%u/$USER}"
    line="${line/#\~/$HOME}"
    if [[ "$line" == *"*"* || "$line" == *"?"* || "$line" == *"["* ]]; then
      shopt -s nullglob
      for path in $line; do
        add_dir "$path"
      done
      shopt -u nullglob
    else
      add_dir "$line"
    fi
  done < "$CONFIG_FILE"
fi

add_dir "$HOME/Downloads"
add_dir "$HOME/.local/share/Steam/steamapps/downloading"
add_dir "$HOME/.local/share/Steam/steamapps/temp"

for base in "/run/media/$USER" "/media/$USER"; do
  shopt -s nullglob
  for d in "$base"/*/Downloads "$base"/*/downloads; do
    add_dir "$d"
  done
  shopt -u nullglob
done

now=$(date +%s)
last_scan=0
last_active=0
last_home_scan=0
if [[ -f "$META_FILE" ]]; then
  while IFS='=' read -r key val; do
    case "$key" in
      last_scan) last_scan="$val" ;;
      last_active) last_active="$val" ;;
      last_home_scan) last_home_scan="$val" ;;
    esac
  done < "$META_FILE"
fi
last_scan="${last_scan:-0}"
last_active="${last_active:-0}"
last_home_scan="${last_home_scan:-0}"

interval="$IDLE_INTERVAL"
if [[ "$last_active" == "1" ]]; then
  interval="$ACTIVE_INTERVAL"
fi

if [[ -f "$OUTPUT_FILE" && $((now - last_scan)) -lt "$interval" ]]; then
  cat "$OUTPUT_FILE"
  exit 0
fi

# Read previous state
declare -A prev_bytes=()
declare -A prev_time=()
read_prev_state

# Collected items
declare -a item_key=()
declare -a item_name=()
declare -a item_path=()
declare -a item_source=()
declare -a item_bytes=()
declare -a item_total=()
declare -a item_speed=()
declare -a item_norm=()

declare -A seen_norm=()

# Chromium-based browsers
scan_chromium_family "$HOME/.config/chromium" "Chromium"
scan_chromium_family "$HOME/.config/google-chrome" "Chrome"
scan_chromium_family "$HOME/.config/google-chrome-beta" "Chrome Beta"
scan_chromium_family "$HOME/.config/google-chrome-unstable" "Chrome Dev"
scan_chromium_family "$HOME/.config/BraveSoftware/Brave-Browser" "Brave"
scan_chromium_family "$HOME/.config/vivaldi" "Vivaldi"
scan_chromium_family "$HOME/.config/vivaldi-snapshot" "Vivaldi Snap"

# Steam downloads
scan_steam

# Folder-based detection
scan_folders

if [[ "$SCAN_HOME" == "1" ]]; then
  do_home_scan=0
  if [[ $((now - last_home_scan)) -ge "$HOME_SCAN_INTERVAL" ]]; then
    do_home_scan=1
  fi
  if [[ "$do_home_scan" == "1" ]]; then
    scan_dir_with_depth "$HOME" "$HOME_SCAN_MAX_DEPTH" 0 1
    last_home_scan="$now"
  else
    load_active_file_items
  fi
fi

count=${#item_key[@]}
if [[ $count -eq 0 ]]; then
  output=$(printf '{"text":"%s","class":"idle","tooltip":"%s"}' "$ICON" "Aucun telechargement en cours")
  write_cache 0 "$output"
  printf '%s' "$output"
  exit 0
fi

record_state
save_active_file_items

# Select primary item by speed, fallback to bytes
primary_idx=0
i=0
best_speed=-1
best_bytes=-1
for i in "${!item_key[@]}"; do
  if [[ "${item_speed[$i]}" -gt "$best_speed" ]]; then
    best_speed="${item_speed[$i]}"
    best_bytes="${item_bytes[$i]}"
    primary_idx="$i"
  elif [[ "${item_speed[$i]}" -eq "$best_speed" && "${item_bytes[$i]}" -gt "$best_bytes" ]]; then
    best_bytes="${item_bytes[$i]}"
    primary_idx="$i"
  fi
done

# Sort items for tooltip by speed desc
mapfile -t sorted < <(
  for i in "${!item_key[@]}"; do
    printf '%s\t%s\n' "${item_speed[$i]}" "$i"
  done | sort -rn
)

# Build tooltip
lines=()
shown=0
for entry in "${sorted[@]}"; do
  idx=${entry#*$'\t'}
  name="${item_name[$idx]}"
  bytes="${item_bytes[$idx]}"
  total="${item_total[$idx]}"
  spd="${item_speed[$idx]}"
  src="${item_source[$idx]}"
  if [[ "$total" -gt 0 ]]; then
    pct=$(( bytes * 100 / total ))
    line="$src: $name - ${pct}% ($(format_bytes "$bytes")/$(format_bytes "$total")) - $(format_speed "$spd")"
  else
    line="$src: $name - $(format_bytes "$bytes") - $(format_speed "$spd")"
  fi
  lines+=("$line")
  shown=$((shown + 1))
  if [[ $shown -ge $MAX_ITEMS ]]; then
    break
  fi
done

if [[ $count -gt $shown ]]; then
  lines+=("+ $((count - shown)) autre(s)")
fi

tooltip=$(printf '%s\n' "${lines[@]}")

# Build bar text (2 lines, Pango)
display_name="${item_name[$primary_idx]}"
if [[ -n "${item_norm[$primary_idx]}" ]]; then
  display_name=$(basename -- "${item_norm[$primary_idx]}")
fi
name_short=$(shorten_filename "$display_name" 10)
bytes="${item_bytes[$primary_idx]}"
total="${item_total[$primary_idx]}"
spd="${item_speed[$primary_idx]}"
extra=""
if [[ $count -gt 1 ]]; then
  extra=" (+$((count - 1)))"
fi

# Read Waybar height from config.jsonc if present.
bar_height=26
config_path="$HOME/.config/waybar/config.jsonc"
if [[ -r "$config_path" ]]; then
  height_val=$(awk -F':' '/"height"/ {gsub(/[^0-9]/, "", $2); if ($2 != "") print $2; exit}' "$config_path")
  if [[ -n "$height_val" ]]; then
    bar_height="$height_val"
  fi
fi
if [[ "$bar_height" -gt "$TEXT_HEIGHT_CAP" ]]; then
  bar_height="$TEXT_HEIGHT_CAP"
fi

available_px=$(awk -v h="$bar_height" 'BEGIN {a=h-3; if (a<8) a=8; printf "%.2f", a}')
line1_px=$(awk -v a="$available_px" 'BEGIN {p=a*0.58; if (p<6) p=6; printf "%.2f", p}')
line2_px=$(awk -v a="$available_px" -v p="$line1_px" 'BEGIN {w=a-p; if (w<5) w=5; printf "%.2f", w}')

line1_size=$(awk -v p="$line1_px" 'BEGIN {printf "%d", p*0.75*1024}')
line2_size=$(awk -v w="$line2_px" 'BEGIN {printf "%d", w*0.75*1024}')
line_height="0.80"
rise_units=$((768))

line1="$ICON $name_short$extra $(format_speed "$spd")"
bar="$(make_bar "$bytes" "$total" "$BAR_WIDTH")"
if [[ "$total" -gt 0 ]]; then
  line2="$(format_bytes "$bytes") $bar $(format_bytes "$total")"
else
  line2="$(format_bytes "$bytes") $bar ?"
fi

line1_escaped=$(pango_escape "$line1")
line2_escaped=$(pango_escape "$line2")

text="<span size='${line1_size}' line_height='${line_height}'>${line1_escaped}</span>"
text="${text}"$'\n'"<span size='${line2_size}' line_height='${line_height}' rise='-${rise_units}'>${line2_escaped}</span>"

primary_path="${item_path[$primary_idx]}"
if [[ -n "${item_norm[$primary_idx]}" ]]; then
  primary_path="${item_norm[$primary_idx]}"
fi
primary_dir="$primary_path"
if [[ -f "$primary_path" ]]; then
  primary_dir=$(dirname -- "$primary_path")
fi
mkdir -p "$STATE_DIR"
printf '%s' "$primary_dir" > "$STATE_DIR/current_dir"

output=$(printf '{"text":"%s","class":"active","tooltip":"%s"}' \
  "$(json_escape "$text")" "$(json_escape "$tooltip")")
write_cache 1 "$output"
printf '%s' "$output"
