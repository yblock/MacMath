#!/usr/bin/env bash
#
# One-time setup: creates the self-signed code-signing identity that every MacMath
# build is signed with. Run it once per Mac, before `npm run build` or `npm run build:dir`.
#
# Why: macOS ties the Accessibility permission (which Insert and loading a selection
# need) to the app's code signature. An ad-hoc signature keys on the content hash, which
# changes on every build, so each rebuild would be a stranger to macOS and you would have
# to re-grant the permission every time. Signing with one certificate keeps the identity
# stable across builds. It does nothing for distribution; only a Developer ID
# certificate and notarization do that.
#
# codesign accepts an untrusted self-signed certificate as long as its keychain is in the
# search list, which the login keychain always is, so no trust settings are changed.
# Recipe adapted from LaTeX Squiggly's scripts/setup-mac-signing.sh (MIT).
#
# The same identity can be made by hand: Keychain Access -> Certificate Assistant ->
# Create a Certificate, Name "MacMath Dev", Identity Type "Self Signed Root",
# Certificate Type "Code Signing".
set -euo pipefail

NAME="${MACMATH_SIGN_IDENTITY:-MacMath Dev}"
DAYS="${DAYS:-3650}"
KEYCHAIN="${HOME}/Library/Keychains/login.keychain-db"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This only applies to macOS." >&2
  exit 1
fi

if security find-certificate -c "$NAME" "$KEYCHAIN" >/dev/null 2>&1; then
  echo "Identity \"$NAME\" already exists in your login keychain. Nothing to do."
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Apple's LibreSSL, not a Homebrew OpenSSL 3 that may be first on PATH: OpenSSL 3 writes
# PKCS#12 files with algorithms the Security framework rejects ("MAC verification failed").
OPENSSL=/usr/bin/openssl

# LibreSSL rejects an empty PKCS#12 password, so use a throwaway one
P12_PASSWORD="$($OPENSSL rand -hex 16)"

"$OPENSSL" req -x509 -newkey rsa:2048 -nodes -days "$DAYS" \
  -keyout "$WORK/key.pem" -out "$WORK/cert.pem" \
  -subj "/CN=$NAME" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" 2>/dev/null

"$OPENSSL" pkcs12 -export \
  -inkey "$WORK/key.pem" -in "$WORK/cert.pem" \
  -out "$WORK/identity.p12" -name "$NAME" \
  -passout "pass:$P12_PASSWORD" 2>/dev/null

# -T lets codesign use the private key
security import "$WORK/identity.p12" -k "$KEYCHAIN" -P "$P12_PASSWORD" -T /usr/bin/codesign >/dev/null

# Without this, macOS shows "codesign wants to access key ..." on every build. It needs
# the login keychain password, which is only asked for here and never stored.
echo "Login password, so codesign can use the key without prompting (hidden, not stored; Return to skip):"
read -r -s LOGIN_PASSWORD
if [[ -n "$LOGIN_PASSWORD" ]] && ! security set-key-partition-list \
    -S apple-tool:,apple:,codesign: -s -k "$LOGIN_PASSWORD" "$KEYCHAIN" >/dev/null 2>&1; then
  echo "Could not set the key partition list; macOS will prompt once on the first build."
fi
unset LOGIN_PASSWORD

echo "Created \"$NAME\". npm run build / build:dir now sign with it."
echo "If MacMath already had Accessibility from an ad-hoc build, remove and re-add it once after the next build."
