const COMMON_PLAN = "ProducePlanType_Common";
const STANDARD_PLANS = new Set([
  "ProducePlanType_Plan1",
  "ProducePlanType_Plan2",
  "ProducePlanType_Plan3",
]);

export const EXAM_CARD_POOL_MODE = Object.freeze({
  NORMAL: "normal",
  RESEARCH: "research",
  HIGH_SCORE: "highScore",
});

function normalizePoolMode(value) {
  const mode = String(value ?? "");
  return Object.values(EXAM_CARD_POOL_MODE).includes(mode)
    ? mode
    : EXAM_CARD_POOL_MODE.NORMAL;
}

export function filterExamIdols(idols, characterId, planType) {
  const character = String(characterId ?? "");
  const plan = String(planType ?? "");
  if (!character || !plan) return [];
  return (idols ?? [])
    .filter((idol) => String(idol.characterId) === character && String(idol.planType) === plan)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "ja") || String(a.id).localeCompare(String(b.id)));
}

function normalizedExamCardFilter(optionsOrPlanType, legacySearch = "") {
  if (optionsOrPlanType && typeof optionsOrPlanType === "object" && !Array.isArray(optionsOrPlanType)) {
    return {
      planType: String(optionsOrPlanType.planType ?? ""),
      characterId: String(optionsOrPlanType.characterId ?? ""),
      idolCardId: String(optionsOrPlanType.idolCardId ?? ""),
      poolMode: normalizePoolMode(optionsOrPlanType.poolMode),
      search: String(optionsOrPlanType.search ?? ""),
      idolById: optionsOrPlanType.idolById instanceof Map ? optionsOrPlanType.idolById : new Map(),
    };
  }
  return {
    planType: String(optionsOrPlanType ?? ""),
    characterId: "",
    idolCardId: "",
    poolMode: EXAM_CARD_POOL_MODE.NORMAL,
    search: String(legacySearch ?? ""),
    idolById: new Map(),
  };
}

function isSsrCard(card) {
  return String(card?.rarity ?? "") === "ProduceCardRarity_Ssr";
}

function cardPlanAllowed(card, planType, poolMode) {
  const cardPlan = String(card?.planType ?? "");
  if (poolMode === EXAM_CARD_POOL_MODE.RESEARCH) {
    // あさり先生のプロデュースゼミでは他プランの通常カードも出現する。
    // ただし isInitialDeckProduceCard=true の基本カードは現在のプラン分だけにする。
    if (cardPlan === COMMON_PLAN || cardPlan === planType) return true;
    if (!STANDARD_PLANS.has(cardPlan)) return false;
    return card?.isInitialDeckProduceCard !== true;
  }
  return cardPlan === COMMON_PLAN || cardPlan === planType;
}

function originIdolIds(card) {
  return [
    card?.originIdolCardId,
    card?.originPrimaStellaIdolCardId,
  ].map((value) => String(value ?? "").trim()).filter(Boolean);
}

function cardBelongsToSelectedOrigin(card, characterId, idolCardId, idolById) {
  const idolOrigins = originIdolIds(card);
  if (idolOrigins.length) {
    // Pアイドル固有は同じキャラの別SSRでも通常プロデュースには混ざらない。
    return Boolean(idolCardId) && idolOrigins.includes(String(idolCardId));
  }

  const originCharacterId = String(card?.originCharacterId ?? "").trim();
  if (originCharacterId) return Boolean(characterId) && originCharacterId === String(characterId);

  // 古い/派生masterで originCharacterId が省略され、originIdolCardId だけが
  // 分かるケースに備えた補助。上の idolOrigins 判定を通らないカードには影響しない。
  for (const originId of idolOrigins) {
    const idol = idolById.get(originId);
    if (idol && String(idol.characterId ?? "") === String(characterId)) return true;
  }
  return true;
}

function cardOriginAllowed(card, filter) {
  const hasExclusiveOrigin = Boolean(
    String(card?.originCharacterId ?? "").trim()
    || originIdolIds(card).length,
  );
  if (!hasExclusiveOrigin) return true;
  if (cardBelongsToSelectedOrigin(
    card,
    filter.characterId,
    filter.idolCardId,
    filter.idolById,
  )) return true;

  // 強化月間は他アイドルの固有SSRスキルカードが出現する。
  // SR以下の固有、または通常/あさりゼミでは他アイドル固有を混ぜない。
  return filter.poolMode === EXAM_CARD_POOL_MODE.HIGH_SCORE && isSsrCard(card);
}

export function filterExamCards(cards, optionsOrPlanType, legacySearch = "") {
  const filter = normalizedExamCardFilter(optionsOrPlanType, legacySearch);
  if (!filter.planType) return [];
  const query = filter.search.trim().toLocaleLowerCase("ja");

  return (cards ?? []).filter((card) => {
    if (!cardPlanAllowed(card, filter.planType, filter.poolMode)) return false;
    if (!cardOriginAllowed(card, filter)) return false;
    const name = String(card.baseName ?? card.name ?? "").toLocaleLowerCase("ja");
    return !query
      || name.includes(query)
      || String(card.id ?? "").toLocaleLowerCase("ja").includes(query);
  });
}

export function changeExamCardCount(counts, card, delta) {
  const next = new Map(counts ?? []);
  const id = String(card?.id ?? "");
  if (!id) return next;
  const limit = card.noDeckDuplication ? 1 : Number.MAX_SAFE_INTEGER;
  const value = Math.max(0, Math.min(limit, Number(next.get(id) ?? 0) + Number(delta ?? 0)));
  if (value) next.set(id, value);
  else next.delete(id);
  return next;
}

export function buildExamDeck(cards, counts) {
  const deck = [];
  const selected = new Map(counts ?? []);
  // The catalog order is stable. UI click order and imported JSON property
  // order must not silently alter the deck before its seeded shuffle.
  for (const card of cards ?? []) {
    const rawCount = selected.get(String(card.id));
    if (rawCount === undefined) continue;
    const count = Math.max(0, Math.trunc(Number(rawCount ?? 0)));
    const safeCount = card.noDeckDuplication ? Math.min(1, count) : count;
    for (let index = 0; index < safeCount; index += 1) {
      deck.push({
        id: String(card.id),
        upgradeCount: 0,
        fixedDeckOrder: 0,
        name: card.baseName ?? card.name ?? card.id,
        isInitial: Boolean(card.isInitial),
      });
    }
  }
  return deck;
}


function examDeckIdentity(card) {
  return `${String(card?.id ?? "")}@@${Number(card?.upgradeCount ?? 0)}`;
}

export function examDeckOrderEntries(deck) {
  const seen = new Map();
  return (deck ?? []).map((card, index) => {
    const identity = examDeckIdentity(card);
    const ordinal = (seen.get(identity) ?? 0) + 1;
    seen.set(identity, ordinal);
    return {
      key: `${identity}@@${ordinal}`,
      index,
      ordinal,
      card: { ...card },
    };
  });
}

export function applyExamDeckOrder(deck, orderKeys) {
  const entries = examDeckOrderEntries(deck);
  const keys = Array.isArray(orderKeys) ? orderKeys.map(String) : [];
  if (!keys.length) return entries.map((entry) => ({ ...entry.card }));
  if (keys.length !== entries.length) {
    throw new Error(`Shuffle前順序の枚数が現在のデッキと一致しません（順序${keys.length}枚 / デッキ${entries.length}枚）。`);
  }
  const byKey = new Map(entries.map((entry) => [entry.key, entry.card]));
  const used = new Set();
  const ordered = [];
  for (const key of keys) {
    if (used.has(key)) throw new Error(`Shuffle前順序に重複キーがあります: ${key}`);
    const card = byKey.get(key);
    if (!card) throw new Error(`Shuffle前順序に現在のデッキにないカードがあります: ${key}`);
    used.add(key);
    ordered.push({ ...card });
  }
  if (used.size !== entries.length) throw new Error("Shuffle前順序に不足しているカードがあります。");
  return ordered;
}

export function moveExamDeckOrder(orderKeys, fromIndex, toIndex) {
  const next = [...(orderKeys ?? [])];
  const from = Math.trunc(Number(fromIndex));
  const to = Math.trunc(Number(toIndex));
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
