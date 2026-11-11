#!/usr/bin/env bash
# Sign the Windows installer with the project's code-signing certificate.
#
# Usage: scripts/sign-windows.sh <unsigned.exe> <signed.exe>
#
# The private key is NOT in the repository (it is gitignored). Put it at
# .signing/logvex-codesign.key, or point CODESIGN_KEY at it. The matching public
# certificate .signing/logvex-codesign.crt IS committed so users can inspect it.
set -euo pipefail

IN="${1:?usage: sign-windows.sh <unsigned.exe> <signed.exe>}"
OUT="${2:?usage: sign-windows.sh <unsigned.exe> <signed.exe>}"

CRT="${CODESIGN_CERT:-.signing/logvex-codesign.crt}"
KEY="${CODESIGN_KEY:-.signing/logvex-codesign.key}"
TS="${CODESIGN_TS:-http://timestamp.digicert.com}"

command -v osslsigncode >/dev/null || { echo "osslsigncode is required: apt-get install osslsigncode" >&2; exit 1; }
[ -f "$CRT" ] || { echo "certificate not found: $CRT" >&2; exit 1; }
[ -f "$KEY" ] || { echo "private key not found: $KEY (see docs/SIGNING.md)" >&2; exit 1; }

# osslsigncode refuses to overwrite an existing file, so sign into a fresh temp
# path (not a pre-created one) and move it into place.
TMP="$(mktemp -u --suffix=.exe)"
trap 'rm -f "$TMP"' EXIT

osslsigncode sign \
  -certs "$CRT" -key "$KEY" \
  -n "Logvex Fleet Manager" \
  -i "https://github.com/logvex-sg/Botsv1" \
  -h sha256 -ts "$TS" \
  -in "$IN" -out "$TMP"

mv "$TMP" "$OUT"
trap - EXIT

echo "signed: $OUT"
osslsigncode verify -in "$OUT" | grep -E "Calculated message digest|Subject:|Timestamp time" | sed 's/^/  /'
