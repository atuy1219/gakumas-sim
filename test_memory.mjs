// Consolidated memory-related regression tests.

// test_memory_backup.mjs
{
const { default: assert } = await import("node:assert/strict");
const {
  MEMORY_BACKUP_FORMAT,
  MEMORY_BACKUP_VERSION,
  createMemoryBackup,
  parseMemoryBackup,
} = await import("./web/memory_backup.js");

const memories = [
  {
    userMemoryId: "m1",
    name: "one",
    vocal: 100,
    examBattleProduceCards: [{ id: "card-a", upgradeCount: 1, customizes: [{ id: "custom-a", customizeCount: 2 }] }],
    examBattleProduceItemIds: ["item-a"],
  },
  {
    userMemoryId: "m2",
    name: "two",
    activeProduceCardIds: ["card-b"],
    examBattleProduceCards: [{ id: "card-b", fixedDeckOrder: 3 }],
  },
];

const backup = createMemoryBackup(memories, "2026-09-19T00:00:00.000Z");
assert.equal(backup.format, MEMORY_BACKUP_FORMAT);
assert.equal(backup.version, MEMORY_BACKUP_VERSION);
assert.equal(backup.exportedAt, "2026-09-19T00:00:00.000Z");
assert.deepEqual(backup.userMemoryList, memories);
assert.deepEqual(parseMemoryBackup(JSON.stringify(backup)), memories);
assert.throws(() => parseMemoryBackup("{}"), /バックアップ/);
assert.throws(
  () => parseMemoryBackup(JSON.stringify({ ...backup, version: 999 })),
  /未対応/,
);

console.log("memory backup tests: ok");
}

// test_memory_detail_ui.mjs
{
const { default: assert } = await import("node:assert/strict");
const {
  findRestrictedDuplicateIds,
  hasNonZeroMemoryStats,
  hasUsableMemoryStats,
  resolveMemoryPItemIds,
} = await import("./web/memory_detail_ui.js");

const idolById = new Map([
  ["i-campus", {
    id: "i-campus",
    beforeProduceItemId: "pitem-before",
    afterProduceItemId: "pitem-after",
    beforeLevelLimitProduceItemId: "pitem-limit-before",
    afterLevelLimitProduceItemId: "pitem-limit-after",
  }],
]);

assert.equal(hasNonZeroMemoryStats({ power: 1, vocal: 0, dance: 0, visual: 0, stamina: 0 }), true);
assert.equal(hasNonZeroMemoryStats({ power: 0, vocal: 0, dance: 0, visual: 0, stamina: 0 }), false);

assert.deepEqual(
  resolveMemoryPItemIds({
    idolCardId: "i-campus",
    power: 100,
    examBattleProduceItemIds: ["pitem-exact"],
  }, idolById),
  { ids: ["pitem-exact"], source: "memory" },
);

assert.deepEqual(
  resolveMemoryPItemIds({
    idolCardId: "i-campus",
    power: 100,
    examBattleProduceItemIds: [],
  }, idolById),
  { ids: ["pitem-limit-after"], source: "idol" },
);

assert.deepEqual(
  resolveMemoryPItemIds({
    idolCardId: "i-campus",
    power: 0,
    vocal: 0,
    dance: 0,
    visual: 0,
    stamina: 0,
    examBattleProduceItemIds: [],
  }, idolById),
  { ids: [], source: "empty" },
);

const cardById = new Map([
  ["limited", { id: "limited", noDeckDuplication: true }],
  ["normal", { id: "normal", noDeckDuplication: false }],
]);
assert.deepEqual(findRestrictedDuplicateIds(["limited", "normal", "limited"], cardById), ["limited"]);
assert.deepEqual(findRestrictedDuplicateIds(["normal", "normal"], cardById), []);

assert.equal(hasUsableMemoryStats({ power: 15744, vocal: 0, dance: 0, visual: 0, stamina: 0 }), false);
assert.equal(hasUsableMemoryStats({ power: 15744, vocal: 100, dance: 0, visual: 0, stamina: 0 }), true);

assert.equal(hasUsableMemoryStats({ power: 15744, raw: { vocal: 321, dance: 654, visual: 987, stamina: 42 } }), true);
assert.deepEqual(
  resolveMemoryPItemIds({
    idolCardId: "i-campus",
    power: 15744,
    raw: { examBattleProduceItemIds: ["pitem-from-raw"] },
  }, idolById),
  { ids: ["pitem-from-raw"], source: "memory" },
);

console.log("memory detail UI tests: ok");
}

// test_memory_judgement.mjs
{
const { default: assert } = await import("node:assert/strict");
const {
  describeCustomize,
  judgeCardCustomization,
  parseCardMemoryRules,
  parseCustomizeCatalog,
  parseCustomizeRarityEvaluations,
  parseGrowEffectCatalog,
} = await import("./web/memory_judgement.js");

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
}

// test_simulator_filter.mjs
{
const { default: assert } = await import("node:assert/strict");
const {
  availableCharacterIds,
  availableIdolCardIds,
  availablePlanTypes,
  filterMemoriesForBuilder,
} = await import("./web/simulator_filter.js");

const memories = [
  { userMemoryId: "m1", planType: "ProducePlanType_Plan1", characterId: "jsna", idolCardId: "i-campus" },
  { userMemoryId: "m2", planType: "ProducePlanType_Plan1", characterId: "jsna", idolCardId: "i-first" },
  { userMemoryId: "m3", planType: "ProducePlanType_Plan1", characterId: "hume", idolCardId: "i-hume" },
  { userMemoryId: "m4", planType: "ProducePlanType_Plan2", characterId: "jsna", idolCardId: "i-logic" },
  { userMemoryId: "m5", planType: "ProducePlanType_Plan3", characterId: "ttmr", idolCardId: "i-anomaly" },
  { userMemoryId: "m6", planType: "ProducePlanType_Plan1", characterId: "jsna", idolCardId: "i-campus" },
];

assert.deepEqual(availablePlanTypes(memories), [
  "ProducePlanType_Plan1",
  "ProducePlanType_Plan2",
  "ProducePlanType_Plan3",
]);

assert.deepEqual(
  new Set(availableCharacterIds(memories, "ProducePlanType_Plan1")),
  new Set(["jsna", "hume"]),
);
assert.deepEqual(availableCharacterIds(memories, ""), []);
assert.deepEqual(
  new Set(availableIdolCardIds(memories, "ProducePlanType_Plan1", "jsna")),
  new Set(["i-campus", "i-first"]),
);
assert.deepEqual(availableIdolCardIds(memories, "ProducePlanType_Plan1", ""), []);

assert.deepEqual(
  filterMemoriesForBuilder(memories, "ProducePlanType_Plan1", "jsna").map((memory) => memory.userMemoryId),
  ["m1", "m2", "m6"],
);
assert.deepEqual(
  filterMemoriesForBuilder(memories, "ProducePlanType_Plan1", "jsna", "i-campus").map((memory) => memory.userMemoryId),
  ["m1", "m6"],
);
assert.deepEqual(
  filterMemoriesForBuilder(memories, "ProducePlanType_Plan1", "jsna", "i-first").map((memory) => memory.userMemoryId),
  ["m2"],
);
assert.deepEqual(filterMemoriesForBuilder(memories, "ProducePlanType_Plan2", "hume"), []);
assert.deepEqual(filterMemoriesForBuilder(memories, "", "jsna"), []);
assert.deepEqual(filterMemoriesForBuilder(memories, "ProducePlanType_Plan1", ""), []);

console.log("simulator filter tests: ok");
}

