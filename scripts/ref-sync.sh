#!/usr/bin/env bash
# Clones Open WebUI at the pinned reference tag (packages/owui-protocol/src/support.json)
# into .ref/open-webui. The checkout is a spec for reading and for the copy check only:
# never run, build or install anything from it.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
tag="$(node -p "require('$root/packages/owui-protocol/src/support.json').referenceTag")"
dest="$root/.ref/open-webui"

if [ -d "$dest/.git" ]; then
  current="$(git -C "$dest" describe --tags --exact-match 2>/dev/null || true)"
  if [ "$current" = "$tag" ]; then
    echo "reference checkout already at $tag"
    exit 0
  fi
  rm -rf "$dest"
fi

mkdir -p "$root/.ref"
git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$tag" https://github.com/open-webui/open-webui.git "$dest"
echo "reference checkout at $tag: .ref/open-webui"
