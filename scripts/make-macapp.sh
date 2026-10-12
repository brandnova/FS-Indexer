#!/usr/bin/env sh
# Wraps a macOS agent binary in "FS Indexer.app" and zips it into dist/.
# GoReleaser calls this after every build (see .goreleaser.yaml); it does nothing for other systems.
# Usage: make-macapp.sh <binary> <os> <arch> <version>
set -eu

APP_NAME="FS Indexer"   # change together with the project name
BUNDLE_ID="com.brandnova.fsindexer.agent"

bin="$1"; os="$2"; arch="$3"; version="$4"
[ "$os" = "darwin" ] || exit 0

bin="$(cd "$(dirname "$bin")" && pwd)/$(basename "$bin")"
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

short="${version%%-*}" # Apple wants 1.2.3, without an -rc suffix
work="$(mktemp -d)"
app="$work/$APP_NAME.app"

mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" dist
cp "$bin" "$app/Contents/MacOS/fsagent"
chmod 755 "$app/Contents/MacOS/fsagent"

# What a double-click runs: open the dashboard, starting the agent in the background first if needed.
cat > "$app/Contents/MacOS/launcher" <<'LAUNCHER'
#!/bin/sh
exec "$(dirname "$0")/fsagent" -ui
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

out="$root/dist/FS-Indexer_${version}_macOS_${arch}.app.zip"
rm -f "$out"
(cd "$work" && zip -qry "$out" "$APP_NAME.app")
rm -rf "$work"
echo "make-macapp: wrote $out"