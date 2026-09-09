import assert from "node:assert/strict";
import { simulateCards } from "./web/engine.js";
import {
  deriveSeedChoiceVariants,
  observationCardLabel,
  runOrderMonteCarlo,
  scanSeedRange,
  seedIntervalFromChoices,
  seedMatchesChoices,
  seedMatchesObservedRounds,
  simulateShuffleRounds,
  validateObservedRounds,
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

const multi = simulateShuffleRounds(cards, seed, 3);
assert.equal(multi.rounds[0].join(""), known.initialDeck.map((card) => card.id).join(""));
const multiObserved = [...multi.rounds[0], ...multi.rounds[1].slice(0, 4)];
const multiRounds = validateObservedRounds(cards, multiObserved);
assert.equal(multiRounds.length, 2);
assert.equal(multiRounds[1].length, 4);
assert.equal(seedMatchesObservedRounds(seed, cards, multiRounds), true);
assert.equal(seedMatchesObservedRounds((seed + 1) >>> 0, cards, multiRounds), false);
assert.throws(() => validateObservedRounds(cards, multi.rounds[0].slice(0, 7)), /1周目/);

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
