# IL2CPP効果Executor：161種類の分離・実装状況

対象 ELF: `gakumas_analysis(1).elf` / Build ID `77fda4e2a21f23954e2349b83fc113ede408f70b`。

## 結果（クラス分離と効果実装を区別）

| 指標 | 件数 |
| --- | ---: |
| 実機で確認できた具体的な `*EffectExecutor` | **161** |
| JavaScriptで独立クラスとして定義した数 | **161** |
| Master Effectからクラス単位に移した分岐数 | **107** |
| Parsed Effectからクラス単位に移した分岐数 | **41**（うち2つはnone/masterの非Nativeアダプタ） |
| JSで効果計算が接続された**重複除外の実機クラス名** | **140** |
| JSに計算実装がなく、未対応扱いにした実機クラス名 | **21** |

**重要:** 161クラスすべての**効果計算が完成したわけではありません**。
今回の変更は主に構造的リファクタリングです。元のMaster switchの処理本体をそのまま
`ExecuteEffect` に移す方式を採用し、丸め・乱数消費・状態更新・発動フェーズを改変していません。

JSの未実装21クラスは旧実装と同様に「未対応効果」を記録します。161種類の登録数と、実行ロジックの実装数を区別してください。
Pythonの重複エンジンはJSへの検証統合に伴い廃止しました。

## 参照先

- `web/tower_runtime.js` : 161個の独立クラス、Master型→Executor対応表。公開 `NATIVE_EFFECT_EXECUTOR_CLASSES`。
- `web/exam_effects.js` : Parsed Effect側の独立 `ExecuteEffect` と `PARSED_EXAM_EFFECT_EXECUTOR_CLASSES`。
- `web/native_effect_executor_registry.js` : IL2CPPから抽出した161クラス名とマスターIDの名称対応。
- `tests/test_all_native_executors.mjs` : 161クラスの一意性、80+41分岐、113対応名を検証。
- `tests/test_contest_dfs.mjs` : JSへ移したコンテストDFS方針の回帰検証。

## ELFによる追加実装（2026-10-14）

- `LessonMultipleConcentrationEffectExecutor`（0x805b180）：`Value1` / `Value2` / `Count` を読み、`FloatFromPermil(Value2) + 1` を追加倍率として一度だけ `CalculateAddingParameter`、`AddParameter` を `Count` 回呼び出す。
- `LessonMultipleFullPowerEffectExecutor`（0x805b658）：同じ処理だが補正対象は `fullPowerMultiple` となる。双方とも既存の `applyNativeModifiedLessonRepeat` を再利用。
- 48→46個の未対応削減を確認。ただしELFで関数シンボルが見つかったことだけで他46種類を推測実装しない。
- テスト：`tests/test_elf_lesson_multiplier_executors.mjs`、`tests/test_all_native_executors.mjs`。
- 注意：この2効果を含む新しい実機キャプチャの比較は未実施。分岐表への追加とELFの機械語呼出し順の整合を確認した段階。

## ELFによる計算系の追加実装（2026-10-14）

- ELF Build ID `77fda4e2a21f23954e2349b83fc113ede408f70b`。
- `AggressiveDependReview`, `AggressivePerSearchCount`, `BlockPerSearchCount`: 状態参照、検索枚数、`FloatFromPermil`、float32の切り上げ順を追跡。
- `FullPowerPointDependFullPowerPointGetSum`, `FullPowerPointPerSearchCount`: 全力値増加と累積カウンタ更新の順序を追跡。
- `LessonDependAggressiveAndSearchCount`, `LessonDependReviewAndSearchCount`: 先にfloat32で1ヒットの基礎値を計算し、`Count` 回 `CalculateAddingParameter → AddParameter`。
- `LessonAddBlock`: パラメータ付与の後、計算値が1以上なら `CalculateAddBlock → AddBlockFix`。
- 上記8種類はELFの直接呼出しとテストベクトルに基づく。未実装は38種類。未収集の実機カードでの完全一致は未検証。

### 指針ロック（ELF確認追加）

- 強気・全力・温存への移行禁止状態は、ELFの `TryAddStanceLock*Effect` が既存のターン数に `Value1` を加算する処理であることを確認。JavaScriptの状態モデルと既存ターン消費へ接続。
- テスト：`tests/test_elf_stance_locks.mjs`。

### 有効期限付き状態（ELF確認追加）

- `BuffConsumptionDown`, `StaminaConsumptionAddDown`, `StaminaConsumptionDownAdd`: いずれもELFで `TryAdd*Status(Value1=持続ターン)` を確認。既存の `genericTimedStatuses` に同種の期限を加算し、ターン境界で失効させる。
- `GimmickEnthusiastic`: `TryAddEnthusiasticStatus(Value1, Value2)` を確認し、既存の `scalarTimedStatuses` に接続。
- 単体テスト：`tests/test_elf_timed_status_executors.mjs`。

### 固定加算ステータスの追加（2026-10-14）
ELFの3クラス（ReviewAdditiveFix @ 0x805f874 / ParameterBuffAdditiveFix @ 0x805d7b8 / FullPowerPointAdditiveFix @ 0x8051df0）は、各 `TryAdd*Status(Value1,Value2)` 呼出しを確認。従来未接続だった固定値を状態の期限付きリストと加算計算に接続。テスト：`tests/test_elf_fixed_additive_executors.mjs`。今回の未収録効果について実機完全一致は未検証。

### 検索枚数依存好調（ELF確認追加）
`ParameterBuffPerSearchCountEffectExecutor @ 0x805e688` は、Value2のpermil変換後に検索候補数を掛けて上方丸めし、Value1を加え、`TryAddParameterBuffStatus` に渡す。ゼロ枚の場合もValue1を保持する。テスト：`tests/test_elf_parameter_buff_per_search.mjs`。

### 累積熱意参照のスコア（ELF確認追加）
`LessonDependEnthusiasticGetSumEffectExecutor @ 0x8058d88` は、`ExamParameterModel.EnthusiasticGetSumCount`（0x3d0）を使って `Value1 + ceil(FloatFromPermil(Value2) × 累積獲得熱意)` を求め、`Count` 回の`CalculateAddingParameter / AddParameter`を繰り返す。熱意の有効期限と累積獲得量を分離し、`tests/test_elf_enthusiastic_gain_sum.mjs`で境界値を検証した。

### 体力減少変更（ELF確認追加）
`StaminaReduceChangeEffectExecutor @ 0x8064178` は `Value1` と `Turn` を `TryAddStaminaReduceChangeStatus` に渡す。JSの期限付き状態と既存の `calculateNativeStaminaDamage` に接続。テスト：`tests/test_elf_stamina_reduce_change.mjs`。

### 元気増加量減少の禁止と恒久体力回復加算（2026-10-14）

- `BlockAddDownRestrictionEffectExecutor @ 0x8047e84` は `TryAddBlockAddDownRestrictionStatus(Value1)` を実行する。既存の `BlockAddDownEffectExecutor` を制御し、状態が期限切れになれば通常の元気低下を再度許可する。
- `StaminaRecoverAddEffectExecutor @ 0x8063a08` は `TryAddStaminaRecoverAddStatus(Value1,-1)` を実行する。無期限加算状態として保持し、固定回復・最大体力割合回復・スキップ回復で適用する。
- 専用回帰テスト：`tests/test_elf_native_status_protections.mjs`。
- これらの効果を使う独立実機トレースの一致は未検証。残りの未対応23種類は推測実装しない。

### 手札保持（ELF確認追加）

`HandHoldEffectExecutor @0x8054E9C` は `TryAddHandHoldStatus(1)` を実行する。`ExamCardMoveController.ResetHand @0x827E4DC` は `IsHandHold(1)` がtrueなら即returnし、Hand→Grave/Lostへの移動を行わない。JSの `finishTowerTurn` に同じ分岐を設け、保持カードはHoldではなくHandへ残す。状態の期限は1ターン。テスト：`tests/test_elf_hand_hold.mjs`。

### 新規カード取得時の強化（ELF確認追加）

`GetCardUpgradeEffectExecutor @0x805320C` は `TryAddGetCardUpgradeStatus(Value1)` を呼び出す。実機の `ExamCardMoveController.AddCard @0x8276818 / @0x827A084` は `IsGetCardUpgrade(1)` を検査し、適用時に取得カードを強化する。JSでは生成後初回 `addRuntimeCardAt` でのみ既存 `applyTemporarySkillUpgradeInPlace` を適用し、既存カードの移動は強化しない。テスト：`tests/test_elf_get_card_upgrade.mjs`。

## 全クラス一覧

| 実機クラス名 | Master Effect側 | Parsed Effect側 |
| --- | --- | --- |
| `AddGrowEffectExecutor` | 未実装 | `add_grow_effect` |
| `AggressiveAdditiveEffectExecutor` | `ExamAggressiveAdditive` | 未実装 |
| `AggressiveAdditiveFixEffectExecutor` | `ExamAggressiveAdditiveFix` | 未実装 |
| `AggressiveDependReviewEffectExecutor` | `ExamAggressiveDependReview` | 未実装 |
| `AggressiveEffectExecutor` | 未実装 | `aggressive` |
| `AggressivePerSearchCountEffectExecutor` | `ExamAggressivePerSearchCount` | 未実装 |
| `AggressiveReduceCancellableEffectExecutor` | 未実装 | 未実装 |
| `AggressiveReduceEffectExecutor` | `ExamAggressiveReduce` | 未実装 |
| `AggressiveValueMultipleEffectExecutor` | `ExamAggressiveValueMultiple` | 未実装 |
| `AntiDebuffEffectExecutor` | `ExamAntiDebuff` | 未実装 |
| `BlockAddDownEffectExecutor` | `ExamBlockAddDown` | 未実装 |
| `BlockAddDownRestrictionEffectExecutor` | `ExamBlockAddDownRestriction` | 未実装 |
| `BlockAddMultipleAggressiveEffectExecutor` | `ExamBlockAddMultipleAggressive` | 未実装 |
| `BlockDependBlockConsumptionSumEffectExecutor` | `ExamBlockDependBlockConsumptionSum` | 未実装 |
| `BlockDependReviewEffectExecutor` | `ExamBlockDependExamReview` | 未実装 |
| `BlockDownEffectExecutor` | `ExamBlockDown` | 未実装 |
| `BlockEffectExecutor` | 未実装 | `block` |
| `BlockFixEffectExecutor` | `ExamBlockFix` | 未実装 |
| `BlockPerSearchCountEffectExecutor` | `ExamBlockPerSearchCount` | 未実装 |
| `BlockPerUserCardCountEffectExecutor` | `ExamBlockPerUseCardCount` | 未実装 |
| `BlockRestrictionEffectExecutor` | `ExamBlockRestriction` | 未実装 |
| `BlockValueMultiplicationEffectExecutor` | `ExamBlockValueMultiple` | 未実装 |
| `BuffConsumptionAddEffectExecutor` | `ExamBuffConsumptionAdd` | 未実装 |
| `BuffConsumptionDownEffectExecutor` | `ExamBuffConsumptionDown` | 未実装 |
| `CardCreateIdEffectExecutor` | 未実装 | `card_create_id` |
| `CardCreateSearchEffectExecutor` | `ExamCardCreateSearch` | 未実装 |
| `CardDuplicateEffectExecutor` | `ExamCardDuplicate` | 未実装 |
| `CardMoveEffectExecutor` | `ExamCardMove` | `card_move_search` |
| `CardShuffleDeckGraveEffectExecutor` | 未実装 | 未実装 |
| `CardShuffleDeckLostEffectExecutor` | 未実装 | 未実装 |
| `ChainEffectExecutor` | 未実装 | 未実装 |
| `ChainEffectPerPassedTurnEffectExecutor` | 未実装 | 未実装 |
| `ChainEffectPerRemainTurnEffectExecutor` | 未実装 | 未実装 |
| `ClearDebuffEffectExecutor` | 未実装 | 未実装 |
| `ConcentrationEffectExecutor` | 未実装 | `concentration` |
| `ConcentrationLessonMultipleAdditiveEffectExecutor` | `ExamConcentrationLessonMultipleAdditive` | 未実装 |
| `DebuffRecoverEffectExecutor` | `ExamDebuffRecover` | 未実装 |
| `DrawEffectExecutor` | 未実装 | `card_draw` |
| `EffectPerSearchCountEffectExecutor` | `ExamEffectPerSearchCount` | 未実装 |
| `EffectTimerEffectExecutor` | `ExamEffectTimer` | `effect_timer` |
| `EffectTimerEndTurnEffectExecutor` | 未実装 | 未実装 |
| `EnthusiasticAdditiveEffectExecutor` | `ExamEnthusiasticAdditive` | 未実装 |
| `EnthusiasticMultipleEffectExecutor` | `ExamEnthusiasticMultiple` | 未実装 |
| `EnthusiasticTurnAdditiveEffectExecutor` | `ExamEnthusiasticTurnAdditive` | 未実装 |
| `ExamLessonAddMultipleLessonBuffEffectExecutor` | `ExamLessonAddMultipleLessonBuff` | 未実装 |
| `LessonPerSearchCountEffectExecutor` | `ExamLessonPerSearchCount` | 未実装 |
| `ExamPlayCardLimitPlayableValueAddEffectExecutor` | 未実装 | 未実装 |
| `ExtraTurnEffectExecutor` | 未実装 | `extra_turn` |
| `ForcePlayCardSearchWithCostEffectExecutor` | `ExamForcePlayCardSearchWithCost` | 未実装 |
| `ForcePlaySearchEffectExecutor` | `ExamForcePlayCardSearch` | 未実装 |
| `FullPowerEffectExecutor` | `ExamFullPower` | 未実装 |
| `FullPowerLessonMultipleAdditiveEffectExecutor` | `ExamFullPowerLessonMultipleAdditive` | 未実装 |
| `FullPowerPointAdditiveEffectExecutor` | `ExamFullPowerPointAdditive` | 未実装 |
| `FullPowerPointAdditiveFixEffectExecutor` | `ExamFullPowerPointAdditiveFix` | 未実装 |
| `FullPowerPointDependFullPowerPointGetSumEffectExecutor` | `ExamFullPowerPointDependFullPowerPointGetSum` | 未実装 |
| `FullPowerPointEffectExecutor` | `ExamFullPowerPoint` | 未実装 |
| `FullPowerPointPerSearchCountEffectExecutor` | `ExamFullPowerPointPerSearchCount` | 未実装 |
| `FullPowerPointReduceCancellableEffectExecutor` | 未実装 | 未実装 |
| `FullPowerPointReduceEffectExecutor` | `ExamFullPowerPointReduce` | 未実装 |
| `GetCardUpgradeEffectExecutor` | `ExamGetCardUpgrade` | 未実装 |
| `GimmickEnthusiasticEffectExecutor` | `ExamGimmickEnthusiastic` | 未実装 |
| `GimmickLessonDebuffEffectExecutor` | `ExamGimmickLessonDebuff` | 未実装 |
| `GimmickParameterDebuffEffectExecutor` | `ExamGimmickParameterDebuff` | 未実装 |
| `GimmickPlayCardLimitEffectExecutor` | `ExamGimmickPlayCardLimit` | 未実装 |
| `GimmickSleepyEffectExecutor` | `ExamGimmickSleepy` | 未実装 |
| `GimmickSlumpEffectExecutor` | `ExamGimmickSlump` | 未実装 |
| `GimmickStartTurnCardDrawDownEffectExecutor` | `ExamGimmickStartTurnCardDrawDown` | 未実装 |
| `GrowEffectLessonAddAdditiveEffectExecutor` | 未実装 | 未実装 |
| `HandGraveCountCardDrawEffectExecutor` | 未実装 | `hand_grave_count_card_draw` |
| `HandHoldEffectExecutor` | `ExamHandHold` | 未実装 |
| `ItemFireLimitAddEffectExecutor` | `ExamItemFireLimitAdd` | 未実装 |
| `LessonAddBlockEffectExecutor` | `ExamLessonAddBlock` | 未実装 |
| `LessonAddMultipleParameterBuffEffectExecutor` | 未実装 | `lesson_add_multiple_parameter_buff` |
| `LessonBuffAdditiveEffectExecutor` | `ExamLessonBuffAdditive` | 未実装 |
| `LessonBuffAdditiveFixEffectExecutor` | `ExamLessonBuffAdditiveFix` | 未実装 |
| `LessonBuffDependParameterBuffEffectExecutor` | `ExamLessonBuffDependParameterBuff` | 未実装 |
| `LessonBuffEffectExecutor` | 未実装 | `lesson_buff` |
| `LessonBuffMultipleEffectExecutor` | 未実装 | `lesson_buff_multiple` |
| `LessonBuffPerSearchCountEffectExecutor` | `ExamLessonBuffPerSearchCount` | 未実装 |
| `LessonBuffReduceCancellableEffectExecutor` | 未実装 | 未実装 |
| `LessonBuffReduceEffectExecutor` | `ExamLessonBuffReduce` | 未実装 |
| `LessonChangeSpecifyLessThanEffectExecutor` | 未実装 | 未実装 |
| `LessonChangeSpecifyMoreThanEffectExecutor` | 未実装 | 未実装 |
| `LessonDependAggressiveAndSearchCountEffectExecutor` | `ExamLessonDependAggressiveAndSearchCount` | 未実装 |
| `LessonDependBlockAndSearchCountEffectExecutor` | `ExamLessonDependBlockAndSearchCount` | 未実装 |
| `LessonDependBlockConsumptionSumEffectExecutor` | `ExamLessonDependBlockConsumptionSum` | 未実装 |
| `LessonDependBlockEffectExecutor` | `ExamLessonDependBlock` | 未実装 |
| `LessonDependEnthusiasticGetSumEffectExecutor` | `ExamLessonDependEnthusiasticGetSum` | 未実装 |
| `LessonDependExamAggressiveEffectExecutor` | 未実装 | `lesson_depend_exam_aggressive` |
| `LessonDependExamReviewEffectExecutor` | 未実装 | `lesson_depend_exam_review` |
| `LessonDependParameterBuffEffectExecutor` | `ExamLessonDependParameterBuff` | `lesson_depend_parameter_buff` |
| `LessonDependPlayCardCountSumEffectExecutor` | `ExamLessonDependPlayCardCountSum` | 未実装 |
| `LessonDependReviewAndSearchCountEffectExecutor` | `ExamLessonDependReviewAndSearchCount` | 未実装 |
| `LessonDependReviewOrAggressiveEffectExecutor` | 未実装 | `lesson_value_multiple_depend_review_or_aggressive` |
| `LessonDependStaminaConsumptionSumEffectExecutor` | `ExamLessonDependStaminaConsumptionSum` | 未実装 |
| `LessonDependStaminaEffectExecutor` | `ExamLessonDependStamina` | 未実装 |
| `LessonEffectExecutor` | 未実装 | `lesson` |
| `LessonFixEffectExecutor` | `ExamLessonFix` | 未実装 |
| `LessonFullPowerPointEffectExecutor` | `ExamLessonFullPowerPoint` | 未実装 |
| `LessonMultipleConcentrationEffectExecutor` | `ExamMultipleConcentrationLesson` | 未実装 |
| `LessonMultipleEnthusiasticEffectExecutor` | `ExamMultipleEnthusiasticLesson` | 未実装 |
| `LessonMultipleFullPowerEffectExecutor` | `ExamMultipleFullPowerLesson` | 未実装 |
| `LessonValueMultipleDownEffectExecutor` | `ExamLessonValueMultipleDown` | `lesson_value_multiple_down` |
| `LessonValueMultipleEffectExecutor` | 未実装 | `lesson_value_multiple` |
| `MoveGrowEffectEffectExecutor` | 未実装 | 未実装 |
| `MultipleLessonBuffLessonEffectExecutor` | 未実装 | `lesson_multiple_lesson_buff` |
| `OverPreservationEffectExecutor` | `ExamOverPreservation` | 未実装 |
| `PanicEffectExecutor` | `ExamPanic` | 未実装 |
| `ParameterBuffAdditiveEffectExecutor` | `ExamParameterBuffAdditive` | 未実装 |
| `ParameterBuffAdditiveFixEffectExecutor` | `ExamParameterBuffAdditiveFix` | 未実装 |
| `ParameterBuffDependLessonBuffEffectExecutor` | `ExamParameterBuffDependLessonBuff` | 未実装 |
| `ParameterBuffEffectExecutor` | 未実装 | `parameter_buff` |
| `ParameterBuffMultiplePerTurnEffectExecutor` | 未実装 | `parameter_buff_multiple_per_turn` |
| `ParameterBuffMultiplePerTurnReduceEffectExecutor` | `ExamParameterBuffMultiplePerTurnReduce` | 未実装 |
| `ParameterBuffPerSearchCountEffectExecutor` | `ExamParameterBuffPerSearchCount` | 未実装 |
| `ParameterBuffReduceCancellableEffectExecutor` | 未実装 | 未実装 |
| `ParameterBuffReduceEffectExecutor` | 未実装 | `parameter_buff_reduce` |
| `ParameterBuffTurnEndReduceLockEffectExecutor` | 未実装 | `parameter_buff_turn_end_reduce_lock` |
| `PlayableValueAddEffectExecutor` | 未実装 | `playable_add` |
| `PreservationEffectExecutor` | 未実装 | `preservation` |
| `ReviewAdditiveEffectExecutor` | `ExamReviewAdditive` | 未実装 |
| `ReviewAdditiveFixEffectExecutor` | `ExamReviewAdditiveFix` | 未実装 |
| `ReviewCountAddEffectExecutor` | 未実装 | `review_count_add` |
| `ReviewDependAggressiveEffectExecutor` | `ExamReviewDependExamCardPlayAggressive` | 未実装 |
| `ReviewDependBlockEffectExecutor` | `ExamReviewDependExamBlock` | 未実装 |
| `ReviewDependReviewConsumptionSumEffectExecutor` | `ExamReviewDependReviewConsumptionSum` | 未実装 |
| `ReviewEffectExecutor` | 未実装 | `review` |
| `ReviewMultipleEffectExecutor` | 未実装 | `review_multiple` |
| `ReviewPerSearchCountEffectExecutor` | `ExamReviewPerSearchCount` | 未実装 |
| `ReviewReduceCancellableEffectExecutor` | 未実装 | 未実装 |
| `ReviewReduceEffectExecutor` | `ExamReviewReduce` | 未実装 |
| `ReviewTurnEndReduceLockEffectExecutor` | 未実装 | `review_turn_end_reduce_lock` |
| `ReviewValueMultipleEffectExecutor` | `ExamReviewValueMultiple` | 未実装 |
| `SearchEffectPlayCountBuffEffectExecutor` | 未実装 | `card_search_effect_play_count_buff` |
| `SearchPlayCardBuffConsumptionChangeEffectExecutor` | 未実装 | 未実装 |
| `SearchPlayCardStaminaConsumptionChangeEffectExecutor` | `ExamSearchPlayCardStaminaConsumptionChange` | 未実装 |
| `StaminaConsumptionAddDownEffectExecutor` | `ExamStaminaConsumptionAddDown` | 未実装 |
| `StaminaConsumptionAddEffectExecutor` | 未実装 | `stamina_consumption_add` |
| `StaminaConsumptionAddFixEffectExecutor` | 未実装 | `stamina_consumption_add_fix` |
| `StaminaConsumptionDownAddEffectExecutor` | `ExamStaminaConsumptionDownAdd` | 未実装 |
| `StaminaConsumptionDownEffectExecutor` | 未実装 | `stamina_consumption_down` |
| `StaminaConsumptionDownFixEffectExecutor` | 未実装 | `stamina_consumption_down_fix` |
| `StaminaDamageEffectExecutor` | `ExamStaminaDamage` | 未実装 |
| `StaminaRecoverAddEffectExecutor` | `ExamStaminaRecoverAdd` | 未実装 |
| `StaminaRecoverFixEffectExecutor` | 未実装 | `stamina_recover` |
| `StaminaRecoverMultipleEffectExecutor` | `ExamStaminaRecoverMultiple` | 未実装 |
| `StaminaRecoverRestrictionEffectExecutor` | `ExamStaminaRecoverRestriction` | 未実装 |
| `StaminaReduceChangeEffectExecutor` | `ExamStaminaReduceChange` | 未実装 |
| `StaminaReduceEffectExecutor` | `ExamStaminaReduce` | 未実装 |
| `StaminaReduceFixEffectExecutor` | `ExamStaminaReduceFix` | 未実装 |
| `StanceLockConcentrationEffectExecutor` | `ExamStanceLockConcentration` | 未実装 |
| `StanceLockEffectExecutor` | `StanceLock` | 未実装 |
| `StanceLockFullPowerEffectExecutor` | `ExamStanceLockFullPower` | 未実装 |
| `StanceLockPreservationEffectExecutor` | `ExamStanceLockPreservation` | 未実装 |
| `StanceResetEffectExecutor` | `ExamStanceReset` | 未実装 |
| `StatusEnchantCountAddEffectExecutor` | 未実装 | 未実装 |
| `StatusEnchantEffectExecutor` | `ExamStatusEnchant` | `status_enchant` |
| `StatusEnchantEncoreEffectExecutor` | `ExamStatusEnchantEncore` | 未実装 |
| `StatusEnchantTurnAddEffectExecutor` | 未実装 | 未実装 |
| `UpgradeEffectExecutor` | `ExamCardUpgrade` | `card_upgrade_hand_all` |
| `UpliftingEffectExecutor` | 未実装 | 未実装 |

## 変更していない部分

- `ExamSequence` / `ExamCommandStack` の順序とコマンド挿入ルール
- カード移動・コスト・トリガーの発動タイミング
- スコア計算と乱数列
- 保存JSONと従来のUIのフィールド契約

実機との差分を利用した処理順序の再実装は、名称移行フェーズが完了した後の独立PRで行います。
