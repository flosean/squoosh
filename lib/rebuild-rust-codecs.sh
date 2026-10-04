#!/bin/sh
# Run in squoosh-rust-audit with the repository mounted at /repo.
set -eu
for codec in "$@"; do
  case "$codec" in oxipng|png|resize|hqx|rotate) ;; *) exit 1;; esac
  work=$(mktemp -d)
  tar -C "/repo/codecs/$codec" --exclude=node_modules --exclude=target --exclude=pkg --exclude=pkg-parallel -cf - . | tar -C "$work" -xf -
  cd "$work"
  for script in *.sh; do [ ! -f "$script" ] || sed -i 's/\r$//' "$script"; done
  if [ "$codec" = oxipng ]; then
    CFLAGS="-DUNALIGNED_ACCESS_IS_FAST=1" bash ./build.sh
    cp -a pkg pkg-parallel "/repo/codecs/$codec/"
  elif [ "$codec" = rotate ]; then
    sh ./build.sh
    cp rotate.wasm /repo/codecs/rotate/
  else
    wasm-pack build --target web -- --locked
    rm -f pkg/.gitignore
    cp -a pkg "/repo/codecs/$codec/"
  fi
  echo "REBUILT $codec"
done
