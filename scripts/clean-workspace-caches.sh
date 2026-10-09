#!/bin/bash
set -euo pipefail

# Removes only regenerable caches from this Alusa checkout. Defaults to inspection.
readonly EXPECTED_ROOT="/Users/blendstudio/Projects/alusa"
readonly THRESHOLD_KIB=$((10 * 1024 * 1024))
readonly TARGETS=(
  "apps/web/node_modules/.cache"
  "apps/web/.next/cache"
  ".turbo"
)

mode="inspect"
if [[ "${1:-}" == "--execute" && $# -eq 1 ]]; then
  mode="execute"
elif [[ "${1:-}" == "--inspect" && $# -eq 1 ]]; then
  mode="inspect"
elif [[ $# -ne 0 ]]; then
  echo "Usage: $0 [--inspect|--execute]" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "$0")" && pwd -P)"
repo_root="$(cd "$script_dir/.." && pwd -P)"
if [[ "$repo_root" != "$EXPECTED_ROOT" || ! -f "$repo_root/pnpm-workspace.yaml" || ! -d "$repo_root/.git" ]]; then
  echo "Refusing: checkout root could not be proven ($repo_root)." >&2
  exit 1
fi

free_kib="$(df -Pk "$repo_root" | awk 'END {print $4}')"
if [[ ! "$free_kib" =~ ^[0-9]+$ ]]; then
  echo "Refusing: could not determine free space." >&2
  exit 1
fi
free_bytes=$((free_kib * 1024))
printf 'Workspace: %s\nFree: %s KiB\nThreshold: %s KiB (10 GiB)\nMode: %s\n' \
  "$repo_root" "$free_kib" "$THRESHOLD_KIB" "$mode"

if (( free_kib >= THRESHOLD_KIB )); then
  echo "No cleanup needed."
  exit 0
fi

# A workspace process may be reading or writing these caches. Check its actual cwd
# via lsof; an unrelated project running elsewhere does not block this cleanup.
workspace_processes=()
while read -r pid command; do
  [[ -n "${pid:-}" && "$pid" != "$$" ]] || continue
  case "$command" in
    *node*|*pnpm*|*next*|*turbo*|*storybook*|*webpack*|*vite*) ;;
    *) continue ;;
  esac
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1 || true)"
  case "$cwd" in
    "$repo_root"|"$repo_root"/*) workspace_processes+=("$pid $command") ;;
  esac
done < <(ps -axo pid=,command=)

if ((${#workspace_processes[@]})); then
  echo "Cleanup deferred: workspace development/build process detected:"
  printf '  %s\n' "${workspace_processes[@]}"
  exit 0
fi

for relative_path in "${TARGETS[@]}"; do
  target="$repo_root/$relative_path"
  if [[ ! -e "$target" ]]; then
    printf 'Absent: %s\n' "$relative_path"
    continue
  fi
  canonical_target="$(cd "$target" 2>/dev/null && pwd -P)" || {
    printf 'Refusing unresolved path: %s\n' "$relative_path" >&2
    exit 1
  }
  if [[ "$canonical_target" != "$repo_root/$relative_path" || "$canonical_target" != "$repo_root"/* ]]; then
    printf 'Refusing non-canonical/out-of-workspace path: %s -> %s\n' "$relative_path" "$canonical_target" >&2
    exit 1
  fi
  printf '%s cache: %s\n' "$mode" "$relative_path"
  if [[ "$mode" == "execute" ]]; then
    # Delete contents only, retaining the whitelisted directory itself.
    find "$canonical_target" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  fi
done
