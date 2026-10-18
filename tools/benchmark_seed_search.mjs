// Compare identical first-cycle constraints using one JavaScript thread.
import assert from "node:assert/strict";
import fs from "node:fs";
import { prepareSeedBatchSearch, seedMatchesChoices } from "../web/simulation.js";
import { solveSeedVariants } from "../web/seed_solver.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../tests/fixtures/seed-search-21-cards.json", import.meta.url)));
const start = performance.now();
const prepared = prepareSeedBatchSearch(fixture.cards, [fixture.observedIds]);
const prepareMs = performance.now() - start;
const runs = [];
for (let run = 0; run < 5; run += 1) {
  const begin = performance.now();
  const result = solveSeedVariants(prepared.choices, { maxMatches: 1000 });
  assert.equal(result.complete, true);
  assert.deepEqual(result.found, [318817053]);
  runs.push({ elapsedMs: performance.now() - begin, ...result });
}
console.log(JSON.stringify({ node: process.version, prepareMs, runs }, null, 2));

if (process.argv.includes("--legacy")) {
  // The old worker checked each state's full list of variants independently.
  const begin = performance.now();
  const found = new Set();
  let scanned = 0;
  for (const [index, group] of prepared.choiceGroups.entries()) {
    for (let seed = group.interval.start; seed < group.interval.end; seed += 1) {
      if (group.variants.some((choices) => seedMatchesChoices(seed, choices))) found.add(seed);
      scanned += 1;
    }
    console.log(JSON.stringify({ group: index, elapsedMs: performance.now() - begin, scanned, found: [...found] }));
  }
  const result = [...found].sort((a, b) => a - b);
  assert.deepEqual(result, runs[0].found);
  console.log(JSON.stringify({ legacyMs: performance.now() - begin, scanned, found: result }));
}
