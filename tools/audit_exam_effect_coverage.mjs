import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { parseProduceCardCatalogYaml } from "../web/engine.js";
import {
  parseExamEffectMaster,
  groupProduceCardRandomPools,
  parseProduceCardRandomPoolCatalog,
  parseProduceCardSearchCatalog,
  parseProduceExamEffectCatalog,
  parseProduceExamStatusEnchantCatalog,
  parseProduceExamTriggerCatalog,
  parseProduceItemCatalogForExam,
  parseProduceItemEffectCatalog,
  resolveProduceItems,
  parseProduceExamGimmickCatalog,
  groupExamGimmicks,
  parseProduceCardStatusEnchantCatalog,
  parseProduceCardPoolCatalog,
  parseExamSettingCatalog,
} from "../web/exam_effects.js";
import { parseGrowEffectCatalog } from "../web/memory_judgement.js";
import {
  createTowerTurnState,
  drawTowerTurn,
  finishTowerTurn,
  playTowerCard,
  useTowerDrink,
} from "../web/tower_runtime.js";

const root = path.resolve(process.argv[2] ?? ".");
let masterCommit;
try {
  masterCommit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch { /* A standalone YAML directory need not be a Git checkout. */ }
const read = (name) => fs.readFileSync(path.join(root, `${name}.yaml`), "utf8");

const examEffects = parseProduceExamEffectCatalog(read("ProduceExamEffect"));
const items = parseProduceItemCatalogForExam(read("ProduceItem"));
const itemEffects = parseProduceItemEffectCatalog(read("ProduceItemEffect"));
const enchants = parseProduceExamStatusEnchantCatalog(read("ProduceExamStatusEnchant"));
const triggers = parseProduceExamTriggerCatalog(read("ProduceExamTrigger"));
const searches = parseProduceCardSearchCatalog(read("ProduceCardSearch"));
const randomPools = parseProduceCardRandomPoolCatalog(read("ProduceCardRandomPool"));

const gimmicks = parseProduceExamGimmickCatalog(read("ProduceExamGimmickEffectGroup"));
const towerGimmicks = gimmicks.filter((row) => row.id.startsWith("p_exam_gimmick-tower_"));
const cardEnchants = parseProduceCardStatusEnchantCatalog(read("ProduceCardStatusEnchant"));
const catalogs = {
  cardStatusEnchantById: new Map(cardEnchants.map((row) => [row.id, row])),
  cardPoolById: parseProduceCardPoolCatalog(read("ProduceCardPool")),
  growEffectById: parseGrowEffectCatalog(read("ProduceCardGrowEffect")),
  examSetting: parseExamSettingCatalog(read("ExamSetting"))[0],
  examEffectById: new Map(examEffects.map((row) => [row.id, row])),
  examStatusEnchantById: new Map(enchants.map((row) => [row.id, row])),
  examTriggerById: new Map(triggers.map((row) => [row.id, row])),
  cardSearchById: new Map(searches.map((row) => [row.id, row])),
  cardRandomPoolById: groupProduceCardRandomPools(randomPools),
};
const resolved = resolveProduceItems(
  items.map((row) => row.id),
  new Map(items.map((row) => [row.id, row])),
  new Map(itemEffects.map((row) => [row.id, row])),
  catalogs,
);
const dummy = {
  id: "coverage-dummy",
  category: "ProduceCardCategory_ActiveSkill",
  rarity: "ProduceCardRarity_R",
  planType: "ProducePlanType_Common",
  playMovePositionType: "ProduceCardMovePositionType_Grave",
  playEffects: [],
};
const state = createTowerTurnState(
  [{ id: dummy.id }],
  1,
  new Map([[dummy.id, dummy]]),
  { ...catalogs, pItems: resolved.items },
);
const unsupportedEffects = examEffects
  .filter((row) => parseExamEffectMaster(row).kind === "unsupported")
  .map((row) => row.id);

const directEffectFailures = [], gimmickFailures = [], runtimeBoundEffectIds = [];
const cardFailures = [];
let cardVariants = 0;
let cardVariantsExecuted = 0;
let cardVariantsConditionBlocked = 0;
const pItemExecutionFailures = [];
const cardPath = path.join(root, "ProduceCard.yaml");
if (fs.existsSync(cardPath)) {
  const cards = parseProduceCardCatalogYaml(fs.readFileSync(cardPath, "utf8"));
  cardVariants = cards.length;
  const cardById = new Map();
  const cardVariantByKey = new Map();
  for (const card of cards) {
    cardVariantByKey.set(`${card.id}@@${card.upgradeCount}`, card);
    const previous = cardById.get(card.id);
    if (!previous || Number(card.upgradeCount) < Number(previous.upgradeCount)) cardById.set(card.id, card);
  }
  cardById.set(dummy.id, dummy);
  cardVariantByKey.set(dummy.id + "@@1", { ...dummy, upgradeCount: 1 });
  for (const row of examEffects) {
    try {
      const runtime = createTowerTurnState([{ id: dummy.id }], 1, cardById, { ...catalogs, cardVariantByKey, stamina: 100, turnLimit: 20 });
      drawTowerTurn(runtime, 1);
      Object.assign(runtime.exam, { block: 100, review: 100, aggressive: 100, lessonBuff: 100, parameterBuff: 100, parameterBuffMultiplePerTurn: 100, fullPowerPoint: 100 });
      const input = { ...row };
      if (/ExamStatusEnchant(?:Encore)?$/.test(input.effectType) && !input.produceExamStatusEnchantId) {
        input.produceExamStatusEnchantId = enchants[0]?.id;
        runtimeBoundEffectIds.push(row.id);
      }
      useTowerDrink(runtime, { id: "coverage-effect", effects: [{ examEffect: input }] });
      finishTowerTurn(runtime);
      if (runtime.unsupported.length) directEffectFailures.push({ id: row.id, unsupported: runtime.unsupported });
    } catch (error) { directEffectFailures.push({ id: row.id, error: String(error?.message ?? error) }); }
  }
  for (const [id, rows] of groupExamGimmicks(gimmicks)) {
    try {
      const turns = Math.max(20, ...rows.map((row) => Number(row.startTurn) || 0), ...rows.map((row) => Number(row.remainingTurn) || 0));
      const runtime = createTowerTurnState([{ id: dummy.id }], 1, cardById, { ...catalogs, cardVariantByKey, gimmicks: rows, stamina: 100, turnLimit: turns });
      for (let n = 0; n < turns; n++) { drawTowerTurn(runtime, 1); finishTowerTurn(runtime); }
      if (runtime.unsupported.length) gimmickFailures.push({ id, unsupported: runtime.unsupported });
    } catch (error) { gimmickFailures.push({ id, error: String(error?.message ?? error) }); }
  }
  for (const card of cards) {
    try {
      const runtime = createTowerTurnState(
        [{ id: card.id, upgradeCount: card.upgradeCount }],
        1,
        cardById,
        {
          ...catalogs,
          cardVariantByKey,
          stamina: 999999,
          targetScore: 100000,
          turnLimit: 20,
        },
      );
      Object.assign(runtime.exam, {
        block: 9999,
        review: 9999,
        aggressive: 9999,
        lessonBuff: 9999,
        parameterBuff: 9999,
        parameterBuffMultiplePerTurn: 9999,
        fullPowerPoint: 9999,
        fullPowerPointGetSum: 9999,
        concentrationChangeCount: 99,
        preservationChangeCount: 99,
        fullPowerChangeCount: 99,
        stanceChangeCount: 99,
        cardPlayCount: 99,
        playCardCountSum: 99,
        blockConsumptionSum: 9999,
        staminaConsumptionSum: 9999,
        reviewConsumptionSum: 9999,
      });
      runtime.turn = 10;
      drawTowerTurn(runtime, 1);
      runtime.playsRemaining = 20;
      playTowerCard(runtime, 0);
      cardVariantsExecuted += 1;
      if (runtime.unsupported.length) {
        cardFailures.push({ id: card.id, upgradeCount: card.upgradeCount, unsupported: runtime.unsupported });
      }
    } catch (error) {
      const message = String(error?.message ?? error);
      if (message.includes("条件を満たしていません")) cardVariantsConditionBlocked += 1;
      else cardFailures.push({ id: card.id, upgradeCount: card.upgradeCount, error: message });
    }
  }

  const pItemDummy = cards.find((card) => (
    card.costType === "ExamCostType_Unknown" && (card.playEffects ?? []).length === 0
  )) ?? cards[0];
  for (const item of resolved.items) {
    try {
      const runtime = createTowerTurnState(
        [{ id: pItemDummy.id, upgradeCount: pItemDummy.upgradeCount }],
        1,
        cardById,
        { ...catalogs, cardVariantByKey, pItems: [item], stamina: 100, turnLimit: 3 },
      );
      Object.assign(runtime.exam, {
        block: 100,
        review: 100,
        aggressive: 100,
        lessonBuff: 100,
        parameterBuff: 100,
        parameterBuffMultiplePerTurn: 100,
        fullPowerPoint: 100,
      });
      drawTowerTurn(runtime, 1);
      if (runtime.hand.length && runtime.playsRemaining > 0) playTowerCard(runtime, 0);
      finishTowerTurn(runtime, { type: "end" });
      if (runtime.unsupported.length) {
        pItemExecutionFailures.push({ id: item.id, unsupported: runtime.unsupported });
      }
    } catch (error) {
      pItemExecutionFailures.push({ id: item.id, error: String(error?.message ?? error) });
    }
  }
}

const report = {
  masterCommit,
  check: "master row execution smoke test",
  examEffects: examEffects.length,
  cardEnchants: cardEnchants.length,
  gimmickRows: gimmicks.length,
  gimmickGroups: groupExamGimmicks(gimmicks).size,
  towerGimmickRows: towerGimmicks.length,
  towerGimmickGroups: groupExamGimmicks(towerGimmicks).size,
  directEffectFailures, gimmickFailures, runtimeBoundEffectIds,
  unsupportedEffects,
  pItems: items.length,
  unresolvedPItems: resolved.unresolved,
  pItemRuntimeUnsupported: state.unsupported,
  pItemExecutionFailures,
  cardVariants,
  cardVariantsExecuted,
  cardVariantsConditionBlocked,
  cardFailures,
};
console.log(JSON.stringify(report, null, 2));

if (directEffectFailures.length || gimmickFailures.length || unsupportedEffects.length || resolved.unresolved.length || state.unsupported.length
    || pItemExecutionFailures.length || cardFailures.length) {
  process.exitCode = 1;
}
