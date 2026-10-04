#!/bin/sh
# Run inside the pinned squoosh-cpp Docker image with this repository at /repo.
# Build on the Linux filesystem; copy back matched JS/WASM artifacts only on success.
set -eu
for codec in "$@"; do
  case "$codec" in qoi|webp|avif|mozjpeg|jxl|wp2|imagequant|visdif) ;; *) echo "Unsupported codec: $codec" >&2; exit 1;; esac
  work=$(mktemp -d)
  tar -C "/repo/codecs/$codec" --exclude=node_modules --exclude='*.js' --exclude='*.wasm' --exclude='*.o' -cf - . | tar -C "$work" -xf -
  (cd "$work" && emmake make -j4)
  (cd "$work" && find . -maxdepth 2 -type f \( -name '*.js' -o -name '*.wasm' \) | while read -r file; do cp "$file" "/repo/codecs/$codec/$file"; done)
  echo "REBUILT $codec"
done
