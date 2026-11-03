#!/bin/zsh
set -eu
cd -- "${0:A:h}"
STAGING=$(mktemp -d /tmp/sgd-viewer-build.XXXXXX)
trap 'rm -rf "$STAGING"' EXIT
APP_NAME="${SGD_APP_NAME:-GelFriend-v2.4.0}"
APP="$STAGING/$APP_NAME.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -swift-version 5 -target arm64-apple-macosx13.0 Sources/CompoundFile.swift Sources/GelImage.swift Sources/BatchProcessor.swift Sources/Theme.swift Sources/AnalysisImport.swift Sources/AnalysisWindow.swift Sources/AgentTransport.swift Sources/AgentServer.swift Sources/BatchSheet.swift Sources/App.swift Sources/main.swift -o "$APP/Contents/MacOS/SGDViewer"
swiftc -O -swift-version 5 -target arm64-apple-macosx13.0 Sources/AgentTransport.swift Sources/AgentCLI.swift -o "$APP/Contents/MacOS/gelfriend-agent"
COPYFILE_DISABLE=1 ditto --norsrc --noextattr Agent "$APP/Contents/Resources/Agent"
COPYFILE_DISABLE=1 ditto --norsrc --noextattr Docs "$APP/Contents/Resources/Docs"
cp README_使用说明.md "$APP/Contents/Resources/README.md"
cp Info.plist "$APP/Contents/Info.plist"
COPYFILE_DISABLE=1 ditto --norsrc --noextattr Analysis "$APP/Contents/Resources/Analysis"
if [[ -f Assets/GelFriend.icns ]]; then
    cp Assets/GelFriend.icns "$APP/Contents/Resources/AppIcon.icns"
fi
find "$APP" -name '._*' -type f -delete
codesign --force --deep --sign - "$APP"
mkdir -p dist
# Stage/sign on the internal filesystem. External volumes can create AppleDouble
# sidecars which codesign mistakes for executables during recursive signing.
# Synchronize generated outputs so removed modules cannot remain in a rebuild.
if [[ "$APP_NAME" == */* || "$APP_NAME" == "." || "$APP_NAME" == ".." ]]; then
    echo "无效的应用输出名称" >&2
    exit 1
fi
rsync -a --delete --exclude='._*' "$APP/" "$(pwd)/dist/$APP_NAME.app/"
find "$(pwd)/dist/$APP_NAME.app" -name '._*' -type f -delete
codesign --verify --deep --strict "$(pwd)/dist/$APP_NAME.app"
ditto -c -k --norsrc --noextattr --keepParent "$APP" "$(pwd)/dist/$APP_NAME-Mac.zip"
echo "已生成：$(pwd)/dist/$APP_NAME.app"
