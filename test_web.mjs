import assert from "node:assert/strict";
import {
  XorShift32,
  cardDisplayName,
  composeMemoryDeck,
  composeSelectedMemories,
  createManualMemory,
  extractMemories,
  extractStartPlayers,
  extractUserMemoryList,
  mergeMemoryLibraries,
  parseExamInitialDeckYaml,
  parseMemoryExportText,
  parseProduceCardCatalogYaml,
  parseSeed,
  resolveCardInput,
  resolveContestInitialDeck,
  shuffleDeck,
  simulateDistribution,
  simulateMemoryLibrary,
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

const cardYaml = `- id: p_card-a\n  upgradeCount: 0\n  name: アピールの基本\n  planType: ProducePlanType_Common\n  category: ProduceCardCategory_ActiveSkill\n- id: p_card-b\n  upgradeCount: 1\n  name: テストカード+\n  planType: ProducePlanType_Sense\n`;
const catalogCards = parseProduceCardCatalogYaml(cardYaml);
assert.equal(catalogCards.length, 2);
assert.equal(catalogCards[0].name, "アピールの基本");
assert.equal(catalogCards[1].upgradeCount, 1);
const cardById = new Map(catalogCards.map((card) => [card.id, card]));
assert.equal(cardDisplayName("p_card-a", cardById), "アピールの基本");
assert.equal(resolveCardInput("アピールの基本", catalogCards).id, "p_card-a");
assert.equal(resolveCardInput("テストカード+ — p_card-b", catalogCards).id, "p_card-b");

const initialYaml = `- id: initial_deck-contest-i_card-test\n  produceCardIds:\n  - p_card-a\n  - p_card-b\n  produceCardUpgradeCounts:\n  - 0\n  - 1\n- id: initial_deck-other\n  produceCardIds: []\n  produceCardUpgradeCounts: []\n`;
const initialDecks = parseExamInitialDeckYaml(initialYaml);
assert.equal(initialDecks.length, 2);
assert.deepEqual(initialDecks[0].cards.map((c) => c.id), ["p_card-a", "p_card-b"]);
assert.deepEqual(initialDecks[0].cards.map((c) => c.upgradeCount), [0, 1]);
assert.equal(resolveContestInitialDeck("i_card-test", new Map(initialDecks.map((x) => [x.id, x]))).id, "initial_deck-contest-i_card-test");

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

const userData = {
  response: {
    userData: {
      userMemoryList: [
        { userMemoryId: "owned-1", power: 12345, idolCardId: "i_card-test", examBattleProduceCards: [{ id: "A" }, { id: "B", upgradeCount: 1 }] },
        { userMemoryId: "owned-2", power: 23456, idolCardId: "i_card-test2", examBattleProduceCards: [{ id: "C" }, { id: "D" }] },
      ],
    },
  },
};
const owned = extractUserMemoryList(userData);
assert.equal(owned.length, 2);
assert.equal(owned[0].power, 12345);
assert.deepEqual(owned[0].examBattleProduceCards.map((card) => card.id), ["A", "B"]);
assert.equal(extractMemories(userData).length, 2);
const overUpgradedMemory = extractMemories({ userMemoryList: [{ userMemoryId: "upgrade-limit", examBattleProduceCards: [{ id: "LIMIT", upgradeCount: 3 }] }] })[0];
assert.equal(overUpgradedMemory.examBattleProduceCards[0].upgradeCount, 1);

const exportText = `noise\nGAKUMAS_MEMORY ${JSON.stringify(userData.response.userData.userMemoryList[0])}\n[device] something\nGAKUMAS_MEMORY ${JSON.stringify(userData.response.userData.userMemoryList[1])}\n`;
const parsedExport = parseMemoryExportText(exportText);
assert.equal(extractMemories(parsedExport).length, 2);
const fridaStyleExport = `[memory-export] ready: Assembly-CSharp.dll\nGAKUMAS_MEMORY ${JSON.stringify(userData.response.userData.userMemoryList[0])}\n`;
assert.equal(extractMemories(parseMemoryExportText(fridaStyleExport)).length, 1);
assert.deepEqual(parseMemoryExportText(JSON.stringify(userData)), userData);

const manual = createManualMemory({
  userMemoryId: "manual-one",
  label: "手動メモリー",
  idolCardId: "i_card-manual",
  cards: [{ id: "E" }, { id: "F" }],
  activeProduceCardIds: ["E"],
});
assert.equal(manual.label, "手動メモリー");
assert.deepEqual(manual.activeProduceCardIds, ["E"]);
const merged = mergeMemoryLibraries(owned, [manual]);
assert.equal(merged.length, 3);

const libraryComposition = composeSelectedMemories(
  merged,
  [
    { userMemoryId: "owned-1", activeProduceCardIds: ["A", "B"] },
    { userMemoryId: "owned-2", activeProduceCardIds: ["C", "D"] },
    { userMemoryId: "manual-one", activeProduceCardIds: ["E", "F"] },
  ],
  [{ id: "G" }, { id: "H" }],
);
assert.deepEqual(libraryComposition.cards.map((card) => card.id), [..."ABCDEFGH"]);
const libraryResult = simulateMemoryLibrary(
  merged,
  libraryComposition.selections.map((selection) => ({ userMemoryId: selection.memory.userMemoryId, activeProduceCardIds: selection.activeIds })),
  [{ id: "G" }, { id: "H" }],
  "0x12345678",
  3,
);
assert.deepEqual(libraryResult.initialDeck.map((card) => card.id), [..."GFECBHDA"]);

const memoryPayload = {
  memories: [
    { memory: { userMemoryId: "m-main", idolCardId: "idol-a", examBattleProduceCards: [{ id: "A" }, { id: "B" }] }, activeProduceCardIds: ["A", "B"] },
    { memory: { userMemoryId: "m-sub1", idolCardId: "idol-b", examBattleProduceCards: [{ id: "C" }, { id: "D" }] }, activeProduceCardIds: ["C", "D"] },
    { memory: { userMemoryId: "m-sub2", idolCardId: "idol-c", examBattleProduceCards: [{ id: "E" }, { id: "F" }] }, activeProduceCardIds: ["E", "F"] },
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
assert.throws(
  () => composeSelectedMemories(owned, [{ userMemoryId: "owned-1", activeProduceCardIds: [] }, { userMemoryId: "owned-2", activeProduceCardIds: ["C"] }]),
  /有効カード/,
);

const towerFourth = createManualMemory({
  userMemoryId: "tower-fourth",
  label: "ドル道4枚目",
  cards: [{ id: "I" }],
  activeProduceCardIds: ["I"],
});
const towerLibrary = mergeMemoryLibraries(merged, [towerFourth]);
const towerSelections = [
  { userMemoryId: "owned-1", activeProduceCardIds: ["A", "B"] },
  { userMemoryId: "owned-2", activeProduceCardIds: ["C", "D"] },
  { userMemoryId: "manual-one", activeProduceCardIds: ["E", "F"] },
  { userMemoryId: "tower-fourth", activeProduceCardIds: ["I"] },
];
assert.throws(() => composeSelectedMemories(towerLibrary, towerSelections), /2枚または3枚/);
const towerFourComposition = composeSelectedMemories(towerLibrary, towerSelections, [], 4);
assert.equal(towerFourComposition.memories.length, 4);
assert.deepEqual(towerFourComposition.cards.map((card) => card.id), ["A", "B", "C", "D", "E", "F", "I"]);

const towerHtml = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./web/index.html", import.meta.url), "utf8"));
assert.match(towerHtml, /id="tower-memory-count"[^>]*>[\s\S]*?<option value="4">4枚<\/option>/);

console.log("web parity tests: ok");
