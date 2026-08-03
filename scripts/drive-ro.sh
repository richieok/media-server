#!/usr/bin/env bash
# Restore the media drive to its read-only baseline after a management
# session started with drive-rw.sh. Same umount/mount cycle (ntfs3 cannot
# change ro/rw in place, and m-server holds the mount busy).
#
# The ro mode is forced explicitly rather than trusted to fstab: an earlier
# version ran a bare "mount <mountpoint>" and happily remounted rw when
# fstab still said rw — while reporting success. fstab is still checked,
# because it alone decides what the next boot comes up as.
#
# Usage: sudo scripts/drive-ro.sh
set -euo pipefail

MOUNTPOINT="${MOUNTPOINT:-/srv/mediadrive}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "This needs root. Run: sudo $0" >&2
  exit 1
fi

# Keep systemd's view of fstab fresh, so mount doesn't emit confusing
# "fstab has been modified ... use daemon-reload" hints mid-script.
command -v systemctl >/dev/null && systemctl daemon-reload

current_opts="$(findmnt -no OPTIONS "$MOUNTPOINT" 2>/dev/null || true)"
if [[ "$current_opts" == ro* ]]; then
  echo "$MOUNTPOINT is already mounted read-only; nothing to do."
  exit 0
fi

fstab_src="$(findmnt --fstab -no SOURCE "$MOUNTPOINT")"
fstab_type="$(findmnt --fstab -no FSTYPE "$MOUNTPOINT")"
fstab_opts="$(findmnt --fstab -no OPTIONS "$MOUNTPOINT")"

other_opts="$(printf '%s' "$fstab_opts" |
  awk -F, '{for (i = 1; i <= NF; i++) if ($i != "ro" && $i != "rw") printf "%s%s", (n++ ? "," : ""), $i}')"
ro_opts="ro${other_opts:+,$other_opts}"

echo "Stopping m-server (it holds the mount busy)..."
docker compose --project-directory "$REPO_DIR" stop m-server 2>/dev/null || true

if findmnt "$MOUNTPOINT" >/dev/null 2>&1; then
  # Flush pending writes before unmounting a volume we were writing to.
  sync
  umount "$MOUNTPOINT"
fi

mount -t "$fstab_type" -o "$ro_opts" "$fstab_src" "$MOUNTPOINT"

echo "Restarting m-server..."
docker compose --project-directory "$REPO_DIR" start m-server 2>/dev/null || true

# Never report a state we haven't confirmed.
state="$(findmnt -no OPTIONS "$MOUNTPOINT")"
if [[ "$state" != ro* ]]; then
  echo "ERROR: expected ro but $MOUNTPOINT is mounted with: $state" >&2
  exit 1
fi

echo ""
findmnt "$MOUNTPOINT"
echo ""
echo "Drive is back to read-only."

# The mount above is ro regardless of fstab, but fstab decides what the
# next boot comes up as — flag it if it wouldn't also be ro. (No ro token
# means rw: that is mount's default mode.)
if [[ ",$fstab_opts," != *,ro,* ]]; then
  echo "" >&2
  echo "WARNING: fstab does not mount $MOUNTPOINT ro, so the next boot will" >&2
  echo "come up read-write. Fix the baseline with:" >&2
  echo "  sudo sed -i 's/${fstab_type} rw,/${fstab_type} ro,/' /etc/fstab && sudo systemctl daemon-reload" >&2
fi
