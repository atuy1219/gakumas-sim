import assert from "node:assert/strict";
import {
  findRestrictedDuplicateIds,
  hasNonZeroMemoryStats,
  resolveMemoryPItemIds,
} from "./web/app_v6.js";

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

console.log("app v6 tests: ok");
