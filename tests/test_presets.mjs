// Consolidated preset format regression tests.

// test_exam_preset.mjs
{
const { default: assert } = await import("node:assert/strict");
const {
  EXAM_PRESET_FORMAT,
  EXAM_PRESET_VERSION,
  createExamPreset,
  parseExamPreset,
} = await import("../web/exam_preset.js");

const preset = createExamPreset({
  characterId: "hski",
  planType: "ProducePlanType_Plan1",
  idolCardId: "i_card-hski-3-001",
  cardPoolMode: "highScore",
  cards: [{ id: "p_card-a", count: 2 }, { id: "p_card-b", count: 1 }],
  manualCards: [
    { id: "p_card-a", upgradeCount: 1, customizes: [{ id: "custom-a", customizeCount: 2 }] },
    { id: "p_card-a", upgradeCount: 0, customizes: [] },
    { id: "p_card-b", upgradeCount: 0, customizes: [] },
  ],
  progressCards: [
    { number: 7, produceCardId: "p_card-a", upgradeCount: 1, deleted: false, originType: "ProduceCardOriginType_Memory", customField: "preserve" },
    { number: 3, produceCardId: "p_card-b", upgradeCount: 0, deleted: false, originType: "ProduceCardOriginType_Initial" },
  ],
  supportCards: [
    { supportCardId: "support-a", rarity: "SSR", filterParameterType: "ProduceExamParameterType_Vocal", cardSearchId: "search-a", produceCardUpgradePermil: 300, limitBreak: 3 },
  ],
  turnParameterTypes: ["Dance", "Visual", "Dance"],
  stamina: 30,
  targetScore: 12000,
});
assert.equal(preset.format, EXAM_PRESET_FORMAT);
assert.equal(preset.version, EXAM_PRESET_VERSION);
assert.equal(preset.characterId, "hski");
assert.equal(preset.cardPoolMode, "highScore");
assert.deepEqual(preset.cards, [{ id: "p_card-a", count: 2 }, { id: "p_card-b", count: 1 }]);
assert.equal(preset.manualCards.length, 3);
assert.deepEqual(preset.manualCards[0].customizes, [{ id: "custom-a", customizeCount: 2 }]);
assert.equal(preset.progressCards.length, 2);
assert.equal(preset.progressCards[0].customField, "preserve");
assert.deepEqual(preset.supportCards, [{
  supportCardId: "support-a",
  rarity: "SSR",
  filterParameterType: "ProduceExamParameterType_Vocal",
  cardSearchId: "search-a",
  produceCardUpgradePermil: 300,
  limitBreak: 3,
}]);
assert.deepEqual(preset.turnParameterTypes, ["Dance", "Visual", "Dance"]);
assert.equal(preset.stamina, 30);
assert.equal(preset.targetScore, 12000);

const parsed = parseExamPreset(JSON.stringify(preset));
assert.equal(parsed.idolCardId, "i_card-hski-3-001");
assert.equal(parsed.cardPoolMode, "highScore");
assert.deepEqual(parsed.cards, preset.cards);
assert.deepEqual(parsed.manualCards, preset.manualCards);
assert.deepEqual(parsed.progressCards, preset.progressCards);
assert.deepEqual(parsed.supportCards, preset.supportCards);
assert.deepEqual(parsed.turnParameterTypes, preset.turnParameterTypes);

const legacyPreset = parseExamPreset(JSON.stringify({
  ...preset,
  version: 1,
  cardPoolMode: undefined,
}));
assert.equal(legacyPreset.cardPoolMode, "normal", "v1 preset must remain loadable as the normal card pool");
assert.deepEqual(legacyPreset.manualCards, []);
assert.deepEqual(legacyPreset.progressCards, []);

const v2Preset = parseExamPreset(JSON.stringify({
  ...preset,
  version: 2,
  progressCards: undefined,
}));
assert.equal(v2Preset.cardPoolMode, "highScore");
assert.deepEqual(v2Preset.progressCards, []);

const grouped = createExamPreset({ ...preset, cards: [{ id: "p_card-a", count: 1 }, { id: "p_card-a", count: 2 }] });
assert.deepEqual(grouped.cards, [{ id: "p_card-a", count: 3 }]);
assert.throws(() => parseExamPreset("not-json"), /JSON/);
assert.throws(() => parseExamPreset(JSON.stringify({ ...preset, format: "wrong" })), /編成ファイル/);
assert.throws(() => createExamPreset({ ...preset, cards: [] }), /1枚もありません/);

console.log("exam preset tests: ok");
}

// test_exam_support_cards.mjs
{
const { default: assert } = await import("node:assert/strict");
const {
  defaultSupportUpgradePercent,
  effectiveSupportUpgradePermil,
  formatExamTurnParameterTypes,
  inferSupportLimitBreak,
  normalizeManualSupportCards,
  parseExamTurnParameterTypes,
  supportCardRateBonusPercent,
} = await import("../web/exam_support_cards.js");

assert.equal(defaultSupportUpgradePercent("R", "ProduceParameterType_Vocal"), 1.9);
assert.equal(defaultSupportUpgradePercent("SR", "ProduceParameterType_Dance"), 2.8);
assert.equal(defaultSupportUpgradePercent("SSR", "ProduceParameterType_Visual"), 3.7);
assert.equal(defaultSupportUpgradePercent("SR", "ProduceParameterType_Unknown"), 1.5);
assert.equal(defaultSupportUpgradePercent("SSR", "ProduceParameterType_Unknown"), 2.0);

assert.deepEqual(
  [0, 1, 2, 3, 4].map((limitBreak) => supportCardRateBonusPercent("SSR", limitBreak)),
  [66.1, 74.6, 83.1, 91.5, 100],
);
assert.equal(supportCardRateBonusPercent("SSR", ""), null);
assert.deepEqual(
  [0, 1, 2, 3, 4].map((limitBreak) => supportCardRateBonusPercent("SR", limitBreak)),
  [59.2, 69.4, 79.6, 89.8, 100],
);
assert.deepEqual(
  [0, 1, 2, 3, 4].map((limitBreak) => supportCardRateBonusPercent("R", limitBreak)),
  [48.7, 61.5, 74.4, 87.2, 100],
);
assert.equal(effectiveSupportUpgradePermil("SSR", "ProduceParameterType_Vocal", 0), 61);
assert.equal(effectiveSupportUpgradePermil("SSR", "ProduceParameterType_Vocal", 4), 74);
assert.equal(effectiveSupportUpgradePermil("SR", "ProduceParameterType_Dance", 0), 44);
assert.equal(effectiveSupportUpgradePermil("R", "ProduceParameterType_Visual", 0), 28);
assert.equal(inferSupportLimitBreak("SSR", "ProduceParameterType_Vocal", 61), 0);
assert.equal(inferSupportLimitBreak("SSR", "ProduceParameterType_Vocal", 74), 4);
assert.equal(inferSupportLimitBreak("SSR", "ProduceParameterType_Vocal", 37), null);

const manualSupports = normalizeManualSupportCards(Array.from({ length: 6 }, (_, index) => ({
  slot: index + 1,
  rarity: index % 2 ? "SR" : "SSR",
  filterParameterType: index === 5 ? "ProduceParameterType_Unknown" : "ProduceParameterType_Vocal",
  limitBreak: index === 5 ? "0" : "4",
})));
assert.equal(manualSupports.length, 6);
assert.equal(manualSupports[0].supportCardId, "manual-support-1");
assert.equal(manualSupports[0].produceCardUpgradePermil, 74);
assert.equal(manualSupports[0].baseProduceCardUpgradePermil, 37);
assert.equal(manualSupports[0].skillCardSupportRateBonusPercent, 100);
assert.equal(manualSupports[5].produceCardUpgradePermil, 23);
assert.equal(manualSupports[5].skillCardSupportRateBonusPercent, 59.2);
assert.equal(manualSupports[5].cardSearchId, "p_card_search-hand");
assert.throws(() => normalizeManualSupportCards([{
  slot: 1,
  rarity: "SSR",
  filterParameterType: "ProduceParameterType_Vocal",
  limitBreak: 0,
}]), /6枚すべて/);
assert.throws(() => normalizeManualSupportCards(Array.from({ length: 6 }, (_, index) => ({
  slot: index + 1,
  rarity: "SSR",
  filterParameterType: "ProduceParameterType_Vocal",
  limitBreak: index === 0 ? "" : 4,
}))), /上限解放/);
assert.deepEqual(normalizeManualSupportCards([]), []);
assert.deepEqual(parseExamTurnParameterTypes("Da, Vi → Vo、Da"), ["Dance", "Visual", "Vocal", "Dance"]);
assert.equal(formatExamTurnParameterTypes(["Dance", "Visual", "Vocal"]), "Da, Vi, Vo");
assert.throws(() => parseExamTurnParameterTypes("Da, Unknown"), /認識できません/);
}

// test_tower_preset.mjs
{
const { default: assert } = await import("node:assert/strict");
const {
  createTowerPreset,
  parseTowerPreset,
  TOWER_PRESET_FORMAT,
  TOWER_PRESET_VERSION,
} = await import("../web/tower_preset.js");

const memories = [
  { userMemoryId: "m-main", name: "Main", examBattleProduceCards: [{ id: "A" }, { id: "B" }] },
  { userMemoryId: "m-sub1", name: "Sub1", examBattleProduceCards: [{ id: "C" }] },
  { userMemoryId: "m-sub2", name: "Sub2", examBattleProduceCards: [{ id: "D" }] },
  { userMemoryId: "m-sub3", name: "Sub3", examBattleProduceCards: [{ id: "E" }] },
];
const slots = [
  { userMemoryId: "m-main", activeProduceCardIds: ["A", "B"] },
  { userMemoryId: "m-sub1", activeProduceCardIds: ["C"] },
  { userMemoryId: "m-sub2", activeProduceCardIds: ["D"] },
  { userMemoryId: "m-sub3", activeProduceCardIds: ["E"] },
];

const preset = createTowerPreset({
  memoryCount: 4,
  slots,
  memories,
  baseCards: [{ id: "p_card-basic", upgradeCount: 0 }],
  filter: { planType: "ProducePlanType_Plan1", characterId: "jsna", idolCardId: "" },
});
assert.equal(preset.format, TOWER_PRESET_FORMAT);
assert.equal(preset.version, TOWER_PRESET_VERSION);
assert.equal(preset.memoryCount, 4);
assert.deepEqual(preset.slots, slots);
assert.deepEqual(preset.memories.map((item) => item.userMemoryId), slots.map((item) => item.userMemoryId));
assert.equal(preset.baseCards[0].id, "p_card-basic");
assert.equal(preset.filter.characterId, "jsna");

const parsed = parseTowerPreset(JSON.stringify(preset));
assert.equal(parsed.memoryCount, 4);
assert.deepEqual(parsed.slots, slots);
assert.equal(parsed.memories.length, 4);

assert.throws(() => parseTowerPreset("not json"), /解析できません/);
assert.throws(() => parseTowerPreset(JSON.stringify({ ...preset, format: "wrong" })), /ドル道セットではありません/);
assert.throws(() => createTowerPreset({ ...preset, memoryCount: 5 }), /2〜4枚/);
assert.throws(() => createTowerPreset({ ...preset, memories: memories.slice(0, 3) }), /本体データがありません/);
assert.throws(() => createTowerPreset({ ...preset, slots: [slots[0], { ...slots[1], userMemoryId: "m-main" }, slots[2], slots[3]] }), /同じメモリー/);

console.log("tower preset tests: ok");
}
