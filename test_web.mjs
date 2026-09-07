import assert from "node:assert/strict";
import {
  XorShift32,
  composeMemoryDeck,
  extractMemories,
  extractStartPlayers,
  parseSeed,
  shuffleDeck,
  simulateDistribution,
  simulateMemorySelection,
  simulateStartPlayer,
} from "./web/engine.js";

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

const startPayload = {
  examContestSituation: {
    stages: [{
      selfSections: [{ player: { seed: 0x12345678, characterId: "c1", idolCardId: "i1", produceCards: [..."ABCDEFGH"].map((id) => ({ id, upgradeCount: 0 })) } }],
      rivalSections: [{ player: { seed: 7, produceCards: [{ id: "R1" }, { id: "R2" }] } }],
    }],
  },
};
const players = extractStartPlayers(startPayload);
assert.equal(players.length, 2);
assert.equal(players[0].key, "self-0-0");
assert.equal(players[0].seed, 0x12345678);
const exact = simulateStartPlayer(startPayload, "self-0-0", 3);
assert.deepEqual(exact.initialDeck.map((c) => c.id), [..."GFECBHDA"]);
assert.deepEqual(exact.draw.map((c) => c.id), [..."GFE"]);

const memoryPayload = {
  memories: [
    {
      memory: { userMemoryId: "m-main", idolCardId: "idol-a", examBattleProduceCards: [{ id: "A" }, { id: "B" }] },
      activeProduceCardIds: ["A", "B"],
    },
    {
      memory: { userMemoryId: "m-sub1", idolCardId: "idol-b", examBattleProduceCards: [{ id: "C" }, { id: "D" }] },
      activeProduceCardIds: ["C", "D"],
    },
    {
      memory: { userMemoryId: "m-sub2", idolCardId: "idol-c", examBattleProduceCards: [{ id: "E" }, { id: "F" }] },
      activeProduceCardIds: ["E", "F"],
    },
  ],
  baseProduceCards: [{ id: "G" }, { id: "H" }],
};
assert.equal(extractMemories(memoryPayload).length, 3);
const composed = composeMemoryDeck(memoryPayload, ["m-main", "m-sub1", "m-sub2"]);
assert.deepEqual(composed.cards.map((c) => c.id), [..."ABCDEFGH"]);
const selected = simulateMemorySelection(memoryPayload, ["m-main", "m-sub1", "m-sub2"], "0x12345678", 3);
assert.deepEqual(selected.initialDeck.map((c) => c.id), [..."GFECBHDA"]);

assert.throws(
  () => composeMemoryDeck({ memories: [{ userMemoryId: "a", examBattleProduceCards: [{ id: "A" }] }, { userMemoryId: "b", examBattleProduceCards: [{ id: "B" }] }] }, ["a", "b"]),
  /ActiveProduceCardIds/,
);

console.log("web parity tests: ok");
