# v1.5.33 card completion boundary

Target: game 3.4.1 ELF build ID `77fda4e2a21f23954e2349b83fc113ede408f70b`.

## Capture (14) establishes the v1.5.32 failure

Nine sessions, 95 turns and 187 selected UseHand/UsePool commands were captured.
The 95 completion records coincide with the 95 turns, rather than the 187
card uses. They contain 172 cards in total. Missing groups occur at session/turn
5/4, 6/2, 7/4, 8/2, 8/3 and 9/6 (2, 2, 3, 3, 2, 3 cards respectively).
No read/write, lineage-capacity or file-capacity drops explain those omissions.
The selected command histories contain 187 UserCardAfterCheck commands, 187
MovePlayCard commands and 374 card-associated SeparateActivity commands.
The two separators are the beginning and end of each card action.

## ELF evidence

| RVA | Evidence |
| --- | --- |
| `0x080A5D5C..0x080A5D68` | ExecuteCardCommandImpl starts its constructed list with CreateSeparateActivityCommand(true, card). |
| `0x080A65F8..0x080A6600` | Appends CreateUseCardAfterCheckCommand(card), after card effects/triggers. |
| `0x080A666C..0x080A667C` | Appends MovePlayCardCommand(position, flag, card). |
| `0x080A66E0..0x080A66EC` | Appends CreateSeparateActivityCommand(false, card) as the last card command. |
| `0x0809A43C..0x0809A454` | Separator constructor stores type 9 at +0x10, start flag at +0xD0 and card at +0x58. |
| `0x080DD698..0x080DD880` | Type 9 executor performs end-only housekeeping, including status cleanup and possible parameter update. Entry is therefore too early. |
| `0x080DD8A0..0x080DD8C4` | Calls handler dispatcher with slot 15, handler from sequence+0x78, flag, card and cancellation. |
| `0x05D5DF10..0x05D5DF98` | Dispatch preserves arguments, resolves interface slot and tail-calls the activity handler; UniTask result returns unchanged. |
| `0x07F00134..0x07F00144` | AddSequenceScore constructs ExamSaveData(sequence, false); trace needs to exist before inline handler saves. |

Hooking the outer ExecuteCommandListImplAsync return cannot distinguish cards
inside that list. Worse, a save/load inside an awaited callback copies the trace
before that return; later trace nodes are not ancestors of the saved branch.
This explains the late-recording loss mechanism. The exact 15 historical losses
cannot be replayed from v1.5.32 JSON alone, which lacks per-callback timing.

## Implementation and limits

The existing command MoveNext hook maintains a stack frame on initial and
resumed calls. The dispatcher hook verifies the exact caller return address
0x080DD8C8, slot, type, owner, end flag and card. A copied GUID matches the one
pending action. It captures after executor housekeeping and before handler
selection/save/reentry. Immutable clone/save ancestry still selects the path;
GUIDs are used only to identify an action on that path, never to select siblings.

List-level fallbacks are explicitly incomplete, with no verified per-card score.
Pending baselines survive checkpoint/load. Successful empty lists stay counters.
New status counters distinguish handler end calls, verified completions and
unmatched boundaries. The hook must install for lineage detail capture to enable.

All reads are passive. Original calls and return values are forwarded once.
Host fixtures validate control flow and serialization with ASAN/UBSAN, but do not
establish on-device coverage, status semantics or full simulation parity.
The next single rehearsal capture must compare selected action count against
verified single-card completions, GUID order, read/drop counts and final scores.
