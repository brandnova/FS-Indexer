#!/usr/bin/env bash
# Writes THIRD_PARTY_NOTICES.md: the licences of everything the agent and the app ship with.
# Needs: go install github.com/google/go-licenses@latest   (and Node, for npx)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

command -v go-licenses >/dev/null || { echo "FAIL: install go-licenses first (see the comment at the top)"; exit 1; }

{
  echo "# Third-party notices"
  echo
  echo "FS Indexer is MIT licensed. It includes the open-source components below, each under its own licence."
  echo
  echo "## Agent (Go modules)"
  echo
  echo "| Module | Version | Licence | Licence text |"
  echo "| --- | --- | --- | --- |"
  (cd agent && go-licenses report ./... --template ../scripts/licenses.tmpl 2>/dev/null)
  echo
  echo "## App (npm packages)"
  echo
  echo "| Package | Licence | Repository |"
  echo "| --- | --- | --- |"
  (cd mobile && npx --yes license-checker --production --json | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const j = JSON.parse(s);
      for (const [k, v] of Object.entries(j).sort()) console.log(`| ${k} | ${v.licenses} | ${v.repository || ""} |`);
    });')
} > THIRD_PARTY_NOTICES.md

echo "wrote THIRD_PARTY_NOTICES.md: skim it for anything with a licence you didn't expect (GPL or AGPL, for example)."