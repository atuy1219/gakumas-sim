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
    // あさり先生のプロデュースゼミでは通常プラン外のスキルカードも
    // 出現する。Unknown 等の内部カードまでは広げず、3プラン＋共通に限定する。
    return cardPlan === COMMON_PLAN || STANDARD_PLANS.has(cardPlan);
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
