import assert from "node:assert/strict";
import { buildExamDeck, changeExamCardCount, filterExamCards, filterExamIdols } from "./web/exam_setup_v9.js";

const idols = [
  { id: "idol-a", characterId: "char-a", planType: "ProducePlanType_Plan1", name: "A" },
  { id: "idol-b", characterId: "char-a", planType: "ProducePlanType_Plan2", name: "B" },
  { id: "idol-c", characterId: "char-b", planType: "ProducePlanType_Plan1", name: "C" },
];
assert.deepEqual(filterExamIdols(idols, "char-a", "ProducePlanType_Plan1").map((idol) => idol.id), ["idol-a"]);
assert.deepEqual(filterExamIdols(idols, "", "ProducePlanType_Plan1"), []);

const cards = [
  { id: "sense", name: "好調", baseName: "好調", planType: "ProducePlanType_Plan1", isInitial: true },
  { id: "logic", name: "好印象", baseName: "好印象", planType: "ProducePlanType_Plan2" },
  { id: "common", name: "アピール", baseName: "アピール", planType: "ProducePlanType_Common" },
  { id: "unique", name: "一度だけ", baseName: "一度だけ", planType: "ProducePlanType_Plan1", noDeckDuplication: true },
];
assert.deepEqual(filterExamCards(cards, "ProducePlanType_Plan1").map((card) => card.id), ["sense", "common", "unique"]);
assert.deepEqual(filterExamCards(cards, "ProducePlanType_Plan1", "アピール").map((card) => card.id), ["common"]);

let counts = new Map();
counts = changeExamCardCount(counts, cards[0], 1);
counts = changeExamCardCount(counts, cards[0], 1);
counts = changeExamCardCount(counts, cards[3], 1);
counts = changeExamCardCount(counts, cards[3], 1);
assert.equal(counts.get("sense"), 2);
assert.equal(counts.get("unique"), 1);
const deck = buildExamDeck(cards, counts);
assert.equal(deck.length, 3);
assert.deepEqual(deck.map((card) => card.id), ["sense", "sense", "unique"]);
assert.equal(deck[0].isInitial, true);
assert.equal(deck[2].isInitial, false);

console.log("exam setup v9 tests: ok");
