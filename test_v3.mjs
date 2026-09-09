import assert from "node:assert/strict";
import { simulateCards } from "./web/engine.js";
import {
  deriveSeedChoiceVariants,
  observationCardLabel,
  runOrderMonteCarlo,
  scanSeedRange,
  seedIntervalFromChoices,
  seedMatchesChoices,
  seedMatchesObservedDraws,
  simulateTurnRecycleDraws,
  validateObservedDraws,
} from "./web/sim_v3.js";

const cards = "ABCDEFGH".split("").map((id) => ({ id, fixedDeckOrder: 0, upgradeCount: 0 }));
const seed = 0x12345678;
const known = simulateCards(cards, seed, 8);
assert.equal(known.initialDeck.map((card) => card.id).join(""), "GFECBHDA");

const derived = deriveSeedChoiceVariants(cards, known.initialDeck.map((card) => card.id));
assert.equal(derived.truncated, false);
assert.equal(derived.variants.length, 1);
const choices = derived.variants[0];
assert.equal(seedMatchesChoices(seed, choices), true);
const interval = seedIntervalFromChoices(choices);
assert.ok(seed >= interval.start && seed < interval.end);
const localMatches = scanSeedRange(choices, seed - 1000, seed + 1001, 20);
assert.ok(localMatches.includes(seed >>> 0));

assert.equal(observationCardLabel("集中+++", 0), "集中");
assert.equal(observationCardLabel("集中+++", 1), "集中+");
assert.equal(observationCardLabel("集中", 1), "集中+");

const elevenCards = Array.from({ length: 11 }, (_, index) => ({
  id: String(index + 1),
  fixedDeckOrder: 0,
  upgradeCount: 0,
}));
// Seed identification always skips. Seed 14 yields a case where draw #12
// happens after recycling only the first three completed 3-card hands. The
// current hand's draw #10/#11 is not part of the recycle source.
const recycleRun = simulateTurnRecycleDraws(elevenCards, 14, 12, 3);
assert.equal(recycleRun.draws.length, 12);
assert.equal(recycleRun.recycleEvents.length, 1);
assert.equal(recycleRun.recycleEvents[0].drawIndex, 11);
assert.deepEqual(
  [...recycleRun.recycleEvents[0].source].sort(),
  [...recycleRun.initialDeck.slice(0, 9)].sort(),
);
assert.equal(recycleRun.recycleEvents[0].source.includes(recycleRun.initialDeck[9]), false);
assert.equal(recycleRun.recycleEvents[0].source.includes(recycleRun.initialDeck[10]), false);
assert.equal(recycleRun.draws[11], recycleRun.draws[5]);

const recycleObserved = validateObservedDraws(elevenCards, recycleRun.draws, 3);
assert.equal(recycleObserved.length, 12);
assert.equal(seedMatchesObservedDraws(14, elevenCards, recycleObserved, 3), true);
assert.equal(seedMatchesObservedDraws(15, elevenCards, recycleObserved, 3), false);
assert.throws(
  () => validateObservedDraws(elevenCards, recycleRun.draws.slice(0, 10), 3),
  /最初の11ドロー/,
);

const duplicateCards = ["A", "A", "B", "C", "D"].map((id) => ({ id, fixedDeckOrder: 0, upgradeCount: 0 }));
const duplicateSeed = 0x89abcdef;
const duplicateRun = simulateCards(duplicateCards, duplicateSeed, 5);
const duplicateDerived = deriveSeedChoiceVariants(duplicateCards, duplicateRun.initialDeck.map((card) => card.id));
assert.ok(duplicateDerived.variants.some((variant) => seedMatchesChoices(duplicateSeed, variant)));

const monte = runOrderMonteCarlo(cards, 100, 0x2468ace0, 3);
assert.equal(monte.count, 100);
assert.equal(monte.scoreSupported, false);
assert.equal(monte.firstCard.reduce((sum, row) => sum + row.count, 0), 100);
assert.equal(monte.firstHand.reduce((sum, row) => sum + row.count, 0), 100);
assert.equal(monte.samples.length, 20);

console.log("v3 tests: ok");
