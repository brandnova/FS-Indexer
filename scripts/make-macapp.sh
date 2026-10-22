#!/usr/bin/env sh
# Wraps a macOS binary in "Perigee Files.app" and zips it into dist/.
# GoReleaser runs this by itself after each build (see .goreleaser.yaml). You don't need to run it by hand:
#   goreleaser release --snapshot --clean      builds everything, including the app zips, into dist/
# Usage (for testing): make-macapp.sh <binary> <os> <arch> <version>
set -eu

if [ "$#" -lt 4 ]; then
  echo "This script is run by GoReleaser, with four arguments: <binary> <os> <arch> <version>."
  echo "To build the macOS app, run:  goreleaser release --snapshot --clean"
  exit 2
fi

APP_NAME="Perigee Files"
ZIP_NAME="Perigee-Files"
BUNDLE_ID="com.brandnova.perigee.agent"

bin="$1"; os="$2"; arch="$3"; version="$4"
[ "$os" = "darwin" ] || exit 0

bin="$(cd "$(dirname "$bin")" && pwd)/$(basename "$bin")"
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

short="${version%%-*}" # Apple wants 1.2.3, without an -rc suffix
work="$(mktemp -d)"
app="$work/$APP_NAME.app"

mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" dist
cp "$bin" "$app/Contents/MacOS/perigee"
chmod 755 "$app/Contents/MacOS/perigee"

# What a double-click runs: open the dashboard, starting the agent in the background first if needed.
cat > "$app/Contents/MacOS/launcher" <<'LAUNCHER'
#!/bin/sh
exec "$(dirname "$0")/perigee" -ui
LAUNCHER
chmod 755 "$app/Contents/MacOS/launcher"

if [ -f branding/AppIcon.icns ]; then
  cp branding/AppIcon.icns "$app/Contents/Resources/AppIcon.icns"
else
  echo "make-macapp: branding/AppIcon.icns not found, so the app will have no icon"
fi

cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$short</string>
  <key>CFBundleVersion</key><string>$short</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.utilities</string>
  <key>NSHumanReadableCopyright</key><string>Made by Brand Nova. MIT License.</string>
</dict>
</plist>
PLIST

out="$root/dist/${ZIP_NAME}_${version}_macOS_${arch}.app.zip"
rm -f "$out"
(cd "$work" && zip -qry "$out" "$APP_NAME.app")
rm -rf "$work"
echo "make-macapp: wrote $out"