# 2026-10-16 ARM64 symbolized ELF: compatibility inventory

This document describes the **user-provided** `gakumas_analysis.symbols.elf` image.
No game ELF, APK, metadata, keys, or proprietary assets are committed.

- ELF class: 64-bit, AArch64, Android NDK r27c
- GNU Build ID: `5ac77881a1242477b5bf6bd928ce8c1765a55f2f`
- `.symtab`: present in the analysis ELF (not necessarily present in the retail runtime ELF)
- Previous instrumented game v3.4.1 Build ID: `77fda4e2a21f23954e2349b83fc113ede408f70b`
- **Never reuse old RVAs/caller whitelists or fixed managed-object offsets on this image.**

## Offline symbol-derived RVAs (not live-hook verification)

| Method | RVA |
|---|---:|
| `ExamSequence.SetUpExam` | `0x0815C230` |
| `ExamSequence.StartExam` | `0x0815F6F4` |
| `ExamSequence.Dispose` | `0x0816B160` |
| `ExamSequence.get_Parameter` | `0x0815B954` |
| `ExamSequence.get_PlayingCard` | `0x0815BD44` |
| `ExamSequence.get_CardController` | `0x0815BD5C` |
| `ExamSequence.GetTriggerEffectListCommand` | `0x08160B58` |
| `ProduceUtility.CreateDeckProduceCardMasters` | `0x0784BA3C` |
| `UserProduceProgressProduceCard.GetProduceCardData` | `0x075C0E54` |
| `UserProduceProgressProduceCard.InternalMergeFrom` (protobuf ParseContext variant) | `0x075C0A24` |
| `ExamParameterModel.GetRandomInt()` | `0x08144594` |
| `ExamParameterModel.GetRandomInt(int,int)` | `0x0814468C` |
| `ExamCardMoveController.ReplaceGraveToDeck` | `0x08337014` |
| `ExamCardMoveController.DrawCard` | `0x0833768C` |
| `ExamCardMoveController.ResetHand` | `0x083386F8` |
| `ExamCardMoveController.ShuffleDeck` | `0x08338F20` |
| `ExamCardMoveController.ShuffleDeckGrave` | `0x08339068` |
| `ExamCardMoveController.SetInitialCard` | `0x0833A4C8` |
| `ExamCardMoveController.MovePlayCard` | `0x0833AE9C` |
| `CardMoveEffectExecutor.ExecuteEffect` | `0x08106098` |
| `ExamSavePlayLogData.LoadAll` | `0x081F226C` |
| `ExamData.get_ExamType` | `0x08141514` |
| `ExamData.get_IsReplay` | `0x081416A4` |
| `ContestProgressData.get_IsRehearsal` | `0x06D5ADEC` |

These are the symbol values, treated as RVAs. They do not establish that
callers, return registers, output storage, object layouts, protobuf member
functions or card command effects are unchanged.

## Compatibility implemented in this branch

- Only **試験開始の診断** (mask `128`) on this specific new Build ID installs
  a new guarded `SetUpExam` probe. The original is forwarded once.
- Observations are capped at 128 and log caller return RVAs, PID, thread and
  **unclassified** origin, with `modeVerified:false` and
  `managedObjectsRead:false`. No card/score/RNG getters are invoked.
- All combined contest, detailed RNG, saved log and ranking replay masks
  deliberately fail closed for this Build ID.
- The old Build ID still routes to its unchanged v3.4.1 implementation.
- The diagnostic mode chooser warns that full capture is not available on
  the new game image. The module is still **not live-device verified**.

The ELF permits us to locate candidate method entrypoints, **not** to conclude
that effects are captured, an audition/replay/tower is classified correctly,
or that the LSPosed hook works without a crash.

## Reproducible independent check

```sh
python tools/verify_gakumas_symbol_build.py \
  /path/to/gakumas_analysis.symbols.elf \
  --output latest-rvas.json
```

The checker fails if Build ID mismatches, a required symbol is absent, or
multiple addresses are returned for the same method. It needs `nm` and
`readelf`. It does not run the shared library. The resulting JSON can be
compared against a later ELF; it is **not** an automatic hook-install manifest.

## Next stage requiring on-device evidence

1. On the *matching* game Build ID, confirm native initialization and
   `exam_entry_probe_status.json` installation with mode `128`.
2. Check `exam_entry_probes.jsonl` events and compare return addresses to
   actual BL/caller code in this ELF; label only verified callers.
3. Extract current IL2CPP method signatures and layouts, and confirm hook
   behavior before enabling card/RNG/status collectors.
4. Reconcile selected-path records with game state across audition, ranking
   replay, contest, rehearsal and tower separately.
5. Only then mark `modeVerified`, `cardEffectsComplete` or
   `reproducibilityVerified` true.

Until those tests pass, retain the known working APK and do not assume
that a successful GitHub Actions build guarantees game compatibility.
