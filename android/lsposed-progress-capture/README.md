# Gakumas Progress Capture (LSPosed)

Native-only LSPosed module for `com.bandainamcoent.idolmaster_gakuen`.
It passively captures the card-instance sequence that the game itself feeds into
`ProduceUtility::CreateDeckProduceCardMasters()`. Exports now use the same
`gakumas-sim-exam-preset` v11 JSON schema as the Web UI.

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

## On-demand export

The installed module now has a launcher activity. With Gakumas running and the
LSPosed scope enabled:

1. Open **Gakumas Progress Capture** from the launcher.
2. Enter any file name.
3. Tap **現在のデータを取得してエクスポート**.
4. Grant the root request if prompted.

The module sends a request to the injected game process, snapshots the latest
known card data at that moment, then copies the unified preset to:

```text
/storage/emulated/0/Download/gakumas-sim/<requested-name>.json
```

Root is intentionally used for this hand-off because the module UI and the
injected target process run under different Android UIDs, while Android scoped
storage prevents a normal target-process write to the public Download directory.

The passive capture is also refreshed at:

```text
/data/user/<userId>/com.bandainamcoent.idolmaster_gakuen/files/gakumas-sim/exam_preset.json
/storage/emulated/<userId>/Android/data/com.bandainamcoent.idolmaster_gakuen/files/gakumas-sim/exam_preset.json
```

The exported file contains the same top-level fields as the Web export. Fields
that cannot be resolved safely from the live game process remain blank/default;
card instances, customization state, Number order, Build ID and the current Seed
are included when available.

## Installation

1. Install the APK.
2. Enable it in LSPosed.
3. Confirm the scope is only `com.bandainamcoent.idolmaster_gakuen`.
4. Force-stop and restart Gakumas.
5. Enter/open a part of Produce that causes the current deck to be built.
6. Open the module app and export the snapshot with the desired file name.

No extra Gakumas API request is made by this module, and it does not alter return
values, RNG state, card data, or server traffic.

### Diagnostics

Version 1.1.2 records the Java bootstrap path in `bootstrap_status.json`, including
the module `nativeLibraryDir` and the exact native `.so` path that was attempted.
The launcher also shows whether `libgakumas_progress_capture.so` is actually mapped
inside the game process. This distinguishes Java module loading, native library
loading, `native_init` execution, request watching, deck capture, and export.

## Build

The build is intentionally independent of Gradle. It needs Android SDK build-tools,
platform 35, NDK r27c or newer, JDK, `zip`, and `keytool`.

```sh
./build-apk.sh
```


### Android 16 app-data isolation

The launcher accesses the target app's private files through
`/proc/<game-pid>/root/data/user/<userId>/...`. On devices with app-data mount
isolation, a root shell started from the launcher may not see another app's
`/data/user/0/<package>` directly even though the target process sees it. The native
watcher creates the handshake files from inside the game process first; the launcher
only truncates those existing files through the target process root so ownership and
SELinux/MCS labels are preserved.


### External-storage control channel

Version 1.1.6 moves the export request/done/status/manual-export control channel to
`/storage/emulated/<userId>/Android/data/com.bandainamcoent.idolmaster_gakuen/files/gakumas-sim/`.
The target game creates the control files itself. The launcher-side root shell reaches the same
underlying files through `/data/media/<userId>/Android/data/...`, which avoids the app-private
`/data/user` mount namespace isolation observed on Android 16 while preserving the target app's
normal access to its own external files directory.


### Live card observation

Version 1.1.7 also observes `UserProduceProgressProduceCard.get_ProduceCardId()`.
Whenever the game renders or otherwise reads a produce-card instance, the module snapshots that
instance's Number, card ID, upgrade/deleted/origin fields and customizations into the live card
cache. This removes the previous requirement that `CreateDeckProduceCardMasters` must have already
run. `export_status.json` now includes hit counters for CreateDeck, GetProduceCardData, and
ProduceCardId plus seen/last-deck counts for diagnosis.


### UserDataManager live list capture

Version 1.1.8 additionally hooks `Campus.Common.User.UserDataManager` (or its base class)
`get__userProduceProgressProduceCardList` and fallback spellings. When the game exposes the
current produce-card collection, the module enumerates the full list and replaces the previous
cache, preventing stale cards from an older produce session from leaking into exports.
`capture_status.json` reports `managerCardListObserver`; `export_status.json` reports the
manager-list hit count and last observed collection count.
