import assert from "node:assert/strict";

import {
  parseExamEffectMaster,
  parseProduceCardSearchCatalog,
  parseProduceExamEffectCatalog,
  parseProduceExamStatusEnchantCatalog,
  parseProduceExamTriggerCatalog,
  parseProduceItemCatalogForExam,
  parseProduceItemEffectCatalog,
  resolveProduceItems,
} from "../web/exam_effects.js";
import {
  createTowerTurnState,
  drawTowerTurn,
  playTowerCard,
} from "../web/tower_runtime.js";

const items = parseProduceItemCatalogForExam(`
- id: pitem-test
  name: テストPアイテム
  planType: ProducePlanType_Plan1
  produceItemEffectIds:
  - pitem-effect-test
  libraryHidden: false
`);
const itemEffects = parseProduceItemEffectCatalog(`
- id: pitem-effect-test
  effectType: ProduceItemEffectType_ExamStatusEnchant
  effectTurn: -1
  effectCount: 2
  produceEffectId: ""
  produceExamStatusEnchantId: enchant-test
`);
const enchants = parseProduceExamStatusEnchantCatalog(`
- id: enchant-test
  assetId: ""
  produceExamTriggerId: trigger-test
  produceExamEffectIds:
  - effect-test
`);
const triggers = parseProduceExamTriggerCatalog(`
- id: trigger-test
  phaseTypes:
  - ProduceExamPhaseType_ExamCardPlayAfter
  phaseValues: []
  fieldStatusCheckTypes: []
  fieldStatusTypes: []
  fieldStatusValues: []
  fieldStatusProduceCardSearchIds: []
  produceCardSearchId: search-active
  upperSearchCount: 0
  lowerSearchCount: 0
  cardMovePositionType: ProduceCardMovePositionType_Unknown
  effectTypes: []
  lessonType: ProduceStepLessonType_Unknown
`);
const examEffects = parseProduceExamEffectCatalog(`
- id: effect-test
  effectType: ProduceExamEffectType_ExamReview
  effectValue1: 3
  effectValue2: 0
  effectCount: 1
  effectTurn: 0
  targetProduceCardId: ""
  targetUpgradeCount: 0
  targetExamEffectType: ProduceExamEffectType_Unknown
  produceCardSearchId: ""
  movePositionType: ProduceCardMovePositionType_Unknown
  pickRangeType: ProducePickRangeType_Unknown
  pickCountMin: 0
  pickCountMax: 0
  chainProduceExamEffectId: ""
  chainProduceExamEffectIds: []
  produceExamStatusEnchantId: ""
  produceCardStatusEnchantId: ""
  produceCardGrowEffectIds: []
  effectGroupIds: []
`);
const cardSearches = parseProduceCardSearchCatalog(`
- id: search-active
  cardRarities: []
  produceCardIds: []
  upgradeCounts: []
  planType: ProducePlanType_Unknown
  cardCategories:
  - ProduceCardCategory_ActiveSkill
  cardStatusType: ProduceCardSearchStatusType_Unknown
  orderType: ProduceCardOrderType_Unknown
  cardPositionType: ProduceCardPositionType_Playing
  cardSearchTag: ""
  produceCardRandomPoolId: ""
  limitCount: 0
  staminaMinMaxType: ConditionMinMaxType_Unknown
  staminaMin: 0
  staminaMax: 0
  examEffectType: ProduceExamEffectType_Unknown
  effectGroupIds: []
  isSelf: false
  produceCardPoolId: ""
  costType: ExamCostType_Unknown
  isCustomized: false
`);

const catalogs = {
  examStatusEnchantById: new Map(enchants.map((row) => [row.id, row])),
  examTriggerById: new Map(triggers.map((row) => [row.id, row])),
  examEffectById: new Map(examEffects.map((row) => [row.id, row])),
  cardSearchById: new Map(cardSearches.map((row) => [row.id, row])),
};
const resolved = resolveProduceItems(
  ["pitem-test"],
  new Map(items.map((row) => [row.id, row])),
  new Map(itemEffects.map((row) => [row.id, row])),
  catalogs,
);

assert.equal(resolved.items.length, 1);
const resolvedEffect = resolved.items[0].effects[0];
assert.equal(resolvedEffect.examStatusEnchant.trigger.id, "trigger-test");
assert.equal(resolvedEffect.examStatusEnchant.trigger.cardSearch.id, "search-active");
assert.equal(resolvedEffect.examStatusEnchant.examEffects[0].effectType, "ProduceExamEffectType_ExamReview");
assert.deepEqual(parseExamEffectMaster(examEffects[0]), {
  kind: "review",
  id: "effect-test",
  value: 3,
});

const masters = [
  {
    id: "MENTAL",
    category: "ProduceCardCategory_MentalSkill",
    rarity: "ProduceCardRarity_R",
    planType: "ProducePlanType_Plan1",
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [],
  },
  {
    id: "ACTIVE-A",
    category: "ProduceCardCategory_ActiveSkill",
    rarity: "ProduceCardRarity_R",
    planType: "ProducePlanType_Plan1",
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [],
  },
  {
    id: "ACTIVE-B",
    category: "ProduceCardCategory_ActiveSkill",
    rarity: "ProduceCardRarity_R",
    planType: "ProducePlanType_Plan1",
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [],
  },
];
const cardById = new Map(masters.map((card) => [card.id, card]));
const state = createTowerTurnState(
  masters.map((card) => ({ id: card.id, upgradeCount: 0, fixedDeckOrder: 0 })),
  0x12345678,
  cardById,
  { pItems: resolved.items, stamina: 20 },
);

assert.equal(state.unsupported.length, 0);
assert.equal(state.effectScheduler.registrations.filter((entry) => entry.sourceType === "pItem").length, 1);
assert.equal(state.pItemEffectRemainingCounts.get("pitem-test::pitem-effect-test"), 2);

drawTowerTurn(state, 3);
state.playsRemaining = 3;

let index = state.hand.findIndex((card) => card.id === "MENTAL");
assert.ok(index >= 0);
playTowerCard(state, index);
assert.equal(state.exam.review, 0, "card search must reject MentalSkill");

index = state.hand.findIndex((card) => card.id === "ACTIVE-A");
assert.ok(index >= 0);
playTowerCard(state, index);
assert.equal(state.exam.review, 3);
assert.equal(state.pItemEffectRemainingCounts.get("pitem-test::pitem-effect-test"), 1);

index = state.hand.findIndex((card) => card.id === "ACTIVE-B");
assert.ok(index >= 0);
playTowerCard(state, index);
assert.equal(state.exam.review, 6);
assert.equal(state.pItemEffectRemainingCounts.get("pitem-test::pitem-effect-test"), 0);
assert.equal(
  state.effectScheduler.registrations
    .filter((entry) => entry.sourceType === "pItem")
    .every((entry) => entry.active === false),
  true,
);


// The same ProduceItem identity fires at most once at a single native timing,
// even when multiple enchant/effect rows are attached to that item.
{
  const trigger = {
    id: "same-item-trigger",
    phaseTypes: ["ProduceExamPhaseType_ExamCardPlayAfter"],
    phaseValues: [],
    fieldStatusCheckTypes: [],
    fieldStatusTypes: [],
    fieldStatusValues: [],
    fieldStatusProduceCardSearchIds: [],
    produceCardSearchId: "",
    upperSearchCount: 0,
    lowerSearchCount: 0,
    cardMovePositionType: "ProduceCardMovePositionType_Unknown",
    effectTypes: [],
    lessonType: "ProduceStepLessonType_Unknown",
    cardSearch: null,
  };
  const sameItem = {
    id: "same-item",
    effects: [
      {
        id: "same-item-effect-a",
        effectType: "ProduceItemEffectType_ExamStatusEnchant",
        effectTurn: -1,
        effectCount: 1,
        examStatusEnchant: {
          id: "same-item-enchant-a",
          trigger,
          examEffects: [{
            id: "same-item-review-a",
            effectType: "ProduceExamEffectType_ExamReview",
            effectValue1: 1,
            effectCount: 1,
          }],
        },
      },
      {
        id: "same-item-effect-b",
        effectType: "ProduceItemEffectType_ExamStatusEnchant",
        effectTurn: -1,
        effectCount: 1,
        examStatusEnchant: {
          id: "same-item-enchant-b",
          trigger,
          examEffects: [{
            id: "same-item-review-b",
            effectType: "ProduceExamEffectType_ExamReview",
            effectValue1: 10,
            effectCount: 1,
          }],
        },
      },
    ],
  };
  const localState = createTowerTurnState(
    masters.map((card) => ({ id: card.id, upgradeCount: 0, fixedDeckOrder: 0 })),
    0x12345678,
    cardById,
    { pItems: [sameItem], stamina: 20 },
  );
  drawTowerTurn(localState, 3);
  localState.playsRemaining = 2;

  const firstIndex = localState.hand.findIndex((card) => card.id === "ACTIVE-A");
  assert.ok(firstIndex >= 0);
  playTowerCard(localState, firstIndex);
  assert.equal(localState.exam.review, 1, "only the first same-item enchant fires at this timing");

  const secondIndex = localState.hand.findIndex((card) => card.id === "ACTIVE-B");
  assert.ok(secondIndex >= 0);
  playTowerCard(localState, secondIndex);
  assert.equal(localState.exam.review, 11, "the skipped same-item enchant remains eligible at the next timing");
}

// Non-canonical IDs must execute from the master effect type instead of
// falling back to the old ID-pattern whitelist.
{
  const genericEffect = {
    id: "effect-generic-block-fix",
    effectType: "ProduceExamEffectType_ExamBlockFix",
    effectValue1: 7,
    effectValue2: 0,
    effectCount: 0,
    effectTurn: 0,
    chainProduceExamEffectIds: [],
    produceCardGrowEffectIds: [],
  };
  const genericCard = {
    id: "GENERIC",
    category: "ProduceCardCategory_MentalSkill",
    rarity: "ProduceCardRarity_R",
    planType: "ProducePlanType_Plan1",
    playMovePositionType: "ProduceCardMovePositionType_Grave",
    playEffects: [{ produceExamEffectId: genericEffect.id, produceExamTriggerId: "generic-trigger" }],
  };
  const localState = createTowerTurnState(
    [{ id: genericCard.id }],
    1,
    new Map([[genericCard.id, genericCard]]),
    {
      examEffectById: new Map([[genericEffect.id, genericEffect]]),
      examTriggerById: new Map([["generic-trigger", {
        id: "generic-trigger",
        phaseTypes: ["ProduceExamPhaseType_None"],
        fieldStatusCheckTypes: [],
        fieldStatusTypes: ["ProduceExamFieldStatusType_NoBlock"],
        fieldStatusValues: [],
        fieldStatusProduceCardSearchIds: [],
        produceCardSearchId: "",
        effectTypes: [],
        lessonType: "ProduceStepLessonType_Unknown",
      }]]),
      stamina: 20,
    },
  );
  drawTowerTurn(localState, 1);
  playTowerCard(localState, 0);
  assert.equal(localState.exam.block, 7);
  assert.deepEqual(localState.unsupported, []);
}

// ProduceEffect P-item rows are out-of-exam effects, not battle-runtime
// failures. Keeping them silent prevents every mixed P-item from being marked
// uncertain during seed replay.
{
  const localState = createTowerTurnState(
    [{ id: "MENTAL" }],
    1,
    cardById,
    {
      pItems: [{
        id: "out-game-item",
        effects: [{
          id: "out-game-effect",
          effectType: "ProduceItemEffectType_ProduceEffect",
          produceEffectId: "p_effect-test",
        }],
      }],
    },
  );
  assert.deepEqual(localState.unsupported, []);
}

console.log("P-item runtime tests: ok");
