# v1.5.30 failure and v1.5.31 capture changes

Analyzed ELF: GNU Build ID `77fda4e2a21f23954e2349b83fc113ede408f70b`.
Method names/signatures were obtained from its embedded IL2CPP v31 metadata;
entrypoints were matched through Assembly-CSharp method-pointer relocations.

## Observed failure

Capture (12), module 1.5.30, contains nine completed sessions, 95 turns and 188
selected played-card records. There are no write failures or limit drops.
However, all 19 command-builder snapshots have null cards and serial zero,
all 107 root-sequence command-list samples have step zero, and only one of
107 sampled mutation contexts matches the original setup instance.

The old controller/parameter match is against the setup sequence. DFS runs
`ExamSequence.DeepCopy` and operates on cloned parameter/controller instances.
Sampling two rejected candidates per search step cannot recover the selected
branch, even when those candidates have matching card GUIDs.

`GetTriggerEffectListCommand` builds commands. It is not an effect-completion
callback; the initial command lists have no playing card. `state == -2` alone
also cannot establish success: the exception path sets that value too.

Finally, `Obscured<int>.get_Value` does not directly return backing storage.
The value is flipped before validation and return. The old code deliberately
exported null metrics instead of reporting the encoded backing integers.

## Native evidence and implementation

| Native method | RVA | Observed role |
| --- | --- | --- |
| ExamSequence.DeepCopy | `0x080AFEE0` | Copies parameter, card pools and pending commands into another sequence |
| ExamSequence.SyncData | `0x080B04B0` | Copies another sequence's state into the receiver |
| ExamSequence.LoadExam | `0x080A3B34` | Loads saved state for the next search |
| ExamSaveData constructor(sequence, bool) | `0x0809B760` | Copies a specific sequence into saved state |
| ExamSaveData.SetSequence | `0x0809C4FC` | Refreshes saved state from a sequence |
| ExamSearchExecuteNode.AddSequenceScore | `0x07EFFEA8` | Constructs ExamSaveData from the candidate sequence at `0x07F00144` |
| ExamDepthFirstSearchSimulator.GetSearchResult | `0x07EFE28C` | Returns the selected result; Nullable payload +24 is ExamSaveData |
| ExecuteCommandImplAsync.MoveNext | `0x080D91D8` | Command +0x18, sequence +0x20; capture costs before UseHand/UsePool |
| ExecuteCommandListImplAsync.MoveNext | `0x080E0F40` | Sequence +0x18; terminal state is shared by success and exception paths |
| AsyncUniTaskMethodBuilder.SetException | `0x0646A038` | Called on builder +8 by the exception path at `0x080E1B20` |
| Obscured<int>.get_Value | `0x0809F438` | Copies Raw._value, flips, verifies and returns the flipped value |
| RandomFlipper<int>.Flip | `0x0809F80C` | 32-bit multiplication, shifts and XOR |

Immutable copied-text trace nodes follow DeepCopy/SyncData/LoadExam. A saved
object captures its sequence's trace head. Only the exact ExamSaveData returned
by GetSearchResult selects events for output. Siblings sharing a GUID are not
selected. Checkpoints and disposal remove obsolete address bindings; unknown
saved objects and buffer overflow are explicitly reported.

Command-list completion tracks the exact builder's SetException call. For
suspended UniTasks, the runner's natural SetResult is observed before forwarding
it, because it can synchronously resume the parent and dispose/select a clone.
Completion contains actual executed-card identities, serials, pools and decoded
metrics. Multi-card lists are reported as groups and do not invent individual
card score deltas. The reconstruction utility accepts a per-card delta only
when lineage, successful completion, a single action, turn and card identity
all agree.

The flipper uses unsigned 32-bit arithmetic:

```
m = (seed * 0x85EBCA77) XOR (seed * 0x794EE000)
m = m XOR (m >> 17)
decoded = encoded XOR m XOR (m << 5)
```

For seed `0xF137BE92`, storage `0xF0D7CEB6` decodes to 1234 and storage
`0xF0D7CF60` decodes to 1284. Empty Obscured values decode to zero.
No game getter, effect, RNG operation or network request is added.

The exported file ceiling and Java reader ceiling are both 32 MiB. In-memory
candidate text is capped at 64 MiB per search, with explicit incomplete flags.

## Verification limits

Host tests cover sibling exclusion with identical GUIDs, exact saved-state
identity, reused/unknown address rejection, encrypted metrics, failed commands,
and inline continuation ordering, under AddressSanitizer/UBSan. Selected-card
reconstruction rejects incomplete, failed and multi-card boundaries.

These checks and an ARM64 APK build validate the implementation, not actual
coverage on the user's device. One new nine-match rehearsal capture is needed
to measure selected lineage coverage and compare decoded states to native turn
logs. `gameCaptureVerified` remains false until that validation.
