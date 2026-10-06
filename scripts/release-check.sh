#!/usr/bin/env bash
# Usage: scripts/release-check.sh v0.2.0
# Checks everything that should be true BEFORE you create the release tag.
# It never changes anything.
set -euo pipefail

tag="${1:?usage: scripts/release-check.sh vX.Y.Z}"
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || { echo "FAIL: tag must look like v1.2.3 or v1.2.3-rc1"; exit 1; }
base="${tag#v}"
base="${base%%-*}" # app.json holds the version without any -rc suffix

fail() { echo "FAIL: $*"; exit 1; }

cd "$(git rev-parse --show-toplevel)"

[[ -z "$(git status --porcelain)" ]] || fail "working tree is not clean (commit or stash first)"
[[ "$(git branch --show-current)" == "main" ]] || fail "not on the main branch"
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then fail "tag $tag already exists"; fi

app_version="$(jq -r '.expo.version' mobile/app.json)"
[[ "$app_version" == "$base" ]] || fail "mobile/app.json version is $app_version, expected $base"

source="$(jq -r '.cli.appVersionSource // "local"' mobile/eas.json)"
if [[ "$source" == "local" ]]; then
  code="$(jq -r '.expo.android.versionCode // 0' mobile/app.json)"
  prev="$(git describe --tags --abbrev=0 2>/dev/null || true)"
  if [[ -n "$prev" ]]; then
    prev_code="$(git show "$prev:mobile/app.json" | jq -r '.expo.android.versionCode // 0')"
    (( code > prev_code )) || fail "android.versionCode ($code) must be higher than in $prev ($prev_code)"
  fi
else
  echo "Build numbers are managed by EAS (remote): skipping the versionCode check."
fi

echo "Running checks (about a minute)..."
(cd agent && go vet ./... && go test ./...)
(cd mobile && npx tsc --noEmit)

echo "OK. Ready to release $tag. Next:"
echo "  git tag -a $tag -m \"$tag\" && git push origin $tag"