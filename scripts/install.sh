#!/bin/sh
# Installs the `browser-agent` command and a "Browser Agent" app in ~/Applications.
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
APP="$HOME/Applications/Browser Agent.app"

[ -n "$NODE" ] || { echo "node not found on PATH"; exit 1; }

# Terminal command.
cd "$PROJECT_DIR"
npm link --silent
echo "Installed command: $(command -v browser-agent)"

# App bundle. Apps launched from Finder don't get the shell PATH, so node is pinned here;
# rerun this script after moving the project or changing Node installs.
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cat > "$APP/Contents/MacOS/browser-agent" <<SCRIPT
#!/bin/sh
exec "$NODE" "$PROJECT_DIR/bin/browser-agent.js" open
SCRIPT
chmod +x "$APP/Contents/MacOS/browser-agent"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Browser Agent</string>
  <key>CFBundleDisplayName</key><string>Browser Agent</string>
  <key>CFBundleIdentifier</key><string>local.browser-agent</string>
  <key>CFBundleExecutable</key><string>browser-agent</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

if [ -f "$PROJECT_DIR/scripts/AppIcon.icns" ]; then
  cp "$PROJECT_DIR/scripts/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
fi
touch "$APP"
echo "Installed app: $APP (open it with Spotlight, or drag it to the Dock)"
