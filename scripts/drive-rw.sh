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

# Keep systemd's view of fstab fresh, so mount doesn't emit confusing
# "fstab has been modified ... use daemon-reload" hints mid-script.
command -v systemctl >/dev/null && systemctl daemon-reload

current_opts="$(findmnt -no OPTIONS "$MOUNTPOINT" 2>/dev/null || true)"
if [[ "$current_opts" == rw* ]]; then
  echo "$MOUNTPOINT is already mounted read-write; nothing to do."
  exit 0
fi

# Build the mount options ourselves: fstab's list with any ro/rw stripped,
# then the mode this script exists to set placed first. Deriving the mode
# from fstab (an earlier version substituted ro->rw in place) silently does
# the wrong thing when fstab doesn't say what we assume it says.
fstab_src="$(findmnt --fstab -no SOURCE "$MOUNTPOINT")"
fstab_type="$(findmnt --fstab -no FSTYPE "$MOUNTPOINT")"
fstab_opts="$(findmnt --fstab -no OPTIONS "$MOUNTPOINT")"
device="$(findmnt --fstab --evaluate -no SOURCE "$MOUNTPOINT" 2>/dev/null || echo "$fstab_src")"

other_opts="$(printf '%s' "$fstab_opts" |
  awk -F, '{for (i = 1; i <= NF; i++) if ($i != "ro" && $i != "rw") printf "%s%s", (n++ ? "," : ""), $i}')"
rw_opts="rw${other_opts:+,$other_opts}"

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

# Never report a state we haven't confirmed.
state="$(findmnt -no OPTIONS "$MOUNTPOINT")"
if [[ "$state" != rw* ]]; then
  echo "ERROR: expected rw but $MOUNTPOINT is mounted with: $state" >&2
  exit 1
fi

echo ""
findmnt "$MOUNTPOINT"
echo ""
echo "Drive is read-write. When you're done: sudo scripts/drive-ro.sh"
