# Gakumas Progress Capture (LSPosed)

## Current checkpoint: v1.5.5 (scoped Native execution observed)

User device evidence on 2026-10-11 confirms root visibility, module-local
self-test (original 46 / detoured 47), and nine SetUpExam replacement executions
in the current PID with matching v3.4.1 Build ID. All nine returns were
0x07EFD3B4 (contest-auto calculation); no managed objects were read. This does
not establish rehearsal classification, other modes, or RNG/card/effect/score
capture. Old lifecycle/card/trace files are isolated as historical evidence.
The compact clipboard JSON includes bounded, PID-scoped entry probe samples.
An empty logcat result does not contradict current Native execution records.



The v1.5.3 device screenshot could not see the game data, whereas Termux root
listed fresh bootstrap/capture/native-bootstrap files owned by the game UID.
Root and game mount namespace IDs differed. v1.5.4 detects advertised
`su -M / --mount-master` support and requests the global namespace for **all**
root scans, reads, logs and configuration. Unsupported implementations use
ordinary su; errors are never automatically retried in another namespace.
The selected invocation and actual Root/init/game namespace IDs are recorded.
An advertised flag does not prove that KernelSU's namespace switch succeeded.
Device verification of this visibility repair remains pending.

「診断表示をコピー」 copies current visible text. 「初期化JSONをコピー」
copies compact initialization JSON with preflight, file acquisition states,
bootstrap/capture/native-bootstrap/self-test and requested initialization logs.
It omits old inventory/card/trace dumps; full JSON remains available via export.
No hook setting is changed by copying. First collect initialization logs, then
paste the compact JSON to verify current-PID Native initialization.

The v1.5.2 device report showed root UID 0 and an active IL2CPP process,
but all capture paths were unseen. An unmatched candidate-directory glob
returned exit 1, incorrectly throwing away a completed root scan. v1.5.3 fixes
that shell exit and adds execution regressions using the production scan script.
A missing/unreadable mask is no longer displayed as a configured mask 0.

Diagnostics export the game's UID/Android user, expected and selected paths,
mount namespace IDs, directory ownership/context/error text, and SELinux mode.
If the ordinary path is unseen but the SAME user's active game-process root
exposes its files, only fixed diagnostic files are read there. Configuration
and ownership repair refuse that read-only fallback and a different game user.
No namespace entry, user switching or SELinux disabling is performed. A scan
failure replaces old report data with an exportable error report. The explicit
initialization-log button also collects bounded AVC lines mentioning fixed
capture names; no matching log lines does not establish absence of denials.

**The user's latest report does not prove files were never generated or Native
was never loaded. The reason paths are unseen and Native execution both remain
unverified on device.** First export v1.5.3 diagnostics and initialization logs
with mask 0. Continue the hook test sequence below only after storage/init works.

Only masks **0**, **128**, **256**, and **384** are accepted now. Legacy
bits 1–127 are rejected, including the detailed RNG/card and unconditional
StartExam paths described in the historical sections below. These paths are
not completed capture features. Default 0 touches no game functions.

The Java module loads Native code at the target package callback after module
registration, replacing the guessed one-second delay. JNI_OnLoad independently
writes `native_bootstrap_status.json` even if the framework never calls
`native_init`; the Java bootstrap also includes a JNI handshake. File-write
errors log the path/errno under GakumasCapture. A module loaded straight from
its APK may appear in maps as the APK path, so a missing SO filename does not
prove missing injection. Exported initialization/self-test verdicts require the
currently running game's PID, and full gameplay remains unverified.

The repair/configuration action checks only fixed diagnostic children (and
their `.tmp` files), rejects symlinks/hard links, resets the mask **before**
making a root-owned directory writable, and repairs those children's ownership
and context too. It uses the diagnostic app's Android user, not hardcoded user 0.
Host tests simulate privileged chown/restorecon: Android ownership and SELinux
must still be verified on the device. No arbitrary game-data recursion occurs.

Device test order:
1. Install the APK and re-enable the LSPosed scope if a signature-changing
   reinstall was needed. Press the repair button; it sets mask 0. Fully restart
   the game and confirm bootstrap, native bootstrap and capture status exist.
2. Select **Native自己テスト (256)** and fully restart the game. It hooks a
   pure function in the module itself, calls both backup and detoured function,
   and writes `native_self_test.json`. `passed` requires one replacement call,
   unchanged backup result and the expected changed detoured result. This proves
   only the local Native API/trampoline test, not IL2CPP hooks or game capture.
3. Export diagnostic JSON including initialization logs. If this succeeds,
   explicitly choose 128, restart, and inspect `callsObserved`, recorded samples,
   process/sequence/thread IDs and caller RVAs. No managed objects are read.

Local builds retain the debug key under ignored `.build/`, so rebuilds in the
same workspace share a signing identity. `GAKUMAS_SIGNING_KEYSTORE` can select
an existing debug-format key. Fresh CI runners still generate new keys; stable
CI release signing is not established. The diagnostic branch runs one APK job
per push; its duplicate PR APK job is skipped.

Reproduce static verification with matching, locally supplied game files:

```sh
python3 tools/verify_gakumas_v341.py base.apk split_config.arm64_v8a.apk libil2cpp.so --output v341-verification.json
```

It checks exact hashes, ELF Build ID, token/RVA mappings, MetadataRegistration
types and documented direct BL instructions. It is not a device test, and does
not establish generic value-type/async ARM64 ABI, mode boundaries or parity.

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


## v1.5.1: native diagnostic and single-file export

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

## v1.5.1 event-driven capture

The native hooks now stay installed but suppress high-frequency RNG/card-pool writes while idle. The first exam deck shuffle, initial-card setup or draw starts a capture session. This applies to the Tower, Contest and audition/exam paths through the same ExamCardMoveController; the numeric native ExamType is always retained. Tower=5 is validated against the reference ELF; contest and audition labels are only used when runtime IsContest/IsAudition getters confirm them, otherwise the mode is exam-unknown.

The session switches to stopped when native ExamParameterModel.Dispose is available or an observed remaining-turn-zero reset is detected. The latter is explicitly heuristic; premature exits may remain recording until a new exam supersedes the old session. Every stop emits trace-stop and archives the completed raw JSONL as exam_session_<start_ms>.jsonl, while exam_seed_trace.jsonl remains the latest session. exam_session_status.json contains recording/stopped and mode/ExamType for the activity UI.

For new game Build IDs, the module searches IL2CPP runtime metadata for required exam methods and derives native field offsets by semantic managed field names. If layout, classes or methods cannot be confirmed it refuses to install unsafe trace hooks and reports this in capture_status.json. The new user-supplied ELF is stripped (Build ID 77fda4e2a21f23954e2349b83fc113ede408f70b) so actual runtime metadata/hook success must still be tested on device; compatibility is NOT guaranteed by a successful APK build.

## v1.5.1: encrypted metadata runtime inventory

Game client 3.4.1 ships a global-metadata.dat without the standard IL2CPP header. The updated module records names/parameter counts and field offsets of relevant Exam/Contest/Audition/Tower classes from the decrypted live IL2CPP runtime in exam_runtime_inventory.json, not from the on-disk file. This is included in the Android diagnostic JSON export. Runtime reflection and actual native hook behavior still require on-device verification.

## v1.5.1: capture-file availability notifications

The Android diagnostic activity no longer treats a missing `exam_seed_trace.jsonl` as a root permission failure. A single `su` scan checks each fixed source (`bootstrap_status.json`, `capture_status.json`, `exam_session_status.json`, `exam_runtime_inventory.json`, `produce_cards.json`, `exam_seed_trace.jsonl`) and reports obtained, empty, not yet created, or read-error separately. Existing files are read only when their size/mtime changes, reducing repeated shell operations.

While the diagnostic activity is open, newly obtainable files produce one aggregated Android notification showing exact filenames (Android 13+ requires notification permission). The screen always shows the current statuses even if notification permission is denied. This polling is limited to when the activity is visible; it does not schedule background file scans when the user is playing.

The exported diagnostic JSON contains a `sources` object with each file's read status and size, and includes capture/bootstrap status content when readable, allowing failed hook setup to be investigated even if no native trace exists.

## v1.5.1: all-files-missing forensic preflight

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

The existing v1.5.1 runtime metadata reflection is still a fallback. However,
for this matching Gakumas build offline metadata parsing should be favored for
research and native hook signature discovery; it avoids relying on a successful
LSPosed injection merely to list metadata.

## v1.5.1: exact-build native exam/contest lifecycle hooks

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

## v1.5.1: game SIGSEGV and controlled hook bisect

Reported tombstone (2026-10-11 02:39:46 JST, libil2cpp Build ID 77fda4e2...): SIGSEGV at ELF PC 0x06397D8C, instruction ldrb w8,[x23,#0x132] with x23=0x203D2000 (unmapped). Native stack contains ExamSequence.StartExam descendants. This proves an invalid runtime type/class pointer, not a conclusive link to one particular hook. Treat previous always-on v1.4.0 hooks as unsafe until narrowed down.

**Safe default:** Native capture mask 0 installs NO game-function hooks (bootstrap/status only). The Android diagnostic activity's 「安全モード／フック設定」 menu sets mask using KernelSU root, in the game private file `files/gakumas-sim/native_hookmask.txt`, readable by the game. Game restart is required.

Supported bitmask values: 1=StartExam, 2=SetExamEndComplete, 4=ExamSequence.Dispose, 8=ContestProgressData.StartExamBattle, 16=ContestProgressData.EndExamBattle, 32=detailed card/RNG hooks, 64=il2cpp_init hook. Menu presets: 0, 1, 3, 7, 31, 63, 127. Each progressive setting adds hooks, so when a crash first appears the new hook group is the primary suspect. Exact game Build ID checks remain mandatory; detailed mode may still fail closed due to unresolved layouts. Do not enable multiple experimental groups for a first test.

The diagnostic JSON's preflight reports the chosen file's mask, and exam_lifecycle_status.json records which individual native lifecycle hooks installed. If crash occurs with mask 0, suspect another plugin, the game, or native module initialization rather than these game-function interceptors. Check logcat/tombstone against the same Build ID and PC.

**Fresh debug key per CI build:** Uninstall previous APK if Android rejects the different signature; after reinstall, re-enable the LSPosed scope and force-stop/restart the game.

## v1.5.1: restored native hook option list

Fixes Android AlertDialog where simultaneously specifying a warning message and list items can hide all seven mode options. The main dialog now displays the complete options list (0, 1, 3, 7, 31, 63, 127) without a message. Choosing a nonzero mask triggers a *separate* explicit crash-risk confirmation before the root-assisted config write; zero/safe mode applies directly. This UI bug is separate from the v1.4.0 native crash. Existing v1.4.1 safe-by-default behavior remains.

## v1.5.1: forensic diagnosis when all capture files are missing

The user's v1.4.1 game stays running with configured hookmask 127 but NONE of the diagnostic sources, even bootstrap_status.json or capture_status.json, exist. Hookmask 127 reflects desired settings only, not successful hook installation. User reports API 102 is supported, so API compatibility is not the target of this investigation.

The diagnostic activity now probes the active game's /proc/<pid>/maps for the **native module shared library** and libil2cpp.so; checks game PID, capture directory existence, its ownership/mode and game files parent ownership. These probes run under the already-authorized KernelSU root during ordinary diagnostic scanning, without changing game memory or process state. Presence in maps indicates a mapped library, not that hooks are installed.

Added button **「LSPosed初期化ログを取得」** to collect the last 48 logcat lines filtered strictly to GakumasCapture tag, only on demand (not once every 2.5 seconds). Exported diagnostic JSON includes preflight and, when explicitly retrieved, injectionLogcat. The UI uses these observations to give differentiated guidance when no trace files exist: game not running; native shared library absent; native mapped but bootstrap/capture files missing; or maps inaccessible. Logcat and native maps alone do not prove actual hook lifecycle functionality.

If no module is mapped and no Java bootstrap file exists after starting the game, re-check whether Gakumas Progress Capture is enabled and scoped to com.bandainamcoent.idolmaster_gakuen. Reinstalling CI builds (fresh debug signing keys) can reset module enablement/scope.

Keep the default-safe hookmask 0 and the staged options introduced in v1.4.1. Do not infer that lack of a crash under hookmask 127 proves native hook success.

## v1.5.1: exact-callsite scope probe based on supplied APK

The caller relationships for three user-requested mode families have been reconstructed from the supplied APK metadata and the matching native-build ELF. See `docs/gakumas-v341-mode-hook-scope.md` and machine-readable `tools/gakumas_v341_user_mode_entrypoints.json`. The old unconditional ExamSequence.StartExam capture misclassifies internal forecasts and play-log simulation as fresh user exams; mode-specific entrypoints and replay/rehearsal context need separate tracking. ContestUtility is also reused by Angya; Tour/Competition rehearsal are not the same as Contest rehearsal.

A **new experimental mask 128**, independent of legacy masks 1..127, installs only one exact-Build-ID hook on ExamSequence.SetUpExam (RVA 0x080A1E90; metadata token 0x060050A4). The wrapper calls the original with its verified void/one-argument calling convention and logs **only** code-callsite return RVA and a conservative lane classification. It never dereferences managed objects or resets the global exam session. Audited callsites: Contest auto calculation, play-log replay and interactive ExamScreenPresenter initialization. Internal fixed-action simulation is explicitly excluded. Unknown callers are excluded. Up to 128 observations written to `exam_entry_probes.jsonl`; installation outcome `exam_entry_probe_status.json`. The Android diagnostic export includes both. Default mask remains 0. Selecting 128 carries a native-hook crash risk, and full mode identification/score parity still require real gameplay evidence.

Importantly, older masks 1..127 are retained **for crash regression only**, labelled unsafe, and must not be treated as a complete user-mode capture strategy. Static RVA/caller provenance is not a substitute for on-device injection/SELinux verification.

## v1.5.1: filesystem ownership root-cause fix and independent native activation proof

The user's on-device v1.5.0 screenshot showed Root UID 0, Gakumas PID 7508,
configured mask 128, loaded libil2cpp, **capture directory owned by 0:0,
mode 755**, every source (including bootstrap_status.json) absent, and
a **GakumasCapture: native-library-loaded** log from that game PID.
This is direct evidence that the directory is inaccessible for writes to
a nonroot game UID; the diagnostic app may previously have created it as
root via mkdir -p. The game also cannot read a root-owned 0600 hook mask
reliably, meaning displayed config 128 did not prove native receipt of 128.

- New diagnostic button 「診断ファイル保存先の権限を修復」 with a
  confirmation dialog. Root-enabled repair is deliberately limited to
  game-private **files/gakumas-sim/** and its native_hookmask.txt; verifies
  parent dir owner is an Android app UID/GID >=10000, rejects symlinks,
  chowns the diagnostic directory to the game's own UID/GID, chmods
  directory 0700 and mask 0600, restores the directory's SELinux label
  with restorecon. It never touches other game data.
- The hook-mode save path also runs that same repair before writing the mask
  to avoid recreating a root-owned directory.
- Native shared library now prints both JNI_OnLoad and native_init
  enter/accept/reject states into the existing GakumasCapture log tag,
  independent of writable directories. Android NDK links liblog.
  This lets the next on-device export distinguish Java System.loadLibrary
  success from successful Xposed native_init callback invocation.

Caution: moduleLibraryMapped=no conflicts with Java native-library-loaded
from the same pid. This does **not** justify a claim that LSPosed injection
was absent: library map matching/callback ordering needs further evidence.
After ownership repair, force-stop/restart the game, check the new JNI_OnLoad
and native_init log lines and bootstrap/capture files before enabling hook
mask 128. Default-safe mask remains 0.

### v1.5.1 safety follow-up

The explicit directory repair action also rewrites native_hookmask.txt to **0**,
owned by the game UID/GID with mode 0600 and restored SELinux context.
This is deliberate: when the earlier mask 128 file was root-owned and
unreadable, repairing its ownership without resetting it could unexpectedly
activate experimental native hooks at next game start. If desired, opt back
into mask 128 separately after confirming bootstrap_status.json and
capture_status.json can be created under safe mode. A selected mask alone
is never proof of hook installation.

JNI_OnUnload is now logged too, so a Java native-library-loaded message and
/proc/PID/maps reporting no corresponding mapping can be investigated for a
possible unload or map-probe mismatch. It is not proof of missing Java injection.



## v1.5.16: array-shaped turn-history decoding (device result pending)

The on-device v1.5.15 export (PID 7986, Build ID
`77fda4e2a21f23954e2349b83fc113ede408f70b`) recorded nine
completed selected auto-play sessions and 54 progress entries. All 54 report
`invalid-address-or-size` at `turns.list.backing-length` for
`address: 0x0`. The first read of the outer container succeeded,
but interpreting +0x10 as a List<T>._items reference produced NULL.
This contradicts a populated List<T> at that address and agrees with a
one-dimensional IL2CPP array (null bounds pointer at +0x10, positive length at
+0x18). The runtime object's class identity is not proven by this alone.

v1.5.16 inspects the observed header without calling managed methods:
- A non-null +0x10 reference continues through the original List<T> reader.
- A null +0x10 reference and a positive, bounded 64-bit length at +0x18
  uses the bounded SZARRAY reader. It sets
  `turnsContainerShape: "array-shaped"`, not a proven type name.
- Unrecognized shapes retain List validation and the prior structured
  `readFailure` instead of trying arbitrary pointer offsets.
- Nested turn fields remain strict, bounded, read-only. Another failure
  such as value-type inline elements or a wrong field layout may appear
  once the outer container succeeds.

The source-level C++ harness exercises both shapes and selected-game-result
forwarding. No on-device success, full RNG trace, exact move list, or
simulation parity should be inferred until a fresh v1.5.16 export confirms
them. CI builds a source-based APK whose signing certificate/DEX can differ
from the byte-pinned local recovered build; reinstall and re-enable the
LSPosed scope if Android refuses the update. The old failed recordings remain
evidence but cannot be retroactively filled with turn objects.

## v1.5.15: turn-history read-failure evidence (not a parity fix)

The October 11 v1.5.14 **device export** contains 9 contest runs, 53 selected
progress records and 9 final results. All 53 progress records contain
`turns: null` and `dataComplete: false`, with 53 incomplete reads and zero
file write failures. Selected actions, scores and end results were captured,
but no turn log, card/effect/RNG history or simulator comparison was verified.

For each incomplete progress record, v1.5.15 adds `readFailure` with
`reason`, `stage`, `address`, `offset`, `requestedBytes`, `errno`
and `observed`. `stage: "turns.list.*"` indicates failure while
decoding the outer turn-history list, while `selectedIndexes.array.*`
identifies an earlier index-array failure. A bad list count, backing-array
capacity, short/failed kernel read, read budget and a list mutated during
a read are reported separately. The first failure is retained even when
additional optional fields cannot be read. All reads remain bounded,
passive, and preserve the caller's `errno`.

Existing score and index fields and successfully decoded partial objects
are retained when later fields fail. No speculative pointer-offset fallback
is attempted; the IL2CPP layout must be confirmed from new device evidence
before a targeted fix. The boolean `gameCaptureVerified` is still hard-coded
false in this diagnostic path.

To continue, rebuild the Native library into the existing recovered APK
(requires the exact v1.5.11 base APK, Android SDK/NDK and recovery signing
key), install v1.5.15, restart the game, run one contest, use "コンテスト記録を保存",
and inspect the first `contest-progress.readFailure`. CI can validate
the C++ host harness but cannot reproduce real game heap addresses or
produce the recovered APK without the required local base file. Do not
interpret a passing CI run as a device capture success.

## v1.5.14: selected contest progress and results

The launcher now exports `gakumas-contest-capture.json` through Android's file
picker. Capture is event driven, uses the existing mask 7808, and records only
GetSearchResult returns consumed by the contest auto-play async state machine.
The two exact-build hooks forward each original call once and preserve the
72-byte Nullable result ABI. No synthetic game calls or periodic polling are added.

Records contain session seed and IDs, selected indexes, score and attributes,
and selected turn history (stamina, hand, statuses, effects, commands). A final
per-player auto-play result is emitted only after a selected terminal result
and natural async completion. Cancellation is reported as `contest-stopped`.
These are per-player calculation records, not the server's contest victory or
ranking response. `gameCaptureVerified` remains false until on-device evidence.

Game-owned files are `contest_capture.jsonl` and `contest_capture_status.json`
in `files/gakumas-sim/`. One previous-process JSONL is retained. Limits are
64 sessions, 128 selected steps per session and 8 MiB per process; dropped records
and incomplete reads are exposed. The old diagnostic observation budget does
not stop this separate capture. Unknown data is null and marked incomplete.

The old diagnostic DEX is preserved; a separate DEX provides manual file export.
Build with `build-recovered-apk.py`, the exact recovered v1.5.11 base APK and
recovery signing key. Resources stay uncompressed and 4-byte aligned; the native
library remains 16-KiB aligned. Static audit: `tools/verify_contest_capture.py`.
Host hook/serializer tests: `tests/test_contest_capture.py`; mock only the kernel
read transport and use ASan/UBSan. Real-device operation is not yet verified.
