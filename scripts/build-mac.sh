#!/usr/bin/env bash
#
# Builds MacMath for macOS and signs it with the stable "MacMath Dev" identity that
# scripts/setup-mac-signing.sh creates. `npm run build:dir` and `npm run build` run this.
#
#   scripts/build-mac.sh          app bundle in dist/mac-arm64 (or dist/mac for Intel)
#   scripts/build-mac.sh --dmg    the same, plus dist/MacMath-<version>-<arch>.dmg
#
# The DMG is made with hdiutil from the signed bundle rather than by electron-builder:
# electron-builder's DMG step packages before our signing and hangs on recent macOS.
set -euo pipefail
cd "$(dirname "$0")/.."

NAME="${MACMATH_SIGN_IDENTITY:-MacMath Dev}"
WANT_DMG=false
[[ "${1:-}" == "--dmg" ]] && WANT_DMG=true

if [[ "$(uname)" != "Darwin" ]]; then
  echo "MacMath builds only on macOS." >&2
  exit 1
fi

if ! security find-certificate -c "$NAME" >/dev/null 2>&1; then
  cat >&2 <<EOF

  No code-signing identity named "$NAME" in your keychain.

  Every MacMath build is signed with one stable identity, so that macOS keeps the
  Accessibility permission across rebuilds. Create it once with:

      npm run setup:signing

  then run this build again.

EOF
  exit 1
fi

node native/build.js
npx electron-builder --mac --dir

APP="$(ls -d dist/mac*/MacMath.app | head -1)"
codesign --force --deep --sign "$NAME" "$APP" 2>/dev/null
codesign --verify --deep --strict "$APP"
echo "Built and signed: $APP"

if $WANT_DMG; then
  VERSION="$(node -p "require('./package.json').version")"
  ARCH="$(uname -m)"
  DMG="dist/MacMath-${VERSION}-${ARCH}.dmg"
  STAGE="$(mktemp -d)"
  trap 'rm -rf "$STAGE"' EXIT
  ditto "$APP" "$STAGE/MacMath.app"
  ln -s /Applications "$STAGE/Applications"
  rm -f "$DMG"
  hdiutil create -volname "MacMath" -srcfolder "$STAGE" -ov -format UDZO -quiet "$DMG"
  echo "Built: $DMG"
fi
