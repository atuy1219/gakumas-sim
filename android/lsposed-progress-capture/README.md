## v1.5.38: capture DFS-cloned card-move RNG states

The earlier v1.5.37 `contest-rng-origin` probe compared RNG calls
against the **selected Run's** ExamParameterModel only. Real Tenpu+
uses a different ExamEffectCalculateContext during DFS; capture (18)
contains two Tenpu+ plays with four XorShift steps each but no
`contest-rng-origin` event for either. In v1.5.38, the probe reads the
**current effect context's** ExamParameterModel at +0x10, rather than
assuming the Run's model. `contextParameterMatched`,
`contextParameterIsClone` and `selectedLineageVerified:false` distinguish
candidate-copy data from the selected root model.

The same opt-in mask **20608** applies. Game originals and arguments
remain unchanged. The revised scope has host coverage for a cloned
model consuming four XorShift words. It has **not yet been tested on-device**
and a missing event after upgrade should not be treated as proof of zero RNG.

---

## v1.5.36 (experimental): selected contest CardMove RNG caller origins

Use **安全モード／フック設定 → 天賦の才+乱数診断（20608）**,
confirm, then fully stop and restart the game before running a rehearsal.
This mode extends the selected-contest 4224 capture and is **opt-in**.
Existing safe/4224/8192 modes do not install the new RNG hooks.

For the **exact v3.4.1 Build ID** `77fda4e2a21f23954e2349b83fc113ede408f70b`
the extra native hooks bracket the real
`CardMoveEffectExecutor.ExecuteEffect` (RVA `0x804BCA8`) and intercept
`ExamParameterModel.GetRandomInt()` (`0x808A340`) and the ranged
`GetRandomInt(min,max)` (`0x808A438`). They forward the game originals
exactly once and observe the RNG state at `ExamParameterModel+0x77c`
via read-only `process_vm_readv`. No synthetic card play, extra RNG
draws, setter calls or random-state mutation are performed.

The existing **コンテスト記録を保存** export includes
`contest-rng-origin` events from `contest_capture.jsonl`. Each event
includes the caller RVA and before/after RNG states for every intercepted
call, plus `observedXorShiftSteps`, the number of actual intercepted
calls, and a truncation marker. To determine which method consumed all
four observed words, use `randomCalls[].callerRva` alongside the
disassembled ELF. The event is scoped to selected auto-play and a single
CardMove effect, **not** every call between a card command and the next
move. A mismatch between `observedXorShiftSteps` and
`capturedRandomCallCount` signals missing instrumentation/indirect
updates; it is not proof of a second sort.

Check `contest_rng_origin_status.json` for all three
`*Installed` flags. Output is capped (48 calls per effect, 96 windows per
session, 512 windows per process, and the existing global 32 MiB limit).
A build mismatch installs nothing. **Not yet verified on a live device.**
Native hooking can crash the game or trigger account restrictions even
with passive reads.

---

## v1.5.35: accessible readback controls and current-mode diagnostics

The exporter now scrolls in small/floating windows. Detail-mode activation and
its status button appear above the potentially long status text. Activation
writes the same guarded fixed-path configuration as the diagnostic screen.
Status checks the native bootstrap's actual mode and PID before showing detail
hook counts, so old contest counters cannot imply that readback is enabled.
After setting the mode, completely close/restart the game and open a detail log.
This repairs UI/diagnosis; it does not establish on-device readback coverage.

---

## v1.5.34: saved detail-log readback (experimental)

Choose **保存済み詳細ログ取得**, restart the game, then open
**詳細 → 詳細ログ** for the desired own/rival character and match.
Return to this module and press **保存済み詳細ログを保存**.
Existing logs may be usable without replaying a rehearsal; this is not yet
verified on-device. Open each desired log so its model reaches a readback hook.

This independent mode uses three hooks: static ExamSavePlayLogData.LoadAll,
CompetitionExamPlayLogListModel construction, and ExamPlayLogListOverlayModel
construction. It captures the game-owned log list after the original returns.
No contest execution, DFS ancestry, card mutation, polling or replay hooks are
enabled by this mode. It never invokes extra game methods.

The export preserves ordered items, turn/section markers, trigger identity,
played/drawn card lists and upgrades/customizes, nested triggered details,
each effect line's before/after pairs, target IDs, move positions, messages,
and before/after card-ID lists. ELF-derived enum definitions are included.
Sources distinguish saved LoadAll data from display models, which may already
have been reconstructed by the game. This is not a claim that every result
screen uses local persistent storage or that all hidden pools/RNG are present.
Full hand reconstruction and numeric line semantics need device validation.

The current and previous process files remain separate from real-time captures.
Typed passive reads, collection limits, record/file limits, consecutive duplicate
suppression and failure counters prevent unbounded or silently incomplete exports.
See [ELF findings](../../docs/saved-detail-log-elf-findings.md).

---

## v1.5.33: card-end snapshots before DFS save callbacks

Capture (14), v1.5.32, contains 187 selected card uses but only 95 list-level
completion records. Those records mention 172 cards: 15 uses in six turns lack
a completion. The cost baseline was readable; the completion boundary was too
coarse and too late for intermediate native DFS saves.

The pinned ELF puts a `SeparateActivity(false, card)` command after
`UserCardAfterCheck` and `MovePlayCard`. Its executor performs cleanup, then
calls the activity handler through RVA `0x05D5DF10` from `0x080DD8C4`.
We snapshot immediately before forwarding that handler, so an inline
`AddSequenceScore` / `ExamSaveData` save includes the completed action.
The guard requires the exact return RVA, interface slot 15, command type 9,
end flag, handler owner, command card pointer and the pending card's copied GUID.
Suspended executor resumptions use the same guard. Original arguments and
UniTask return registers are preserved; originals run once. No getters, effects
or RNG methods are called by the probe.

Each verified completion now contains exactly one card and its pre-cost / end
metrics. Reconstruction now requires this precise capture phase and rejects
v1.5.32 list-level records even when they contain a single card. A list ending with a pending card produces
`contest-card-use-incomplete`, never a verified per-card delta. Checkpoints
preserve pending copied baselines. Empty successful list completions stay
counter-only, and compact JSON output remains enabled.

Host tests cover repeated GUIDs, inline saves, pending checkpoints, suspended
resumption, rejected boundaries, forwarding, and incomplete fallbacks.
On-device 187/187 coverage is not established by host tests or the old capture.
See [ELF findings](../../docs/contest-capture-v1.5.33-elf-findings.md).

---

## v1.5.32: suppress empty completion payloads and reject reentrant no-ops

Successful command-list callbacks without cards are now counted only: no pools,
metrics or trace nodes are serialized. Non-card exceptions remain compact
failure events. Turn, draw, move and creation observations remain independent.
The exported JSON has no indentation; printable ASCII IDs are emitted without
six-byte Unicode escapes. Both changes preserve JSON values.

Capture (13) showed 123 purported card completions with identical before/after
score, stamina and block. The old terminal-state check accepted reentrant
`ExecuteCommandListImplAsync` calls that return immediately while another
command list is playing. Initial calls now require the runtime
`_isCommandPlaying._value` to be false; card-builder reentry is also rejected.
Unreadable guards fail closed and are counted. Suspended real MoveNext calls
retain the original continuation-aware completion hook.

The comparison utility now requires `completionBoundaryVerified:true`, so
v1.5.31's premature zero deltas are not treated as measured card effects.
On-device completion coverage remains to be verified with the next capture.

---

## v1.5.31: selected DFS lineage and completion snapshots

The contest detail mode (4224) follows native DeepCopy/SyncData/LoadExam and
anchors observations to the exact ExamSaveData returned by GetSearchResult.
Unselected sibling candidates are buffered, then discarded at each checkpoint.
The new `contest-card-use-complete` records include executed cards, serials,
ordered pools and ELF-decoded score/stamina/block/turn. Exception completion is
rejected; suspended SetResult callbacks are sampled before they resume parents.
The exporter displays selected-lineage matches and missing/overflow counts.

Use `tools/reconstruct_selected_contest.py` for measured single-card deltas.
Multi-card lists remain grouped. Host tests and APK validation do not establish
on-device coverage; the next rehearsal capture is the verification source.
See [ELF findings](../../docs/contest-capture-v1.5.31-elf-findings.md).

---

## v1.5.28: ROM-verified controller offset and instrumented command boundary

For the **コンテスト詳細取得（4224）** opt-in mode, v1.5.27 native
samples had zero successful per-card records despite 3,171 MovePlayCard
callbacks (9 selected contest sessions). The previous
\`ExamSequence.AddEffectDifferenceLog\` (RVA \`0x080A8380\`) hook fired
zero times in that capture, and is **no longer installed**.

v1.5.28 records a different, synchronous stage:
\`ExamSequence.GetTriggerEffectListCommand\` (RVA \`0x080A67B8\`),
directly called by \`ExecuteCardCommandImpl\` at ROM callsites
\`0x080A5E9C\`, \`0x080A5F08\`, \`0x080A5FCC\`, \`0x080A6098\`.
It emits \`contest-card-command-snapshot\` after the natural original
method returns. This is **command construction, not card effect completion**.
The native game client has not yet verified that the new hook actually
fires during selected contest auto-play. It is an experimentally
instrumented call path, not a claim of full per-card effect coverage.

The controller field is **not an assumed offset**:
\`ExamSequence.get_CardController\` (RVA \`0x080A19BC\`)
uses \`ldr x0, [x0,#0x58]\`, and
\`get_PlayingCard\` (RVA \`0x080A19A4\`) accesses the
returned controller's \`+0x48\` field.

The \`contest_capture_status.json\` now separately includes
\`cardMoveCalls\`, \`cardMoveControllerReadable\`,
\`cardMoveControllerMatched\`, \`cardMoveParameterMatched\`,
\`cardSnapshotAttempts\`, \`cardSnapshotSequenceMatched\`,
\`cardSnapshotParameterMatched\`, \`triggerCommandInstalled\`,
\`triggerCommandCalls\`, and successful \`cardMoveSamples\` /
\`effectSamples\`. Existing \`effectDifferenceInstalled\` is explicitly
\`false\`, since that non-firing detour was removed.
Rejected matches are persisted with bounded/throttled status writes
rather than silently yielding zero samples.

Status-effect and \`ExamParameterModel\` field capture from v1.5.27
continues unchanged, but remains provisional until verified against
on-device card/turn histories. Original game methods are called once.
Do not confuse \`contest-card-command-snapshot\` with complete
\`after card\` effect state; \`cardEffectsComplete:false\` remains.

---

## v1.5.27: all plan status-effect fields (opt-in)

The **コンテスト詳細取得（4224）** setting in v1.5.26 is retained.
For each native \`contest-card-move\` / \`contest-card-effect-snapshot\` event,
v1.5.27 and later additionally record the **real game's loaded status objects**:

- \`metrics.statusEffects[]\` includes the exact native \`type\`, a type-and-ordinal
  \`key\`, and readable primitive \`fields\` such as values, counters, turn
  durations and \`isPassingTurnStart\`. This is runtime-metadata-driven rather
  than a new collection of guessed per-type offsets. The list includes types
  such as \`ParameterBuffStatusEffect\` (好調),
  \`ParameterBuffMultiplePerTurnStatusEffect\` (絶好調),
  \`LessonBuffStatusEffect\` (集中),
  \`FullPowerPointStatusEffect\` (全力値),
  \`EnthusiasticStatusEffect\` (熱意),
  \`UpliftingStatusEffect\`, \`StanceLockStatusEffect\`,
  \`StaminaConsumptionDownStatusEffect\`, etc., **when the native list contains
  these objects**. Every status class is exported, not just a hardcoded set.
- \`statusEffectChanges\` records the differences of like-named primitive
  fields between two observations of the *same* card; new instances are flagged
  \`added\`, and disappeared instances \`removed\`. The type/ordinal association
  is provisional if the runtime reorders multiple same-type instances.
- \`metrics.parameterStatusFields\` and \`parameterStatusChanges\` also project
  primitive fields with explicit stance, uplifting, full-power, enthusiastic,
  concentration, buff or stamina-consumption names directly from the live
  \`ExamParameterModel\`. This catches numeric stance/gauge state held **outside**
  the effect collection. They retain the IL2CPP field names; no unsupported
  mapping of stance numeric IDs to 強気/温存 is invented.
- \`statusMetadataAvailable\`, \`parameterStatusMetadataAvailable\`,
  \`statusListComplete\` and per-effect \`fieldsComplete\` flag missing or
  partial reflection. Missing fields do not imply that the status equals zero.
  Not all managed field kinds can safely be decoded; only bounded primitive
  scalars are supported.

There is **still no verified full-card effect-completion hook**. These
observations describe specific in-progress native callback stages and require
on-device parity checks. Neither safe execution, completeness of all status
effects, nor account-ban avoidance is guaranteed.

---

## v1.5.26: optional native card-effect-stage observations (experimental)

**Game build:** Gakumas v3.4.1, \`libil2cpp.so\` Build ID \`77fda4e2a21f23954e2349b83fc113ede408f70b\`.
Other builds do not install these hooks.

In the module's 診断画面 > Nativeフック設定, choose **コンテスト詳細取得 (4224)**, accept the explicit warning, and fully restart the game. Mask 4224 enables the existing scoped SetUpExam probe (128) and selected contest capture (4096) without the optional clone/mode monitoring bits. Safe mode 0 remains the default. This is **not** confirmed safe from crashes or account actions.

The usual **コンテスト記録を保存** button exports these additional \`events\` in the same \`gakumas-contest-capture.json\`:
- \`contest-card-move\`: sampled after the natural \`ExamCardMoveController.MovePlayCard\` call, **not** proof that the card effect completed.
- \`contest-card-effect-snapshot\`: sampled after the natural \`ExamSequence.AddEffectDifferenceLog\` call, which is a native effect-difference/log stage, **not** a verified full-card resolution boundary.

Each sample includes \`sessionId\`, \`cardActionSerial\`, \`card\` (ID and GUID when available), and \`metrics\` containing the **real device's** per-attribute score, total score, stamina, block/Genki, Review and Aggressive (好印象/やる気) where readable, plus \`changes\` relative to the prior observed snapshot for the **same card**. \`null\` means unavailable; it never means zero. Native runtime getters/game effects are **not** called for observation: memory is read using bounded \`process_vm_readv\` requests. The source is the device's own live game process, never the Web simulator. All events carry \`cardEffectsComplete:false\` because post-effect-difference is not yet proven to be a final card state. The Obscured integer getters' backing-store layout is verified against native code, but \`turnResultParityVerified:false\` stays until an actual game sample has been reconciled against the official turn end log.

The capture status file exposes \`cardMoveInstalled\`, \`effectDifferenceInstalled\`, \`cardMoveSamples\`, \`effectSamples\` and \`nativeMetricReadFailures\`. New events are bounded to **512 total samples per session** and share the existing **8 MiB** process capture limit. A hooked game function is forwarded exactly once; detours must not introduce actions, alter status, or call the game RNG. If an optional hook fails to install, regular contest capture remains available and diagnostic flags report the failed installation.

**Limitations:** No on-device validation has yet established whether these exact two hooks fire on every card, whether all status types are represented in the _effectList, or whether the last effect-difference snapshot is equal to the after-card state. Do not use this data as a definitive per-card result until actual events are inspected. This is *per-effect-stage telemetry*, not certified per-card completion.

---

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



## Contest parity follow-up: seed-derived schedule, extra turns and bounded replay

The independent observed-action replay now accepts game-card extra turns:
`turnParameterTypes` must cover the **base** `LimitTurn`, not every
captured turn. Extra turns use the native final-turn attribute clamp, but
must arise from simulated effects (`extra_turn`, e.g. 私がスター).
If no extra-turn effect executes, replay reports
`extra-turn-not-generated` and never fabricates a turn.

A missing `randomStateBeforeSetUp` does not imply an unobservable game RNG.
The post-`SetUpExam` state is reproducible from the captured Seed after
`LimitTurn - 3` XorShift32 words on the observed contest sessions.
It is now a clearly labeled **diagnostic shuffle-start hypothesis**,
permitted only if that exact chain matches. The simulator uses its own
shuffle and effect calculations and stops at the earliest mismatch.
This does **not** establish pre-shuffle-state or complete score parity.

The capture upload UI waits for card and exam item catalogs before
normalizing/replaying. Module version strings in exported captures are read
from installed package metadata rather than a stale hardcoded constant.

### Safety boundary
The module's native contest observer uses passive memory reads and forwards
game calls once; the game function trampoline necessarily writes hook code
to process memory. It also creates bounded diagnostics under the target
app's private `files/gakumas-sim/` directory. The exported JSON is saved
only after a user-initiated Android document-picker action.
No anti-cheat bypass, cloak, or write of game score/card/seed values is
implemented. Root+LSPosed injection can still violate game policy or
trigger detection; no no-ban guarantee exists. Safe mode mask=0 installs
no game-function hooks; a contest capture requires opting into hooks.

## v1.5.24: exact turn targets and pre-setup RNG provenance

Real v1.5.23 evidence (nine sessions) resolved 163/163 deck master IDs,
but every ExamParameterModel snapshot omitted the turn-target array despite
objectsVisited=12 and truncated=false. The field was named
`_turnTargetStatusParameterTypeList`; our uppercase `TurnTarget...`
allowlist never matched its lower-case initial. v1.5.24 matches verified
metadata names case-insensitively and retains rejection of partial arrays.

All nine `randomStateBeforeSetUp` observations were null, while
`randomStateObserved` after the original setup was readable.
Rather than guess that either seed or after-setup state is the
pre-shuffle state, the capture now reports
`beforeRandomUnavailableReason`, `beforeSequenceParameterReadable`,
`beforeSequenceParameterPresent`, `afterSequenceParameterPresent`,
and `seedBeforeSetUp` read directly from the passed ExamData. The
diagnostic changes are read-only and do not add game hooks.
If the ParameterModel is not bound before SetUpExam, its RNG state cannot
be observed at that point using the existing sequence pointer. The
post-setup state remains recorded independently, and shuffle-start
parity still needs real-device verification.

## v1.5.23: resolve real device ExamCardData._cardData

The v1.5.22 real-device capture on 2026-10-11 recorded **9 complete contest sessions, 53 selected-progress events and 95 delta turns**, with no transport/write failures or drops. Nine native setup RNG states were independently matched by XorShift32 with 7, 9, 5 advances by team respectively. All initial deck lengths (16–19), session P-item lists (2–5, 34 item references total), initial stamina/max-stamina (39–43), and real scores were preserved.

The new one-time `$cardClassInventory` **identified the cause of missing card IDs**. The runtime `ExamCardData` is exactly **248 bytes** and inherits only `System.Object`; it has **no inherited card-ID field**. Its first declared field is the class reference **`_cardData` at byte offset 0x10, IL2CPP kind 18**. Earlier `wanted()` filtering checked case-sensitive `Card` and `Id` tokens, silently rejecting the lower-case `_cardData` field. Scanning the direct `ExamCardData` object for a UTF-16 `p_card-` string consequently matched zero cards.

v1.5.23 explicitly accepts `_cardData`, dereferences it via passive IL2CPP metadata, and serializes its master-card ID fields. It avoids recursing through the full resolved card-effect tree for every duplicate. Recursive-cycle checks now track only the **current object ancestry** rather than suppressing repeated master references across sibling cards. The JS normalizer handles `ExamCardData.fields._cardData.fields._id` (or the equivalent CardId/Id backing fields) and continues to fail closed if the ID cannot be read. The native read budget increases to 16 KiB per root to accommodate the new lookups. Production card and contest gameplay methods are not invoked.

Regression tests now explicitly verify `wanted("_cardData",2)` and normalize nested master IDs, including a negative missing-ID case. This is a **predicted correction based on metadata**; the actual runtime class of `_cardData` and whether it contains the desired ID must be proven in the next v1.5.23 contest capture. Neither full-score simulator parity nor independent card-selection/DFS equivalence is claimed.

## v1.5.22: real-device v1.5.21 card-layout verification

The v1.5.21 capture uploaded on 2026-10-11 contains **9 completed contest sessions, 53 progress events, 95 contiguous turn records, 9 native setups, 9 results, zero gameplay write/read errors**. All 9 independent post-setup RNG states match Seed-based XorShift32 after 5, 7 or 9 advancements; this is not evidence of an independently computed score.

The newly expanded `ExamData` capture recovered every initial deck length (16–19), all **34** session-scoped native P-item IDs (prefix `pitem_`), native initial stamina/max stamina and original 8/10/12 turn limits. Yet **zero** `$scannedCardId` entries succeeded (none were ambiguous). `il2cpp_class_get_parent` is present, but the inherited ID field still does not appear in the inventory. `Obscured<T>` runtime values are encrypted and must never be mistaken for stamina.

v1.5.22 obtains `il2cpp_class_instance_size` and scans exactly the size of each card object, bounded by 4096 bytes; it no longer assumes 768 bytes is the object size. The first `ExamCardData` record in each snapshot also includes a metadata-only `$cardClassInventory` (runtime byte size, up to 8 parent class names, with declared field names, offsets, and type kinds). This identifies whether `ProduceCardId` is actually stored in a base field, elsewhere, or synthesized by a property. No managed getter is called. The class inventory is emitted only once per setup snapshot, avoiding repeated huge logs.

The web setup normalizer now consumes native `pitem_` IDs and the in-field `$scannedCardId` only when non-ambiguous. It reads unencrypted `ExamData.Stamina`, `ExamData.MaxStamina`, and `ExamData.LimitTurn`, **not** the encrypted `ExamParameterModel.Obscured<T>.Raw<T>` values. Candidate diagnostics preserve native deck count, number of IDs acquired, P-item IDs, and initial vitals even when replay is blocked.

Real-device ID recovery and the exact pre-shuffle random state still await verification; do not claim full independent gameplay/DFS parity. Upgrade the module, restart the game, and submit a single `gakumas-contest-capture.json` again. The new `$cardClassInventory` should determine the next concrete fix without guessing field layout.

## v1.5.21: device v1.5.20 card identity, protected-value, and ArraySegment diagnostics

The 2026-10-11 device v1.5.20 capture contains **9 sessions, 52 selected-progress events, 95 native turn logs, 9 results, 9 setup records** with zero read failures, write failures and drops. The native result score equals the terminal progress score and Vo+Da+Vi in each session. Each `ExamData.DeckList` has 16–19 real cards; 11–12 were previously decoded due to the nested effects/tree byte cap. The IL2CPP `ExamParameterModel` now includes 89 fields, `_random.state`, 8/10/12-turn attribution, and Obscured<T> stamina; the latter contains **encrypted/raw values**, not direct stamina. No independent full-score comparison is supported for this data.

v1.5.20 still omitted every card's inherited `ProduceCardId`, despite an attempt to inspect class parents. v1.5.21 logs whether `il2cpp_class_get_parent` was available and adds a bounded *read-only, single-direct-reference UTF-16 scanner* for the unique `p_card-` identity inside each real `ExamCardData` object. An ambiguous/missing identity is `null`; it is not manufactured from the observed hand. Native string probes restore optional read failures and do not execute managed gameplay methods.

The capture also skips heavy per-card resolved effect-tree/cache fields (effect masters remain in the public catalog) so the deck, items and other setup fields are not displaced by its output budget. For `Obscured<T>`, `Raw<T>`, and `ArraySegment<T>` it records all named fields instead of only name-filtered values, preserving possible deobfuscation keys and backing arrays, offsets and counts. The browser normalizer accepts the unique `$scannedCardId` field and decodes `ArraySegment<T>` using a verified offset/count bound. New host and JS tests cover unique ID recognition, rejected missing IDs, and sliced P-item arrays.

**This is still an experimental acquisition build.** v1.5.21 cannot yet claim confirmed card identity scanning, stamina deobfuscation, exact pre-shuffle RNG or full AI/DFS score replay on the device. Reinstall/upgrade, fully restart game, run contest, export only `gakumas-contest-capture.json`. The next real capture will show whether ID-field scanning and item/obscured internals are now sufficient to refine the setup adapter.

## v1.5.20: real-device v1.5.19 inherited-card discovery

The 2026-10-11 v1.5.19 contest capture recorded **9 sessions, 54 selected-progress records, 9 setup records, 9 results and 95 contiguous delta turns**. Each `contest-start.nativeInitialState` successfully resolved the actual IL2CPP `ExamData` runtime type, with `DeckList` sizes 16–19 and `LimitTurn` values 8, 10 or 12. `ExamParameterModel._turnTargetStatusParameterTypeList` exposed the exact numeric `ProduceParameterType` enum. Nine independent XorShift32 post-setup checks passed with 5, 7 and 9 advancements respectively. Native gameplay recording still had zero read/write failures.

However, each `ExamCardData` entry contained only fields declared on the derived class; the inherited card-ID fields were absent. `IReadOnlyList<T>` fields were empty because the reader used the declared interface type instead of the concrete runtime type. Encoded `Obscured<T>` parameters were incomplete, and optional invalid child pointers caused `available:false` despite a valid decoded `ExamParameterModel` root.

v1.5.20 walks up to six runtime IL2CPP class parents using `il2cpp_class_get_parent`, reads reference objects by their actual object-header class (including List<T> implementation types), and treats generic instantiated value types as unboxed when IL2CPP reports value-type semantics. The decoder permits additional nested parameter levels while retaining bounded nodes, memory reads and snapshot bytes. It omits redundant card icon/cache fields so inherited identity takes priority. A successfully decoded root now remains `available:true` even when optional child fields fail, with `complete:false` and `readFailure` identifying missing data. Unsupported nested type-kind codes are reported rather than silently replaced by arbitrary values. No gameplay methods are called.

The browser input normalizer now recognizes the **observed** `ExamData.DeckList`, `_baseUpgradeCount`, `_fixedDeckOrder`, `ProduceParameterType` enum and `ExamData.LimitTurn` fields. Missing ID, stamina, settings, draw-per-turn, P-items or verified pre-shuffle RNG still correctly block a full-score parity verdict. The v1.5.20 code and host/JS tests do **not** prove on-device inherited field extraction yet; submit a new `gakumas-contest-capture.json` from v1.5.20 for that validation.

## v1.5.19: v1.5.18 on-device regression and initial-layout diagnostics

The 2026-10-11 v1.5.18 user capture recorded **9 contest sessions, 55 selected-progress events, 95 append-only turns, 9 results and 9 setup events**, with zero incomplete reads, write errors or file-limit drops. All terminal native scores matched the final native progress scores and their Vo/Da/Vi sums. **Every** `nativeInitialState`, `examParameterSnapshot`, and `examSequenceSnapshot` returned `il2cpp-reflection-exports-unavailable`; `randomStateBeforeSetUp` was null in all nine sessions. These are setup-acquisition failures, not failures to save the existing gameplay log.

The nine post-`SetUpExam` RNG states were independently confirmed by advancing XorShift32 from the captured Seed **5, 7 or 9 times**. The Web comparison and downloadable report now include `rngVerification.status` and `advanceSteps` per session, plus `summary.setupRngVerified`. These values prove the **post-setup RNG chain only**; they do not establish the pre-shuffle deck RNG state, full scoring, or contest AI DFS parity.

v1.5.19 first resolves IL2CPP metadata symbols through `dlsym` and the module's existing ELF dynamic-symbol fallback. If required metadata exports are missing, the setup event now includes their names in `missingExports` and a bounded `rawLayout` with a 384-byte root hex dump plus at most 24 valid pointer targets sampled for 64 bytes each. All memory is read through the existing guarded `process_vm_readv` transport; no managed game logic is executed. The raw bytes are **opaque offline evidence** and never treated as a recognized deck or valid simulator inputs.

Device verification of the v1.5.19 setup fallback remains pending. Install this version, fully restart the game, and send **only the resulting `gakumas-contest-capture.json`**. Until the missing native fields can be decoded and the full effects/DFS replay is complete, no true full-score match verdict is issued.

## v1.5.18: native setup evidence and guarded independent replay

**This is an experimental data-acquisition build, not yet proof of full contest score parity.**
On the pinned v3.4.1 IL2CPP Build ID, a selected auto-play session now records:

- `contest-start.nativeInitialState`: passive `ExamData` field inventory obtained through bounded `process_vm_readv` plus `il2cpp_class_get_fields` metadata. The module does not call managed gameplay methods.
- `contest-setup` (only the verified caller RVA `0x07EFD3B4` inside natural selected auto-play): `randomStateBeforeSetUp`, `randomStateObserved` after `ExamSequence.SetUpExam`, and `examParameterSnapshot` / `examSequenceSnapshot` with typed field names and list data.
- A snapshot includes `available`, `complete`, `truncated` and `readFailure` metadata when appropriate. Missing exports/unknown value-type arrays fail closed; observations never become fabricated fields.

The app's exported `gakumas-contest-capture.json` contains all these events in the **same JSON**; no second diagnostics file is normally required. The existing turn-delta replay remains compatible with schema v2.

`web/contest_native_setup.js` resolves **only recognized, fully evidenced** deck, item, turn setting, stamina, and random-state inputs. `web/contest_native_replay.js` then runs a fresh `tower_runtime` state, advances its own RNG, draws its own cards, and applies the captured **decisions** through the simulator. It reports the first divergent hand, turn score, stamina, block, or terminal score without substituting actual device results for predicted values. This validates **action/effect replay**, not independent AI action selection/DFS. The existing strict comparator classifies partial coverage as `partial-match` and never as complete parity.

Current limitations: card and item master catalogs must be loaded and match the game version; reflection field shapes still need on-device confirmation. The pre-SetUp random state is not necessarily the exact pre-shuffle state. Unsupported effects, incomplete setup, undecoded enum/list shapes, and unresolved initial-state fields intentionally produce `simulation-unavailable` rather than 'match'. Exact DFS search/evaluation replay is still unsupported for full-effect contests.

After installing v1.5.18 and restarting the game, submit only a fresh `gakumas-contest-capture.json`; the new setup field inventory identifies the missing normalization fields if the automatic replay remains blocked.
## v1.5.17: incremental selected-turn history (device verification pending)

The v1.5.16 device export from October 11 had nine completed contest runs
and 57 selected-progress entries. Turn objects and command/effect history
decoded in 26 entries; the remaining 31 exhausted the per-event 4,096
kernel-read budget when earlier turns were repeatedly decoded at every
step. Readable earlier turns were unchanged across successive steps in this
sample. Nine final score results were saved; no file write errors or
8 MiB limit drops occurred.

This build switches progress-event output to **schemaVersion 2** and
`turnsEncoding: "delta"`. The `turns` array contains **only newly appended
full turn records**, starting at the zero-based `turnStartIndex` position
of the original history. The original full history length is `turnCount`.
To replay a session, collect consecutive progress events, insert their
`turns` at `turnStartIndex`, and verify the accumulated count reaches
`turnCount` on each complete event. A result's `dataComplete` remains
false if any earlier selected-step read was incomplete.

The read budget is still bounded (8,192 kernel reads per selected result).
The per-session turn cursor advances only after successfully decoding each
whole turn. If a turn fails to decode, the next selected-step retries it.
If a progress record cannot be written or hits the file cap, its cursor
is rolled back so the next event can retry. When the history unexpectedly
shrinks, the decoder fails closed instead of silently discarding indices.
The selected indexes, score, evaluation and lifecycle event boundaries
remain present. The export's outer `schemaVersion` is also 2.

The mode is designed for append-only saved-turn logs. That behavior held in
the supplied v1.5.16 sample but is not yet proven for every game mode or
game update. Re-read the new JSON with a schema-aware consumer; legacy
readers treating `turns` as a complete snapshot will interpret this file
incorrectly. The native hook does not call synthetic managed methods,
capture the full RNG stream, or perform simulator parity automatically.
Validate with a fresh v1.5.17 device capture before declaring complete.

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
