#!/bin/bash
set -euo pipefail

readonly LABEL="com.alusa.workspace-cache-cleaner"
readonly SOURCE="/Users/blendstudio/Projects/alusa/scripts/${LABEL}.plist"
readonly DESTINATION="$HOME/Library/LaunchAgents/${LABEL}.plist"
readonly DOMAIN="gui/$(id -u)"

case "${1:-install}" in
  install)
    [[ -f "$SOURCE" ]] || { echo "Missing LaunchAgent: $SOURCE" >&2; exit 1; }
    /usr/bin/plutil -lint "$SOURCE"
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    if [[ -f "$DESTINATION" ]]; then
      launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    fi
    install -m 0644 "$SOURCE" "$DESTINATION"
    launchctl bootstrap "$DOMAIN" "$DESTINATION"
    launchctl enable "$DOMAIN/$LABEL"
    echo "Installed and enabled $LABEL at $DESTINATION"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$DESTINATION"
    echo "Uninstalled $LABEL"
    ;;
  status)
    launchctl print "$DOMAIN/$LABEL"
    ;;
  *)
    echo "Usage: $0 [install|uninstall|status]" >&2
    exit 2
    ;;
esac
