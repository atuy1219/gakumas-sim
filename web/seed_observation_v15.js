import { observationCardLabel } from "./sim_v3.js";
import { parseExamEffectId } from "./exam_effects_v7.js";

function cardId(card) {
  return String(card?.id ?? card?.produceCardId ?? "");
}

function upgradeCount(card) {
  return Number(card?.upgradeCount ?? 0);
}

function masterFor(card, cardById = new Map(), cardVariantByKey = new Map()) {
  const id = cardId(card);
  const upgrade = upgradeCount(card);
  return cardVariantByKey?.get?.(`${id}@@${upgrade}`)
    ?? cardById?.get?.(id)
    ?? card
    ?? {};
}

function labelVariants(card, cardById = new Map(), cardVariantByKey = new Map()) {
  const id = cardId(card);
  const master = masterFor(card, cardById, cardVariantByKey);
  const name = String(master?.name ?? card?.name ?? id).trim();
  const upgrade = upgradeCount(card);
  const labels = new Set([id]);
  if (name) {
    labels.add(name);
    labels.add(observationCardLabel(name, upgrade));
    labels.add(observationCardLabel(name, 0));
  }
  for (const label of [...labels]) {
    if (!label) continue;
    labels.add(String(label).replace(/\+{2,}$/, "+"));
    labels.add(String(label).replace(/\++$/, ""));
  }
  return labels;
}

export function collectGeneratedCardTargets(cards, cardById = new Map(), cardVariantByKey = new Map()) {
  const targets = new Map();
  for (const card of cards ?? []) {
    const sourceMaster = masterFor(card, cardById, cardVariantByKey);
    for (const effect of sourceMaster?.playEffects ?? []) {
      const parsed = parseExamEffectId(effect?.produceExamEffectId);
      if (parsed.kind !== "card_create_id" || !parsed.cardId) continue;
      const target = {
        id: String(parsed.cardId),
        upgradeCount: Number(parsed.upgradeCount ?? 0),
        sourceCardId: cardId(card),
        movePosition: String(parsed.movePosition ?? ""),
        pickCountMin: Number(parsed.pickCountMin ?? 0),
        pickCountMax: Number(parsed.pickCountMax ?? 0),
      };
      const targetMaster = masterFor(target, cardById, cardVariantByKey);
      target.name = String(targetMaster?.name ?? target.id);
      const existing = targets.get(target.id);
      if (existing) {
        existing.sources.push(target.sourceCardId);
        existing.pickCountMin += target.pickCountMin;
        existing.pickCountMax += target.pickCountMax;
      } else {
        targets.set(target.id, { ...target, sources: [target.sourceCardId] });
      }
    }
  }
  return targets;
}

export function resolveSeedObservationLine(lineInput, initialCards, generatedTargets, cardById = new Map(), cardVariantByKey = new Map()) {
  const line = String(lineInput ?? "").trim();
  if (!line) throw new Error("観測カードが空です。");

  const candidates = new Map();
  for (const card of initialCards ?? []) {
    const id = cardId(card);
    if (id && !candidates.has(id)) candidates.set(id, { id, upgradeCount: upgradeCount(card) });
  }
  for (const target of generatedTargets?.values?.() ?? []) {
    if (target?.id && !candidates.has(String(target.id))) candidates.set(String(target.id), target);
  }

  if (candidates.has(line)) return line;
  const suffix = line.match(/(?:—|\||\[)\s*(p_card-[^\]\s]+)\]?\s*(?:\[生成\])?$/)?.[1];
  if (suffix && candidates.has(suffix)) return suffix;

  const normalized = line.replace(/\s*\[生成\]\s*$/, "").trim();
  const compact = normalized.replace(/\+{2,}$/, "+");
  const bare = normalized.replace(/\++$/, "");
  const matches = [];
  for (const card of candidates.values()) {
    const labels = labelVariants(card, cardById, cardVariantByKey);
    if (labels.has(normalized) || labels.has(compact) || labels.has(bare)) matches.push(card.id);
  }
  const unique = [...new Set(matches)];
  if (unique.length === 1) return unique[0];
  if (unique.length > 1) throw new Error(`観測カード「${line}」が複数カードに一致します。ID付き候補を使用してください。`);
  throw new Error(`観測カード「${line}」を現在のデッキまたは生成カードに対応付けできません。`);
}

export function partitionSeedObservations(lines, initialCards, cardById = new Map(), cardVariantByKey = new Map()) {
  const generatedTargets = collectGeneratedCardTargets(initialCards, cardById, cardVariantByKey);
  const remaining = new Map();
  for (const card of initialCards ?? []) {
    const id = cardId(card);
    remaining.set(id, (remaining.get(id) ?? 0) + 1);
  }

  const allIds = [];
  const initialIds = [];
  const generatedIds = [];
  for (const line of lines ?? []) {
    const id = resolveSeedObservationLine(line, initialCards, generatedTargets, cardById, cardVariantByKey);
    allIds.push(id);
    const left = remaining.get(id) ?? 0;
    if (left > 0) {
      initialIds.push(id);
      remaining.set(id, left - 1);
      continue;
    }
    if (generatedTargets.has(id)) {
      generatedIds.push(id);
      continue;
    }
    throw new Error(`観測カード ${id} が元デッキの枚数を超えています。生成効果がある場合は対応カードを確認してください。`);
  }

  const initialCount = (initialCards ?? []).length;
  return {
    allIds,
    initialIds,
    generatedIds,
    generatedTargets,
    initialCount,
    observedInitialCount: initialIds.length,
    complete: initialIds.length === initialCount,
    missingCount: Math.max(0, initialCount - initialIds.length),
  };
}

export function generatedObservationLabel(target, cardById = new Map(), cardVariantByKey = new Map()) {
  const master = masterFor(target, cardById, cardVariantByKey);
  const name = String(master?.name ?? target?.name ?? target?.id ?? "");
  return observationCardLabel(name, Number(target?.upgradeCount ?? 0));
}
