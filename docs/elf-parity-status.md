# ELF parity status (2026-10-04)

Target: `gakumas_analysis_fullcfg.elf.zst`, ARM64 IL2CPP. The attached ELF is
used for the native executor checks below. `surisuririsu/gakumas-tools` is a
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

## Verification boundary

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
