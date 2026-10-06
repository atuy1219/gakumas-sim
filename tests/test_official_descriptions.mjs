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
