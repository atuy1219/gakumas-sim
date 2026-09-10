import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  prepareSeedBatchSearch,
  seedIntervalFromChoices,
  seedMatchesChoices,
  simulateTurnRecycleDraws,
} from "./web/sim_v3.js";

const cards = "ABCDEFGH".split("").map((id) => ({ id }));
const seed = 0x12345678;
const order = simulateTurnRecycleDraws(cards, seed, cards.length, 3).draws;
const batches = [order.slice(0, 3).reverse(), order.slice(3, 5), [order[5]], order.slice(6).reverse()];
const prepared = prepareSeedBatchSearch(cards, batches);
const choices = prepared.choices.find((candidate) => seedMatchesChoices(seed, candidate));
assert.ok(choices);
const interval = seedIntervalFromChoices(choices);

let response = null;
const self = {
  postMessage(message) { response = message; },
};
vm.runInNewContext(fs.readFileSync(new URL("./web/seed_worker.js", import.meta.url), "utf8"), { self, Map, Math, Number, String, Array });
self.onmessage({ data: {
  type: "scan",
  taskId: 1,
  choices,
  batchSearch: { shuffleIds: prepared.shuffleIds, shuffledBatches: prepared.shuffledBatches, prefixVariants: prepared.prefixVariants },
  start: Math.max(interval.start, seed - 10_000),
  end: Math.min(interval.end, seed + 10_001),
  maxMatches: 100,
} });
assert.ok(response.found.includes(seed));

console.log("seed worker tests: ok");
