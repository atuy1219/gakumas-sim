// Temporary, replaceable provider of contest master data.
// The capture describes the game; this module never uses captured scores as masters.
import { createHash } from "node:crypto";
import { parseProduceCardCatalogYaml } from "../web/engine.js";
import { parseCustomizeCatalog, parseGrowEffectCatalog, parseCardMemoryRules } from "../web/memory_judgement.js";
import {
  parseExamSettingCatalog, parseProduceItemCatalogForExam,
  parseProduceItemEffectCatalog, parseProduceExamStatusEnchantCatalog,
  parseProduceExamTriggerCatalog, parseProduceExamEffectCatalog,
  parseProduceCardSearchCatalog, parseProduceCardRandomPoolCatalog,
  parseProduceCardStatusEnchantCatalog, parseProduceCardPoolCatalog,
} from "../web/exam_effects.js";

export const TEMPORARY_DIFF_REPOSITORY = "vertesan/gakumasu-diff";
export const CONTEST_MASTER_FILES = Object.freeze({
  cards: "ProduceCard.yaml",
  items: "ProduceItem.yaml",
  itemEffects: "ProduceItemEffect.yaml",
  examSettings: "ExamSetting.yaml",
  examEffects: "ProduceExamEffect.yaml",
  examStatusEnchants: "ProduceExamStatusEnchant.yaml",
  examTriggers: "ProduceExamTrigger.yaml",
  cardSearches: "ProduceCardSearch.yaml",
  cardRandomPools: "ProduceCardRandomPool.yaml",
  cardStatusEnchants: "ProduceCardStatusEnchant.yaml",
  cardPools: "ProduceCardPool.yaml",
  cardCustomizes: "ProduceCardCustomize.yaml",
  cardGrowEffects: "ProduceCardGrowEffect.yaml",
});

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
async function requireOk(response, url) {
  if (!response?.ok) throw new Error("Contest master fetch failed (" + (response?.status ?? "network") + "): " + url);
  return response;
}
export async function resolveDiffCommit(ref = "main", fetchImpl = globalThis.fetch) {
  if (/^[a-f0-9]{40}$/i.test(ref)) return ref.toLowerCase();
  if (!/^[\w./-]+$/.test(ref) || ref.includes("..")) throw new Error("Invalid master ref");
  const url = "https://api.github.com/repos/" + TEMPORARY_DIFF_REPOSITORY + "/commits/" + encodeURIComponent(ref);
  const response = await requireOk(await fetchImpl(url, { headers: { Accept: "application/vnd.github+json" } }), url);
  const data = await response.json();
  if (!/^[a-f0-9]{40}$/i.test(data?.sha ?? "")) throw new Error("Could not resolve a pinned diff commit");
  return data.sha.toLowerCase();
}
export function parseContestMasters(textByFile, manifest = {}) {
  for (const filename of Object.values(CONTEST_MASTER_FILES)) {
    if (!textByFile[filename]?.trim()) throw new Error("Missing or empty required master: " + filename);
  }
  const get = key => textByFile[CONTEST_MASTER_FILES[key]];
  const cardVariants = parseProduceCardCatalogYaml(get("cards"));
  const cardCustomizeRules = [...parseCardMemoryRules(get("cards")).values()]
    .map(rule=>({id:rule.id,customizeIds:[...rule.customizeIds],maxCustomizeCount:rule.maxCustomizeCount}));
  const items = parseProduceItemCatalogForExam(get("items"));
  const itemEffects = parseProduceItemEffectCatalog(get("itemEffects"));
  const examSettings = parseExamSettingCatalog(get("examSettings"));
  const examEffects = parseProduceExamEffectCatalog(get("examEffects"));
  const examStatusEnchants = parseProduceExamStatusEnchantCatalog(get("examStatusEnchants"));
  const examTriggers = parseProduceExamTriggerCatalog(get("examTriggers"));
  const cardSearches = parseProduceCardSearchCatalog(get("cardSearches"));
  const cardRandomPools = parseProduceCardRandomPoolCatalog(get("cardRandomPools"));
  const cardStatusEnchants = parseProduceCardStatusEnchantCatalog(get("cardStatusEnchants"));
  const cardPools = [...parseProduceCardPoolCatalog(get("cardPools"))].map(([id,cards])=>({id,cards}));
  const cardCustomizes = [...parseCustomizeCatalog(get("cardCustomizes"))].map(([id,route])=>({
    id, levels: [...route.levels].map(([count,level])=>({count,level})),
  }));
  const cardGrowEffects = [...parseGrowEffectCatalog(get("cardGrowEffects")).values()];
  // Do not silently treat zero parsed rows as "no special effects".
  for (const [name, rows] of Object.entries({cardVariants,items,itemEffects,examSettings,examEffects,examTriggers})) {
    if (!rows.length) throw new Error("Required master parser returned zero records: " + name);
  }
  // Exclude display-only description ASTs. They expand the snapshot by >150 MB
  // but have no effect on replay logic; keep all gameplay effect IDs intact.
  for(const rows of [cardVariants,items,itemEffects,examSettings,examEffects,
    examStatusEnchants,examTriggers,cardSearches,cardRandomPools,
    cardStatusEnchants,cardGrowEffects]){
    for(const row of rows){
      for(const key of Object.keys(row)){
        if(key.endsWith("DescriptionParts")||key==="produceDescriptions")delete row[key];
      }
    }
  }
  const cards = [...new Map([...cardVariants].sort((a,b)=>b.upgradeCount-a.upgradeCount).map(c=>[c.id,c])).values()];
  return {
    schemaVersion: 1,
    provenance: {
      provider: "gakumasu-diff-temporary",
      repository: TEMPORARY_DIFF_REPOSITORY,
      commit: manifest.commit ?? null,
      retrievedAt: manifest.retrievedAt ?? null,
      fileSha256: manifest.fileSha256 ?? {},
      gameVersionVerified: false,
      disclaimer: "Temporary public YAML masters; equality with the captured game build is NOT verified",
    },
    cards, cardVariants, cardCustomizeRules, items, itemEffects, examSettings,
    examEffects, examStatusEnchants, examTriggers, cardSearches,
    cardRandomPools, cardStatusEnchants, cardPools, cardCustomizes, cardGrowEffects,
  };
}
export async function fetchTemporaryContestCatalog({
  ref = "main", fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is required");
  const commit = await resolveDiffCommit(ref, fetchImpl);
  const records = await Promise.all(Object.values(CONTEST_MASTER_FILES).map(async filename => {
    const url = "https://raw.githubusercontent.com/" + TEMPORARY_DIFF_REPOSITORY + "/" + commit + "/" + filename;
    const response = await requireOk(await fetchImpl(url), url);
    const value = await response.text();
    if (!value.trim()) throw new Error("Empty contest master: " + filename);
    return [filename, value];
  }));
  const textByFile = Object.fromEntries(records);
  const fileSha256 = Object.fromEntries(records.map(([filename,value])=>[filename,sha256(value)]));
  return parseContestMasters(textByFile, { commit, fileSha256, retrievedAt: new Date().toISOString() });
}
