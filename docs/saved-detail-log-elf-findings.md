# Saved detail-log readback: pinned ELF 3.4.1

Build ID: `77fda4e2a21f23954e2349b83fc113ede408f70b`.
The UI exposes richer log models than ExamSimulateResult command/turn history.

| Method | RVA | ABI/evidence |
| --- | --- | --- |
| ExamSavePlayLogData.SaveAll | 0x081377E4 | Static: x0 list, x1 label. Groups by turn and saves labelled turn data and maxTurn summary. Not hooked/invoked by the probe. |
| ExamSavePlayLogData.LoadAll | 0x08137ECC | Static: x0 label, x1 MethodInfo; returns restored list in x0. Traverses cached/loaded turn records through maxTurn, appending stored lists. |
| CompetitionExamPlayLogListModel.ctor | 0x082440D8 | self, logItemModels, idolCards, isOwn, skin maps, MethodInfo. Captures input log list after original construction. |
| ExamPlayLogListOverlayModel.ctor | 0x0824708C | self, itemList, characterId, bool isBattle (packed nullable bool in field), skin map, MethodInfo. Arguments are forwarded unchanged. |

## Stored/display payload

ExamUserPlayLogItemModel getters 0x080EF000..0x080EF0B8 expose cell type +0x10,
details +0x18, current/limit/extra turn +0x20/+0x24/+0x28, turn types +0x30,
bonus +0x38, trigger ID +0x40, subscription number/list/bool +0x48/+0x50/+0x58,
owner +0x60, UID +0x68, played IDs/upgrades/customizes +0x78/+0x80/+0x88,
and drawn IDs/upgrades/customizes +0x98/+0xA0/+0xA8.

ExamUserPlayLogDetailModel getters 0x080F05CC..0x080F062C expose nested line list
+0x18 and trigger/divided-detail metadata. ExamPlayLogDetailLineModel getters
0x080F18E8..0x080F1950 establish line type +0x10, before/after +0x14/+0x18,
second before/after +0x1C/+0x20, target ID +0x28, subscription +0x30,
from/move position +0x34/+0x38, effect type +0x3C, message +0x48,
and before/after ID lists +0x50/+0x58. Customize wrapper getter at
0x080F0594 reads its integer list at +0x10.

The v31 metadata field-default data uses compressed signed integers, not raw
32-bit little endian values. Enum mappings were decoded using the field-default
index and compressed data bytes. Line type 14 is absent: FullPowerPoint is 15,
then TurnAdd 16 through CardGrowEffectMove 25. Do not infer enums by ordinal.

## Experiment

Independent opt-in 8192 installs only readback hooks. Export source distinguishes
LoadAll readback from competition/overlay display lists. The game may naturally
reconstruct some display models via ExamPlayLogSimulator; the probe does not
initiate reconstruction or replay. Native class names and pinned getter offsets
validate each item/detail/line. Unsupported roots or oversized collections are
explicitly incomplete. Lists are read in <=4096-byte chunks with count/version
stability checks; arrays use their own header layout. Null optional lists are empty.

Each readback record is <=8 MiB; total process file <=32 MiB. Consecutive identical
complete records from the same source/label/character/own flag are suppressed.
Old process file retained separately. No selected gameplay session is required.

Host ASAN/UBSAN fixture checks before/after 100→217, IDs, typed failures,
large array chunks, exact-once argument/result forwarding, mode-off behavior
and duplicate suppression. Device validation still needs the saved log export:
which hook is reached, completeness, per-card effects and presence of the
hand/draw/creation/move detail for the requested screens. A screen's existence
alone cannot establish local persistence, hidden state or exact RNG coverage.
