#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/out"
STAGE="$OUT/stage"
PACKAGE_SO="libgakumas_progress_capture.so"
MIN_API=23
TARGET_API=35

ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "$ANDROID_HOME" ]]; then
  echo "ANDROID_HOME or ANDROID_SDK_ROOT is required" >&2
  exit 1
fi

if [[ -n "${ANDROID_NDK_HOME:-}" ]]; then
  NDK="$ANDROID_NDK_HOME"
elif [[ -n "${ANDROID_NDK_ROOT:-}" ]]; then
  NDK="$ANDROID_NDK_ROOT"
else
  NDK="$(find "$ANDROID_HOME/ndk" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -n1)"
fi
if [[ -z "${NDK:-}" || ! -d "$NDK" ]]; then
  echo "Android NDK not found" >&2
  exit 1
fi

HOST_TAG=linux-x86_64
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) HOST_TAG=darwin-x86_64 ;;
  Darwin-x86_64) HOST_TAG=darwin-x86_64 ;;
esac
CXX="$NDK/toolchains/llvm/prebuilt/$HOST_TAG/bin/aarch64-linux-android${MIN_API}-clang++"
if [[ ! -x "$CXX" ]]; then
  echo "NDK compiler not found: $CXX" >&2
  exit 1
fi

BUILD_TOOLS="$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -n1)"
PLATFORM="$ANDROID_HOME/platforms/android-$TARGET_API"
if [[ ! -d "$PLATFORM" ]]; then
  PLATFORM="$(find "$ANDROID_HOME/platforms" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -n1)"
fi
AAPT2="$BUILD_TOOLS/aapt2"
D8="$BUILD_TOOLS/d8"
ZIPALIGN="$BUILD_TOOLS/zipalign"
APKSIGNER="$BUILD_TOOLS/apksigner"
ANDROID_JAR="$PLATFORM/android.jar"
for tool in "$AAPT2" "$D8" "$ZIPALIGN" "$APKSIGNER" "$ANDROID_JAR"; do
  [[ -e "$tool" ]] || { echo "Missing Android build dependency: $tool" >&2; exit 1; }
done

rm -rf "$OUT"
mkdir -p "$STAGE/lib/arm64-v8a" "$STAGE/META-INF/xposed" "$OUT/app-classes" "$OUT/dex" "$OUT/deps"

"$CXX"   -std=c++17 -O2 -fPIC -fvisibility=hidden -ffunction-sections -fdata-sections   -shared -static-libstdc++ -Wl,--gc-sections -Wl,--build-id=sha1   "$ROOT/src/main/cpp/progress_capture.cpp"   -ldl   -o "$STAGE/lib/arm64-v8a/$PACKAGE_SO"

READELF="$NDK/toolchains/llvm/prebuilt/$HOST_TAG/bin/llvm-readelf"
"$READELF" -d "$STAGE/lib/arm64-v8a/$PACKAGE_SO" | tee "$OUT/native-dynamic.txt"
if grep -q 'libc++_shared\.so' "$OUT/native-dynamic.txt"; then
  echo "ERROR: native module still depends on libc++_shared.so" >&2
  exit 1
fi

cp "$ROOT/src/main/resources/META-INF/xposed/"* "$STAGE/META-INF/xposed/"

LIBXPOSED_AAR="$OUT/deps/api-102.0.0.aar"
LIBXPOSED_API="$OUT/deps/libxposed-api-102-classes.jar"
curl -fL --retry 3 \
  "https://repo1.maven.org/maven2/io/github/libxposed/api/102.0.0/api-102.0.0.aar" \
  -o "$LIBXPOSED_AAR"
unzip -p "$LIBXPOSED_AAR" classes.jar > "$LIBXPOSED_API"
test -s "$LIBXPOSED_API"

mapfile -t JAVA_SOURCES < <(find "$ROOT/src/main/java" -name '*.java' -type f | sort)
javac -source 8 -target 8 \
  -cp "$LIBXPOSED_API:$ANDROID_JAR" \
  -d "$OUT/app-classes" \
  "${JAVA_SOURCES[@]}"

mapfile -t CLASS_FILES < <(find "$OUT/app-classes" -name '*.class' -type f | sort)
"$D8" \
  --lib "$ANDROID_JAR" \
  --classpath "$LIBXPOSED_API" \
  --min-api "$MIN_API" \
  --output "$OUT/dex" \
  "${CLASS_FILES[@]}"

cp "$OUT/dex/classes.dex" "$STAGE/classes.dex"

BASE_APK="$OUT/base.apk"
UNALIGNED="$OUT/gakumas-progress-capture-unaligned.apk"
ALIGNED="$OUT/gakumas-progress-capture-aligned.apk"
FINAL="$OUT/gakumas-progress-capture-v1.1.3.apk"

"$AAPT2" link   -I "$ANDROID_JAR"   --manifest "$ROOT/AndroidManifest.xml"   --min-sdk-version "$MIN_API"   --target-sdk-version "$TARGET_API"   -o "$BASE_APK"

cp "$BASE_APK" "$UNALIGNED"
(
  cd "$STAGE"
  zip -q -r "$UNALIGNED" META-INF classes.dex
  zip -q -0 "$UNALIGNED" "lib/arm64-v8a/$PACKAGE_SO"
)

"$ZIPALIGN" -P 16 -f 4 "$UNALIGNED" "$ALIGNED"

KEYSTORE="$OUT/debug.keystore"
keytool -genkeypair -v   -keystore "$KEYSTORE"   -storepass android -keypass android   -alias androiddebugkey   -keyalg RSA -keysize 2048 -validity 10000   -dname "CN=Gakumas Progress Capture,O=atuy1219,C=JP" >/dev/null 2>&1

"$APKSIGNER" sign   --ks "$KEYSTORE" --ks-pass pass:android   --key-pass pass:android --ks-key-alias androiddebugkey   --out "$FINAL" "$ALIGNED"

"$APKSIGNER" verify --verbose "$FINAL"
unzip -l "$FINAL" | grep -E 'META-INF/xposed/(java_init.list|native_init.list|scope.list|module.prop)|classes.dex|lib/arm64-v8a/libgakumas_progress_capture.so|AndroidManifest.xml'
unzip -lv "$FINAL" | grep 'lib/arm64-v8a/libgakumas_progress_capture.so' | grep 'Stored'
sha256sum "$FINAL" | tee "$FINAL.sha256"
echo "$FINAL"
