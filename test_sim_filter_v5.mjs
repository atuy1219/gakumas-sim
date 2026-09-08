import assert from "node:assert/strict";
import {
  availableCharacterIds,
  availablePlanTypes,
  filterMemoriesForBuilder,
} from "./web/app_v5.js";

const memories = [
  { userMemoryId: "m1", planType: "ProducePlanType_Plan1", characterId: "jsna" },
  { userMemoryId: "m2", planType: "ProducePlanType_Plan1", characterId: "jsna" },
  { userMemoryId: "m3", planType: "ProducePlanType_Plan1", characterId: "hume" },
  { userMemoryId: "m4", planType: "ProducePlanType_Plan2", characterId: "jsna" },
  { userMemoryId: "m5", planType: "ProducePlanType_Plan3", characterId: "ttmr" },
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
  filterMemoriesForBuilder(memories, "ProducePlanType_Plan1", "jsna").map((memory) => memory.userMemoryId),
  ["m1", "m2"],
);
assert.deepEqual(filterMemoriesForBuilder(memories, "ProducePlanType_Plan2", "hume"), []);
assert.deepEqual(filterMemoriesForBuilder(memories, "", "jsna"), []);
assert.deepEqual(filterMemoriesForBuilder(memories, "ProducePlanType_Plan1", ""), []);

console.log("sim filter v5 tests: ok");
