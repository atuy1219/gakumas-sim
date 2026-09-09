import assert from "node:assert/strict";
import { parseProduceCardCatalogYaml } from "./web/engine.js";

const yaml = `
- id: p_card-test
  upgradeCount: 0
  name: テストカード
  planType: ProducePlanType_Plan1
  stamina: 3
  forceStamina: 1
  costType: ExamCostType_ExamReview
  costValue: 2
  playProduceExamTriggerId: ""
  playEffects:
  - produceExamTriggerId: ""
    produceExamEffectId: e_effect-exam_lesson-0010-01
  - produceExamTriggerId: e_trigger-exam_card_play-review_up-3
    produceExamEffectId: e_effect-exam_block-0005
  playMovePositionType: ProduceCardMovePositionType_Lost
  isInitial: false
  isRestrict: true
  noDeckDuplication: true
  moveProduceExamEffectIds:
  - e_effect-exam_card_draw-0001
`;

const [card] = parseProduceCardCatalogYaml(yaml);
assert.equal(card.id, "p_card-test");
assert.equal(card.stamina, 3);
assert.equal(card.forceStamina, 1);
assert.equal(card.costType, "ExamCostType_ExamReview");
assert.equal(card.costValue, 2);
assert.equal(card.playEffects.length, 2);
assert.equal(card.playEffects[0].produceExamEffectId, "e_effect-exam_lesson-0010-01");
assert.equal(card.playEffects[1].produceExamTriggerId, "e_trigger-exam_card_play-review_up-3");
assert.equal(card.playMovePositionType, "ProduceCardMovePositionType_Lost");
assert.equal(card.isRestrict, true);
assert.equal(card.noDeckDuplication, true);
assert.deepEqual(card.moveProduceExamEffectIds, ["e_effect-exam_card_draw-0001"]);

console.log("card master effect parser tests: ok");
