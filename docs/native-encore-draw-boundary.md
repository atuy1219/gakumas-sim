# Encore and draw boundary corrections

Captures (16)–(19), Build ID `77fda4e2a21f23954e2349b83fc113ede408f70b`,
were replayed from PR #93 commit `d552cfa20fa62e6c80bd2b72c6919178a320c779`.
With these corrections, all 36 sessions / 380 turns finish without a draw
mismatch. Contest #3 has no compared stamina differences in any capture.
Final scores match in 22/36 sessions; 19/36 have no differences in the
compared fields. Other score/status discrepancies remain.

## Runtime changes and evidence

- `StaminaReduceFixEffectExecutor` calls `ReduceStaminaFix` at `0x80355fc`.
  The subtraction at `0x8035698` bypasses ordinary cost multipliers and Block.
  Capture (16), contest #3, T3 previously reduced 34 → 33 instead of 34 → 32.
- Card-installed interval enchants retain their installation turn, including
  JSON checkpoints. `GetTurnIntervalEffectList.b__0` at `0x807ff14` passes
  `TriggerEffectStatusEffect.TurnCount` (+0x88) to `IsTurnIntervalTrigger`
  (`0x803fc34`); it must not use the global exam turn. Existing setup P-item
  scheduling is retained, including all four previously matching contest #4
  recordings.
- Interval replay and timer commands execute after the ordinary draw.
  Reserved draws execute individually instead of becoming the next turn's
  `pendingDraw`. A replay's draw adds a fourth card rather than using a slot
  in the ordinary three-card quota.
- `GetEffectWarning` checks Hand count against HandLimit for Hand moves
  (`0x803166c`–`0x803173c`). Warning 9 is rejected by `IsUsableWarningType`
  (`0x6938fa0`) before the executor runs. Low-level `MoveCard` overflow
  handling still applies when an initially non-full Hand receives a batch.
  This fixes contest #5: (16)T8 reaches five cards before its reserved move,
  leaving また、飛べる+ in Lost until the later T11 reservation.
- CardMove command preparation (`0x80dbc18`) and execution (`0x804bce4`)
  each evaluate Random search order. Preparation does not consume a ranged
  pick-count roll or perform selection. Movement groups cards by source,
  preserving first appearance within the stable groups, with Playing first.
  Eight native movement/RNG endpoint goldens cover 2–5 candidates and the
  interleaved Grave/Deck/Grave case in (17), contest #1.
- Independent replay honors the recorded Skip (command 12) versus EndTurn
  decision. An unused simulator play must not invent a skip and heal HP.
  Explicit `finishTowerTurn(..., {type: "end"})` does not grant skip recovery.

## Contest #3 validation

| Capture | Native Encore turns | Completion | Stamina differences | Native score | Simulated score |
|---|---|---|---:|---:|---:|
| (16) | 7, 9 | 10/10 turns | 0 | 63,752 | 61,181 |
| (17) | none | 10/10 turns | 0 | 66,067 | 65,850 |
| (18) | 3, 5 | 10/10 turns | 0 | 99,918 | 97,707 |
| (19) | 3, 9 | 10/10 turns | 0 | 75,131 | 74,951 |

39 JavaScript test files and 36 Python tests pass. The new
`tests/test_encore_draw_boundary.mjs` checks a Turn-1/Turn-2 installation,
31/39 versus 32/39 HP, failed-condition count preservation, two replay uses,
current/legacy checkpoint resume, reserved draws, full-Hand rejection,
fixed HP reduction and eight captured movement/RNG endpoints. CI includes it.

Replay used pinned provisional YAML masters from
`vertesan/gakumasu-diff@1f07db111068a65defc13bd44e3e8957ca4baca4`
and `--observed-customs-provisional`; master identity with the captured game
build and initialization-time customization identity remain unverified.
Native choices are replay inputs; native intermediate/final scores and hands
are not forced into the simulator.
