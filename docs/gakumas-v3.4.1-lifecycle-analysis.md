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


## Native RVA mapping in the supplied ELF

Verified ARM64 code locations within the executable il2cpp ELF section
(Build ID 77fda4e2a21f23954e2349b83fc113ede408f70b):

| Method | RVA | Disassembly evidence |
| --- | --- | --- |
| ExamSequence.StartExam | 0x080A5354 | Function prologue |
| ExamSequence.get_Parameter | 0x080A15B4 | ldr x0,[x0,#0x10]; ret |
| ExamSequence.Dispose | 0x080B0DC0 | Function prologue |
| ExamParameterModel.SetExamEndComplete | 0x0809305C | Sets an argument to 1 before branching |
| ContestProgressData.StartExamBattle | 0x06CEC3CC | Stores 1 into an object field |
| ContestProgressData.EndExamBattle | 0x06CEC3D8 | Function prologue |

These are ELFs virtual addresses for this exact build, not metadata tokens.
The existing pinned-build LSPosed lifecycle hooks already refer to these
addresses. The new implementation preserves them rather than double-hooking
the same entry points. The Android viewer reads exam_lifecycle_status.json,
which describes per-hook installation status.

Early native module injection can occur before the managed IL2CPP domain
is initialized. An il2cpp_init post-call retry now avoids that race without
periodic polling. The game process is still not confirmed to call every
lifecycle method in all game modes, and full RNG/card/score/effect capture is
not established.

The current raw field resolver expects a direct randomstate field and a pool
cardlist field. Actual version-31 metadata instead records ExamParameterModel
with _random and ExamCardPoolModel inheriting _cardList from the generic
CardPoolModel type. Native detailed trace therefore remains fail-closed
until the new layouts can be validated.

Offline parser: tools/inspect_gakumas_metadata.py. Supplied ELF addresses are
not portable to different game Build IDs.
