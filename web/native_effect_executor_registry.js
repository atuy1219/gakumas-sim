// 161 concrete Campus.InGame.Exam.IExamEffectExecutor implementations confirmed
// in gakumas_analysis(1).elf (Build ID 77fda4e2a21f23954e2349b83fc113ede408f70b).
// This is a symbol catalog, NOT a reimplementation of native execution order.
// Only explicitly implemented ExecuteEffect handlers alter simulation state.
export const NATIVE_EFFECT_EXECUTOR_CLASS_NAMES = Object.freeze(`
AddGrowEffectExecutor AggressiveAdditiveEffectExecutor AggressiveAdditiveFixEffectExecutor AggressiveDependReviewEffectExecutor AggressiveEffectExecutor AggressivePerSearchCountEffectExecutor AggressiveReduceCancellableEffectExecutor AggressiveReduceEffectExecutor AggressiveValueMultipleEffectExecutor AntiDebuffEffectExecutor BlockAddDownEffectExecutor BlockAddDownRestrictionEffectExecutor BlockAddMultipleAggressiveEffectExecutor BlockDependBlockConsumptionSumEffectExecutor BlockDependReviewEffectExecutor BlockDownEffectExecutor BlockEffectExecutor BlockFixEffectExecutor BlockPerSearchCountEffectExecutor BlockPerUserCardCountEffectExecutor
BlockRestrictionEffectExecutor BlockValueMultiplicationEffectExecutor BuffConsumptionAddEffectExecutor BuffConsumptionDownEffectExecutor CardCreateIdEffectExecutor CardCreateSearchEffectExecutor CardDuplicateEffectExecutor CardMoveEffectExecutor CardShuffleDeckGraveEffectExecutor CardShuffleDeckLostEffectExecutor ChainEffectExecutor ChainEffectPerPassedTurnEffectExecutor ChainEffectPerRemainTurnEffectExecutor ClearDebuffEffectExecutor ConcentrationEffectExecutor ConcentrationLessonMultipleAdditiveEffectExecutor DebuffRecoverEffectExecutor DrawEffectExecutor EffectPerSearchCountEffectExecutor EffectTimerEffectExecutor
EffectTimerEndTurnEffectExecutor EnthusiasticAdditiveEffectExecutor EnthusiasticMultipleEffectExecutor EnthusiasticTurnAdditiveEffectExecutor ExamLessonAddMultipleLessonBuffEffectExecutor LessonPerSearchCountEffectExecutor ExamPlayCardLimitPlayableValueAddEffectExecutor ExtraTurnEffectExecutor ForcePlayCardSearchWithCostEffectExecutor ForcePlaySearchEffectExecutor FullPowerEffectExecutor FullPowerLessonMultipleAdditiveEffectExecutor FullPowerPointAdditiveEffectExecutor FullPowerPointAdditiveFixEffectExecutor FullPowerPointDependFullPowerPointGetSumEffectExecutor FullPowerPointEffectExecutor FullPowerPointPerSearchCountEffectExecutor FullPowerPointReduceCancellableEffectExecutor FullPowerPointReduceEffectExecutor GetCardUpgradeEffectExecutor
GimmickEnthusiasticEffectExecutor GimmickLessonDebuffEffectExecutor GimmickParameterDebuffEffectExecutor GimmickPlayCardLimitEffectExecutor GimmickSleepyEffectExecutor GimmickSlumpEffectExecutor GimmickStartTurnCardDrawDownEffectExecutor GrowEffectLessonAddAdditiveEffectExecutor HandGraveCountCardDrawEffectExecutor HandHoldEffectExecutor ItemFireLimitAddEffectExecutor LessonAddBlockEffectExecutor LessonAddMultipleParameterBuffEffectExecutor LessonBuffAdditiveEffectExecutor LessonBuffAdditiveFixEffectExecutor LessonBuffDependParameterBuffEffectExecutor LessonBuffEffectExecutor LessonBuffMultipleEffectExecutor LessonBuffPerSearchCountEffectExecutor LessonBuffReduceCancellableEffectExecutor
LessonBuffReduceEffectExecutor LessonChangeSpecifyLessThanEffectExecutor LessonChangeSpecifyMoreThanEffectExecutor LessonDependAggressiveAndSearchCountEffectExecutor LessonDependBlockAndSearchCountEffectExecutor LessonDependBlockConsumptionSumEffectExecutor LessonDependBlockEffectExecutor LessonDependEnthusiasticGetSumEffectExecutor LessonDependExamAggressiveEffectExecutor LessonDependExamReviewEffectExecutor LessonDependParameterBuffEffectExecutor LessonDependPlayCardCountSumEffectExecutor LessonDependReviewAndSearchCountEffectExecutor LessonDependReviewOrAggressiveEffectExecutor LessonDependStaminaConsumptionSumEffectExecutor LessonDependStaminaEffectExecutor LessonEffectExecutor LessonFixEffectExecutor LessonFullPowerPointEffectExecutor LessonMultipleConcentrationEffectExecutor
LessonMultipleEnthusiasticEffectExecutor LessonMultipleFullPowerEffectExecutor LessonValueMultipleDownEffectExecutor LessonValueMultipleEffectExecutor MoveGrowEffectEffectExecutor MultipleLessonBuffLessonEffectExecutor OverPreservationEffectExecutor PanicEffectExecutor ParameterBuffAdditiveEffectExecutor ParameterBuffAdditiveFixEffectExecutor ParameterBuffDependLessonBuffEffectExecutor ParameterBuffEffectExecutor ParameterBuffMultiplePerTurnEffectExecutor ParameterBuffMultiplePerTurnReduceEffectExecutor ParameterBuffPerSearchCountEffectExecutor ParameterBuffReduceCancellableEffectExecutor ParameterBuffReduceEffectExecutor ParameterBuffTurnEndReduceLockEffectExecutor PlayableValueAddEffectExecutor PreservationEffectExecutor
ReviewAdditiveEffectExecutor ReviewAdditiveFixEffectExecutor ReviewCountAddEffectExecutor ReviewDependAggressiveEffectExecutor ReviewDependBlockEffectExecutor ReviewDependReviewConsumptionSumEffectExecutor ReviewEffectExecutor ReviewMultipleEffectExecutor ReviewPerSearchCountEffectExecutor ReviewReduceCancellableEffectExecutor ReviewReduceEffectExecutor ReviewTurnEndReduceLockEffectExecutor ReviewValueMultipleEffectExecutor SearchEffectPlayCountBuffEffectExecutor SearchPlayCardBuffConsumptionChangeEffectExecutor SearchPlayCardStaminaConsumptionChangeEffectExecutor StaminaConsumptionAddDownEffectExecutor StaminaConsumptionAddEffectExecutor StaminaConsumptionAddFixEffectExecutor StaminaConsumptionDownAddEffectExecutor
StaminaConsumptionDownEffectExecutor StaminaConsumptionDownFixEffectExecutor StaminaDamageEffectExecutor StaminaRecoverAddEffectExecutor StaminaRecoverFixEffectExecutor StaminaRecoverMultipleEffectExecutor StaminaRecoverRestrictionEffectExecutor StaminaReduceChangeEffectExecutor StaminaReduceEffectExecutor StaminaReduceFixEffectExecutor StanceLockConcentrationEffectExecutor StanceLockEffectExecutor StanceLockFullPowerEffectExecutor StanceLockPreservationEffectExecutor StanceResetEffectExecutor StatusEnchantCountAddEffectExecutor StatusEnchantEffectExecutor StatusEnchantEncoreEffectExecutor StatusEnchantTurnAddEffectExecutor UpgradeEffectExecutor
UpliftingEffectExecutor
`.trim().split(/\s+/));

const knownClasses = new Set(NATIVE_EFFECT_EXECUTOR_CLASS_NAMES);
const masterOverrides = Object.freeze({
  "ExamCardDraw": "DrawEffectExecutor",
  "ExamBlockPerUseCardCount": "BlockPerUserCardCountEffectExecutor",
  "ExamReviewDependExamBlock": "ReviewDependBlockEffectExecutor",
  "ExamLessonPerSearchCount": "LessonPerSearchCountEffectExecutor",
  "ExamLessonAddMultipleLessonBuff": "ExamLessonAddMultipleLessonBuffEffectExecutor",
  "ExamLessonAddMultipleParameterBuff": "LessonAddMultipleParameterBuffEffectExecutor",
  "ExamLessonBuff": "LessonBuffEffectExecutor",
  "ExamCardPlayAggressive": "AggressiveEffectExecutor",
  "ExamParameterBuff": "ParameterBuffEffectExecutor",
  "ExamLesson": "LessonEffectExecutor",
  "ExamLessonFix": "LessonFixEffectExecutor",
  "ExamBlock": "BlockEffectExecutor",
  "ExamStaminaRecover": "StaminaRecoverFixEffectExecutor",
  "ExamStaminaRecoverFix": "StaminaRecoverFixEffectExecutor",
  "ExamCardPlayConcentration": "ConcentrationEffectExecutor",
  "ExamCardPlayPreservation": "PreservationEffectExecutor",
  "ExamCardShuffleDeckGrave": "CardShuffleDeckGraveEffectExecutor",
  "ExamCardShuffleDeckLost": "CardShuffleDeckLostEffectExecutor",
  "ExamStatusEnchant": "StatusEnchantEffectExecutor",
  "ExamStatusEnchantEncore": "StatusEnchantEncoreEffectExecutor",
  "ExamReview": "ReviewEffectExecutor",
  "ExamEffectTimer": "EffectTimerEffectExecutor",
  "ExamEffectTimerEndTurn": "EffectTimerEndTurnEffectExecutor",
  "ExamCardCreateId": "CardCreateIdEffectExecutor",
  "ExamCardCreateSearch": "CardCreateSearchEffectExecutor",
  "ExamCardMove": "CardMoveEffectExecutor",
  "ExamPlayableValueAdd": "PlayableValueAddEffectExecutor",
  "ExamFullPower": "FullPowerEffectExecutor"
});
export const PARSED_EFFECT_EXECUTOR_CLASS_NAMES = Object.freeze({
  "none": null,
  "lesson": "LessonEffectExecutor",
  "lesson_multiple_lesson_buff": "MultipleLessonBuffLessonEffectExecutor",
  "lesson_add_multiple_parameter_buff": "LessonAddMultipleParameterBuffEffectExecutor",
  "lesson_depend_parameter_buff": "LessonDependParameterBuffEffectExecutor",
  "lesson_depend_exam_review": "LessonDependExamReviewEffectExecutor",
  "lesson_depend_exam_aggressive": "LessonDependExamAggressiveEffectExecutor",
  "lesson_value_multiple": "LessonValueMultipleEffectExecutor",
  "lesson_value_multiple_down": "LessonValueMultipleDownEffectExecutor",
  "lesson_buff_multiple": "LessonBuffMultipleEffectExecutor",
  "review_multiple": "ReviewMultipleEffectExecutor",
  "review_count_add": "ReviewCountAddEffectExecutor",
  "lesson_value_multiple_depend_review_or_aggressive": "LessonDependReviewOrAggressiveEffectExecutor",
  "review_turn_end_reduce_lock": "ReviewTurnEndReduceLockEffectExecutor",
  "parameter_buff_turn_end_reduce_lock": "ParameterBuffTurnEndReduceLockEffectExecutor",
  "block": "BlockEffectExecutor",
  "review": "ReviewEffectExecutor",
  "aggressive": "AggressiveEffectExecutor",
  "lesson_buff": "LessonBuffEffectExecutor",
  "parameter_buff": "ParameterBuffEffectExecutor",
  "parameter_buff_reduce": "ParameterBuffReduceEffectExecutor",
  "concentration": "ConcentrationEffectExecutor",
  "preservation": "PreservationEffectExecutor",
  "stamina_recover": "StaminaRecoverFixEffectExecutor",
  "stamina_consumption_down": "StaminaConsumptionDownEffectExecutor",
  "stamina_consumption_add": "StaminaConsumptionAddEffectExecutor",
  "stamina_consumption_down_fix": "StaminaConsumptionDownFixEffectExecutor",
  "stamina_consumption_add_fix": "StaminaConsumptionAddFixEffectExecutor",
  "extra_turn": "ExtraTurnEffectExecutor",
  "card_draw": "DrawEffectExecutor",
  "card_create_id": "CardCreateIdEffectExecutor",
  "card_move_search": "CardMoveEffectExecutor",
  "add_grow_effect": "AddGrowEffectExecutor",
  "playable_add": "PlayableValueAddEffectExecutor",
  "effect_timer": "EffectTimerEffectExecutor",
  "card_search_effect_play_count_buff": "SearchEffectPlayCountBuffEffectExecutor",
  "hand_grave_count_card_draw": "HandGraveCountCardDrawEffectExecutor",
  "card_upgrade_hand_all": "UpgradeEffectExecutor",
  "parameter_buff_multiple_per_turn": "ParameterBuffMultiplePerTurnEffectExecutor",
  "status_enchant": "StatusEnchantEffectExecutor"
});

export function resolveNativeEffectExecutorClassName(effectType) {
  const type = String(effectType ?? "").replace(/^ProduceExamEffectType_/, "");
  if (Object.prototype.hasOwnProperty.call(PARSED_EFFECT_EXECUTOR_CLASS_NAMES, type))
    return PARSED_EFFECT_EXECUTOR_CLASS_NAMES[type];
  const candidate = masterOverrides[type] ?? `${type.replace(/^Exam/, "")}EffectExecutor`;
  return knownClasses.has(candidate) ? candidate : null;
}

export function assertNativeExecutorClassName(name) {
  if (!knownClasses.has(name)) throw new RangeError(`Unverified IL2CPP executor: ${name}`);
  return name;
}
