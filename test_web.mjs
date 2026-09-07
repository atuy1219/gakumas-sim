import assert from "node:assert/strict";
import { XorShift32, parseSeed, shuffleDeck, simulateDistribution } from "./web/engine.js";

const rng = new XorShift32(0x12345678);
assert.equal(rng.nextU32(), 0x87985aa5);
assert.equal(rng.nextU32(), 0x155b24a3);
assert.equal(rng.nextU32(), 0x4820f4c4);

const deck = [..."ABCDEFGH"].map((id) => ({ id, fixedDeckOrder: 0 }));
const result = shuffleDeck(deck, 0x12345678);
assert.deepEqual(result.cards.map((c) => c.id), [..."GFECBHDA"]);
assert.equal(result.randomState, 0x89ca4f1d);

const fixed = shuffleDeck([
  { id: "c", fixedDeckOrder: 3 },
  { id: "a", fixedDeckOrder: 1 },
  { id: "b", fixedDeckOrder: 2 },
], 1234);
assert.deepEqual(fixed.cards.map((c) => c.id), ["a", "b", "c"]);
assert.equal(fixed.randomState, 1234);

assert.equal(parseSeed("0xFFFFFFFF"), 0xffffffff);
assert.equal(parseSeed("4294967297"), 1);

const dist = simulateDistribution("A\nB\nC\nD", "1", 2);
assert.equal(dist.draw.length, 2);
assert.deepEqual(dist.draw, dist.initialDeck.slice(0, 2));

console.log("web parity tests: ok");
