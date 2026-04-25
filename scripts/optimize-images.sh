#!/usr/bin/env bash
# Recompresses JPEGs to ~75% quality + emits WebP siblings.
# Idempotent — skips already-optimized files unless OVERWRITE=1.
set -euo pipefail

SRC="client-app/public/images/characters"
[ -d "$SRC" ] || { echo "no $SRC"; exit 1; }

# Each input gets a recompressed JPG + a WebP at the same name.
recompress_jpg() {
  local in="$1"; local out="$1.tmp.jpg"
  # qscale 4 ≈ ~78% quality, mjpeg encoder
  ffmpeg -loglevel error -y -i "$in" -q:v 4 "$out"
  # Only swap if smaller (occasionally re-encoding bloats already-tight JPEGs)
  local oldsize newsize
  oldsize=$(stat -c%s "$in")
  newsize=$(stat -c%s "$out")
  if [ "$newsize" -lt "$oldsize" ]; then
    mv "$out" "$in"
    echo "  jpg: $(basename "$in") $oldsize → $newsize ($(( 100 * newsize / oldsize ))%)"
  else
    rm "$out"
    echo "  jpg: $(basename "$in") kept original ($oldsize, recompress was bigger)"
  fi
}

emit_webp() {
  local in="$1"
  local out="${in%.jpg}.webp"
  if [ -f "$out" ] && [ "${OVERWRITE:-0}" != "1" ]; then return; fi
  # libwebp quality 80 — visually identical to JPEG q=78 but ~30% smaller
  ffmpeg -loglevel error -y -i "$in" -c:v libwebp -quality 80 "$out"
  local jpgsize webpsize
  jpgsize=$(stat -c%s "$in")
  webpsize=$(stat -c%s "$out")
  echo "  webp: $(basename "$out") jpg=$jpgsize webp=$webpsize ($(( 100 * webpsize / jpgsize ))%)"
}

shopt -s nullglob
total_before=0
total_after=0
for f in "$SRC"/*.jpg; do
  echo "→ $(basename "$f")"
  before=$(stat -c%s "$f")
  total_before=$(( total_before + before ))
  recompress_jpg "$f"
  emit_webp "$f"
  after=$(stat -c%s "$f")
  total_after=$(( total_after + after ))
done

echo ""
echo "Summary:"
echo "  JPG bytes: $total_before → $total_after ($(( 100 * total_after / total_before ))%)"
echo "  Files now in $SRC:"
ls -lh "$SRC" | grep -v '^total' | awk '{print "    "$5" "$9}'
