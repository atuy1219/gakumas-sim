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
- whether a customize collection exists

The primary `produceCards` array is the live deck captured during native deck
construction. It is de-duplicated and sorted by `Number` ascending. The JSON also
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
