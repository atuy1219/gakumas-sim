import assert from "node:assert/strict";
import { XorShift32 } from "../web/engine.js";
import {
  addNativeGenericTimedStatus, addNativeScoreTimedStatus, calculateNativeBuffCost,
  createExamState, groupExamGimmicks, parseExamEffectMaster, parseExamSettingCatalog,
  parseProduceCardPoolCatalog, parseProduceExamGimmickCatalog, payCardCost,
  resolveExamGimmicks, tickNativeScoreTimedStatuses,
} from "../web/exam_effects.js";
import { applyCardGrowEffectsToParsedEffect, applyRuntimeCardGrowEffects } from "../web/card_customization.js";
import {
  cloneTowerTurnState, createTowerTurnState, currentTowerScoreContext, drawTowerTurn,
  finishTowerTurn, playTowerCard, restoreTowerTurnState, serializeTowerTurnState, useTowerDrink,
} from "../web/tower_runtime.js";
import { applyTowerAiAction, enumerateTowerAiActions, isTowerAiTerminal } from "../web/tower_ai.js";
import { createExamPreset, parseExamPreset } from "../web/exam_preset.js";
import { createExamWorkflowSnapshot, parseExamWorkflowSnapshot } from "../web/exam_workflow.js";

const active = "ProduceCardCategory_ActiveSkill";
const mental = "ProduceCardCategory_MentalSkill";
const effect = (type, value = 0, turn = 0, extra = {}) => ({
  id: "fixture-" + type, effectType: "ProduceExamEffectType_" + type,
  effectValue1: value, effectValue2: 0, effectCount: 1, effectTurn: turn, ...extra,
});
const trigger = (...phases) => ({ id: "trigger", phaseTypes: phases.map((phase) => "ProduceExamPhaseType_" + phase) });
const search = (id, categories = [], extra = {}) => ({ id, cardPositionType: "ProduceCardPositionType_Hand", cardCategories: categories, ...extra });
const entries = (rows) => new Map(rows.map((row) => [row.id, row]));
function state(options = {}, masters = null) {
  masters ??= Array.from({ length: 24 }, (_, n) => ({ id: "card-" + n, category: n % 2 ? mental : active,
    playMovePositionType: "ProduceCardMovePositionType_Grave", stamina: 0, playEffects: [] }));
  return createTowerTurnState(masters.map((card) => ({ id: card.id })), 12345678, entries(masters), { stamina: 100, handLimit: 99, ...options });
}
function apply(s, ...effects) {
  return useTowerDrink(s, { id: "fixture-drink", effects: effects.map((examEffect) => ({ examEffect })) });
}
function row(id, effectId, extra = {}) {
  return { id, priority: 0, startTurn: 0, remainingTurn: 0, remainingTurnPermil: 0,
    fieldStatusType: "ProduceExamFieldStatusType_Unknown", produceExamEffectId: effectId, ...extra };
}

// Explicit values and durations override legacy ID descriptions.
{
  assert.deepEqual(parseExamEffectMaster(effect("ExamParameterBuff", 0, 2, { id: "e_effect-exam_parameter_buff-99" })),
    { kind: "parameter_buff", id: "e_effect-exam_parameter_buff-99", value: 2 });
  assert.equal(parseExamEffectMaster(effect("ExamStaminaConsumptionDown", 0, 4)).value, 4);
  assert.equal(parseExamEffectMaster(effect("ExamParameterBuffMultiplePerTurn", 0, 3)).turn, 3);
  const exam = createExamState();
  addNativeGenericTimedStatus(exam, "panic", 1, 1, "flag");
  addNativeGenericTimedStatus(exam, "parameterDebuff", 1, 1, "duration");
  addNativeGenericTimedStatus(exam, "parameterDebuff", 1, 2, "duration");
  tickNativeScoreTimedStatuses(exam);
  assert.equal(exam.panic, false);
  assert.equal(exam.parameterDebuff, 1);
  assert.equal(exam.genericTimedStatuses[0].turn, 2);
  tickNativeScoreTimedStatuses(exam); tickNativeScoreTimedStatuses(exam);
  assert.equal(exam.parameterDebuff, 0);
}

// Buff costs round after multiplicative modifiers; a failed payment changes nothing.
{
  const exam = createExamState({ stamina: 20 });
  exam.buffConsumptionDown = true;
  assert.equal(calculateNativeBuffCost(exam, 3), 2);
  exam.buffConsumptionAdd = 1;
  assert.equal(calculateNativeBuffCost(exam, 3), 3);
  exam.review = 2; exam.block = 5;
  const before = JSON.parse(JSON.stringify(exam));
  assert.throws(() => payCardCost(exam, { stamina: 4, forceStamina: 2, costType: "ExamCostType_ExamReview", costValue: 3 }), /好印象/);
  assert.deepEqual(exam, before);
}

// Gimmicks execute once, in priority order, at the specified turn/ratio.
{
  const gain = effect("ExamCardPlayAggressive", 3), bonus = effect("ExamLessonFix", 20);
  const s = state({ turnLimit: 4, examEffectById: entries([gain, bonus]), gimmicks: [
    row("priority", bonus.id, { startTurn: 1, priority: 2, fieldStatusType: "ProduceExamFieldStatusType_CardPlayAggressiveUp", fieldStatusValue: 3 }),
    row("priority", gain.id, { startTurn: 1, priority: 1 }),
    row("failed", bonus.id, { startTurn: 1, fieldStatusType: "ProduceExamFieldStatusType_ReviewUp", fieldStatusValue: 1 }),
    row("ratio", bonus.id, { remainingTurnPermil: 500 }),
    row("remaining", bonus.id, { remainingTurn: 1 }),
  ] });
  drawTowerTurn(s); assert.equal(s.exam.parameter, 20);
  apply(s, effect("ExamReview", 1)); finishTowerTurn(s); drawTowerTurn(s);
  assert.equal(s.exam.parameter, 41);
  finishTowerTurn(s); drawTowerTurn(s); assert.equal(s.exam.parameter, 41);
  finishTowerTurn(s); drawTowerTurn(s); assert.equal(s.exam.parameter, 61);
  assert.deepEqual(s.unsupported, []);
}

// Last Mental card and four active debuffs are distinct native field conditions.
{
  const gain = effect("ExamLessonFix", 7);
  const s = state({ examEffectById: entries([gain]), gimmicks: [
    row("last-mental", gain.id, { startTurn: 2, fieldStatusType: "ProduceExamFieldStatusType_PlayCardSkill", fieldStatusValue: 0 }),
    row("four-debuffs", gain.id, { startTurn: 2, fieldStatusType: "ProduceExamFieldStatusType_DebuffCountUp", fieldStatusValue: 4 }),
  ] });
  drawTowerTurn(s, 24); playTowerCard(s, s.hand.findIndex((card) => card.category === mental));
  apply(s, effect("ExamGimmickSlump", 0, 3), effect("ExamGimmickParameterDebuff", 0, 3), effect("ExamPanic", 0, 3), effect("ExamGimmickLessonDebuff", 1, 3));
  finishTowerTurn(s); drawTowerTurn(s); assert.equal(s.exam.parameter, 14);
}

// Recovery removes lifetime records while preserving unrelated positive statuses.
{
  const s = state(); drawTowerTurn(s);
  apply(s, effect("ExamAntiDebuff"), effect("ExamGimmickSlump", 0, 3));
  assert.equal(s.exam.slump, false); assert.equal(s.exam.antiDebuffCount, 0);
  addNativeScoreTimedStatus(s.exam, "lessonParameterMultiple", 500, 3);
  addNativeScoreTimedStatus(s.exam, "lessonParameterDown", 100, 2);
  addNativeScoreTimedStatus(s.exam, "lessonParameterDown", 200, 3);
  apply(s, effect("ExamDebuffRecover", 1));
  assert.equal(s.exam.lessonParameterDown, Math.fround(0.2));
  assert.equal(s.exam.lessonParameterMultiple, 1.5);
  apply(s, effect("ExamGimmickSleepy", 2), effect("ExamGimmickSleepy", 3));
  assert.equal(s.exam.blockAddDownFix, 3);
  apply(s, effect("ExamDebuffRecover")); finishTowerTurn(s);
  assert.equal(s.exam.blockAddDownFix, 0);
  assert.equal(s.exam.lessonParameterDown, 0);
  assert.equal(s.exam.lessonParameterMultiple, 1.5);
}

// Category bans and cost changes do not affect other cards or the play budget.
{
  const s = state({ cardSearchById: entries([search("active", [active])]) });
  drawTowerTurn(s, 24);
  apply(s, effect("ExamGimmickPlayCardLimit", 0, 1, { produceCardSearchId: "active" }));
  assert.equal(s.playsRemaining, 1);
  assert.throws(() => playTowerCard(s, s.hand.findIndex((card) => card.category === active)), /ギミック/);
  playTowerCard(s, s.hand.findIndex((card) => card.category === mental));
  finishTowerTurn(s); assert.equal(s.searchPlayCardLimits.length, 0);
  drawTowerTurn(s, 24); s.playsRemaining = 3;
  for (const card of s.hand) card.stamina = 5;
  apply(s, effect("ExamSearchPlayCardStaminaConsumptionChange", 0, 2, { produceCardSearchId: "active", effectCount: 1 }));
  playTowerCard(s, s.hand.findIndex((card) => card.category === mental)); assert.equal(s.exam.stamina, 95);
  assert.equal(s.searchCardCostChanges[0].count, 1);
  playTowerCard(s, s.hand.findIndex((card) => card.category === active)); assert.equal(s.exam.stamina, 95);
  playTowerCard(s, s.hand.findIndex((card) => card.category === active)); assert.equal(s.exam.stamina, 90);
}

// Empty hands still require the final turn-end; AI may choose that action.
{
  const down = effect("ExamGimmickStartTurnCardDrawDown", 3, 1);
  const s = state({ turnLimit: 1, examEffectById: entries([down]), gimmicks: [row("draw-ban", down.id, { startTurn: 1 })] });
  drawTowerTurn(s);
  assert.equal(s.hand.length, 0); assert.equal(s.turnOpen, true);
  assert.equal(isTowerAiTerminal(s), false);
  assert.deepEqual(enumerateTowerAiActions(s), [{ type: "end" }]);
  assert.throws(() => drawTowerTurn(s), /ターンを終了/);
  const next = applyTowerAiAction(s, { type: "end" });
  assert.equal(next.history.length, 1); assert.equal(next.ended, true);
}

// Fire-count increases apply to active finite P-items, excluding exhausted/unlimited.
{
  const t = trigger("ExamCardPlayAfter"), gain = effect("ExamLessonFix", 2);
  const item = (id, count) => ({ id, effects: [{ id: "e", effectType: "ProduceItemEffectType_ExamStatusEnchant", effectTurn: -1, effectCount: count,
    examStatusEnchant: { id: "enchant", trigger: t, examEffects: [gain] } }] });
  const s = state({ pItems: [item("finite", 2), item("infinite", 0), item("exhausted", 1)] });
  drawTowerTurn(s, 24); s.playsRemaining = 5; playTowerCard(s, 0);
  assert.equal(s.exam.parameter, 6);
  apply(s, effect("ExamItemFireLimitAdd", 2));
  assert.equal(s.pItemEffectRemainingCounts.get("finite::e"), 3);
  assert.equal(s.pItemEffectRemainingCounts.get("infinite::e"), null);
  assert.equal(s.pItemEffectRemainingCounts.get("exhausted::e"), 0);
  for (let n = 0; n < 4; n += 1) playTowerCard(s, 0);
  assert.equal(s.exam.parameter, 20);
}

// Value multiplication changes the current count rather than future gain multipliers.
{
  const s = state(); drawTowerTurn(s); s.exam.block = 5; s.exam.aggressive = 5; s.exam.review = 5;
  apply(s, effect("ExamBlockValueMultiple", 500), effect("ExamAggressiveValueMultiple", 500), effect("ExamReviewValueMultiple", 500));
  assert.deepEqual([s.exam.block, s.exam.aggressive, s.exam.review], [8, 8, 8]);
  apply(s, effect("ExamCardPlayAggressive", 2), effect("ExamReview", 2));
  assert.deepEqual([s.exam.aggressive, s.exam.review], [10, 10]);
}

// Panic leaves opening draws intact and consumes one RNG word per later hand card.
{
  const candidates = [2, 7, 11], s = state({ examRuntimeSettings: { produceExamPanicStaminaCandidates: candidates } });
  addNativeGenericTimedStatus(s.exam, "panic", 1, -1, "flag");
  const initialRandom = s.randomState; drawTowerTurn(s);
  assert.equal(s.randomState, initialRandom);
  assert.ok(s.hand.every((card) => card.temporaryStaminaConsumptionFix === undefined));
  finishTowerTurn(s);
  const rng = new XorShift32(s.randomState), expected = Array.from({ length: 3 }, () => candidates[rng.nextInt(0, candidates.length)]);
  drawTowerTurn(s); assert.deepEqual(s.hand.map((card) => card.temporaryStaminaConsumptionFix), expected);
  assert.equal(s.randomState, rng.state);
  finishTowerTurn(s); assert.ok(s.discard.every((card) => card.temporaryStaminaConsumptionFix === undefined));
}

// Every force-play target executes for free and leaves the ordinary use available.
{
  const s = state({ cardSearchById: entries([search("active", [active])]) });
  drawTowerTurn(s, 24); for (const card of s.hand) card.stamina = 5;
  apply(s, effect("ExamForcePlayCardSearch", 0, 0, { produceCardSearchId: "active", pickRangeType: "ProducePickRangeType_All" }));
  assert.equal(s.currentTurnPlays.length, 12); assert.equal(s.playsRemaining, 1);
  assert.equal(s.exam.stamina, 100); assert.equal(s.hand.length, 12);
}

// Card enchant growth is owner-specific, count-limited and retained through upgrades.
{
  const t = trigger("ExamCardPlayAfter"); t.produceCardSearchId = "self";
  const grow = { id: "grow", effectType: "ProduceCardGrowEffectType_LessonAdd", value: 3 }, lesson = effect("ExamLesson", 5);
  const a = { id: "A", category: active, stamina: 0, produceCardStatusEnchantId: "card-enchant", playMovePositionType: "ProduceCardMovePositionType_Grave", playEffects: [{ produceExamEffectId: lesson.id }] };
  const b = { id: "B", category: active, stamina: 0, playMovePositionType: "ProduceCardMovePositionType_Grave", playEffects: [] };
  const s = state({ examEffectById: entries([lesson]), examTriggerById: entries([t]), growEffectById: entries([grow]),
    cardSearchById: entries([search("self", [], { cardPositionType: "ProduceCardPositionType_Playing", isSelf: true })]),
    cardStatusEnchantById: entries([{ id: "card-enchant", produceExamTriggerId: t.id, triggerCount: 1, produceCardGrowEffectIds: [grow.id] }]),
    cardVariantByKey: new Map([["A@@1", { ...a, upgradeCount: 1, stamina: 2 }]]),
  }, [a, b]);
  drawTowerTurn(s); s.playsRemaining = 2; playTowerCard(s, s.hand.findIndex((card) => card.id === "B"));
  assert.equal(s.hand[0].runtimeGrowEffects, undefined);
  playTowerCard(s, 0); assert.equal(s.exam.parameter, 5);
  const owner = s.discard.find((card) => card.id === "A"); assert.equal(owner.runtimeGrowEffects.length, 1);
  s.cardSearchById.set("owner", search("owner", [], { cardPositionType: "ProduceCardPositionType_Grave", produceCardIds: ["A"] }));
  apply(s, effect("ExamCardUpgrade", 0, 0, { produceCardSearchId: "owner", pickRangeType: "ProducePickRangeType_All" }));
  assert.equal(owner.stamina, 2); assert.equal(owner.runtimeGrowEffects.length, 1);
  const restored = restoreTowerTurnState(JSON.stringify(serializeTowerTurnState(s)), s), clone = cloneTowerTurnState(restored);
  clone.discard.find((card) => card.id === "A").runtimeGrowEffects[0].value = 99;
  assert.equal(restored.discard.find((card) => card.id === "A").runtimeGrowEffects[0].value, 3);
  finishTowerTurn(restored); drawTowerTurn(restored); playTowerCard(restored, restored.hand.findIndex((card) => card.id === "A"));
  assert.equal(restored.exam.parameter, 13);
  assert.equal(restored.discard.find((card) => card.id === "A").runtimeGrowEffects.length, 1);
}

// Enchant counts are shared across phase registrations; Encore keeps its origin.
{
  const gain = effect("ExamLessonFix", 9), multi = { ...trigger("ExamStartTurn", "ExamEndTurn"), id: "multi" };
  const s = state({ examEffectById: entries([gain]), examTriggerById: entries([multi]),
    examStatusEnchantById: entries([{ id: "multi-enchant", produceExamTriggerId: "multi", produceExamEffectIds: [gain.id] }]) });
  drawTowerTurn(s); apply(s, effect("ExamStatusEnchant", 0, -1, { produceExamStatusEnchantId: "multi-enchant", effectCount: 1 }));
  finishTowerTurn(s); drawTowerTurn(s); assert.equal(s.exam.parameter, 9);
  const lesson = effect("ExamLessonFix", 4), encore = effect("ExamStatusEnchantEncore", 0, -1, { produceExamStatusEnchantId: "encore", effectCount: 1 });
  const force = effect("ExamForcePlayCardSearch", 0, 0, { produceCardSearchId: "self", pickRangeType: "ProducePickRangeType_All" });
  const t = { ...trigger("ExamStartTurn"), id: "encore-trigger" };
  const card = { id: "ENCORE", stamina: 8, category: active, playMovePositionType: "ProduceCardMovePositionType_Grave", playEffects: [{ produceExamEffectId: lesson.id }, { produceExamEffectId: encore.id }] };
  const e = state({ examEffectById: entries([lesson, encore, force]), examTriggerById: entries([t]),
    examStatusEnchantById: entries([{ id: "encore", produceExamTriggerId: t.id, produceExamEffectIds: [force.id] }]),
    cardSearchById: entries([search("self", [], { cardPositionType: "ProduceCardPositionType_Target", isSelf: true })]),
  }, [card]);
  drawTowerTurn(e); playTowerCard(e, 0); assert.equal(e.exam.parameter, 4);
  const before = e.exam.stamina; finishTowerTurn(e); drawTowerTurn(e);
  assert.equal(e.exam.parameter, 8); assert.equal(e.exam.stamina, before); assert.equal(e.playsRemaining, 1);
  assert.equal(e.currentTurnPlays[0].card.id, "ENCORE"); assert.deepEqual(e.unsupported, []);
}

// Duration and Full Power growth affect execution, and each attribute applies its bonus.
{
  const c = { stamina: 3, playEffects: [] };
  applyRuntimeCardGrowEffects(c, [
    { effectType: "ProduceCardGrowEffectType_FullPowerPointAdd", value: 4 },
    { effectType: "ProduceCardGrowEffectType_FullPowerPointReduce", value: 2 },
    { effectType: "ProduceCardGrowEffectType_ParameterBuffMultiplePerTurnAdd", value: 2 },
    { effectType: "ProduceCardGrowEffectType_StaminaConsumptionDownTurnAdd", value: 1 },
  ]);
  assert.equal(applyCardGrowEffectsToParsedEffect(parseExamEffectMaster(effect("ExamFullPowerPoint", 3)), c).value1, 5);
  assert.equal(applyCardGrowEffectsToParsedEffect(parseExamEffectMaster(effect("ExamParameterBuffMultiplePerTurn", 0, 1)), c).turn, 3);
  assert.equal(applyCardGrowEffectsToParsedEffect(parseExamEffectMaster(effect("ExamStaminaConsumptionDown", 0, 2)), c).value, 3);
  const s = state({ turnParameterTypes: ["Vocal", "Dance"], parameterBonus: { vocal: { bonusPermil: 1500 }, dance: { bonusPermil: 2000 } } });
  drawTowerTurn(s); apply(s, effect("ExamLesson", 5), effect("ExamReview", 2));
  assert.equal(finishTowerTurn(s).parameterDelta, 11); assert.equal(s.exam.parameterVocal, 11);
  drawTowerTurn(s); apply(s, effect("ExamLesson", 5));
  assert.equal(finishTowerTurn(s).parameterDelta, 12); assert.equal(s.exam.parameterDance, 12);
  drawTowerTurn(s); assert.equal(currentTowerScoreContext(s).parameterType, "Dance");
  assert.equal(currentTowerScoreContext(s).battleBonusPermil, 2000);
}

// Repeated gimmick IDs, nested card pools, settings and battle input round trips.
{
  const rows = parseProduceExamGimmickCatalog("- id: same\n  priority: 1\n  startTurn: 1\n  produceExamEffectId: a\n- id: same\n  priority: 2\n  startTurn: 2\n  produceExamEffectId: b\n");
  assert.deepEqual(resolveExamGimmicks("same", { gimmickById: groupExamGimmicks(rows) }).map((r) => r.produceExamEffectId), ["a", "b"]);
  assert.equal(resolveExamGimmicks("missing", {}).at(0).unresolved, true);
  assert.equal(parseProduceCardPoolCatalog("- id: pool\n  produceCardRatios:\n  - id: A\n    upgradeCount: 1\n    ratio: 100\n  - id: B\n    upgradeCount: 0\n    ratio: 200\n").get("pool").length, 2);
  assert.deepEqual(parseExamSettingCatalog("- id: setting\n  produceExamPanicStaminaCandidates:\n  - 2\n  - 7\n")[0].produceExamPanicStaminaCandidates, [2, 7]);
  const context = { produceItemIds: ["item"], produceExamGimmickEffectGroupId: "gimmick", parameterBonus: { vocal: { bonusPermil: 2000 } }, turnLimit: 5 };
  const preset = createExamPreset({ cards: [{ id: "A", count: 1 }], examContext: context }, { allowPartial: true });
  const reloaded = parseExamPreset(JSON.stringify({ ...preset, source: "lsposed" }));
  assert.deepEqual(reloaded.examContext, context);
  const workflow = parseExamWorkflowSnapshot(JSON.stringify(createExamWorkflowSnapshot({ examContext: reloaded.examContext })));
  assert.deepEqual(workflow.examContext, context);
  workflow.examContext.produceItemIds.push("other"); assert.deepEqual(context.produceItemIds, ["item"]);
}
// Status intervals use the status/change count, independent of the turn number.
{
  const gain = effect("ExamLessonFix", 9);
  for (const [phase, interval, changes] of [
    ["ExamAggressiveUpInterval", 5, [effect("ExamCardPlayAggressive", 5), effect("ExamCardPlayAggressive", 5)]],
    ["ExamStanceChangeCountInterval", 2, [effect("ExamConcentration", 1), effect("ExamPreservation", 1)]],
  ]) {
    const t = { ...trigger(phase), phaseValues: [interval] };
    const s = state({ pItems: [{ id: "interval-item", effects: [{ id: "interval-effect",
      effectType: "ProduceItemEffectType_ExamStatusEnchant", effectTurn: -1, effectCount: 0,
      examStatusEnchant: { id: "interval-enchant", trigger: t, examEffects: [gain] },
    }] }] });
    drawTowerTurn(s);
    for (const change of changes) apply(s, change);
    assert.equal(s.exam.parameter, phase === "ExamAggressiveUpInterval" ? 18 : 9);
    apply(s, effect("ExamLessonBuff", 5));
    assert.equal(s.exam.parameter, phase === "ExamAggressiveUpInterval" ? 18 : 9);
  }
}

// Runtime growth changes the actual post-play destination, including after restore.
{
  const grow = { id: "reusable", effectType: "ProduceCardGrowEffectType_PlayMovePositionTypeChange",
    playMovePositionType: "ProduceCardMovePositionType_Grave" };
  const card = { id: "ONCE", category: active, stamina: 0,
    playMovePositionType: "ProduceCardMovePositionType_Lost", playEffects: [] };
  const s = state({ growEffectById: entries([grow]),
    cardSearchById: entries([search("hand")]) }, [card]);
  drawTowerTurn(s);
  apply(s, effect("ExamAddGrowEffect", 0, 0, { produceCardSearchId: "hand",
    pickRangeType: "ProducePickRangeType_All", produceCardGrowEffectIds: [grow.id] }));
  const restored = restoreTowerTurnState(JSON.stringify(serializeTowerTurnState(s)), s);
  playTowerCard(restored, 0);
  assert.equal(restored.lost.length, 0);
  assert.equal(restored.discard.length, 1);
  assert.equal(restored.currentTurnPlays[0].onceOnly, false);
}

// Growth earned while support-upgraded persists on the permanent card at turn end.
{
  const lesson = effect("ExamLesson", 5);
  const card = { id: "SUP-GROW", category: active, stamina: 6,
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [{ produceExamEffectId: lesson.id }] };
  const grows = [
    { id: "cost", effectType: "ProduceCardGrowEffectType_CostReduce", value: 1 },
    { id: "lesson", effectType: "ProduceCardGrowEffectType_LessonAdd", value: 3 },
  ];
  for (const permanentUpgrade of [false, true]) {
    const s = state({ examEffectById: entries([lesson]), growEffectById: entries(grows),
      cardSearchById: entries([search("hand")]),
      cardVariantByKey: new Map([[card.id + "@@1", { ...card, upgradeCount: 1, stamina: 4 }],
        [card.id + "@@2", { ...card, upgradeCount: 2, stamina: 2 }]]),
      supportCards: [{ supportCardId: "always", cardSearchId: "p_card_search-hand", produceCardUpgradePermil: 1000 }],
    }, [card]);
    drawTowerTurn(s);
    apply(s, effect("ExamAddGrowEffect", 0, 0, { produceCardSearchId: "hand",
      pickRangeType: "ProducePickRangeType_All", produceCardGrowEffectIds: grows.map((grow) => grow.id) }));
    if (permanentUpgrade) apply(s, effect("ExamCardUpgrade", 0, 0, {
      produceCardSearchId: "hand", pickRangeType: "ProducePickRangeType_All" }));
    playTowerCard(s, 0);
    assert.equal(s.exam.parameter, 8);
    finishTowerTurn(s);
    assert.equal(s.discard[0].upgradeCount, permanentUpgrade ? 1 : 0);
    assert.equal(s.discard[0].stamina, permanentUpgrade ? 3 : 5);
    assert.equal(s.discard[0].runtimeGrowEffects.length, 2);
    s.supportCards = [];
    drawTowerTurn(s); playTowerCard(s, 0);
    assert.equal(s.exam.parameter, 16);
  }
}

console.log("exam completeness regressions: ok");
