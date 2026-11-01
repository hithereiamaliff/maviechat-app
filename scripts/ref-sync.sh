#!/usr/bin/env bash
# Clones the pinned reference checkouts into .ref/: Open WebUI at
# packages/owui-protocol/src/support.json's referenceTag, and DeepTutor at
# packages/deeptutor-protocol/src/support.json's. They are specs for reading and for
# the copy check only: never run, build or install anything from them.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

sync() {
  local name="$1" repo="$2" support="$3"
  local tag dest current
  tag="$(node -p "require('$root/$support').referenceTag")"
  dest="$root/.ref/$name"
  if [ -d "$dest/.git" ]; then
    current="$(git -C "$dest" describe --tags --exact-match 2>/dev/null || true)"
    if [ "$current" = "$tag" ]; then
      echo "reference checkout already at $tag: .ref/$name"
      return
    fi
    rm -rf "$dest"
  fi
  mkdir -p "$root/.ref"
  git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$tag" "$repo" "$dest"
  echo "reference checkout at $tag: .ref/$name"
}

sync open-webui https://github.com/open-webui/open-webui.git packages/owui-protocol/src/support.json
sync deeptutor https://github.com/HKUDS/DeepTutor.git packages/deeptutor-protocol/src/support.json
