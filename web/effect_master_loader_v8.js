import { CATALOG_URLS, fetchTextWithFallback, parseProduceCardCatalog, parseProduceItemCatalog } from "./catalog_v4.js";
import { buildCanonicalCardCatalog } from "./catalog_v4.js";
import { parseProduceItemEffectCatalog } from "./exam_effects_v7.js";
import { collectEffectMasterEntries, generateEffectReport } from "./effect_report_generator_v8.js";

export async function loadEffectMasterV8({
  fetchImpl = globalThis.fetch,
  urls = CATALOG_URLS,
  memories = [],
} = {}) {
  const [cardText, itemText, itemEffectText] = await Promise.all([
    fetchTextWithFallback(urls.cardsPrimary, urls.cardsFallback, fetchImpl),
    fetchTextWithFallback(urls.itemsPrimary, urls.itemsFallback, fetchImpl),
    fetchTextWithFallback(
      "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/ProduceItemEffect.yaml",
      "https://raw.githubusercontent.com/zliu-aki/simple_gakuen_idolmaster/main/yaml/ProduceItemEffect.yaml",
      fetchImpl,
    ),
  ]);

  const cards = buildCanonicalCardCatalog(parseProduceCardCatalog(cardText));
  const items = parseProduceItemCatalog(itemText);
  const itemEffects = parseProduceItemEffectCatalog(itemEffectText);

  const entries = collectEffectMasterEntries({
    cards: cards.map((card) => ({
      ...card,
      effectId: card.effectId ?? card.moveEffectTriggerType,
    })),
    items: itemEffects,
    memories,
  });

  const report = generateEffectReport(entries);

  return {
    cards,
    items,
    itemEffects,
    memories,
    entries,
    report,
    unsupported: report.unsupported,
  };
}

export function createUnsupportedEffectList(report) {
  return (report?.unsupported ?? []).map(({ effect, result }) => ({
    source: effect?.source ?? "unknown",
    id: effect?.id ?? "",
    kind: effect?.kind ?? null,
    reason: result?.reason ?? null,
  }));
}
