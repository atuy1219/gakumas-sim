import assert from "node:assert/strict";
import fs from "node:fs";
import { Worker } from "node:worker_threads";
import {
  prepareSeedBatchSearch,
  seedMatchesChoices,
  simulateTurnRecycleDraws,
  xorshift32,
} from "../web/simulation.js";
import { solveSeedVariants } from "../web/seed_solver.js";

// Differential tests compare the entire solution set, not just a known seed.
function brute(variants, start, end, accept = () => true) {
  const found = [];
  for (let seed = start; seed < end; seed += 1) {
    if (variants.some((choices) => seedMatchesChoices(seed, choices)) && accept(seed)) found.push(seed);
  }
  return found;
}
function compare(variants, start, end, accept) {
  const actual = solveSeedVariants(variants, { start, end, maxMatches: 1_000_000, accept });
  assert.equal(actual.complete, true);
  assert.deepEqual(actual.found, brute(variants, start, end, accept));
}

for (const start of [0, 65531, 0x7fff8000, 0xffff8000]) {
  for (const n of [2, 3, 7, 12, 21]) {
    const cards = Array.from({ length: n }, (_, index) => ({
      id: String(index === 3 ? 2 : index),
      isInitial: n >= 7 && index < 2,
    }));
    const seed = (start + 14321) >>> 0;
    const observed = simulateTurnRecycleDraws(cards, seed, n).draws;
    const prepared = prepareSeedBatchSearch(cards, [observed]);
    compare(prepared.choices, start, start + 32768);
  }
}
// Force bucket boundaries, contradictory equations, zero, and UINT32_MAX.
for (const choices of [
  [{ n: 3, j: 1 }, { n: 2, j: 0 }],
  [{ n: 32, j: 31 }, { n: 32, j: 31 }],
  [{ n: 21, j: 0 }, { n: 20, j: 0 }, { n: 19, j: 0 }],
  [{ n: 3, j: -1 }],
  [{ n: 3, j: 3 }],
]) {
  compare([choices], 0, 65536);
  compare([choices], 0xffff0000, 2 ** 32);
}
compare([[]], 1000, 1023);
compare([[{ n: 2, j: 1 }]], 0x80000000 - 100, 0x80000000 + 100);
compare([[{ n: 2, j: 1 }]], 0xfffffffe, 2 ** 32);
compare([[{ n: 2, j: 0 }]], 999, 999);
// Exact integer interval boundaries must also be checked after approximation.
for (const n of [3, 7, 21]) {
  for (let j = 1; j < n; j += 1) {
    const boundary = Math.ceil(j * 2 ** 32 / n);
    compare([[{ n, j }]], boundary - 3, boundary + 3);
  }
}
const duplicates = [[{ n: 2, j: 0 }], [{ n: 2, j: 0 }]];
compare(duplicates, 0, 100, (seed) => (xorshift32(seed) & 1) === 1);
const limited = solveSeedVariants(duplicates, { start: 0, end: 1000, maxMatches: 3 });
assert.equal(limited.complete, false);
assert.equal(limited.found.length, 3);
assert.equal(new Set(limited.found).size, 3);
assert.deepEqual(solveSeedVariants([], {}).found, []);

// This is the user's actual 21-card case, including two IsInitial cards and
// two copies of やる気は満点. No memory IDs or account data are retained.
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/seed-search-21-cards.json", import.meta.url)));
const prepared = prepareSeedBatchSearch(fixture.cards, [fixture.observedIds]);
assert.equal(prepared.choices.length, 420);
const result = solveSeedVariants(prepared.choices, { maxMatches: 1000 });
assert.equal(result.complete, true);
assert.deepEqual(result.found, [318817053]);
assert.deepEqual(simulateTurnRecycleDraws(fixture.cards, result.found[0], 21).draws, fixture.observedIds);
assert.ok(result.stats.candidates < 1_000_000, "must avoid scanning hundreds of millions of states");
// Match the UI's task boundaries and exercise the module Worker entry point.
let message;
globalThis.self = { postMessage: (value) => { message = value; } };
await import("../web/seed_worker.js");
const workerMatches = new Set();
for (let i = 0; i < prepared.choices.length; i += 32) {
  self.onmessage({ data: { type: "scan", taskId: i, choiceVariants: prepared.choices.slice(i, i + 32), maxMatches: 1000 } });
  assert.equal(message.type, "done");
  assert.equal(message.taskId, i);
  assert.equal(message.complete, true);
  assert.equal(message.scanned, prepared.choices.slice(i, i + 32).length);
  for (const seed of message.found) workerMatches.add(seed);
}
assert.deepEqual([...workerMatches], result.found);
delete globalThis.self;
// Exercise imports and message passing in a fresh, actual module Worker too.
const workerUrl = new URL("../web/seed_worker.js", import.meta.url).href;
const worker = new Worker(`
  const { parentPort } = require("node:worker_threads");
  globalThis.self = { postMessage: (value) => parentPort.postMessage(value) };
  import(${JSON.stringify(workerUrl)}).then(() => {
    parentPort.on("message", (data) => self.onmessage({ data }));
    parentPort.postMessage({ type: "ready" });
  });
`, { eval: true });
try {
  const reply = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("seed Worker timed out")), 10_000);
    worker.once("error", (error) => { clearTimeout(timeout); reject(error); });
    worker.on("message", (data) => {
      if (data.type === "ready") {
        worker.postMessage({ type: "scan", choiceVariants: prepared.choices, maxMatches: 1000 });
      } else {
        clearTimeout(timeout);
        resolve(data);
      }
    });
  });
  assert.equal(reply.complete, true);
  assert.deepEqual(reply.found, result.found);
} finally {
  await worker.terminate();
}
console.log("seed solver differential, boundary, worker, and 21-card tests: ok");
