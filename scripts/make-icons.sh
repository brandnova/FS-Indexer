#!/usr/bin/env bash
# Builds every icon the project needs from two source images:
#   branding/logo-agent.png   the PC agent: dashboard, Windows .exe, macOS app, Linux packages
#   branding/logo-client.png  the phone app: Android and iPhone icons, splash, store icons
# Needs: ImageMagick (sudo dnf install ImageMagick), png2icns (sudo dnf install libicns-utils),
#        go-winres (go install github.com/tc-hib/go-winres@latest) for the Windows icon.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

AGENT=branding/logo-agent.png
CLIENT=branding/logo-client.png

fail() { echo "FAIL: $*"; exit 1; }
for f in "$AGENT" "$CLIENT"; do [[ -f "$f" ]] || fail "$f not found (put the two source images in branding/)"; done
command -v magick >/dev/null || fail "ImageMagick is not installed (sudo dnf install ImageMagick)"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# A square of the given size with the picture centred and transparent padding.
square() { magick "$1" -background none -gravity center -resize "${2}x${2}" -extent "${2}x${2}" "$3"; }

check_source() {
  local w h corner
  read -r w h < <(magick identify -format '%w %h' "$1[0]")
  (( w >= 1024 && h >= 1024 )) || echo "WARN: $1 is ${w}x${h}; 1024x1024 or larger gives the sharpest result."
  [[ "$w" == "$h" ]] || echo "WARN: $1 isn't square (${w}x${h}); it will be centred on a square."
  corner="$(magick "$1[0]" -format '%[pixel:p{3,3}]' info:)"
  [[ "$corner" == *",0)" || "$corner" == "none" || "$corner" == "transparent" ]] \
    || echo "WARN: $1 has a solid corner pixel ($corner). If a dark margin surrounds the rounded tile, crop it first (see the guide)."
}

# ---------- the agent ----------
echo "== the agent"
check_source "$AGENT"
square "$AGENT" 1024 "$work/agent-1024.png"
mkdir -p branding agent/web/static/images agent/winres
for s in 16 32 48 64 128 256 512 1024; do square "$work/agent-1024.png" "$s" "branding/icon-$s.png"; done
cp branding/icon-512.png agent/web/static/images/logo.png
cp branding/icon-64.png  agent/web/static/images/favicon.png
cp branding/icon-256.png agent/winres/icon.png
cp branding/icon-16.png  agent/winres/icon16.png

if command -v png2icns >/dev/null; then
  png2icns branding/AppIcon.icns branding/icon-{16,32,48,128,256,512}.png >/dev/null
  echo "wrote branding/AppIcon.icns"
else
  echo "WARN: png2icns not found, so AppIcon.icns was skipped (sudo dnf install libicns-utils)"
fi
if command -v go-winres >/dev/null; then
  (cd agent && go-winres make) && echo "wrote the Windows icon resources (rsrc_windows_*.syso)"
else
  echo "WARN: go-winres not found, so the Windows icon wasn't rebuilt (go install github.com/tc-hib/go-winres@latest)"
fi

# ---------- the phone app ----------
echo "== the phone app"
check_source "$CLIENT"
square "$CLIENT" 1024 "$work/client-1024.png"

# The tile's own edge colour fills the rounded corners (iPhone and the stores add their own rounding).
edge="$(magick "$work/client-1024.png" -format '%[hex:p{512,36}]' info:)"
[[ "${edge:6:2}" == "00" ]] && echo "WARN: the tile doesn't reach the edge of the picture; crop the source tighter (see the guide)."
EDGE="#${edge:0:6}"

mkdir -p mobile/assets branding/store docs/images
# A full-bleed square with no transparency: the iPhone icon, and the base for the others.
magick "$work/client-1024.png" -background "$EDGE" -alpha remove -alpha off "$work/client-full.png"
cp "$work/client-full.png" mobile/assets/icon.png
# Android adaptive icon: the tile at 78%, centred on transparency. Its background is the edge colour (app.json).
magick "$work/client-full.png" -resize 800x800 -background none -gravity center -extent 1024x1024 mobile/assets/adaptive-icon.png
# The splash screen shows the rounded tile on navy.
cp "$work/client-1024.png" mobile/assets/splash-icon.png
square "$work/client-1024.png" 48 mobile/assets/favicon.png
# Store listings.
magick "$work/client-full.png" -resize 512x512 branding/store/play-icon-512.png
cp "$work/client-full.png" branding/store/appstore-1024.png
# README and the landing page.
square "$work/agent-1024.png" 256 docs/images/logo-agent.png
square "$work/client-1024.png" 256 docs/images/logo-client.png

echo
echo "Done. Put this in mobile/app.json:   \"adaptiveIcon\": { ..., \"backgroundColor\": \"$EDGE\" }"
echo "Then: git add branding mobile/assets agent/web/static/images agent/winres rsrc_windows_*.syso docs/images"
