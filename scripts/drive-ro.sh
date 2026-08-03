#!/usr/bin/env bash
# Restore the media drive to its read-only baseline after a management
# session started with drive-rw.sh. Same umount/mount cycle (ntfs3 cannot
# change ro/rw in place, and m-server holds the mount busy), but mounts
# straight from fstab, whose entry is the ro source of truth.
#
# Usage: sudo scripts/drive-ro.sh
set -euo pipefail

MOUNTPOINT="${MOUNTPOINT:-/srv/mediadrive}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "This needs root. Run: sudo $0" >&2
  exit 1
fi

current_opts="$(findmnt -no OPTIONS "$MOUNTPOINT" 2>/dev/null || true)"
if [[ "$current_opts" == ro* ]]; then
  echo "$MOUNTPOINT is already mounted read-only; nothing to do."
  exit 0
fi

echo "Stopping m-server (it holds the mount busy)..."
docker compose --project-directory "$REPO_DIR" stop m-server 2>/dev/null || true

if findmnt "$MOUNTPOINT" >/dev/null 2>&1; then
  # Flush pending writes before unmounting a volume we were writing to.
  sync
  umount "$MOUNTPOINT"
fi

mount "$MOUNTPOINT"

echo "Restarting m-server..."
docker compose --project-directory "$REPO_DIR" start m-server 2>/dev/null || true

echo ""
findmnt "$MOUNTPOINT"
echo ""
echo "Drive is back to read-only."
