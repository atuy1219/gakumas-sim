function field(record, ...names) {
  if (!record || typeof record !== "object") return undefined;
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(record, name)) return record[name];
  }
  return undefined;
}

function boolValue(value) {
  if (value === true || value === false) return value;
  if (value === 1 || value === "1" || String(value).toLowerCase() === "true") return true;
  if (value === 0 || value === "0" || String(value).toLowerCase() === "false" || value == null) return false;
  return Boolean(value);
}

function progressCardId(record) {
  const value = field(record, "produceCardId", "ProduceCardId", "id", "Id");
  return String(value ?? "").trim();
}

function progressCardNumber(record) {
  const value = field(record, "number", "Number");
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function progressUpgradeCount(record) {
  const value = field(record, "upgradeCount", "UpgradeCount");
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function progressDeleted(record) {
  return boolValue(field(record, "deleted", "Deleted", "isDeleted", "IsDeleted"));
}

function progressCustomizes(record) {
  const source = field(record, "customizes", "Customizes");
  if (!Array.isArray(source)) return [];
  const counts = new Map();
  for (const item of source) {
    const id = String(field(item, "id", "Id", "produceCardCustomizeId", "ProduceCardCustomizeId") ?? "").trim();
    if (!id) continue;
    const count = Math.max(1, Math.trunc(Number(field(item, "customizeCount", "CustomizeCount") ?? 1) || 1));
    counts.set(id, (counts.get(id) ?? 0) + count);
  }
  return [...counts].map(([id, customizeCount]) => ({ id, customizeCount }));
}

function normalizeProgressExamSupportCards(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const source = field(payload, "examSupportCards", "ExamSupportCards", "supportCards", "SupportCards");
  if (!Array.isArray(source)) return [];
  return source.flatMap((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return [];
    const supportCardId = String(field(record, "supportCardId", "SupportCardId", "id", "Id") ?? "").trim();
    if (!supportCardId) return [];
    const permil = Number(field(
      record,
      "produceCardUpgradePermil",
      "ProduceCardUpgradePermil",
      "upgradePermil",
      "UpgradePermil",
    ) ?? 0);
    return [{
      supportCardId,
      filterParameterType: String(field(record, "filterParameterType", "FilterParameterType") ?? ""),
      cardSearchId: String(field(
        record,
        "cardSearchId",
        "CardSearchId",
        "produceCardSearchId",
        "ProduceCardSearchId",
      ) ?? ""),
      produceCardUpgradePermil: Number.isFinite(permil) ? Math.max(0, Math.trunc(permil)) : 0,
      sourceIndex: index,
    }];
  });
}

function cardLikeScore(list) {
  if (!Array.isArray(list) || !list.length) return -1;
  let score = 0;
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    if (progressCardId(item)) score += 2;
    if (progressCardNumber(item) !== null) score += 4;
    if (field(item, "upgradeCount", "UpgradeCount") !== undefined) score += 1;
    if (field(item, "deleted", "Deleted", "isDeleted", "IsDeleted") !== undefined) score += 1;
  }
  return score;
}

export function extractProgressProduceCards(payload) {
  if (Array.isArray(payload) && cardLikeScore(payload) >= payload.length * 4) {
    return { cards: payload, path: "$" };
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("進行中プロデュースJSONにproduceCardsが見つかりません。");
  }

  const candidates = [];
  const seen = new Set();
  function visit(value, path, depth = 0) {
    if (!value || typeof value !== "object" || depth > 12 || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      const score = cardLikeScore(value);
      if (score >= 0) candidates.push({ cards: value, path, score });
      for (let i = 0; i < value.length; i += 1) visit(value[i], `${path}[${i}]`, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (Array.isArray(child) && /producecards/i.test(key)) {
        const score = cardLikeScore(child) + 1000;
        candidates.push({ cards: child, path: `${path}.${key}`, score });
      }
      visit(child, `${path}.${key}`, depth + 1);
    }
  }
  visit(payload, "$");

  const usable = candidates
    .filter((candidate) => candidate.cards.some((item) => progressCardId(item) && progressCardNumber(item) !== null))
    .sort((a, b) => b.score - a.score || b.cards.length - a.cards.length || a.path.localeCompare(b.path));

  if (!usable.length) {
    throw new Error("Number付きのproduceCardsが見つかりません。UserProduceProgressを含むJSONを読み込んでください。");
  }
  return usable[0];
}

export function normalizeProgressProduceCardInstances(
  rawCards,
  cardById = new Map(),
  cardVariantByKey = new Map(),
) {
  if (!Array.isArray(rawCards)) throw new Error("produceCardsが配列ではありません。");
  return rawCards.map((source, sourceIndex) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new Error(`produceCards[${sourceIndex}] がカードオブジェクトではありません。`);
    }
    const id = progressCardId(source);
    if (!id) throw new Error(`produceCards[${sourceIndex}] にProduceCardIdがありません。`);
    const number = progressCardNumber(source);
    if (number === null) throw new Error(`${id}: Numberがありません。`);
    const upgradeCount = progressUpgradeCount(source);
    const variant = cardVariantByKey.get(`${id}@@${upgradeCount}`)
      ?? cardById.get(id)
      ?? {};
    const deleted = progressDeleted(source);
    const customizes = progressCustomizes(source);
    return {
      ...source,
      id,
      produceCardId: id,
      number,
      upgradeCount,
      customizes,
      deleted,
      customizing: boolValue(field(source, "customizing", "Customizing")),
      hasCustomizes: customizes.length > 0 || boolValue(field(source, "hasCustomizes", "HasCustomizes")),
      originType: field(source, "originType", "OriginType") ?? null,
      fixedDeckOrder: Number(field(source, "fixedDeckOrder", "FixedDeckOrder") ?? 0) || 0,
      name: variant.baseName ?? variant.name ?? id,
      isInitial: Boolean(variant.isInitial ?? field(source, "isInitial", "IsInitial")),
      progressSourceIndex: sourceIndex,
      progressCard: { ...source },
    };
  }).sort((a, b) => a.number - b.number || a.progressSourceIndex - b.progressSourceIndex);
}

export function normalizeProgressProduceCards(
  rawCards,
  cardById = new Map(),
  cardVariantByKey = new Map(),
) {
  return normalizeProgressProduceCardInstances(rawCards, cardById, cardVariantByKey)
    .filter((card) => !card.deleted);
}

export function parseProgressProduceCardsJson(
  input,
  cardById = new Map(),
  cardVariantByKey = new Map(),
) {
  let payload;
  try {
    payload = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    throw new Error("進行中プロデュースJSONを読み込めませんでした。");
  }
  const extracted = extractProgressProduceCards(payload);
  const allCards = normalizeProgressProduceCardInstances(extracted.cards, cardById, cardVariantByKey);
  const cards = allCards.filter((card) => !card.deleted);
  const deletedCards = allCards.filter((card) => card.deleted);

  // produce_cards.json generated by the LSPosed capture module can also retain
  // deleted instances in observedInstances. Merge only deleted instances here;
  // active deck order always comes from produceCards.
  if (payload?.format === "gakumas-sim-progress-capture" && Array.isArray(payload.observedInstances)) {
    const knownNumbers = new Set(allCards.map((card) => card.number));
    for (const card of normalizeProgressProduceCardInstances(payload.observedInstances, cardById, cardVariantByKey)) {
      if (!card.deleted || knownNumbers.has(card.number)) continue;
      allCards.push(card);
      deletedCards.push(card);
      knownNumbers.add(card.number);
    }
    allCards.sort((a, b) => a.number - b.number || a.progressSourceIndex - b.progressSourceIndex);
    deletedCards.sort((a, b) => a.number - b.number || a.progressSourceIndex - b.progressSourceIndex);
  }

  if (!cards.length) throw new Error("Deleted除外後のproduceCardsが0枚です。");
  return {
    cards,
    allCards,
    deletedCards,
    supportCards: normalizeProgressExamSupportCards(payload),
    path: extracted.path,
  };
}

export function progressDeckCounts(cards) {
  const counts = new Map();
  for (const card of cards ?? []) {
    const id = String(card?.id ?? "");
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
