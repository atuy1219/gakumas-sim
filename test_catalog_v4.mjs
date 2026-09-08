import assert from "node:assert/strict";
import {
  buildCanonicalCardCatalog,
  buildUniqueNameIndex,
  canonicalCardName,
  fetchTextWithFallback,
  gradeLabel,
  parseCharacterCatalog,
  parseGradeCatalog,
  parseIdolCardCatalog,
  parseProduceCardCatalog,
  parseProduceItemCatalog,
  planLabel,
} from "./web/catalog_v4.js";

const characters = parseCharacterCatalog(`- id: jsna\n  lastName: 十王\n  firstName: 星南\n  isPlayable: true\n  order: 10\n- id: npc\n  lastName: 非\n  firstName: 対象\n  isPlayable: false\n  order: 9999\n`);
assert.equal(characters[0].id, "jsna");
assert.equal(characters[0].name, "十王星南");
assert.equal(characters[0].isPlayable, true);
assert.equal(characters[1].isPlayable, false);

const idols = parseIdolCardCatalog(`- id: i_card-jsna-1-001\n  characterId: jsna\n  name: Campus mode!!\n  rarity: IdolCardRarity_R\n  planType: ProducePlanType_Plan1\n  produceVocal: 65\n  produceDance: 55\n  produceVisual: 45\n  produceStamina: 31\n  beforeProduceItemId: pitem-before\n  afterProduceItemId: pitem-after\n  beforeLevelLimitProduceItemId: pitem-limit-before\n  afterLevelLimitProduceItemId: pitem-limit-after\n`);
assert.equal(idols.length, 1);
assert.equal(idols[0].name, "Campus mode!!");
assert.equal(idols[0].characterId, "jsna");
assert.equal(idols[0].produceVocal, 65);
assert.equal(idols[0].produceStamina, 31);
assert.equal(idols[0].beforeProduceItemId, "pitem-before");
assert.equal(idols[0].afterLevelLimitProduceItemId, "pitem-limit-after");

const rawCards = parseProduceCardCatalog(`- id: p_card-00-act-2_009\n  upgradeCount: 0\n  name: 前途洋々\n  planType: ProducePlanType_Common\n  category: ProduceCardCategory_ActiveSkill\n  evaluation: 35\n  noDeckDuplication: true\n- id: p_card-00-act-2_009\n  upgradeCount: 1\n  name: 前途洋々+\n  planType: ProducePlanType_Common\n  category: ProduceCardCategory_ActiveSkill\n  evaluation: 45\n  noDeckDuplication: true\n- id: p_card-00-act-2_009\n  upgradeCount: 3\n  name: 前途洋々+++\n  planType: ProducePlanType_Common\n  category: ProduceCardCategory_ActiveSkill\n- id: p_card-other\n  upgradeCount: 0\n  name: 別カード\n  noDeckDuplication: false\n`);
assert.equal(rawCards.length, 4);
assert.equal(rawCards[0].noDeckDuplication, true);
assert.equal(rawCards[0].evaluation, 35);
assert.equal(canonicalCardName("前途洋々+++", 3), "前途洋々");
const cards = buildCanonicalCardCatalog(rawCards);
assert.equal(cards.length, 2);
const zento = cards.find((card) => card.id === "p_card-00-act-2_009");
assert.equal(zento.baseName, "前途洋々");
assert.equal(zento.upgradeCount, 0);
assert.equal(zento.maxMasterStage, 3);
assert.equal(zento.noDeckDuplication, true);
assert.equal(buildUniqueNameIndex(cards, "baseName").get("前途洋々").id, "p_card-00-act-2_009");

const items = parseProduceItemCatalog(`- id: pitem_00-1-002-0\n  name: 必携ステンレスボトル\n  planType: ProducePlanType_Plan1\n  rarity: ProduceItemRarity_R\n  libraryHidden: false\n  order: "10"\n- id: hidden\n  name: 非表示\n  libraryHidden: true\n`);
assert.equal(items.length, 1);
assert.equal(items[0].name, "必携ステンレスボトル");

const grades = parseGradeCatalog(`- produceGroupId: produce_group-001\n  grade: ResultGrade_F\n  threshold: 0\n- produceGroupId: produce_group-001\n  grade: ResultGrade_APlus\n  threshold: 100\n- produceGroupId: produce_group-002\n  grade: ResultGrade_APlus\n  threshold: 200\n- produceGroupId: produce_group-003\n  grade: ResultGrade_SssPlus\n  threshold: 300\n- produceGroupId: produce_group-004\n  grade: ResultGrade_SS_PLUS\n  threshold: 400\n`);
assert.deepEqual(grades, ["ResultGrade_F", "ResultGrade_APlus", "ResultGrade_SssPlus", "ResultGrade_SS_PLUS"]);
assert.equal(gradeLabel("ResultGrade_APlus"), "A+");
assert.equal(gradeLabel("ResultGrade_SssPlus"), "SSS+");
assert.equal(gradeLabel("SS_PLUS"), "SS+");
assert.equal(gradeLabel("ResultGrade_SS_PLUS"), "SS+");
assert.equal(gradeLabel(13), "SS+");
assert.equal(planLabel("ProducePlanType_Plan1"), "センス");
assert.equal(planLabel("ProducePlanType_Plan2"), "ロジック");
assert.equal(planLabel("ProducePlanType_Plan3"), "アノマリー");

const calls = [];
const fakeFetch = async (url) => {
  calls.push(url);
  if (url === "primary") return { ok: true, text: async () => "" };
  return { ok: true, text: async () => "fallback-data" };
};
assert.equal(await fetchTextWithFallback("primary", "fallback", fakeFetch), "fallback-data");
assert.deepEqual(calls, ["primary", "fallback"]);

console.log("catalog v4 tests: ok");
