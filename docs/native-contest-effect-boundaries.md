# Native contest effect boundaries (captures 16–19)

Evidence: `gakumas_analysis.elf`, AArch64 IL2CPP build ID
`77fda4e2a21f23954e2349b83fc113ede408f70b`. The local catalog is pinned to
`vertesan/gakumasu-diff@1f07db111068a65defc13bd44e3e8957ca4baca4`;
equality of that external catalog with the game build remains unverified.

## Corrections

| Native evidence | Simulator behavior |
|---|---|
| `LessonDependPlayCardCountSumEffectExecutor.ExecuteEffect` at `0x8059ca0` reads completed card uses. `PlayCardCountIncrement` at `0x8092358` is called by the after-check at `0x80dcb20`. | Increment exam and turn use counters after main effects. Natural Charm reads `2 + 14 * completedUses`, excluding itself. Preserve the installation boundary for legacy enchants so they do not activate on their own installing card. |
| `MultipleLessonBuffLessonEffectExecutor.ExecuteEffect` at `0x805ced8`, particularly `0x805cf84–0x805cfcc`, rounds its extra concentration contribution before passing the base into `CalculateAddingParameter`. | Compute the extra concentration contribution separately. A 4x concentration effect has `Value1 + ceil(3*C*m) + ceil(C*m)`, not `Value1 + ceil(4*C*m)`. |
| `ExecuteCardCommandImpl` at `0x80a6520` prepares valid effect commands before executing costs and effects. | Freeze each main effect's condition before costs, play-trigger effects and the card's own effects. Preserve per-effect conditions across repeats. |
| `ConsumeCardCost` at `0x80a7a44–0x80a7a4c` selects stamina or buff cost processing by `CostType`. | Buff-cost cards do not charge stamina growth or spend stamina waivers. Rollback's apparent Genki difference was a spurious cost, not a missing Genki grant. |
| `ExamLoopTaskAsync` calls `ClearTurnState` at `0x80b8260`, `UnsetFullPower` at `0x80b82b4`, and consumes the next ten-point gauge at `0x80b8310`. | Resolve FullPower at the next turn start. It survives multiple cards in the same turn, allowing capture 18/session 7/turn 4 Trend Leader's 2,784 points. |

Natural Charm's excess card score was 932 (capture 16), 1,215 (17), and 662
(18). Its stamina-dependent score already matched. The completed-use counts
were 11, 10, and 14, producing base values 156, 142, and 198.

## Missing customization evidence

The captures have some customization counts in boundary Hand/Hold snapshots,
but omit them from several cards drawn and played within a turn. Unknown is
not evidence of an uncustomized card. The simulator itself contains no
capture-specific card overrides.

An explicit CLI supplement is available for the user's confirmed customs:

```sh
node tools/compare_contest_capture.mjs capture.json comparison.json catalog.json \
  --observed-customs-provisional \
  --customization-overrides tools/fixtures/contest_customizations_16_19.json
```

The supplement checks the exact capture SHA-256 and master customization
levels, fills only unknown customization on a unique card identity, rejects
conflicts with recorded data, and records its provenance and applied card IDs
in the output. It never marks an external supplement as a verified native
initial capture. It supplies missing Spotlight, Shining to You, I'll Become
an Idol, and Influencer customs; known recorded copies must agree.

## Validation

With observed-hand recovery and the explicit supplement, all 36 sessions and
380 turns complete; all final scores and compared card/turn score, stamina
and Genki values match. A separate audit of 17 native state scalars at the
before/after boundaries of 741 normal card uses checks 25,194 values without
a difference. The 749 native per-card metrics include eight forced uses.
The CLI still reports `partial-match` because decision search, initial-state
capture completeness and game-version master parity are not fully verified.

`tests/test_native_contest_remaining_effects.mjs` covers completed-use
counting, fractional concentration rounding, cost-type waiver selection,
pre-cost/own-effect conditions, multiple FullPower cards, and supplement
identity/conflict/level rejection. Existing lifecycle and mixed-cost tests
are updated to follow these ELF boundaries.
