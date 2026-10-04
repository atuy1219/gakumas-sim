# ELF parity status (2026-10-04)

Target: `gakumas_analysis_fullcfg.elf.zst`, ARM64 IL2CPP. The attached ELF is
used for the native executor checks below. `gakumas-tools/gakumas-tools` at `58c7148cb1d097b78f66faa4a9ab6d5212f083b7` is a
secondary behavioral reference; the ELF determines rounding and execution
order where they disagree.

ELF archive SHA-256:
`f8894c161ad5eeda6310e500d0c8a6fa4b8c18ad348534f7fe17c9700137d71a`.

## Checked in this change

| Native executor RVA | Master effect | Corrected behavior |
| --- | --- | --- |
| `0x8008B88` | `ExamLessonPerSearchCount` | fixed value + ceil(card count × permil) |
| `0x8006CA4` | `ExamEffectPerSearchCount` | ceil(card count × permil) chain repetitions; zero skips |
| `0x8011ABC` | `ExamLessonDependBlockAndSearchCount` | ceil((fixed permil + card count × permil) × block); zero cards remains zero when fixed part is zero |
| `0x80133E0` | `ExamLessonDependPlayCardCountSum` | fixed value + current card play count × value2 |
| `0x8014618` | `ExamLessonFullPowerPoint` | fixed value + floor(cumulative Full Power points gained × permil), per hit |
| `0x804BA98`, `0x804F934` | `PlayCardCountIncrement`, `ClearTurnState` | increment both cumulative and turn-local play counts; clear the turn-local count at the next turn |
| `0x7FF7EC8`, `0x7FFB0F0` | `IsCardPlayValidTrigger`, `IncrementEnchantPhaseCountWithCardSearch` | interval triggers read an enchant's own phase count, filtered by status conditions and target-card search, instead of the turn number |
| `0x805F2D0` | `ExecuteCardCommandImpl` | increment phase counts and collect card-play triggers before the card's own effects; after-play intervals remain after the card's own effects |
| `0x6901698` | `IsFieldStatusTriggerStatusEffect` | `PlayCardLesson` checks ActiveSkill (category 1), `PlayCardSkill` checks MentalSkill (category 2); missing/skip card history matches neither |

Stamina is now included in status-change notifications. The master distinguishes
`ExamStaminaReduce` (direct-effect damage) from `ExamStaminaReduceCard` (card cost).
Regression cases use the real `初声の証・咲季`, `勝ちへのこだわり` and `高くジャンプ！`
P-items to verify actual reduction, blocked damage, recovery, cost exclusions,
execution limits and turn-local reset. Cost-only and before/after-card ordering
cases use score assertions that change when effects execute in the wrong order.

The committed trigger fixture is pinned to master commit
`75eb2a94eb494a6e74053c0f295cb026e837e32a`. It covers all 10 affected Tower
interval groups and all 33 Active / 50 Mental category rows. Group/category tests
keep master conditions and replace only effect payloads or scheduling turns with
sentinels to isolate triggering. P-item tests execute original master effects.

The Tower snapshot preserves the exact gimmick ID from the original
`TowerLayerExam_live.json` (app 3.4.0, captured 2026-09-19): 351 floors and 2,126
effect-specific exam records. It includes all six common exam types plus 20
additional preservation-type records. The extraction tool excludes user,
common-response and ranking data. Tests verify ID presence, reference validity
and effect-specific stage selection; this is a dated snapshot, not a live fetch.

## Reference-engine comparison

The follow-up comparison with `packages/gakumas-engine` found missing card-own
move effects, Hold capacity/Full Power return, growth on dependent score effects,
per-card draw/Hand/Grave result phases, and source/transition scope for result
triggers. Those paths now have regression assertions, including the original
five card types / eight variants and Expert forcing a grown Grand Finale.
Native Hold returns FIFO (at most two cards, constrained by Hand capacity),
whereas the reference engine uses LIFO. See
[gakumas-engine-comparison.md](gakumas-engine-comparison.md) for the comparison,
RVA evidence, intentional differences, and remaining gaps such as Link Contest.

## Verification boundary

### Encore with final-turn extensions (2026-10-05)

`GetPhaseEffectList` (`0x803331C`) / `GetTriggerEffectList`
(`0x8032178`) supply the trigger candidates to
`GetInsertTriggerEffectListCommand` (`0x8061338`). That method materializes
commands and spends trigger counts before the commands execute. Phase conditions
are therefore collected before any of that phase's effects mutate the state.
This prevents 頂点の輝き's extra turn from suppressing a simultaneously eligible
光り輝く道しるべ Encore. Execution still checks active/count/reentrancy gates;
registrations installed during a dispatch remain deferred until the next root
dispatch. Gimmick row payload conditions retain their ordered evaluation.

`ExecuteCardCommandImpl` (`0x805F2D0`, especially `0x805F8E0`–`0x805FA70`)
reads the card's previous play count and its `IsOncePlayEffectList` to exclude
initial-only effects from a subsequent use's first execution. Repeat-buff
executions retain the native repeat behavior. The runtime now stores per-card
play counts; legacy backups recover them from completed/current play records.
Without this exclusion, fixing the phase condition would incorrectly reinstall
the Encore on every replay and reset its three-use lifetime.

The public-master fixture covers 光り輝く道しるべ (base / +), its real Review
cost, three-use final-turn Encore, and 頂点の輝き's two turn extensions. Tests
check free replay, added playable count, no duplicate/lost-card leakage, no
reinstalled Encore, exhausted activation counts, and new/legacy backup resume.
A local replay of the supplied 18-turn backup's recorded actions keeps turns
1–16 hands identical and activates Encore once on each of turns 17, 18 and 19.
The private backup and deck are not committed. An existing turn-18 checkpoint
can continue at turn 19; its missing earlier activations are not backfilled.
This is master/ELF/replay verification, not a new device trace comparison.

The current `audit_exam_effect_coverage.mjs` run against the `vertesan/gakumasu-diff`
master YAML returned 2,098 effect rows, 1,732 card variants and 478 P-items.
Its smoke test exercised 1,686 card variants; 46 were blocked by play conditions.
It reported zero unsupported IDs for the paths it executed. This is dispatch
coverage, not score equivalence: it does not exhaust every status, trigger,
random draw, drink, P-item timing, stage or card customization combination.
The 1,118 gimmick groups / 3,762 rows cover all modes; Tower alone contains
242 groups / 1,328 rows. A zero-unsupported result cannot establish that a
condition fired at the correct time; the separate trigger regressions assert
both activation and non-activation in the reported defect cases.

No complete real-device action/score trace is included in this repository.
Therefore all-card, all-stage score parity remains unverified. In particular,
the pre-shuffle fallback in `web/exam_turns.js` is explicitly not validated for
every stage and character. A parity gate needs paired real-device turn logs
including seed, stage, initial deck, support cards, drinks, all actions,
intermediate status and per-hit score; compare the first divergent transition
before claiming an exact final-score match.
Global ordering when multiple P-items, enchants, card effects and gimmicks
interact remains unverified beyond the specific before/after assertions above.

## Tower26 progress regressions

`tests/fixtures/tower26-replay-masters.json` contains only public master records
from the reported Tower26 configuration, without memory/player data.
`tests/test_simulation_backup.mjs` checks non-activation of 頂点の輝き before
the final turn, two final-turn activations after drawing, newest-debuff
recovery before Turn2 draw, and full/pruned catalog resume parity.

Native references: `IsFieldStatusTriggerStatusEffect` RemainingTurn branch
`0x6901dd8 -> 0x6901edc` uses signed less-or-equal;
`DebuffRecoverEffectExecutor.ExecuteEffect @ 0x8006280` orders filtered
debuffs descending by Uid (`0x8006918`, selector offset `0x1c`, matching
`ExamStatusEffectBase.get_Uid @ 0x80215d0`).

## Tower turn attribute initialization

The Tower search/input Seed is the first deck shuffle's XorShift state. It
correctly reproduces the reported all-skip draws and must stay unchanged for
deck simulation. Turn attributes use the earlier state, before native setup
consumes `max(0, turn - 3)` words for attributes and `turn * npcCount` words
for NPC score jitter. The selected floor's NPC count is loaded from its
`ProduceExamBattleNpcGroup` master, without a fixed five-NPC assumption.
Missing NPC information blocks attribute generation instead of guessing.

Native call chain checked in the supplied ELF:

| RVA | Evidence |
| --- | --- |
| `0x8041608 -> 0x8041614` | `CreateTowerExamData` sets ExamType **5**; the `3` passed by the transition constructor is not ExamType |
| `0x805be58 -> 0x805be84` | Tower calls `CalcTurnParameterType`; only ExamType 4 accepts a supplied list |
| `0x804d4d0 -> 0x804d4f8` | Each randomized attribute uses the current RNG state, then advances it, including the final pool of size 1 |
| `0x6903ce8`, `0x805bea4 -> 0x805bed4` | `IsAudition` includes Tower/5, so setup also calls `CalculateAuditionNpc` |
| `0x804e614 -> 0x804f154` | Tower `GetScoreList` returns one score per turn without consuming randomness |
| `0x804e130 -> 0x804e4cc`, especially `0x804e478 -> 0x804e498` | For each NPC, consume one RNG word per score, even if the jitter range is 0..1 |
| `0x8072894 -> 0x80728ac`, `0x803f7c4 -> 0x96a0ea8` | Initial deck shuffle follows setup and uses the resulting RNG stream |

For the reported 16-turn floor: 13 attribute words + 80 words for five NPCs =
93 words. Rewinding `3437998083` yields `775645918`; the calculated first two
attributes are Visual/Visual, and the reproduced first-turn 好印象 score is
259 at 3694%, matching the supplied screenshots. The master has all 2,126
snapshot exam records' NPC groups, each with five NPCs. This checks reference
availability; it does not establish real-device parity for every floor.

`tests/test_tower_turn_rng.mjs` checks the full calculated sequence, restoration
with different turn/NPC counts, floor-group lookup and unchanged all-skip
draws/RNG through recycling. Only the first two attributes have device-image
confirmation. Existing backups preserve their historical computed results;
restart with the same recovered Seed to apply corrected attributes throughout.

## Skill-card upgrades and generated cards

`UpgradeEffectExecutor.ExecuteEffect @ 0x801ff74` checks
`ExamCardData.get_IsUpgradableRaw @ 0x822a738` at `0x80202fc` before
`SetTemporaryUpgrade @ 0x8229de0`. The original upgrade plus skill-effect
upgrade must be zero, and the + master must exist. `SetTemporaryUpgrade`
sets its own field to one; it does not increment an already upgraded card.
Support upgrades use the separate `SetSupportUpgrade @ 0x8229f6c` /
`get_IsUpgradable @ 0x822a110` path and may reach higher master variants in
ordinary exams. Tower has no support-card upgrades.

The reported action sequence used ティーパーティ+ on Turn5. The incorrect
skill upgrade changed 私がスター+ to 私がスター++, adding its block effect
group. That false block card incremented 私を超えて's filtered counter and
generated an extra 私を超えて（翔）. Removing the false upgrade also removes
that extra card, changing depletion and recycle timing without changing Seed.
Replaying the supplied actions with the corrected logic produces one 翔 by
Turn7, and the first recycle occurs during Turn7's draw. The predicted Turn7
hand is 手書きのメッセージ+ / ゆめみごこち+ / 目線の基本. This is a corrected
simulation prediction, not a confirmed real-device post-recycle comparison.

The same trace consumes three RNG words before recycling: one for 眠気's
DeckRandom insertion and two for 夏夜に咲く思い出's Random removal (fixed
pick-count roll plus one candidate sort key). Fixed-count DeckFirst creation
consumes none: `CardCreateIdEffectExecutor @ 0x8003cdc` skips the count roll
when min == max; `PickCardPositionListImpl @ 0x7fea0c8` always rolls the
Random pick count. No extra RNG advancement was added for these effects.

Enchant history captures the installing card's actual name/upgrade instead
of looking up `cardById`'s last (often +++) variant. Existing checkpoints can
resolve the origin via their saved card token. Tests cover upgrade no-ops,
filtered generation timing, no-RNG DeckFirst creation, recycle word count,
and full/pruned checkpoint continuation. Historical false upgrades/generated
cards in old backups are retained; restart to recalculate those actions.
