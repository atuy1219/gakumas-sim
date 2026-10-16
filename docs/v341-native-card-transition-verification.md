# Gakumas 3.4.1: ROM-verified card transition probes (2026-10-12)

Static analysis of user-provided `libil2cpp.so` and decrypted IL2CPP metadata version 31.
- ELF SHA256: `90a0b71d96691e41641690e57983d600c3ef1301b971d114d6a1658591e9ea17`
- Metadata SHA256: `4370094ac9c8949eeb8a2b57c17424fe85d0e7a29ab2de0a71510b2458740a38`
- Build ID: `77fda4e2a21f23954e2349b83fc113ede408f70b`
- Verified mapping: method definition token -> Assembly-CSharp.dll codegen module pointer relocation -> ELF executable address. This is more reliable than guessing an RVA from unrelated function snippets.

| Native method | RVA | Managed arguments |
| --- | --- | --- |
| `ExamCardMoveController.DrawCard` | `0x827CFF0` | count, context, isAddLog |
| `ExamCardMoveController.MovePlayCard` | `0x8280800` | card, context |
| `ExamCardMoveController.MoveCard` | `0x82769B0` | fromList, destination, effectType, context |
| `ExamCardMoveController.ReplaceGraveToDeck` | `0x827C978` | context, preDrawCount |
| `ExamCardMoveController.ShuffleDeck` | `0x827E884` | context |
| `ExamCardMoveController.ShuffleDeckGrave` | `0x827E9CC` | context |
| `ExamCardMoveController.ResetHand` | `0x827E05C` | context |
| `ExamSequence.ExecuteCardCommandImpl` | `0x80A5BB0` | position, card, usePlayableCount, context |
| `CardCreateIdEffectExecutor.ExecuteEffect` | `0x804A504` | context |
| `CardCreateSearchEffectExecutor.ExecuteEffect` | `0x804AB14` | context |

**A stale RVA from an older ELF-analysis note (`0x805F2D0`) is not the start of `ExecuteCardCommandImpl` in THIS pinned ELF.** Use `0x80A5BB0`.

## Root cause of the previously empty hook logs

IL2CPP `ExamEffectCalculateContext` exposes `<ExamParameter>k__BackingField` (not `<Parameter>k__BackingField`). Its getter at `0x802B584` is literally `ldr x0,[x0,#0x10]; ret`. Therefore old probes rejected valid contexts and reported zero matching parameters. Metadata also confirms `DrawCard(int, ExamEffectCalculateContext, bool)`; its prologue at `0x827D014` saves x2 (the context) in x19.

Other context fields: `<CardController>... +0x18`; `<HandList>... +0x20`; `<DeckList>... +0x28`; `<GraveList>... +0x30`; `<LostList>... +0x38`; `<HoldList>... +0x40`, confirmed by direct getters `0x802B5C4` through `0x802B614`. These are read passively and checked against IL2CPP runtime metadata.

## Logging policy and verification boundary

The module hooks the named methods above for before/after snapshots (read-only, original called once), with a strict Build ID gate. Context pointer identity and ExamParameter/CardController pointer identity are recorded. **Search candidates/clones are labeled unverified and never silently treated as actual selected game actions**. Sampling caps are per selected-rehearsal progress step; they are not evidence that every mutation in all nine participant simulations has been recorded.

`ExecuteCardCommandImpl` constructs action commands. `GetTriggerEffectListCommand` is also a command-construction boundary; neither is proven to run *after every asynchronously scheduled card effect*. Native `ExecuteCommandList` calls `ExecuteCommandListImplAsync` (see BL `0x80A77D0`); it schedules a UniTask state machine, so the synchronous return is not itself an end-of-card-effects marker. Post-selected-result snapshots have the same limitation.

The first 27-rehearsal diagnostic JSON observed 5,872 calls to DrawCard but only 24 matching the initially stored controller; 7,492 MovePlayCard calls had zero matching controller, consistent with activity on other controller instances during search. This does NOT independently prove which callbacks belong to the selected sequence. The pre-update context-field typo additionally blocked all context parameter matching.

**Only fresh on-device traces can establish the exact chosen playback path, asynchronous completion point, and end-to-end hand/deck/hold/generation/recycle parity.** An ELF alone has no executed invocation sequence, runtime object identity or selected search outcome.

For routine testing, one rehearsal with nine participant runs is the intended collection scope; still enforce the 8 MiB file cap with explicit dropped-event counters.
