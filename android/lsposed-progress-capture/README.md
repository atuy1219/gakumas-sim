# Gakumas Progress Capture (LSPosed)

Native-only LSPosed module for `com.bandainamcoent.idolmaster_gakuen`.
It passively captures the card-instance sequence that the game itself feeds into
`ProduceUtility::CreateDeckProduceCardMasters()` and writes a JSON file compatible
with `gakumas-sim`'s exam progress importer.

## What it hooks

The current offsets are from the supplied `gakumas_analysis_fullcfg.elf`:

- `ProduceUtility::CreateDeckProduceCardMasters` — RVA `0x077C7018`
- `UserProduceProgressProduceCard::GetProduceCardData` — RVA `0x074DBEE0`
- `UserProduceProgressProduceCard::InternalMergeFrom` — RVA `0x074DBAB0`
- expected `libil2cpp.so` GNU Build ID — `c94ab574cfe2d62da43ec6167db4d96d429b18f8`

The module refuses to install hooks when the Build ID differs, so an app update
that changes `libil2cpp.so` should fail closed instead of applying stale RVAs.

## Captured fields

For each card instance:

- `number`
- `produceCardId`
- `upgradeCount`
- `deleted`
- `originType`
- `customizing`
- `customizes[]` with each applied `ProduceCardCustomize.id` and `customizeCount`
- whether a non-empty customize collection exists

The primary `produceCards` array is the live deck captured during native deck
construction. It is de-duplicated and sorted by `Number` ascending. Customize
entries are decoded read-only from the runtime protobuf
`RepeatedField<ProduceCardCustomize>`. The JSON also
contains `observedInstances`, populated from protobuf `InternalMergeFrom` calls,
which can include deleted/stale instances observed during the current process.

## Output paths

The module attempts both paths:

```text
/data/user/<userId>/com.bandainamcoent.idolmaster_gakuen/files/gakumas-sim/produce_cards.json
/storage/emulated/<userId>/Android/data/com.bandainamcoent.idolmaster_gakuen/files/gakumas-sim/produce_cards.json
```

The internal path is the authoritative one. The external app-specific path is
best-effort because Android storage policy can vary by ROM.

Example with root:

```sh
su -c 'cat /data/user/0/com.bandainamcoent.idolmaster_gakuen/files/gakumas-sim/produce_cards.json' \
  > /sdcard/Download/gakumas-produce-cards.json
```

Load that JSON in the `進行中プロデュースJSON` field of `gakumas-sim`.

## Installation

1. Install the APK.
2. Enable it in LSPosed.
3. Confirm the scope is only `com.bandainamcoent.idolmaster_gakuen`.
4. Force-stop and restart Gakumas.
5. Enter/open a part of Produce that causes the current deck to be built; the file is refreshed whenever `CreateDeckProduceCardMasters` runs.
6. Copy/read the generated JSON locally and import it into the simulator.

No extra Gakumas API request is made by this module, and it does not alter return
values, RNG state, card data, or server traffic.

## Build

The build is intentionally independent of Gradle. It needs Android SDK build-tools,
platform 35, NDK r27c or newer, JDK, `zip`, and `keytool`.

```sh
./build-apk.sh
```


## v1.1.0: native diagnostic and single-file export

A launcher activity, **学マス実機診断**, is now included in the same LSPosed APK.
Open it after enabling the module for the game's process. It requests read-only
root access to read the game's existing private capture files, refreshes every
2.5 seconds while visible, and saves the latest report to the module app's
internal files/gakumas-diagnostic-latest.json.

Press **診断JSONを書き出す** to save one gakumas-diagnostic.json via Android's
file picker. This JSON includes native events, deck cards, calculated RNG
transitions, detected differences and capture limitations. No captured data is
sent to a remote service.

**Verification boundary:** The Android viewer currently checks only the
32-bit XorShift state and mapped range results against native RNG events.
It does **not** establish card effect, score, action, stage or complete gameplay
parity. If only RNG checks match, the report says unverified, not match.
The trace-start line now reports explicit capture capabilities and no longer
contains the previously hardcoded sample seed.

The existing RNG/card-pool hooks are tied to one known libil2cpp.so Build ID.
The module deliberately does not apply outdated native offsets to unknown game
versions; on those versions exam_seed_trace.jsonl will not be available.
The existing dynamic deck-capture route may still work. Validate the module
status / Build ID after each game update.

### Continuous automatic comparison with ADB (host-side)

From the repository root, with Node 22+, adb and KernelSU root access:

    node tools/watch_native_exam.mjs --watch

This watches the game's private native trace and deck JSON through adb, recalculates
differences on every change, prints the first divergence, and atomically writes
one AI-ready out/gakumas-diagnostics/gakumas-diagnostic-latest.json.

Without a verified stage and master-data profile this compares RNG behavior
only; gameplay comparisons are explicitly unverified. To replay native card
moves through the existing tower simulator, supply a *verified* local profile
containing at least seed, stamina, initialDeck (or captured produceCards) and
cardMasters, with the required effect/P-item/stage masters populated:

    node tools/watch_native_exam.mjs --watch --profile ./verified-profile.json

The host attempts partial replay with createTowerTurnState, drawTowerTurn,
playTowerCard, and finishTowerTurn. It compares only unambiguous checkpoints
and records unsupported or ambiguous transitions. This is not a substitute
for native score/effect capture: MovePlayCard alone cannot prove every user
selection or ordering.

For offline analysis without ADB:

    node tools/watch_native_exam.mjs --trace ./exam_seed_trace.jsonl --cards ./produce_cards.json

### Building and installing

GitHub Actions workflow **Build LSPosed diagnostic APK** builds an arm64 APK
from build-apk.sh and uploads it as a workflow artifact. If rebuilding locally,
set Android SDK (ANDROID_HOME) and NDK and run the same script.

Each local build currently uses a freshly generated debug signing key. APKs
signed with different keys cannot be installed as upgrades over one another;
uninstall a previously signed variant if required, then re-enable the LSPosed
scope. This is a diagnostic build, not a signed production release.
