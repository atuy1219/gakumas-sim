import assert from "node:assert/strict";
import {
  applyParsedExamEffect,
  checkCardEffectTrigger,
  createExamState,
  describeProduceItemEffect,
  parseExamEffectId,
  parseProduceItemCatalogForExam,
  parseProduceItemEffectCatalog,
  payCardCost,
  resolveProduceItems,
} from "./web/exam_effects_v7.js";

assert.deepEqual(parseExamEffectId("e_effect-exam_lesson-0012-02"), {
  kind: "lesson", id: "e_effect-exam_lesson-0012-02", value: 12, count: 2,
});
assert.equal(parseExamEffectId("e_effect-exam_block-0007").kind, "block");
assert.equal(parseExamEffectId("e_effect-exam_card_draw-0002").kind, "card_draw");
assert.equal(parseExamEffectId("e_effect-not-yet-supported").kind, "unsupported");

const exam = createExamState({ stamina: 20 });
applyParsedExamEffect(exam, parseExamEffectId("e_effect-exam_block-0005"));
applyParsedExamEffect(exam, parseExamEffectId("e_effect-exam_review-0003"));
applyParsedExamEffect(exam, parseExamEffectId("e_effect-exam_lesson_buff-0004"));
applyParsedExamEffect(exam, parseExamEffectId("e_effect-exam_parameter_buff-0002"));
applyParsedExamEffect(exam, parseExamEffectId("e_effect-exam_lesson-0010-02"));
assert.equal(exam.block, 5);
assert.equal(exam.review, 3);
assert.equal(exam.lessonBuff, 4);
assert.equal(exam.parameterBuff, 2);
assert.equal(exam.parameter, 20);

assert.equal(checkCardEffectTrigger("", exam).triggered, true);
assert.equal(checkCardEffectTrigger("e_trigger-exam_card_play-review_up-3", exam).triggered, true);
assert.equal(checkCardEffectTrigger("e_trigger-exam_card_play-review_up-5", exam).triggered, false);
assert.equal(checkCardEffectTrigger("e_trigger-something-unknown", exam).supported, false);

payCardCost(exam, { stamina: 7, forceStamina: 2, costType: "ExamCostType_ExamReview", costValue: 2 });
assert.equal(exam.block, 0);
assert.equal(exam.stamina, 16);
assert.equal(exam.review, 1);

const itemYaml = `
- id: pitem_test
  name: テストPアイテム
  planType: ProducePlanType_Plan1
  produceItemEffectIds:
  - p_item_effect_test_a
  - p_item_effect_test_b
  order: 10
`;
const effectYaml = `
- id: p_item_effect_test_a
  effectType: ProduceItemEffectType_ExamStatusEnchant
  effectTurn: -1
  effectCount: 2
  produceEffectId: ""
  produceExamStatusEnchantId: enchant-test-a
- id: p_item_effect_test_b
  effectType: ProduceItemEffectType_ProduceEffect
  effectTurn: 0
  effectCount: 0
  produceEffectId: p_effect-test-b
  produceExamStatusEnchantId: ""
`;
const items = parseProduceItemCatalogForExam(itemYaml);
const itemEffects = parseProduceItemEffectCatalog(effectYaml);
assert.deepEqual(items[0].produceItemEffectIds, ["p_item_effect_test_a", "p_item_effect_test_b"]);
const resolved = resolveProduceItems(
  ["pitem_test"],
  new Map(items.map((item) => [item.id, item])),
  new Map(itemEffects.map((effect) => [effect.id, effect])),
);
assert.equal(resolved.items[0].name, "テストPアイテム");
assert.equal(resolved.items[0].effects.length, 2);
assert.match(describeProduceItemEffect(resolved.items[0].effects[0]), /enchant-test-a/);
assert.match(describeProduceItemEffect(resolved.items[0].effects[1]), /p_effect-test-b/);

console.log("exam effect v7 tests: ok");
