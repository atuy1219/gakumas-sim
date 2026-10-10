# Gakumas 3.4.1: IL2CPP exam lifecycle metadata analysis

Input evidence (provided by the device owner):
- `global-metadata.decrypted.dat`: SHA-256 `4370094ac9c8949eeb8a2b57c17424fe85d0e7a29ab2de0a71510b2458740a38`, metadata version 31.
- `libil2cpp.so`: Build ID `77fda4e2a21f23954e2349b83fc113ede408f70b`.

## Relevant classes and tokens

| Class (namespace: `Campus.InGame.Exam` unless noted) | Method | Metadata token | Managed parameter count |
| --- | --- | --- | --- |
| `ExamSequence` | `get_Parameter` | `0x06005080` | 0 |
| `ExamSequence` | `SetUpExam` | `0x060050A4` | 1 |
| `ExamSequence` | `StartExam` | `0x060050A9` | 0 |
| `ExamSequence` | `IsEndExam` | `0x060050AC` | 0 |
| `ExamSequence` | `Dispose` | `0x060050D7` | 0 |
| `ExamParameterModel` | `get_ExamType` | `0x06004EA7` | 0 |
| `ExamParameterModel` | `get_RemainTurn` | `0x06004EC4` | 0 |
| `ExamParameterModel` | `SetExamEndComplete` | `0x06004F6C` | 0 |
| `ExamParameterModel` | `GetRandomInt` | `0x06004F44` | 0 |
| `ExamParameterModel` | `GetRandomInt` | `0x06004F45` | 2 |
| `Campus.InGame.Card.ExamCardMoveController` | `DrawCard` | `0x06006622` | 3 |
| `Campus.InGame.Card.ExamCardMoveController` | `ResetHand` | `0x06006625` | 1 |
| `Campus.InGame.Card.ExamCardMoveController` | `ShuffleDeck` | `0x06006627` | 1 |
| `Campus.InGame.Card.ExamCardMoveController` | `SetInitialCard` | `0x0600662A` | 2 |
| `Campus.InGame.Card.ExamCardMoveController` | `MovePlayCard` | `0x0600662B` | 2 |
| `ExamData` | `CreateProduceAuditionExamData` | `0x06004DCC` | 23 |
| `ExamData` | `CreateContestExamData` | `0x06004DCD` | 9 |
| `ExamData` | `CreateTowerExamData` | `0x06004DD1` | 23 |

The metadata type `Campus.InGame.Exam.ExamType` declares sequential constant
values: `Lesson=0`, `Audition=1`, `Contest=2`, `Seminar=3`,
`SeminarAudition=4`, `Tower=5`, `Angya=6`, `TourManual=7`,
`TourAuto=8`, and `Competition=9`. The values are decoded from field default
data (compressed signed integers), not inferred from order alone. Tower=5
also agrees with previous ELF analysis.

## Implementation, verification, and limits

In v1.4.0 the LSPosed module resolves `ExamSequence.StartExam` and
`ExamSequence.Dispose` through *live* IL2CPP metadata; verifies the method
tokens, that both methods have no managed arguments and a `void` return
type, and confirms the method pointer belongs to `libil2cpp.so`.
Only then does it install lifecycle hooks. The `get_Parameter` getter
is also identified by exact token. A per-device `exam_hook_resolution.json`
reports the **actual Native RVAs** only when method pointers can be resolved
on the device. Native addresses in that file have not been verified yet.

Using these specific events avoids maintaining log-write hooks during idle
gameplay. The original deck event detection remains a fallback. The
`il2cpp_init` completion hook retries setup when the module was injected
before IL2CPP domain initialization.

**Important:** metadata tokens such as `0x060050A9` are NOT RVAs. No
static address for the supplied 3.4.1 ELF has been established from
CodeRegistration/MetadataRegistration, and even valid C# tokens do not prove
that a method is called in all variants of the game.

The current raw state capture is still fail-closed on unknown field layouts:
metadata proves the actual `ExamParameterModel` has a `_random` field and
that `ExamCardPoolModel` inherits its `_cardList` from a generic base.
The older raw offset resolver assumed names `randomstate` and a pool-local
`cardlist`; it must be updated before claiming complete card-pool/RNG capture
for 3.4.1.

This analysis is reproducible without uploading or committing copyrighted
full game metadata. See `tools/inspect_gakumas_metadata.py`.
