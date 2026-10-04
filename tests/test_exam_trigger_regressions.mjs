import assert from "node:assert/strict";
import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { buildTowerStageChoices, parseTowerLiveLayerMap } from "../web/tower_stage.js";
import {
  createTowerTurnState, drawTowerTurn, finishTowerTurn, playTowerCard,
  restoreTowerTurnState, serializeTowerTurnState, useTowerDrink,
} from "../web/tower_runtime.js";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/exam-trigger-masters.json", import.meta.url)));
const entries = (rows) => new Map(rows.map((row) => [row.id, row]));
const catalogs = {
  examEffectById: entries(fixture.examEffects),
  examStatusEnchantById: entries(fixture.examStatusEnchants),
  examTriggerById: entries(fixture.examTriggers),
  cardSearchById: entries(fixture.cardSearches),
};
const active = "ProduceCardCategory_ActiveSkill", mental = "ProduceCardCategory_MentalSkill";
const effect = (type, value, extra = {}) => ({ id: "fixture-" + type,
  effectType: "ProduceExamEffectType_" + type, effectValue1: value, effectValue2: 0,
  effectCount: 1, effectTurn: 0, ...extra });
const gain = effect("ExamLessonFix", 7);
const cards = Array.from({ length: 12 }, (_, index) => ({ id: "card-" + index,
  category: index % 2 ? mental : active, stamina: 0,
  playMovePositionType: "ProduceCardMovePositionType_Grave", playEffects: [] }));
function state(options = {}, masters = cards) {
  return createTowerTurnState(masters.map(({ id }) => ({ id })), 123, entries(masters),
    { ...catalogs, stamina: 100, handLimit: 99, turnLimit: 30, ...options });
}
const apply = (s, ...effects) => useTowerDrink(s, {
  id: "fixture-drink", effects: effects.map((examEffect) => ({ examEffect })),
});
const play = (s, category = active, options = {}) => playTowerCard(s,
  s.hand.findIndex((card) => card.category === category), options);

// Actual P-items fire on direct stamina damage, never on card cost or recovery.
for (const id of ["pitem_02-1-013-0", "pitem_02-3-032-0"]) {
  const item = fixture.pItems.find((item) => item.id === id);
  const s = state({ pItems: [item] }); drawTowerTurn(s, 12); s.playsRemaining = 12;
  s.hand[0].stamina = 5;
  playTowerCard(s, 0);
  assert.equal(s.exam.review, 0, id + ": card cost is not direct-effect damage");
  apply(s, effect("ExamStaminaRecoverFix", 5));
  assert.equal(s.exam.review, 0, id + ": recovery must not fire");
  s.exam.block = 10;
  apply(s, effect("ExamStaminaDamage", 2));
  assert.equal(s.exam.review, 0, id + ": block absorbs damage");
  s.exam.block = 0;
  const limit = item.effects[0].effectCount;
  for (let n = 1; n <= limit + 1; n++) {
    apply(s, effect("ExamStaminaReduceFix", 1));
    assert.equal(s.exam.review, Math.min(n, limit) * 2, id + ": direct damage and fire limit");
  }
  assert.deepEqual(s.unsupported, []);
}

// Cost-only stamina triggers resolve before the card's own effects. A free,
// blocked or ignored cost cannot trigger them, and direct damage cannot either.
{
  const costItem = { id: "cost-item", effects: [{ id: "cost-effect", effectCount: 0,
    effectType: "ProduceItemEffectType_ExamStatusEnchant", examStatusEnchant: {
      id: "cost-enchant", trigger: { id: "cost-trigger",
        phaseTypes: ["ProduceExamPhaseType_ExamStaminaReduceCard"] },
      examEffects: [effect("ExamLessonBuff", 2)],
    } }] };
  const s = state({ pItems: [costItem] }); drawTowerTurn(s, 12); s.playsRemaining = 12;
  playTowerCard(s, 0); assert.equal(s.exam.parameter, 0);
  s.hand[0].stamina = 4; s.exam.block = 4;
  playTowerCard(s, 0); assert.equal(s.exam.parameter, 0);
  s.hand[0].stamina = 4;
  playTowerCard(s, 0, { ignoreCost: true }); assert.equal(s.exam.parameter, 0);
  apply(s, effect("ExamStaminaReduceFix", 4)); assert.equal(s.exam.parameter, 0);
  s.hand[0].stamina = 4;
  s.hand[0].playEffects = [{ produceExamEffectId: "fixture-dependent-score" }];
  s.examEffectById.set("fixture-dependent-score", effect("ExamLesson", 10));
  playTowerCard(s, 0);
  assert.equal(s.exam.parameter, 12, "cost trigger must precede own score effect");
}

// High Jump counts the second card in each turn and fires before own effects.
{
  const item = fixture.pItems.find((item) => item.id === "pitem_02-3-172-0");
  const s = state({ pItems: [item] }); drawTowerTurn(s, 12); s.playsRemaining = 2;
  play(s); assert.equal(s.exam.block, 0);
  const restored = restoreTowerTurnState(serializeTowerTurnState(s), s);
  const second = restored.hand.find((card) => card.category === active);
  second.playEffects = [{ produceExamEffectId: "fixture-stamina-score" }];
  restored.examEffectById = new Map(restored.examEffectById).set("fixture-stamina-score",
    effect("ExamLessonDependStamina", 1000));
  play(restored); assert.equal(restored.exam.block, 5);
  assert.equal(restored.exam.parameter, 99, "High Jump's direct damage must precede own score effect");
  assert.equal(s.exam.block, 0, "restored counter must be independent");
  finishTowerTurn(restored); drawTowerTurn(restored, 12); restored.playsRemaining = 2;
  play(restored); assert.equal(restored.exam.block, 5, "turn 2 first card must not fire");
  play(restored); assert.equal(restored.exam.block, 10);
  assert.equal(restored.pItemEffectRemainingCounts.get(item.id + "::" + item.effects[0].id), 0);
  assert.deepEqual(restored.unsupported, []);
}

// Every affected Tower group uses its real enchant/trigger. Substitute only
// the payload with a score sentinel so timing is independent of effect math.
assert.equal(fixture.intervalGimmickGroupIds.length, 10);
for (const id of fixture.intervalGimmickGroupIds) {
  const rows = fixture.gimmicks.filter((row) => row.id === id);
  const row = rows.find((row) => {
    const e = catalogs.examEffectById.get(row.produceExamEffectId);
    const enchant = catalogs.examStatusEnchantById.get(e?.produceExamStatusEnchantId);
    return catalogs.examTriggerById.get(enchant?.produceExamTriggerId)?.phaseTypes
      .includes("ProduceExamPhaseType_ExamPlayTurnCountInterval");
  });
  const e = catalogs.examEffectById.get(row.produceExamEffectId);
  const enchant = catalogs.examStatusEnchantById.get(e.produceExamStatusEnchantId);
  const s = state({ gimmicks: [{ ...row, startTurn: 1 }],
    examStatusEnchantById: new Map(catalogs.examStatusEnchantById).set(enchant.id,
      { ...enchant, produceExamEffectIds: [gain.id] }),
    examEffectById: new Map(catalogs.examEffectById).set(gain.id, gain),
  });
  drawTowerTurn(s, 12); s.playsRemaining = 4;
  play(s); assert.equal(s.exam.parameter, 0, id);
  play(s); assert.equal(s.exam.parameter, 7, id);
  play(s); assert.equal(s.exam.parameter, 7, id);
  play(s); assert.equal(s.exam.parameter, 14, id);
  finishTowerTurn(s); drawTowerTurn(s, 12); s.playsRemaining = 2;
  play(s); assert.equal(s.exam.parameter, 14, id);
  play(s); assert.equal(s.exam.parameter, 21, id);
  assert.deepEqual(s.unsupported, [], id);
}

// Target searches count only eligible cards; the current card is included.
{
  const t = catalogs.examTriggerById.get("e_trigger-exam_play_turn_count_interval-2-p_card_search-mental_skill-target");
  const item = { id: "mental-counter", effects: [{ id: "e", effectCount: 0,
    effectType: "ProduceItemEffectType_ExamStatusEnchant", examStatusEnchant: {
      id: "enc", trigger: { ...t, cardSearch: catalogs.cardSearchById.get(t.produceCardSearchId) },
      examEffects: [gain],
    } }] };
  const s = state({ pItems: [item] }); drawTowerTurn(s, 12); s.playsRemaining = 6;
  play(s, mental); play(s, active); assert.equal(s.exam.parameter, 0);
  play(s, mental); assert.equal(s.exam.parameter, 7);
  play(s, active); assert.equal(s.exam.parameter, 7);
  play(s, mental); assert.equal(s.exam.parameter, 7);
  play(s, mental); assert.equal(s.exam.parameter, 14);
  assert.equal(s.exam.turnCardPlayCount, 6);
}

// Native counters exclude plays made before installation (including the
// installing card), and After intervals resolve after the card's own effect.
{
  const trigger = { id: "after-counter", phaseTypes: ["ProduceExamPhaseType_ExamPlayCountIntervalAfter"], phaseValues: [2] };
  const afterBuff = effect("ExamLessonBuff", 2), ownScore = effect("ExamLesson", 10);
  const enchant = { id: "after-enchant", produceExamTriggerId: trigger.id, produceExamEffectIds: [afterBuff.id] };
  const install = effect("ExamStatusEnchant", 0, { effectTurn: -1, produceExamStatusEnchantId: enchant.id });
  const s = state({ examTriggerById: new Map([[trigger.id, trigger]]),
    examStatusEnchantById: new Map([[enchant.id, enchant]]),
    examEffectById: new Map([[afterBuff.id, afterBuff], [ownScore.id, ownScore], [install.id, install]]),
  });
  drawTowerTurn(s, 12); s.playsRemaining = 6;
  play(s); play(s);
  s.hand.find((card) => card.category === active).playEffects = [{ produceExamEffectId: install.id }];
  play(s); assert.equal(s.exam.parameter, 0, "installing card is excluded");
  assert.equal(s.exam.lessonBuff, 0);
  play(s); assert.equal(s.exam.parameter, 0, "first play since installation");
  assert.equal(s.exam.lessonBuff, 0);
  s.hand.find((card) => card.category === active).playEffects = [{ produceExamEffectId: ownScore.id }];
  play(s); assert.equal(s.exam.parameter, 10, "After trigger must follow own score effect");
  assert.equal(s.exam.lessonBuff, 2, "second play since installation");
  assert.deepEqual(s.unsupported, []);
}

// Conditions filter phase counts too, rather than merely gating the global
// second/fourth card. Both spellings of native lesson types are accepted.
for (const id of ["e_trigger-exam_play_turn_count_interval-2-review_up-6-p_card_search-target",
  "e_trigger-exam_play_turn_count_interval-2-p_card_search-target-lesson_visual"]) {
  const t = catalogs.examTriggerById.get(id);
  const item = { id, effects: [{ id: "e", effectCount: 0,
    effectType: "ProduceItemEffectType_ExamStatusEnchant", examStatusEnchant: {
      id: "enc", trigger: { ...t, cardSearch: catalogs.cardSearchById.get(t.produceCardSearchId) },
      examEffects: [gain],
    } }] };
  const s = state({ pItems: [item] }); drawTowerTurn(s, 12); s.playsRemaining = 5;
  s.lessonType = "ProduceStepLessonType_VocalLesson";
  play(s); assert.equal(s.exam.parameter, 0, id);
  s.exam.review = 6; s.lessonType = "ProduceStepLessonType_VisualLesson";
  play(s); assert.equal(s.exam.parameter, 0, id + ": first eligible play");
  play(s); assert.equal(s.exam.parameter, 7, id + ": second eligible play");
  s.exam.review = 0; s.lessonType = "ProduceStepLessonType_VocalLesson";
  play(s); assert.equal(s.exam.parameter, 7, id);
  s.exam.review = 6; s.lessonType = "ProduceStepLessonType_VisualLesson";
  play(s); assert.equal(s.exam.parameter, 7, id + ": third eligible play");
}

// All 33 Active and 50 Mental rows have a real category check even when the
// master value is zero. Opening and skipped turns match neither category.
const categoryRows = fixture.gimmicks.filter((row) => /_PlayCard(?:Lesson|Skill)$/.test(row.fieldStatusType));
assert.equal(categoryRows.filter((row) => row.fieldStatusType.endsWith("_PlayCardLesson")).length, 33);
assert.equal(categoryRows.filter((row) => row.fieldStatusType.endsWith("_PlayCardSkill")).length, 50);
for (const row of categoryRows) for (const previous of [active, mental, "skip", "active-then-skip"]) {
  const s = state({ gimmicks: [{ ...row, startTurn: previous === "active-then-skip" ? 3 : 2,
    produceExamEffectId: gain.id }], examEffectById: new Map([[gain.id, gain]]) });
  drawTowerTurn(s, 12);
  if (previous !== "skip") play(s, previous === "active-then-skip" ? active : previous);
  finishTowerTurn(s);
  if (previous === "active-then-skip") { drawTowerTurn(s, 12); finishTowerTurn(s); }
  drawTowerTurn(s, 12);
  const expectedCategory = row.fieldStatusType.endsWith("_PlayCardLesson") ? active : mental;
  assert.equal(s.exam.parameter, previous === expectedCategory ? 7 : 0, row.id + ": " + previous);
}

// Source-backed automatic mapping: all saved floors carry exact gimmick IDs;
// choices retain the effect-specific group instead of deriving it from names.
{
  const payload = JSON.parse(gunzipSync(fs.readFileSync(new URL("../web/data/tower_layer_config.json.gz", import.meta.url))));
  const rows = parseTowerLiveLayerMap(payload);
  assert.equal(new Set(rows.map((row) => row.towerId + "#" + row.number)).size, 351);
  assert.equal(rows.length, 2126);
  const groups = new Set(fixture.towerGimmickGroupIds);
  assert.equal(groups.size, 242);
  for (const row of rows) {
    assert.ok(Object.hasOwn(row, "produceExamGimmickEffectGroupId"));
    assert.ok(!row.produceExamGimmickEffectGroupId || groups.has(row.produceExamGimmickEffectGroupId));
  }
  const catalog = { layerExams: rows, configById: new Map(rows.map((row) =>
    [row.produceExamBattleConfigId, { id: row.produceExamBattleConfigId, turn: 20 }])), towerById: new Map() };
  for (const type of new Set(rows.map((row) => row.examEffectType))) {
    const choices = buildTowerStageChoices(catalog, "hski", type);
    for (const choice of choices) {
      const source = rows.find((row) => row.towerId === choice.towerId && row.number === choice.number && row.examEffectType === type);
      assert.equal(choice.produceExamGimmickEffectGroupId, source.produceExamGimmickEffectGroupId);
    }
  }
}

console.log("exam trigger regressions: 3 real P-items, 10 Tower groups, 83 category rows, 351 floors: ok");
