#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
NDK="${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}"
if [[ -z "$SDK" || -z "$NDK" || -z "${GAKUMAS_RECOVERED_APK:-}" ]]; then
  echo "Set ANDROID_HOME, ANDROID_NDK_HOME and GAKUMAS_RECOVERED_APK (exact v1.5.11 APK)." >&2
  echo "The recovered DEX preserves the on-demand diagnostics UI; old Java sources are not used." >&2
  exit 1
fi
exec python3 "$ROOT/build-recovered-apk.py" \
  --base-apk "$GAKUMAS_RECOVERED_APK" --sdk "$SDK" --ndk "$NDK" \
  --keystore "${GAKUMAS_SIGNING_KEYSTORE:-$ROOT/.build/recovery.keystore}" --output "$ROOT/out"
