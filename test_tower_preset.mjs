import assert from "node:assert/strict";
import {
  createTowerPreset,
  parseTowerPreset,
  TOWER_PRESET_FORMAT,
  TOWER_PRESET_VERSION,
} from "./web/tower_preset.js";

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
