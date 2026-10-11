#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
NDK="${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}"
if [[ -z "$SDK" || -z "$NDK" ]]; then
  echo "Set ANDROID_HOME and ANDROID_NDK_HOME." >&2
  exit 1
fi
if [[ -z "${GAKUMAS_RECOVERED_APK:-}" ]]; then
  echo "No recovered v1.5.11 base APK supplied; building from checked-in Java and Native sources." >&2
  exec bash "$ROOT/build-source-apk.sh"
fi
echo "Using byte-pinned recovered base APK for local build."
exec python3 "$ROOT/build-recovered-apk.py" \
  --base-apk "$GAKUMAS_RECOVERED_APK" --sdk "$SDK" --ndk "$NDK" \
  --keystore "${GAKUMAS_SIGNING_KEYSTORE:-$ROOT/.build/recovery.keystore}" --output "$ROOT/out"
