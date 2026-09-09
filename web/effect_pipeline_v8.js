import { loadEffectMasterV8 } from "./effect_master_loader_v8.js";
import { generateEffectReport } from "./effect_report_generator_v8.js";

export const EffectCategoryV8 = Object.freeze({
  TIMER: "timer",
  ENCHANT: "enchant",
  CARD: "card_effect",
  ITEM: "item_effect",
  MEMORY: "memory_effect",
  DRAW: "draw_search",
  CONDITION: "condition",
  STATUS: "status",
  OTHER: "other",
});

export function categorizeEffect(entry) {
  const text = JSON.stringify(entry).toLowerCase();

  if (text.includes("timer")) return EffectCategoryV8.TIMER;
  if (text.includes("enchant")) return EffectCategoryV8.ENCHANT;
  if (text.includes("draw") || text.includes("search")) return EffectCategoryV8.DRAW;
  if (text.includes("condition")) return EffectCategoryV8.CONDITION;
  if (text.includes("status") || text.includes("parameter")) return EffectCategoryV8.STATUS;
  if (entry.source === "card") return EffectCategoryV8.CARD;
  if (entry.source === "item") return EffectCategoryV8.ITEM;
  if (entry.source === "memory") return EffectCategoryV8.MEMORY;
  return EffectCategoryV8.OTHER;
}

export function buildEffectPipelineReport() {
  const master = loadEffectMasterV8();
  const report = generateEffectReport(master.entries);

  const unsupportedByCategory = {};
  for (const item of report.unsupported) {
    const category = categorizeEffect(item.effect);
    if (!unsupportedByCategory[category]) unsupportedByCategory[category] = [];
    unsupportedByCategory[category].push(item);
  }

  return {
    ...report,
    unsupportedByCategory,
  };
}
