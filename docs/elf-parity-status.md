# ELF parity status (2026-09-23)

Target: `gakumas_analysis_fullcfg.elf.zst`, ARM64 IL2CPP. The attached ELF is
used for the native executor checks below. `surisuririsu/gakumas-tools` is a
secondary behavioral reference; the ELF determines rounding and execution
order where they disagree.

## Checked in this change

| Native executor RVA | Master effect | Corrected behavior |
| --- | --- | --- |
| `0x8008B88` | `ExamLessonPerSearchCount` | fixed value + ceil(card count × permil) |
| `0x8006CA4` | `ExamEffectPerSearchCount` | ceil(card count × permil) chain repetitions; zero skips |
| `0x8011ABC` | `ExamLessonDependBlockAndSearchCount` | ceil((fixed permil + card count × permil) × block); zero cards remains zero when fixed part is zero |
| `0x80133E0` | `ExamLessonDependPlayCardCountSum` | fixed value + current card play count × value2 |
| `0x8014618` | `ExamLessonFullPowerPoint` | fixed value + floor(cumulative Full Power points gained × permil), per hit |

## Verification boundary

The current `audit_exam_effect_coverage.mjs` run against the `vertesan/gakumasu-diff`
master YAML returned 2,098 effect rows, 1,732 card variants and 478 P-items.
Its smoke test exercised 1,686 card variants; 46 were blocked by play conditions.
It reported zero unsupported IDs for the paths it executed. This is dispatch
coverage, not score equivalence: it does not exhaust every status, trigger,
random draw, drink, P-item timing, stage or card customization combination.

No complete real-device action/score trace is included in this repository.
Therefore all-card, all-stage score parity remains unverified. In particular,
the pre-shuffle fallback in `web/exam_turns.js` is explicitly not validated for
every stage and character. A parity gate needs paired real-device turn logs
including seed, stage, initial deck, support cards, drinks, all actions,
intermediate status and per-hit score; compare the first divergent transition
before claiming an exact final-score match.
