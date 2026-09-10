import assert from "node:assert/strict";
import {
  describeCustomize,
  judgeCardCustomization,
  parseCardMemoryRules,
  parseCustomizeCatalog,
  parseCustomizeRarityEvaluations,
  parseGrowEffectCatalog,
} from "./web/memory_judgement_v10.js";

const cardRules = parseCardMemoryRules(`- id: p_card-test
  upgradeCount: 0
  name: テスト
  rarity: ProduceCardRarity_Ssr
  evaluation: 50
  produceCardCustomizeIds: []
  maxCustomizeCount: 0
- id: p_card-test
  upgradeCount: 1
  name: テスト+
  rarity: ProduceCardRarity_Ssr
  evaluation: 68
  produceCardCustomizeIds:
  - p_card_custom-test
  maxCustomizeCount: 2
`);
const customizes = parseCustomizeCatalog(`- id: p_card_custom-test
  customizeCount: 1
  description: ""
  produceCardGrowEffectIds:
  - g_effect-lesson_add-3
  producePoint: 40
- id: p_card_custom-test
  customizeCount: 2
  description: パラメータ+
  produceCardGrowEffectIds:
  - g_effect-lesson_add-6
  producePoint: 70
`);
const effects = parseGrowEffectCatalog(`- id: g_effect-lesson_add-3
  effectType: ProduceCardGrowEffectType_LessonAdd
  costType: ExamCostType_Unknown
  value: 3
- id: g_effect-lesson_add-6
  effectType: ProduceCardGrowEffectType_LessonAdd
  costType: ExamCostType_Unknown
  value: 6
`);
const rarity = parseCustomizeRarityEvaluations(`- rarity: ProduceCardRarity_Ssr
  evaluation: 12
`);

assert.equal(describeCustomize("p_card_custom-test", 1, customizes, effects).label, "パラメータ +3");
const valid = judgeCardCustomization(
  { id: "p_card-test", upgradeCount: 1, customizes: [{ id: "p_card_custom-test", customizeCount: 2 }] },
  cardRules.get("p_card-test"), customizes, effects, rarity,
);
assert.equal(valid.valid, true);
assert.equal(valid.baseEvaluation, 68);
assert.equal(valid.customizeEvaluation, 24);
assert.equal(valid.totalEvaluation, 92);

const unupgraded = judgeCardCustomization(
  { id: "p_card-test", upgradeCount: 0, customizes: [{ id: "p_card_custom-test", customizeCount: 1 }] },
  cardRules.get("p_card-test"), customizes, effects, rarity,
);
assert.equal(unupgraded.valid, false);
assert.match(unupgraded.reasons.join(" "), /強化済み/);

const over = judgeCardCustomization(
  { id: "p_card-test", upgradeCount: 1, customizes: [{ id: "p_card_custom-test", customizeCount: 3 }] },
  cardRules.get("p_card-test"), customizes, effects, rarity,
);
assert.equal(over.valid, false);
assert.match(over.reasons.join(" "), /上限2回/);

console.log("memory judgement v10 tests: ok");
