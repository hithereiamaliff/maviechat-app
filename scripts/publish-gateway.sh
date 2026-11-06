#!/bin/sh
# Mirrors the committed services/opencode-gateway into a checkout of its public repository
# (github.com/hithereiamaliff/maviechat-gateway), checks it there and commits. Pushing stays a
# separate step.
#
#   scripts/publish-gateway.sh <checkout of the public repository> ["commit message"]
set -eu
root=$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)
dest=${1:?usage: scripts/publish-gateway.sh <checkout of the public repository> [message]}
message=${2:-"Update from MavieChat $(git -C "$root" rev-parse --short HEAD)"}

# Everything in the checkout but its history and installed packages is replaced, so make sure it's the right one.
case "$(git -C "$dest" remote get-url origin 2>/dev/null || true)" in
  *maviechat-gateway*) ;;
  *) echo "$dest isn't a checkout of the maviechat-gateway repository." >&2; exit 1 ;;
esac
# Only committed files go public.
if [ -n "$(git -C "$root" status --porcelain -- services/opencode-gateway)" ]; then
  echo "Commit the gateway's changes first: only committed files are published." >&2
  exit 1
fi

find "$dest" -mindepth 1 -maxdepth 1 ! -name .git ! -name node_modules ! -name package-lock.json -exec rm -rf {} +
git -C "$root" archive HEAD services/opencode-gateway | tar -x -C "$dest" --strip-components=2

cd "$dest"
npm install --no-audit --no-fund > /dev/null
npm test
npm run -s typecheck
git add -A
if git diff --cached --quiet; then
  echo "Nothing new to publish."
  exit 0
fi
git commit -q -m "$message"
echo "Committed in $dest: $(git log --oneline -1)"
echo "Publish it with: git -C $dest push"
