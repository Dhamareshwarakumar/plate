#!/bin/sh
# Rasterises public/favicon.svg into the PNG sizes the PWA manifest needs (macOS: uses qlmanage).
set -eu
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
render() { # $1 = source svg, $2 = size, $3 = output
  qlmanage -t -s "$2" -o "$tmp" "$1" >/dev/null 2>&1
  mv "$tmp/$(basename "$1").png" "$3"
}
render public/favicon.svg 192 public/pwa-192.png
render public/favicon.svg 512 public/pwa-512.png
render public/favicon.svg 180 public/apple-touch-icon.png
render public/maskable.svg 512 public/pwa-maskable-512.png
render public/badge.svg 96 public/badge-96.png
rm -rf "$tmp"
echo "icons written to public/"
