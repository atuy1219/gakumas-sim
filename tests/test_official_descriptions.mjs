import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseProduceCardCatalogYaml } from "../web/engine.js";
import { parseProduceExamEffectCatalog, parseProduceItemCatalogForExam, parseProduceDrinkCatalog,
  describeCardEffects } from "../web/exam_effects.js";
import { parseOfficialDescriptionParts, officialDescriptionText } from "../web/official_description.js";
import { createTowerTurnState } from "../web/tower_runtime.js";

// Unmodified public master records, gakumasu-diff commit
// 32e80387586d7a1322b6ebc0f3e27ced1564416c.
const cards = parseProduceCardCatalogYaml(readFileSync(new URL("./fixtures/official-descriptions.yaml", import.meta.url), "utf8"));
const effects = parseProduceExamEffectCatalog(readFileSync(new URL("./fixtures/official-description-effects.yaml", import.meta.url), "utf8"));
const catalogs = { examEffectById: new Map(effects.map(row => [row.id, row])) };
const dream = cards.find(card => card.name === "ゆめみごこち+");
assert.deepEqual(describeCardEffects(dream, catalogs), ["好印象消費1", "やる気+5", "スキルカード使用数追加+1", "重複不可"]);
const tea = cards.find(card => card.name === "ティーパーティ+");
assert.deepEqual(describeCardEffects(tea, catalogs), ["消費体力1", "スキルカード使用数追加+1", "スキルカードを引く", "手札をすべてレッスン中強化", "重複不可 レッスン中1回"]);
const adrenaline = cards.find(card => card.name === "アドレナリン全開+");
assert.ok(describeCardEffects(adrenaline, catalogs).includes("好調4ターン"));
assert.ok(describeCardEffects(adrenaline, catalogs).includes("絶好調5ターン"));
const grown = { ...dream, costValue: 0, customGrowEffects: [{ effectType: "ProduceCardGrowEffectType_AggressiveAdd", value: 3 }] };
assert.deepEqual(describeCardEffects(grown, catalogs).slice(0, 3), ["好印象消費0", "やる気+8", "スキルカード使用数追加+1"]);
assert.ok(describeCardEffects({ ...adrenaline, customGrowEffects: [{ effectType: "ProduceCardGrowEffectType_ParameterBuffTurnAdd", value: 2 }] }, catalogs).includes("好調6ターン"));
assert.ok(describeCardEffects({ ...dream, isInitial: true }, catalogs).includes("レッスン開始時手札に入る"));
const state = createTowerTurnState([{ id: dream.id, upgradeCount: 1 }], 123,
  new Map([[dream.id, dream]]), { ...catalogs, cardVariantByKey: new Map([[`${dream.id}@@1`, dream]]) });
assert.equal(officialDescriptionText(state.deck[0].produceDescriptionParts), officialDescriptionText(dream.produceDescriptionParts));

const yaml = `- id: test\n  name: テスト\n  produceDescriptions:\n  - text: "<nobr>パラメータ+10</nobr>"\n  - text: |\n\n  - text: '<color=#fff>元気+5</color>'\n`;
assert.equal(officialDescriptionText(parseOfficialDescriptionParts(yaml).get("test@@0")), "パラメータ+10\n元気+5");
for (const parse of [parseProduceItemCatalogForExam, parseProduceDrinkCatalog]) {
  assert.equal(officialDescriptionText(parse(yaml)[0].produceDescriptionParts), "パラメータ+10\n元気+5");
}
assert.equal(officialDescriptionText([{ text: "&lt;表示&gt; &amp; テキスト" }]), "<表示> & テキスト");
console.log("official master descriptions, customization values, runtime propagation: ok");

// Projected official records from the same master commit: retain all text,
// references and customization metadata; omit unrelated description defaults.
const { parseCustomizeCatalog, parseGrowEffectCatalog, parseCardMemoryRules } = await import("../web/memory_judgement.js");
const { applyCardCustomizations } = await import("../web/card_customization.js");
const { parseProduceExamTriggerCatalog, parseProduceCardStatusEnchantCatalog, parseYamlRecordsWithLists,
  describeOfficialCard } = await import("../web/exam_effects.js");
const { customizeOfficialCardParts } = await import("../web/official_description.js");
const { createSimulationBackup, stringifySimulationBackup, parseSimulationBackup } = await import("../web/simulation_backup.js");
const fixture = name => readFileSync(new URL(`./fixtures/custom-description/${name}.yaml`, import.meta.url), "utf8");
const customCards = parseProduceCardCatalogYaml(fixture("ProduceCard"));
const rules = parseCardMemoryRules(fixture("ProduceCard"));
const customRoutes = parseCustomizeCatalog(fixture("ProduceCardCustomize"));
const grows = parseGrowEffectCatalog(fixture("ProduceCardGrowEffect"));
const map = rows => new Map(rows.map(row => [row.id, row]));
const customCatalogs = {
  examEffectById: map(parseProduceExamEffectCatalog(fixture("ProduceExamEffect"))),
  examTriggerById: map(parseProduceExamTriggerCatalog(fixture("ProduceExamTrigger"))),
  cardStatusEnchantById: map(parseProduceCardStatusEnchantCatalog(fixture("ProduceCardStatusEnchant"))),
  descriptionLabelById: map(parseYamlRecordsWithLists(fixture("ProduceDescriptionLabel"), ["name"])),
};
function customized(name, match, count = 1) {
  const card = customCards.find(row => row.name === name);
  const id = rules.get(card.id).customizeIds.find(id => match(id));
  assert.ok(id, name);
  const result = applyCardCustomizations({ ...card, customizes: [{ id, customizeCount: count }] }, customRoutes, grows);
  assert.deepEqual(customizeOfficialCardParts(result, customCatalogs).unresolved, []);
  return result;
}
const text = card => describeOfficialCard(card, customCatalogs).replace(/\n+/g, "\n");
const firstStep = customized("ファーストステップ+", id => id.includes("effect_add"));
assert.equal(text(firstStep), "元気+6\n体力が50%以上の場合、消費体力削減1\nパラメータ+6\n重複不可 レッスン中1回");
const leap = customized("飛躍+", id => id.includes("play_move_position"));
assert.equal(text(leap), "パラメータ+13\n集中が6以上の場合、パラメータ+15");
const momentum = customized("破竹の勢い+", id => id.endsWith("-a-01"));
assert.equal(text(momentum), "好調が4ターン以上の場合、使用可\n集中+7\n以降の4ターンの間、ターン開始時、パラメータ+5\n重複不可 レッスン中1回");
const parry = customized("奥義、受け流し！+", id => id.endsWith("-a-01"));
assert.match(text(parry), /好調が8ターン以上の場合、2ターン後/);
assert.doesNotMatch(text(parry), /12ターン以上/);
const formal = customized("盛装の華形+++", id => id.endsWith("-1-3"));
assert.equal(text(formal), "パラメータ+25（好調効果を2倍適用）\n好調状態の場合、パラメータ+26（集中効果を3倍適用）\n重複不可 レッスン中1回");
assert.equal(text(formal).match(/パラメータ\+26/g).length, 1, "a bullet before the condition must not duplicate the replaced effect");
const opening = customized("オープニングアクト+", id => id.includes("card_status_enchant_change"));
assert.match(text(opening), /成長：直接効果で強気になった時、自身のパラメータ値増加\+2/);
assert.match(text(customized("オープニングアクト+", id => id.includes("card_status_enchant_change"), 2)), /パラメータ値増加\+5/);
assert.match(text(customized("オープニングアクト+", id => id.includes("effect_change"))), /強気2段階目に変更/);
const baseCopy = JSON.stringify(customCards);
assert.equal(text(formal), text(formal));
assert.equal(JSON.stringify(customCards), baseCopy, "rendering must not mutate the original description fragments");
const missing = customizeOfficialCardParts(firstStep, { ...customCatalogs, examEffectById: new Map() });
assert.ok(missing.unresolved.some(id => id.includes("e_effect-exam_lesson-0006-01")), "missing official fragments are reported");

// The saved runtime must keep the templates needed for rendering customized
// cards after a reload, including their newly added effects and enchantments.
const original = customCards.find(card => card.name === "オープニングアクト+");
const savedState = createTowerTurnState([opening], 123, new Map([[original.id, original]]), {
  ...customCatalogs, customizeById: customRoutes, growEffectById: grows,
  cardVariantByKey: new Map([[`${original.id}@@1`, original]]),
});
const restored = parseSimulationBackup(stringifySimulationBackup(createSimulationBackup(savedState, "exam"))).state;
assert.equal(describeOfficialCard(restored.deck[0], restored), describeOfficialCard(savedState.deck[0], savedState));
for (const position of ["Lost", "Hold"]) {
  const card = { ...leap, playMovePositionType: `ProduceCardMovePositionType_${position}`,
    customGrowEffects: [{ effectType: "ProduceCardGrowEffectType_PlayMovePositionTypeChange", playMovePositionType: `ProduceCardMovePositionType_${position}` }] };
  const state = createTowerTurnState([card], 123, new Map([[card.id, card]]), customCatalogs);
  Object.assign(state.deck[0], { customGrowEffects: card.customGrowEffects, playMovePositionType: card.playMovePositionType });
  const restored = parseSimulationBackup(stringifySimulationBackup(createSimulationBackup(state, "exam"))).state;
  const expected = position === "Lost" ? "レッスン中1回" : "保留";
  assert.ok(describeCardEffects(restored.deck[0], restored).includes(expected));
  assert.equal(describeOfficialCard(restored.deck[0], restored), describeOfficialCard(state.deck[0], state));
}
const initialCard = { ...leap, isInitial: true, customGrowEffects: [
  ...leap.customGrowEffects, { effectType: "ProduceCardGrowEffectType_InitialAdd" },
] };
const initialState = createTowerTurnState([initialCard], 123, new Map([[initialCard.id, initialCard]]), customCatalogs);
Object.assign(initialState.deck[0], { customGrowEffects: initialCard.customGrowEffects, isInitial: true });
const initialRestored = parseSimulationBackup(stringifySimulationBackup(createSimulationBackup(initialState, "exam"))).state;
assert.ok(describeCardEffects(initialRestored.deck[0], initialRestored).includes("レッスン開始時手札に入る"));
console.log("official customization composition: additions, replacement, both trigger contexts, movement, growth and saved reload: ok");
