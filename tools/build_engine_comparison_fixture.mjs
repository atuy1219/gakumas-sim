// Run: node tools/build_engine_comparison_fixture.mjs /path/to/master-data
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseProduceCardCatalogYaml } from "../web/engine.js";
import {
  parseProduceExamEffectCatalog, parseProduceExamTriggerCatalog,
  parseProduceExamStatusEnchantCatalog, parseProduceCardSearchCatalog,
  parseProduceCardStatusEnchantCatalog,
} from "../web/exam_effects.js";
import { parseGrowEffectCatalog } from "../web/memory_judgement.js";

const root = path.resolve(process.argv[2]);
const read = (name) => fs.readFileSync(path.join(root, name + ".yaml"), "utf8");
const cardYaml = read("ProduceCard").split(/(?=^- id:)/m).filter((block) =>
  /moveEffectTriggerType: ProduceCardMoveEffectTriggerType_(Hand|Hold)\s/.test(block)).join("");
const cards = parseProduceCardCatalogYaml(cardYaml);
const maps = {
  examEffects: new Map(parseProduceExamEffectCatalog(read("ProduceExamEffect")).map((r) => [r.id, r])),
  examTriggers: new Map(parseProduceExamTriggerCatalog(read("ProduceExamTrigger")).map((r) => [r.id, r])),
  examStatusEnchants: new Map(parseProduceExamStatusEnchantCatalog(read("ProduceExamStatusEnchant")).map((r) => [r.id, r])),
  cardSearches: new Map(parseProduceCardSearchCatalog(read("ProduceCardSearch")).map((r) => [r.id, r])),
  cardStatusEnchants: new Map(parseProduceCardStatusEnchantCatalog(read("ProduceCardStatusEnchant")).map((r) => [r.id, r])),
  growEffects: parseGrowEffectCatalog(read("ProduceCardGrowEffect")),
};
const collected = Object.fromEntries(Object.keys(maps).map((key) => [key, new Map()]));
function collect(kind, id) {
  if (!id || collected[kind].has(id)) return;
  const row = maps[kind].get(id);
  if (!row) throw new Error(`Missing ${kind}: ${id}`);
  collected[kind].set(id, row);
  visit(row);
}
function visit(row) {
  const scalars = { produceExamEffectId: "examEffects", chainProduceExamEffectId: "examEffects",
    produceExamTriggerId: "examTriggers", playProduceExamTriggerId: "examTriggers",
    produceExamStatusEnchantId: "examStatusEnchants", produceCardStatusEnchantId: "cardStatusEnchants",
    produceCardSearchId: "cardSearches" };
  for (const [field, kind] of Object.entries(scalars)) collect(kind, row[field]);
  const lists = { produceExamEffectIds: "examEffects", moveProduceExamEffectIds: "examEffects",
    chainProduceExamEffectIds: "examEffects", moveProduceExamTriggerIds: "examTriggers",
    fieldStatusProduceCardSearchIds: "cardSearches", produceCardGrowEffectIds: "growEffects" };
  for (const [field, kind] of Object.entries(lists)) for (const id of row[field] ?? []) collect(kind, id);
  for (const entry of row.playEffects ?? []) visit(entry);
}
for (const card of cards) visit(card);
const fixture = {
  source: { repository: "vertesan/gakumasu-diff", commit: execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() },
  cards,
  ...Object.fromEntries(Object.entries(collected).map(([key, map]) => [key, [...map.values()]])),
};
const destination = new URL("../tests/fixtures/engine-comparison-masters.json", import.meta.url);
fs.writeFileSync(destination, JSON.stringify(fixture, null, 2) + "\n");
console.log(Object.fromEntries(Object.entries(fixture).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length])));
