import assert from "node:assert/strict";
import {
  CONTEST_MASTER_FILES, fetchTemporaryContestCatalog, parseContestMasters, resolveDiffCommit,
} from "../tools/contest_catalog_provider.mjs";

const sha = "1".repeat(40);
const fixtures = Object.fromEntries(Object.values(CONTEST_MASTER_FILES).map(filename=>[
  filename, "- id: example\n  name: Example\n",
]));
fixtures["ProduceCard.yaml"] = [
  "- id: p_card-01-men-0_007",
  "  upgradeCount: 0",
  "  name: Card zero",
  "  produceCardCustomizeIds:",
  "  - route-a",
  "  - route-b",
  "  playEffects:",
  "  - produceExamEffectId: e_effect-example",
  "- id: p_card-01-men-0_007",
  "  upgradeCount: 1",
  "  name: Card plus",
  "  playEffects: []",
].join("\n") + "\n";
fixtures["ProduceItem.yaml"] = "- id: pitem_test\n  name: Test\n  produceItemEffectIds:\n  - pitem_effect_1\n";
fixtures["ProduceItemEffect.yaml"] = "- id: pitem_effect_1\n  effectType: ProduceItemEffectType_ExamStatusEnchant\n";
fixtures["ProduceExamEffect.yaml"] = "- id: e_effect-example\n  effectType: ProduceExamEffectType_ExamLesson\n  effectValue1: 10\n";
fixtures["ProduceExamTrigger.yaml"] = "- id: e_trigger-example\n  phaseTypes:\n  - ProduceExamPhaseType_StartPlay\n";
fixtures["ExamSetting.yaml"] = "- id: p_exam_setting-1\n  turnStartDistribute: 3\n  handLimit: 5\n";
const catalog = parseContestMasters(fixtures, {commit:sha});
assert.equal(catalog.provenance.gameVersionVerified,false);
assert.equal(catalog.cardVariants.length,2);
assert.equal(catalog.cards.length,1);
assert.equal(catalog.cards[0].upgradeCount,0);
assert.deepEqual(catalog.cardCustomizeRules.find(x=>x.id==="p_card-01-men-0_007").customizeIds,["route-a","route-b"]);
assert.equal(catalog.cardVariants[0].playEffects[0].produceExamEffectId,"e_effect-example");
assert.equal(catalog.examSettings[0].turnStartDistribute,3);
assert.deepEqual(catalog.items[0].produceItemEffectIds,["pitem_effect_1"]);
assert.equal(catalog.itemEffects[0].id,"pitem_effect_1");
assert.throws(()=>parseContestMasters({...fixtures,"ProduceExamEffect.yaml":""}),/Missing or empty/);

const requested=[];
const mockFetch = async url => {
  requested.push(url);
  if (url.includes("/commits/")) return {ok:true,json:async()=>({sha})};
  const file = url.split("/").at(-1);
  if (file in fixtures) return {ok:true,text:async()=>fixtures[file]};
  return {ok:false,status:404};
};
assert.equal(await resolveDiffCommit("main",mockFetch),sha);
const remote = await fetchTemporaryContestCatalog({ref:"main",fetchImpl:mockFetch});
assert.equal(remote.provenance.commit,sha);
assert.equal(remote.provenance.repository,"vertesan/gakumasu-diff");
assert.equal(remote.provenance.gameVersionVerified,false);
assert.equal(Object.keys(remote.provenance.fileSha256).length,Object.keys(CONTEST_MASTER_FILES).length);
assert.ok(requested.every(url=>url.includes("/commits/main")||url.includes("/"+sha+"/")));
await assert.rejects(
  fetchTemporaryContestCatalog({ref:"main",fetchImpl:async url => url.includes("ProduceCard.yaml") ? {ok:false,status:404} : mockFetch(url)}),
  /Contest master fetch failed/,
);
console.log("contest catalog provisional provider tests passed");
