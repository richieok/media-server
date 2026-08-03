#!/usr/bin/env bash
# Remount the media drive read-write for a file-management session.
# Companion to drive-ro.sh, which restores the read-only baseline when done.
#
# fstab keeps the drive ro on purpose: an unclean shutdown while the volume
# is mounted rw sets the NTFS dirty bit, and ntfs3 then refuses to mount at
# all until it is cleared. Staying ro except during deliberate management
# sessions makes that near-impossible to trigger.
#
# ntfs3 cannot switch ro->rw with an in-place remount, and the m-server
# container holds the mount busy, so the sequence is:
#   stop m-server -> umount -> mount rw -> start m-server
#
# Usage: sudo scripts/drive-rw.sh [--fix]
#   --fix  if the volume's dirty bit blocks mounting, clear it with
#          ntfsfix -d and retry once
set -euo pipefail

MOUNTPOINT="${MOUNTPOINT:-/srv/mediadrive}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIX=""
[[ "${1:-}" == "--fix" ]] && FIX=1

if [[ $EUID -ne 0 ]]; then
  echo "This needs root. Run: sudo $0" >&2
  exit 1
fi

current_opts="$(findmnt -no OPTIONS "$MOUNTPOINT" 2>/dev/null || true)"
if [[ "$current_opts" == rw* ]]; then
  echo "$MOUNTPOINT is already mounted read-write; nothing to do."
  exit 0
fi

# Reuse the fstab entry's own source/type/options so this script never
# drifts from the mount configuration, just with ro flipped to rw.
fstab_src="$(findmnt --fstab -no SOURCE "$MOUNTPOINT")"
fstab_type="$(findmnt --fstab -no FSTYPE "$MOUNTPOINT")"
rw_opts="$(findmnt --fstab -no OPTIONS "$MOUNTPOINT" | sed -E 's/(^|,)ro(,|$)/\1rw\2/')"
device="$(findmnt --fstab --evaluate -no SOURCE "$MOUNTPOINT" 2>/dev/null || echo "$fstab_src")"

echo "Stopping m-server (it holds the mount busy)..."
docker compose --project-directory "$REPO_DIR" stop m-server 2>/dev/null || true

if findmnt "$MOUNTPOINT" >/dev/null 2>&1; then
  umount "$MOUNTPOINT"
fi

try_mount() {
  mount -t "$fstab_type" -o "$rw_opts" "$fstab_src" "$MOUNTPOINT"
}

if ! try_mount; then
  if [[ -n "$FIX" ]] && command -v ntfsfix >/dev/null; then
    echo "Mount failed; clearing the NTFS dirty bit with ntfsfix -d $device ..."
    ntfsfix -d "$device"
    try_mount
  else
    echo "" >&2
    echo "Mount failed. If dmesg shows 'volume is dirty', clear it and retry:" >&2
    echo "  sudo ntfsfix -d $device   # from the ntfs-3g package" >&2
    echo "or rerun with: sudo $0 --fix" >&2
    exit 1
  fi
fi

echo "Restarting m-server..."
docker compose --project-directory "$REPO_DIR" start m-server 2>/dev/null || true

echo ""
findmnt "$MOUNTPOINT"
echo ""
echo "Drive is read-write. When you're done: sudo scripts/drive-ro.sh"
