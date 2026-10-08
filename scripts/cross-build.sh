#!/usr/bin/env bash
# Builds the agent for every release target to prove it still compiles and links everywhere.
# Usage: scripts/cross-build.sh
set -euo pipefail

cd "$(git rev-parse --show-toplevel)/agent"

for target in linux/amd64 linux/arm64 windows/amd64 windows/arm64 darwin/amd64 darwin/arm64; do
  echo "building $target"
  GOOS="${target%/*}" GOARCH="${target#*/}" CGO_ENABLED=0 go build -o /dev/null . || { echo "FAIL: $target"; exit 1; }
done

echo "OK: every target builds"