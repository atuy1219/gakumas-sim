# IL2CPP効果Executor：161種類の分離・実装状況

対象 ELF: `gakumas_analysis(1).elf` / Build ID `77fda4e2a21f23954e2349b83fc113ede408f70b`。

## 結果（クラス分離と効果実装を区別）

| 指標 | 件数 |
| --- | ---: |
| 実機で確認できた具体的な `*EffectExecutor` | **161** |
| JavaScriptで独立クラスとして定義した数 | **161** |
| Master Effectからクラス単位に移した分岐数 | **80** |
| Parsed Effectからクラス単位に移した分岐数 | **41**（うち2つはnone/masterの非Nativeアダプタ） |
| JSで既存挙動を移せた**重複除外の実機クラス名** | **113** |
| JSに計算実装がなく、未対応扱いにした実機クラス名 | **48** |

**重要:** 161クラスすべての**効果計算が完成したわけではありません**。
今回の変更は主に構造的リファクタリングです。元のMaster switchの処理本体をそのまま
`ExecuteEffect` に移す方式を採用し、丸め・乱数消費・状態更新・発動フェーズを改変していません。

JSの未実装48クラスは旧実装と同様に「未対応効果」を記録します。161種類の登録数と、実行ロジックの実装数を区別してください。
Pythonの重複エンジンはJSへの検証統合に伴い廃止しました。

## 参照先

- `web/tower_runtime.js` : 161個の独立クラス、Master型→Executor対応表。公開 `NATIVE_EFFECT_EXECUTOR_CLASSES`。
- `web/exam_effects.js` : Parsed Effect側の独立 `ExecuteEffect` と `PARSED_EXAM_EFFECT_EXECUTOR_CLASSES`。
- `web/native_effect_executor_registry.js` : IL2CPPから抽出した161クラス名とマスターIDの名称対応。
- `tests/test_all_native_executors.mjs` : 161クラスの一意性、80+41分岐、113対応名を検証。
- `tests/test_official_contest_dfs.mjs` : JSへ移した公式DFS方針の回帰検証。

## 全クラス一覧

| 実機クラス名 | Master Effect側 | Parsed Effect側 |
| --- | --- | --- |
| `AddGrowEffectExecutor` | 未実装 | `add_grow_effect` |
| `AggressiveAdditiveEffectExecutor` | `ExamAggressiveAdditive` | 未実装 |
| `AggressiveAdditiveFixEffectExecutor` | `ExamAggressiveAdditiveFix` | 未実装 |
| `AggressiveDependReviewEffectExecutor` | 未実装 | 未実装 |
| `AggressiveEffectExecutor` | 未実装 | `aggressive` |
| `AggressivePerSearchCountEffectExecutor` | 未実装 | 未実装 |
| `AggressiveReduceCancellableEffectExecutor` | 未実装 | 未実装 |
| `AggressiveReduceEffectExecutor` | `ExamAggressiveReduce` | 未実装 |
| `AggressiveValueMultipleEffectExecutor` | `ExamAggressiveValueMultiple` | 未実装 |
| `AntiDebuffEffectExecutor` | `ExamAntiDebuff` | 未実装 |
| `BlockAddDownEffectExecutor` | `ExamBlockAddDown` | 未実装 |
| `BlockAddDownRestrictionEffectExecutor` | 未実装 | 未実装 |
| `BlockAddMultipleAggressiveEffectExecutor` | `ExamBlockAddMultipleAggressive` | 未実装 |
| `BlockDependBlockConsumptionSumEffectExecutor` | `ExamBlockDependBlockConsumptionSum` | 未実装 |
| `BlockDependReviewEffectExecutor` | `ExamBlockDependExamReview` | 未実装 |
| `BlockDownEffectExecutor` | `ExamBlockDown` | 未実装 |
| `BlockEffectExecutor` | 未実装 | `block` |
| `BlockFixEffectExecutor` | `ExamBlockFix` | 未実装 |
| `BlockPerSearchCountEffectExecutor` | 未実装 | 未実装 |
| `BlockPerUserCardCountEffectExecutor` | `ExamBlockPerUseCardCount` | 未実装 |
| `BlockRestrictionEffectExecutor` | `ExamBlockRestriction` | 未実装 |
| `BlockValueMultiplicationEffectExecutor` | `ExamBlockValueMultiple` | 未実装 |
| `BuffConsumptionAddEffectExecutor` | `ExamBuffConsumptionAdd` | 未実装 |
| `BuffConsumptionDownEffectExecutor` | 未実装 | 未実装 |
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
| `FullPowerPointAdditiveFixEffectExecutor` | 未実装 | 未実装 |
| `FullPowerPointDependFullPowerPointGetSumEffectExecutor` | 未実装 | 未実装 |
| `FullPowerPointEffectExecutor` | `ExamFullPowerPoint` | 未実装 |
| `FullPowerPointPerSearchCountEffectExecutor` | 未実装 | 未実装 |
| `FullPowerPointReduceCancellableEffectExecutor` | 未実装 | 未実装 |
| `FullPowerPointReduceEffectExecutor` | `ExamFullPowerPointReduce` | 未実装 |
| `GetCardUpgradeEffectExecutor` | 未実装 | 未実装 |
| `GimmickEnthusiasticEffectExecutor` | 未実装 | 未実装 |
| `GimmickLessonDebuffEffectExecutor` | `ExamGimmickLessonDebuff` | 未実装 |
| `GimmickParameterDebuffEffectExecutor` | `ExamGimmickParameterDebuff` | 未実装 |
| `GimmickPlayCardLimitEffectExecutor` | `ExamGimmickPlayCardLimit` | 未実装 |
| `GimmickSleepyEffectExecutor` | `ExamGimmickSleepy` | 未実装 |
| `GimmickSlumpEffectExecutor` | `ExamGimmickSlump` | 未実装 |
| `GimmickStartTurnCardDrawDownEffectExecutor` | `ExamGimmickStartTurnCardDrawDown` | 未実装 |
| `GrowEffectLessonAddAdditiveEffectExecutor` | 未実装 | 未実装 |
| `HandGraveCountCardDrawEffectExecutor` | 未実装 | `hand_grave_count_card_draw` |
| `HandHoldEffectExecutor` | 未実装 | 未実装 |
| `ItemFireLimitAddEffectExecutor` | `ExamItemFireLimitAdd` | 未実装 |
| `LessonAddBlockEffectExecutor` | 未実装 | 未実装 |
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
| `LessonDependAggressiveAndSearchCountEffectExecutor` | 未実装 | 未実装 |
| `LessonDependBlockAndSearchCountEffectExecutor` | `ExamLessonDependBlockAndSearchCount` | 未実装 |
| `LessonDependBlockConsumptionSumEffectExecutor` | `ExamLessonDependBlockConsumptionSum` | 未実装 |
| `LessonDependBlockEffectExecutor` | `ExamLessonDependBlock` | 未実装 |
| `LessonDependEnthusiasticGetSumEffectExecutor` | 未実装 | 未実装 |
| `LessonDependExamAggressiveEffectExecutor` | 未実装 | `lesson_depend_exam_aggressive` |
| `LessonDependExamReviewEffectExecutor` | 未実装 | `lesson_depend_exam_review` |
| `LessonDependParameterBuffEffectExecutor` | `ExamLessonDependParameterBuff` | `lesson_depend_parameter_buff` |
| `LessonDependPlayCardCountSumEffectExecutor` | `ExamLessonDependPlayCardCountSum` | 未実装 |
| `LessonDependReviewAndSearchCountEffectExecutor` | 未実装 | 未実装 |
| `LessonDependReviewOrAggressiveEffectExecutor` | 未実装 | `lesson_value_multiple_depend_review_or_aggressive` |
| `LessonDependStaminaConsumptionSumEffectExecutor` | `ExamLessonDependStaminaConsumptionSum` | 未実装 |
| `LessonDependStaminaEffectExecutor` | `ExamLessonDependStamina` | 未実装 |
| `LessonEffectExecutor` | 未実装 | `lesson` |
| `LessonFixEffectExecutor` | `ExamLessonFix` | 未実装 |
| `LessonFullPowerPointEffectExecutor` | `ExamLessonFullPowerPoint` | 未実装 |
| `LessonMultipleConcentrationEffectExecutor` | 未実装 | 未実装 |
| `LessonMultipleEnthusiasticEffectExecutor` | `ExamMultipleEnthusiasticLesson` | 未実装 |
| `LessonMultipleFullPowerEffectExecutor` | 未実装 | 未実装 |
| `LessonValueMultipleDownEffectExecutor` | `ExamLessonValueMultipleDown` | `lesson_value_multiple_down` |
| `LessonValueMultipleEffectExecutor` | 未実装 | `lesson_value_multiple` |
| `MoveGrowEffectEffectExecutor` | 未実装 | 未実装 |
| `MultipleLessonBuffLessonEffectExecutor` | 未実装 | `lesson_multiple_lesson_buff` |
| `OverPreservationEffectExecutor` | `ExamOverPreservation` | 未実装 |
| `PanicEffectExecutor` | `ExamPanic` | 未実装 |
| `ParameterBuffAdditiveEffectExecutor` | `ExamParameterBuffAdditive` | 未実装 |
| `ParameterBuffAdditiveFixEffectExecutor` | 未実装 | 未実装 |
| `ParameterBuffDependLessonBuffEffectExecutor` | `ExamParameterBuffDependLessonBuff` | 未実装 |
| `ParameterBuffEffectExecutor` | 未実装 | `parameter_buff` |
| `ParameterBuffMultiplePerTurnEffectExecutor` | 未実装 | `parameter_buff_multiple_per_turn` |
| `ParameterBuffMultiplePerTurnReduceEffectExecutor` | `ExamParameterBuffMultiplePerTurnReduce` | 未実装 |
| `ParameterBuffPerSearchCountEffectExecutor` | 未実装 | 未実装 |
| `ParameterBuffReduceCancellableEffectExecutor` | 未実装 | 未実装 |
| `ParameterBuffReduceEffectExecutor` | 未実装 | `parameter_buff_reduce` |
| `ParameterBuffTurnEndReduceLockEffectExecutor` | 未実装 | `parameter_buff_turn_end_reduce_lock` |
| `PlayableValueAddEffectExecutor` | 未実装 | `playable_add` |
| `PreservationEffectExecutor` | 未実装 | `preservation` |
| `ReviewAdditiveEffectExecutor` | `ExamReviewAdditive` | 未実装 |
| `ReviewAdditiveFixEffectExecutor` | 未実装 | 未実装 |
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
| `StaminaConsumptionAddDownEffectExecutor` | 未実装 | 未実装 |
| `StaminaConsumptionAddEffectExecutor` | 未実装 | `stamina_consumption_add` |
| `StaminaConsumptionAddFixEffectExecutor` | 未実装 | `stamina_consumption_add_fix` |
| `StaminaConsumptionDownAddEffectExecutor` | 未実装 | 未実装 |
| `StaminaConsumptionDownEffectExecutor` | 未実装 | `stamina_consumption_down` |
| `StaminaConsumptionDownFixEffectExecutor` | 未実装 | `stamina_consumption_down_fix` |
| `StaminaDamageEffectExecutor` | `ExamStaminaDamage` | 未実装 |
| `StaminaRecoverAddEffectExecutor` | 未実装 | 未実装 |
| `StaminaRecoverFixEffectExecutor` | 未実装 | `stamina_recover` |
| `StaminaRecoverMultipleEffectExecutor` | `ExamStaminaRecoverMultiple` | 未実装 |
| `StaminaRecoverRestrictionEffectExecutor` | `ExamStaminaRecoverRestriction` | 未実装 |
| `StaminaReduceChangeEffectExecutor` | 未実装 | 未実装 |
| `StaminaReduceEffectExecutor` | `ExamStaminaReduce` | 未実装 |
| `StaminaReduceFixEffectExecutor` | `ExamStaminaReduceFix` | 未実装 |
| `StanceLockConcentrationEffectExecutor` | 未実装 | 未実装 |
| `StanceLockEffectExecutor` | `StanceLock` | 未実装 |
| `StanceLockFullPowerEffectExecutor` | 未実装 | 未実装 |
| `StanceLockPreservationEffectExecutor` | 未実装 | 未実装 |
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
