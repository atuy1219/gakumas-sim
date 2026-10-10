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


## v1.5.0: native diagnostic and single-file export

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

## v1.5.0 event-driven capture

The native hooks now stay installed but suppress high-frequency RNG/card-pool writes while idle. The first exam deck shuffle, initial-card setup or draw starts a capture session. This applies to the Tower, Contest and audition/exam paths through the same ExamCardMoveController; the numeric native ExamType is always retained. Tower=5 is validated against the reference ELF; contest and audition labels are only used when runtime IsContest/IsAudition getters confirm them, otherwise the mode is exam-unknown.

The session switches to stopped when native ExamParameterModel.Dispose is available or an observed remaining-turn-zero reset is detected. The latter is explicitly heuristic; premature exits may remain recording until a new exam supersedes the old session. Every stop emits trace-stop and archives the completed raw JSONL as exam_session_<start_ms>.jsonl, while exam_seed_trace.jsonl remains the latest session. exam_session_status.json contains recording/stopped and mode/ExamType for the activity UI.

For new game Build IDs, the module searches IL2CPP runtime metadata for required exam methods and derives native field offsets by semantic managed field names. If layout, classes or methods cannot be confirmed it refuses to install unsafe trace hooks and reports this in capture_status.json. The new user-supplied ELF is stripped (Build ID 77fda4e2a21f23954e2349b83fc113ede408f70b) so actual runtime metadata/hook success must still be tested on device; compatibility is NOT guaranteed by a successful APK build.

## v1.5.0: encrypted metadata runtime inventory

Game client 3.4.1 ships a global-metadata.dat without the standard IL2CPP header. The updated module records names/parameter counts and field offsets of relevant Exam/Contest/Audition/Tower classes from the decrypted live IL2CPP runtime in exam_runtime_inventory.json, not from the on-disk file. This is included in the Android diagnostic JSON export. Runtime reflection and actual native hook behavior still require on-device verification.

## v1.5.0: capture-file availability notifications

The Android diagnostic activity no longer treats a missing `exam_seed_trace.jsonl` as a root permission failure. A single `su` scan checks each fixed source (`bootstrap_status.json`, `capture_status.json`, `exam_session_status.json`, `exam_runtime_inventory.json`, `produce_cards.json`, `exam_seed_trace.jsonl`) and reports obtained, empty, not yet created, or read-error separately. Existing files are read only when their size/mtime changes, reducing repeated shell operations.

While the diagnostic activity is open, newly obtainable files produce one aggregated Android notification showing exact filenames (Android 13+ requires notification permission). The screen always shows the current statuses even if notification permission is denied. This polling is limited to when the activity is visible; it does not schedule background file scans when the user is playing.

The exported diagnostic JSON contains a `sources` object with each file's read status and size, and includes capture/bootstrap status content when readable, allowing failed hook setup to be investigated even if no native trace exists.

## v1.5.0: all-files-missing forensic preflight

When all six capture files are missing, the diagnostic view now shows root UID, PID of the target game process, whether /data/user/0 contains the target game app data directory, and any matching /data/user/* directory (secondary Android user/profile). The same information appears in exported diagnostic JSON under preflight. This distinguishes unavailable injection/bootstrap from a wrong Android profile and a game that is not running. All missing source files remain explicitly unverified.

The Java LSPosed entry emits logcat messages tagged GakumasCapture for successful module entry/native library loading and errors writing the bootstrap file. To collect evidence immediately after force-restarting the game (rooted phone):

    su -c 'logcat -d -s GakumasCapture:I GakumasCapture:E'

If the game PID and data directory are correct but both bootstrap_status.json and capture_status.json are missing, inspect LSPosed module enablement/scope and the LSPosed framework log. The diagnostic APK does not infer confirmed injection from the absence of a file.


## Gakumas v3.4.1: recovered on-disk IL2CPP metadata

The supplied Gakumas 3.4.1 global-metadata.dat is not AES-encrypted. It is
obfuscated by XOR against a static **128-byte repeating key**. This was
confirmed by decoding the canonical IL2CPP magic AF 1B B1 FA, metadata version
31, 31 sane section range pairs ending precisely at EOF, and valid UTF-8 text
in the 4,761,508-byte metadata string section. Method names are intact after
decoding. The key and a portable Python decoder live in
tools/decrypt_gakumas_metadata.py.

Verified input SHA-256:
aaff4137984cbfbc58aeabe48c0d3abf4d586923c2355e43c5908dd890ca29dc

Verified decoded SHA-256:
4370094ac9c8949eeb8a2b57c17424fe85d0e7a29ab2de0a71510b2458740a38

Usage:

    python3 tools/decrypt_gakumas_metadata.py ./global-metadata.dat -o ./global-metadata.decrypted.dat

Recovered names of direct interest include ExamParameterModel,
ExamCardMoveController, CreateContestExamData, CreateTowerExamData,
IsExamEnd, OnExamEnd, and GetRandomInt. These names alone do **not**
establish declaring types, calling conventions, method RVA or correct
hook lifecycle. Match the decoded method/type tables against the matching
libil2cpp.so CodeRegistration/MetadataRegistration before enabling hooks.

Do not commit the proprietary full metadata blob to this repository. Only the
transformation script, reproducible tests and findings are committed. Future
game releases require independent validation of their Build ID, XOR key and
decoded metadata, even if the file name is identical.

The existing v1.5.0 runtime metadata reflection is still a fallback. However,
for this matching Gakumas build offline metadata parsing should be favored for
research and native hook signature discovery; it avoids relying on a successful
LSPosed injection merely to list metadata.

## v1.5.0: exact-build native exam/contest lifecycle hooks

For libil2cpp.so Build ID **77fda4e2a21f23954e2349b83fc113ede408f70b**
(Gakumas 3.4.1), deobfuscated metadata v31 method tokens have now been
mapped through Assembly-CSharp.dll's Il2CppCodeGenModule and its ELF
R_AARCH64_RELATIVE relocations. The reproducible token/RVA map is
tools/gakumas_v341_lifecycle_rvas.json.

The new exact-build-only lifecycle hooks:
- ExamSequence.StartExam() RVA 0x80A5354 opens a recording session using
  ExamSequence.get_Parameter() RVA 0x80A15B4.
- ExamParameterModel.SetExamEndComplete() RVA 0x809305C closes the session.
- ExamSequence.Dispose() RVA 0x80B0DC0 closes aborted/cleared sessions.
- ContestProgressData.StartExamBattle() RVA 0x6CEC3CC and
  EndExamBattle(...) RVA 0x6CEC3D8 additionally mark contest boundaries
  and close the active session at contest battle end.
- All hook-installation outcomes are recorded in exam_lifecycle_status.json.
  The file is now included in the Android diagnostic app's source list/export.

This lifecycle-only path is installed before runtime metadata resolution and
works separately from card-pool trace hooks. It DOES NOT imply complete
card/effect/score capture: those hooks may still be unavailable on the updated
build until field layouts and argument conventions are verified. Exact-build
RVA mapping is a static result, and interception/lifecycle ordering has NOT
been verified through real gameplay. A newer libil2cpp.so Build ID will
never use these static offsets. On this build, completion/dispose are preferred
over the previous end-of-turn zero heuristic.

Build APK and test using the repo's GitHub Actions. Always re-enable the
LSPosed scope after uninstalling an older debug-signed build.

## v1.5.0: game SIGSEGV and controlled hook bisect

Reported tombstone (2026-10-11 02:39:46 JST, libil2cpp Build ID 77fda4e2...): SIGSEGV at ELF PC 0x06397D8C, instruction ldrb w8,[x23,#0x132] with x23=0x203D2000 (unmapped). Native stack contains ExamSequence.StartExam descendants. This proves an invalid runtime type/class pointer, not a conclusive link to one particular hook. Treat previous always-on v1.4.0 hooks as unsafe until narrowed down.

**Safe default:** Native capture mask 0 installs NO game-function hooks (bootstrap/status only). The Android diagnostic activity's 「安全モード／フック設定」 menu sets mask using KernelSU root, in the game private file `files/gakumas-sim/native_hookmask.txt`, readable by the game. Game restart is required.

Supported bitmask values: 1=StartExam, 2=SetExamEndComplete, 4=ExamSequence.Dispose, 8=ContestProgressData.StartExamBattle, 16=ContestProgressData.EndExamBattle, 32=detailed card/RNG hooks, 64=il2cpp_init hook. Menu presets: 0, 1, 3, 7, 31, 63, 127. Each progressive setting adds hooks, so when a crash first appears the new hook group is the primary suspect. Exact game Build ID checks remain mandatory; detailed mode may still fail closed due to unresolved layouts. Do not enable multiple experimental groups for a first test.

The diagnostic JSON's preflight reports the chosen file's mask, and exam_lifecycle_status.json records which individual native lifecycle hooks installed. If crash occurs with mask 0, suspect another plugin, the game, or native module initialization rather than these game-function interceptors. Check logcat/tombstone against the same Build ID and PC.

**Fresh debug key per CI build:** Uninstall previous APK if Android rejects the different signature; after reinstall, re-enable the LSPosed scope and force-stop/restart the game.

## v1.5.0: restored native hook option list

Fixes Android AlertDialog where simultaneously specifying a warning message and list items can hide all seven mode options. The main dialog now displays the complete options list (0, 1, 3, 7, 31, 63, 127) without a message. Choosing a nonzero mask triggers a *separate* explicit crash-risk confirmation before the root-assisted config write; zero/safe mode applies directly. This UI bug is separate from the v1.4.0 native crash. Existing v1.4.1 safe-by-default behavior remains.

## v1.5.0: forensic diagnosis when all capture files are missing

The user's v1.4.1 game stays running with configured hookmask 127 but NONE of the diagnostic sources, even bootstrap_status.json or capture_status.json, exist. Hookmask 127 reflects desired settings only, not successful hook installation. User reports API 102 is supported, so API compatibility is not the target of this investigation.

The diagnostic activity now probes the active game's /proc/<pid>/maps for the **native module shared library** and libil2cpp.so; checks game PID, capture directory existence, its ownership/mode and game files parent ownership. These probes run under the already-authorized KernelSU root during ordinary diagnostic scanning, without changing game memory or process state. Presence in maps indicates a mapped library, not that hooks are installed.

Added button **「LSPosed初期化ログを取得」** to collect the last 48 logcat lines filtered strictly to GakumasCapture tag, only on demand (not once every 2.5 seconds). Exported diagnostic JSON includes preflight and, when explicitly retrieved, injectionLogcat. The UI uses these observations to give differentiated guidance when no trace files exist: game not running; native shared library absent; native mapped but bootstrap/capture files missing; or maps inaccessible. Logcat and native maps alone do not prove actual hook lifecycle functionality.

If no module is mapped and no Java bootstrap file exists after starting the game, re-check whether Gakumas Progress Capture is enabled and scoped to com.bandainamcoent.idolmaster_gakuen. Reinstalling CI builds (fresh debug signing keys) can reset module enablement/scope.

Keep the default-safe hookmask 0 and the staged options introduced in v1.4.1. Do not infer that lack of a crash under hookmask 127 proves native hook success.

## v1.5.0: exact-callsite scope probe based on supplied APK

The caller relationships for three user-requested mode families have been reconstructed from the supplied APK metadata and the matching native-build ELF. See `docs/gakumas-v341-mode-hook-scope.md` and machine-readable `tools/gakumas_v341_user_mode_entrypoints.json`. The old unconditional ExamSequence.StartExam capture misclassifies internal forecasts and play-log simulation as fresh user exams; mode-specific entrypoints and replay/rehearsal context need separate tracking. ContestUtility is also reused by Angya; Tour/Competition rehearsal are not the same as Contest rehearsal.

A **new experimental mask 128**, independent of legacy masks 1..127, installs only one exact-Build-ID hook on ExamSequence.SetUpExam (RVA 0x080A1E90; metadata token 0x060050A4). The wrapper calls the original with its verified void/one-argument calling convention and logs **only** code-callsite return RVA and a conservative lane classification. It never dereferences managed objects or resets the global exam session. Audited callsites: Contest auto calculation, play-log replay and interactive ExamScreenPresenter initialization. Internal fixed-action simulation is explicitly excluded. Unknown callers are excluded. Up to 128 observations written to `exam_entry_probes.jsonl`; installation outcome `exam_entry_probe_status.json`. The Android diagnostic export includes both. Default mask remains 0. Selecting 128 carries a native-hook crash risk, and full mode identification/score parity still require real gameplay evidence.

Importantly, older masks 1..127 are retained **for crash regression only**, labelled unsafe, and must not be treated as a complete user-mode capture strategy. Static RVA/caller provenance is not a substitute for on-device injection/SELinux verification.
