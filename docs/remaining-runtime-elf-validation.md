# Remaining runtime executor validation (2026-10-14)

Source: attached `gakumas_analysis(1).elf`, SHA1 build ID `77fda4e2a21f23954e2349b83fc113ede408f70b`.
The stripped ELF's embedded v31 metadata and Assembly-CSharp code-generation module were used to recover method names; instructions were decoded with Capstone. The other attachment, `gakumas_analysis.elf`, was unavailable and was not used.

## Implemented paths

| Executor | Evidence and behavior |
| --- | --- |
| CardShuffleDeckGrave | `ExecuteEffect 0x804BD24` delegates to `ShuffleDeckGrave 0x827E9CC`. Returns if either pool is empty. Concatenates Deck then Grave; descending Fisher-Yates draws N-1 bounded random values. `0x827EFF4` takes the original DeckCount prefix; predicate `0x828236C` rejects a prefix wholly contained in the old Deck GUID set. Retry shuffles the preceding permutation. Take/Skip split preserves both pool sizes. Emits pool/shuffle differences rather than MoveCard commands. |
| CardShuffleDeckLost | `0x804BD4C -> 0x827F440`. Same pool-size and RNG semantics; GUID membership loop `0x827FA18..0x827FA58` retries if all prefix cards belong to old Deck. |
| ClearDebuff | `0x804C314` delegates `RemoveStatusEffect 0x80694F8` with predicate `0x804C500`: `GetEffectType` then `GetEffectTargetType == 2 (Debuff)`. Uses existing debuff-row removal and resynchronizes aggregated values. |
| EffectTimerEndTurn | `0x804E150` builds phase 42 (`ExamEndTurnTimer`) with Value1 as timer value, child effect(s), unlimited status lifetime and one activation. `0x807FEF0 -> IsEndTurnTimerTrigger 0x803FB40` compares status TurnCount for equality. Uses installed-turn clock (grant turn zero) and END_TURN phase; child owner token survives scheduling. |
| LessonChangeSpecifyLessThan | `0x80578B0 -> TryAddLessonChangeSpecifyLessThanStatus 0x8074A60`, arguments Value1 replacement, Value2 threshold, Turn lifetime. Same pair extends only a shorter lifetime. Predicate `0x807FA14` is input <= threshold; getter orders replacement descending. |
| LessonChangeSpecifyMoreThan | `0x8057C30 -> 0x8075004`. Predicate `0x807FA6C` is input >= threshold; getter orders replacement ascending. `CalculateAddingParameter 0x80349D4..0x80349FC` applies MoreThan first, then LessThan to the replaced input. |

## Existing growth path corrected

`GrowEffectLessonAddAdditive.ExecuteEffect 0x8054660` loads Value1 and Turn at `0x80546EC`; its second argument is not Value2. `TryAddGrowEffectLessonAddAdditiveStatus 0x8074038` aggregates permil additions for a lifetime. `GetGrowEffectLessonAddAdditiveMultiple 0x8074238` returns 1 + float32 sum(permil/1000). `ExamEffectUtility.AddGrowEffect 0x8038F64` checks grow type 1 (LessonAdd), clones the grow data, multiplies the incoming grow value by this multiplier, and ceils (`0x80390A4..0x8039130`). Apply the multiplier when acquiring growth, once, before deferred self-growth is stored; do not rescale existing growth or non-LessonAdd growth.

## Validation and scope

- 46 Node CI test files passed locally, including `test_elf_remaining_runtime.mjs`.
- Shuffle vector: Deck A,B + secondary C,D; RNG state 3601345174. The first permutation is rejected; after two passes (six random calls), Deck A,C, secondary D,B, final RNG state 3492243874. Computed independently from the decoded bounded RNG and swap sequence.
- Tests cover empty-pool no-RNG, identity/card conservation, debuff removal with positive-status preservation, inclusive thresholds, ordered overrides, expiry, one-shot end-turn timer, and growth 3 at multiplier 1.5 -> ceil(4.5)=5 without mutating master data.
- The starting table had 116 master paths / 149 supported names / 12 unconnected classes, although documentation and tests claimed 115 / 148 / 13. The wired GrowEffectLessonAddAdditive path explained the discrepancy. This update repairs its behavior and adds six paths: 122 master paths, 155 supported native names, 6 remaining.
- No new live capture or historical captures (16)-(19) were available locally; those 36 matches were not rerun. Fixture-based CI regressions passed. Registration coverage is not a claim of complete live-game parity, especially trigger ordering for the remaining chain executors.
