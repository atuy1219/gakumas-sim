const COMMON_PLAN = "ProducePlanType_Common";

export function filterExamIdols(idols, characterId, planType) {
  const character = String(characterId ?? "");
  const plan = String(planType ?? "");
  if (!character || !plan) return [];
  return (idols ?? [])
    .filter((idol) => String(idol.characterId) === character && String(idol.planType) === plan)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "ja") || String(a.id).localeCompare(String(b.id)));
}

export function filterExamCards(cards, planType, search = "") {
  const plan = String(planType ?? "");
  if (!plan) return [];
  const query = String(search ?? "").trim().toLocaleLowerCase("ja");
  return (cards ?? []).filter((card) => {
    if (![COMMON_PLAN, plan].includes(String(card.planType))) return false;
    const name = String(card.baseName ?? card.name ?? "").toLocaleLowerCase("ja");
    return !query || name.includes(query) || String(card.id).toLocaleLowerCase("ja").includes(query);
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
  const byId = new Map((cards ?? []).map((card) => [String(card.id), card]));
  const deck = [];
  for (const [id, rawCount] of counts ?? []) {
    const card = byId.get(String(id));
    if (!card) continue;
    const count = Math.max(0, Math.trunc(Number(rawCount ?? 0)));
    const safeCount = card.noDeckDuplication ? Math.min(1, count) : count;
    for (let index = 0; index < safeCount; index += 1) {
      deck.push({ id: String(card.id), upgradeCount: 0, fixedDeckOrder: 0, name: card.baseName ?? card.name ?? card.id });
    }
  }
  return deck;
}
