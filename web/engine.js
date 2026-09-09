export const UINT32_MASK = 0xffffffffn;

export const DEFAULT_PRODUCE_CARD_CATALOG_URL =
  "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/ProduceCard.yaml";
export const DEFAULT_EXAM_INITIAL_DECK_URL =
  "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/ExamInitialDeck.yaml";
export const DEFAULT_IDOL_CARD_CATALOG_URL =
  "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/IdolCard.yaml";

function normalizedKey(key) {
  return String(key).replace(/[_\-\s]/g, "").toLowerCase();
}

export function getField(object, ...names) {
  if (!object || typeof object !== "object" || Array.isArray(object)) return undefined;
  const wanted = new Set(names.map(normalizedKey));
  for (const [key, value] of Object.entries(object)) {
    if (wanted.has(normalizedKey(key))) return value;
  }
  return undefined;
}

function hasField(object, ...names) {
  if (!object || typeof object !== "object" || Array.isArray(object)) return false;
  const wanted = new Set(names.map(normalizedKey));
  return Object.keys(object).some((key) => wanted.has(normalizedKey(key)));
}

export function parseJson(text) {
  try {
    return JSON.parse(String(text ?? ""));
  } catch (error) {
    throw new Error(`JSONを読み取れません: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseMemoryJsonText(text) {
  const source = String(text ?? "").trim();
  if (!source) throw new Error("メモリーデータが空です。");
  if (!source.startsWith("{") && !source.startsWith("[")) {
    throw new Error("JSON形式のメモリーデータを選択してください。");
  }
  return parseJson(source);
}

function yamlScalar(value) {
  const text = String(value ?? "").trim();
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    try {
      if (text.startsWith('"')) return JSON.parse(text);
    } catch {}
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return text;
}

export function parseProduceCardCatalogYaml(text) {
  const cards = [];
  let current = null;
  let section = null;
  let activePlayEffect = null;
  const scalarFields = new Set([
    "upgradeCount", "name", "planType", "category", "rarity", "assetId",
    "stamina", "forceStamina", "costType", "costValue",
    "playProduceExamTriggerId", "playMovePositionType", "moveEffectTriggerType",
    "isEndTurnLost", "isInitial", "isRestrict", "produceCardStatusEnchantId",
    "noDeckDuplication", "isLimited", "evaluation",
  ]);
  const flush = () => {
    if (!current?.id) return;
    current.upgradeCount = Number(current.upgradeCount ?? 0);
    current.stamina = Number(current.stamina ?? 0);
    current.forceStamina = Number(current.forceStamina ?? 0);
    current.costValue = Number(current.costValue ?? 0);
    current.evaluation = Number(current.evaluation ?? 0);
    current.playEffects = Array.isArray(current.playEffects) ? current.playEffects : [];
    current.moveProduceExamEffectIds = Array.isArray(current.moveProduceExamEffectIds) ? current.moveProduceExamEffectIds : [];
    current.noDeckDuplication = current.noDeckDuplication === true;
    current.isLimited = current.isLimited === true;
    current.isEndTurnLost = current.isEndTurnLost === true;
    current.isInitial = current.isInitial === true;
    current.isRestrict = current.isRestrict === true;
    cards.push(current);
  };

  for (const line of String(text ?? "").split(/\r?\n/)) {
    let match = line.match(/^- id:\s*(.+?)\s*$/);
    if (match) {
      flush();
      current = { id: String(yamlScalar(match[1])), playEffects: [], moveProduceExamEffectIds: [] };
      section = null;
      activePlayEffect = null;
      continue;
    }
    if (!current) continue;

    match = line.match(/^  ([A-Za-z][A-Za-z0-9_]*):\s*(.*?)\s*$/);
    if (match) {
      const field = match[1];
      const raw = match[2];
      activePlayEffect = null;
      if (field === "playEffects") {
        section = raw === "[]" ? null : "playEffects";
        current.playEffects = [];
      } else if (field === "moveProduceExamEffectIds") {
        section = raw === "[]" ? null : "moveProduceExamEffectIds";
        current.moveProduceExamEffectIds = [];
      } else {
        section = null;
        if (scalarFields.has(field)) current[field] = yamlScalar(raw);
      }
      continue;
    }

    if (section === "playEffects") {
      match = line.match(/^  -\s*([A-Za-z][A-Za-z0-9_]*):\s*(.*?)\s*$/);
      if (match) {
        activePlayEffect = { [match[1]]: yamlScalar(match[2]) };
        current.playEffects.push(activePlayEffect);
        continue;
      }
      match = line.match(/^    ([A-Za-z][A-Za-z0-9_]*):\s*(.*?)\s*$/);
      if (match && activePlayEffect) {
        activePlayEffect[match[1]] = yamlScalar(match[2]);
        continue;
      }
    }

    if (section === "moveProduceExamEffectIds") {
      match = line.match(/^  -\s*(.*?)\s*$/);
      if (match) current.moveProduceExamEffectIds.push(String(yamlScalar(match[1])));
    }
  }
  flush();
  return cards;
}

export function parseIdolCardCatalogYaml(text) {
  const cards = [];
  let current = null;
  const flush = () => {
    if (current?.id) cards.push(current);
  };
  for (const line of String(text ?? "").split(/\r?\n/)) {
    let match = line.match(/^- id:\s*(.+?)\s*$/);
    if (match) {
      flush();
      current = { id: yamlScalar(match[1]) };
      continue;
    }
    if (!current) continue;
    match = line.match(/^  (characterId|name|planType|examEffectType|assetId):\s*(.*?)\s*$/);
    if (!match) continue;
    current[match[1]] = yamlScalar(match[2]);
  }
  flush();
  return cards;
}

export function parseExamInitialDeckYaml(text) {
  const decks = [];
  let current = null;
  let list = null;
  const flush = () => {
    if (!current?.id) return;
    const upgrades = current.produceCardUpgradeCounts ?? [];
    current.cards = (current.produceCardIds ?? []).map((id, index) => ({
      id: String(id),
      upgradeCount: Number(upgrades[index] ?? 0),
      fixedDeckOrder: 0,
    }));
    decks.push(current);
  };

  for (const line of String(text ?? "").split(/\r?\n/)) {
    let match = line.match(/^- id:\s*(.+?)\s*$/);
    if (match) {
      flush();
      current = { id: yamlScalar(match[1]), produceCardIds: [], produceCardUpgradeCounts: [] };
      list = null;
      continue;
    }
    if (!current) continue;
    match = line.match(/^  (produceCardIds|produceCardUpgradeCounts):\s*(.*?)\s*$/);
    if (match) {
      list = match[1];
      if (match[2] === "[]") current[list] = [];
      continue;
    }
    match = line.match(/^  -\s*(.+?)\s*$/);
    if (match && list) {
      const raw = yamlScalar(match[1]);
      current[list].push(list === "produceCardUpgradeCounts" ? Number(raw) : raw);
    }
  }
  flush();
  return decks;
}

export async function loadCatalogs(fetchImpl = globalThis.fetch, urls = {}) {
  if (typeof fetchImpl !== "function") throw new Error("カード名データを取得する fetch がありません。");
  const cardUrl = urls.produceCards ?? DEFAULT_PRODUCE_CARD_CATALOG_URL;
  const deckUrl = urls.initialDecks ?? DEFAULT_EXAM_INITIAL_DECK_URL;
  const idolUrl = urls.idolCards ?? DEFAULT_IDOL_CARD_CATALOG_URL;
  const [cardResponse, deckResponse, idolResponse] = await Promise.all([
    fetchImpl(cardUrl), fetchImpl(deckUrl), fetchImpl(idolUrl),
  ]);
  if (!cardResponse.ok) throw new Error(`カード名データの取得に失敗しました (${cardResponse.status})。`);
  if (!deckResponse.ok) throw new Error(`初期デッキデータの取得に失敗しました (${deckResponse.status})。`);
  if (!idolResponse.ok) throw new Error(`Pアイドルデータの取得に失敗しました (${idolResponse.status})。`);
  const [cardText, deckText, idolText] = await Promise.all([
    cardResponse.text(), deckResponse.text(), idolResponse.text(),
  ]);
  const cards = parseProduceCardCatalogYaml(cardText);
  const initialDecks = parseExamInitialDeckYaml(deckText);
  const idolCards = parseIdolCardCatalogYaml(idolText);
  const cardVariantByKey = new Map(cards.map((card) => [
    `${String(card.id)}@@${Number(card.upgradeCount ?? 0)}`,
    card,
  ]));
  return {
    cards,
    cardById: new Map(cards.map((card) => [String(card.id), card])),
    cardVariantByKey,
    initialDecks,
    initialDeckById: new Map(initialDecks.map((deck) => [String(deck.id), deck])),
    idolCards,
    idolCardById: new Map(idolCards.map((idol) => [String(idol.id), idol])),
  };
}

export function cardDisplayName(cardOrId, cardById) {
  const id = typeof cardOrId === "object" && cardOrId ? String(cardOrId.id) : String(cardOrId);
  const catalog = cardById?.get?.(id);
  if (catalog?.name) return String(catalog.name);
  const direct = typeof cardOrId === "object" && cardOrId ? getField(cardOrId, "name", "produceCardName") : null;
  return direct ? String(direct) : id;
}

export function resolveCardInput(input, cards) {
  const text = String(input ?? "").trim();
  if (!text) throw new Error("カードを入力してください。");
  const exactId = cards.find((card) => String(card.id) === text);
  if (exactId) return exactId;

  const idSuffix = text.match(/(?:—|\||\[)\s*(p_card-[^\]\s]+)\]?\s*$/)?.[1];
  if (idSuffix) {
    const bySuffix = cards.find((card) => String(card.id) === idSuffix);
    if (bySuffix) return bySuffix;
  }

  const nameMatches = cards.filter((card) => String(card.name) === text || `${card.name} — ${card.id}` === text);
  if (nameMatches.length === 1) return nameMatches[0];
  if (nameMatches.length > 1) throw new Error(`「${text}」は複数のカードに一致します。ID付き候補を選択してください。`);
  throw new Error(`カード「${text}」がカード名データにありません。`);
}

export function parseSeed(input) {
  const text = String(input ?? "").trim();
  if (!text) throw new Error("シード値を入力してください。");
  let value;
  try {
    value = BigInt(text);
  } catch {
    throw new Error("シード値は10進数または 0x から始まる16進数で入力してください。");
  }
  return Number(value & UINT32_MASK) >>> 0;
}

export class XorShift32 {
  constructor(seed) {
    this.state = Number(seed) >>> 0;
  }

  nextU32() {
    let x = this.state >>> 0;
    x = (x ^ ((x << 13) >>> 0)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ ((x << 5) >>> 0)) >>> 0;
    this.state = x >>> 0;
    return this.state;
  }

  nextInt(minimum, maximum) {
    minimum = Number(minimum);
    maximum = Number(maximum);
    if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || maximum <= minimum) {
      throw new Error("乱数範囲が不正です。");
    }
    const width = maximum - minimum;
    const mapped = Number((BigInt(this.state >>> 0) * BigInt(width)) >> 32n);
    const result = minimum + mapped;
    this.nextU32();
    return result;
  }
}

export function normalizeProduceCard(card, extra = {}) {
  if (typeof card === "string" || typeof card === "number") {
    return { id: String(card), fixedDeckOrder: 0, upgradeCount: 0, ...extra };
  }
  if (!card || typeof card !== "object") throw new Error("カードデータの形式が不正です。");
  const id = getField(card, "id", "produceCardId");
  if (id === undefined || id === null || String(id) === "") throw new Error("カードIDがないカードがあります。");
  const fixedRaw = getField(card, "fixedDeckOrder") ?? 0;
  const fixedDeckOrder = Number(fixedRaw);
  if (!Number.isInteger(fixedDeckOrder)) throw new Error(`カード ${id}: FixedDeckOrder が整数ではありません。`);
  return {
    id: String(id),
    fixedDeckOrder,
    upgradeCount: Number(getField(card, "upgradeCount") ?? 0),
    customizes: getField(card, "customizes") ?? [],
    name: getField(card, "name", "produceCardName") ?? undefined,
    ...extra,
  };
}

export function parseDeck(text) {
  const cards = [];
  for (const [index, rawLine] of String(text ?? "").split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const [idPart, orderPart, ...rest] = line.split(",");
    if (rest.length) throw new Error(`${index + 1}行目: 「カードID,FixedDeckOrder」の形式で入力してください。`);
    const id = idPart.trim();
    if (!id) throw new Error(`${index + 1}行目: カードIDが空です。`);
    let fixedDeckOrder = 0;
    if (orderPart !== undefined && orderPart.trim() !== "") {
      fixedDeckOrder = Number(orderPart.trim());
      if (!Number.isInteger(fixedDeckOrder)) throw new Error(`${index + 1}行目: FixedDeckOrder は整数で入力してください。`);
    }
    cards.push({ id, fixedDeckOrder });
  }
  if (!cards.length) throw new Error("カードを1枚以上入力してください。");
  return cards;
}

export function shuffleDeck(inputCards, seed) {
  const cards = inputCards.map((card) => ({ ...card }));
  const rng = new XorShift32(seed);
  const fixed = cards.some((card) => Number(card.fixedDeckOrder) > 0);

  if (fixed) {
    const seen = new Set();
    for (const card of cards) {
      const key = Number(card.fixedDeckOrder);
      if (seen.has(key)) throw new Error("同じ FixedDeckOrder を持つカードがある固定順デッキは現在未対応です。");
      seen.add(key);
    }
    cards.sort((a, b) => Number(a.fixedDeckOrder) - Number(b.fixedDeckOrder));
    return { cards, randomState: rng.state >>> 0, fixedOrder: true };
  }

  for (let n = cards.length; n >= 2; n -= 1) {
    const j = rng.nextInt(0, n);
    [cards[j], cards[n - 1]] = [cards[n - 1], cards[j]];
  }
  return { cards, randomState: rng.state >>> 0, fixedOrder: false };
}

export function simulateCards(cards, seedInput, drawCount = 5) {
  const seed = typeof seedInput === "number" ? seedInput >>> 0 : parseSeed(seedInput);
  const count = Number(drawCount);
  if (!Number.isInteger(count) || count < 0) throw new Error("ドロー枚数は0以上の整数で入力してください。");
  if (!Array.isArray(cards) || !cards.length) throw new Error("カードを1枚以上指定してください。");
  const result = shuffleDeck(cards.map((card) => normalizeProduceCard(card, { source: card.source })), seed);
  return {
    seed,
    initialDeck: result.cards,
    draw: result.cards.slice(0, count),
    remainingDeck: result.cards.slice(count),
    randomState: result.randomState,
    fixedOrder: result.fixedOrder,
  };
}

export function simulateDistribution(deckText, seedText, drawCount) {
  return simulateCards(parseDeck(deckText), seedText, drawCount);
}

function walkJson(root, visit) {
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    visit(value);
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i -= 1) stack.push(value[i]);
    } else {
      for (const child of Object.values(value)) stack.push(child);
    }
  }
}

function findSituation(payload) {
  if (payload && typeof payload === "object" && Array.isArray(getField(payload, "stages"))) return payload;
  let found;
  walkJson(payload, (value) => {
    if (found || Array.isArray(value)) return;
    const situation = getField(value, "examContestSituation");
    if (situation && typeof situation === "object" && Array.isArray(getField(situation, "stages"))) found = situation;
  });
  return found;
}

function sectionPlayers(sections, side, stageIndex) {
  if (!Array.isArray(sections)) return [];
  return sections.flatMap((section, sectionIndex) => {
    const player = getField(section, "player");
    if (!player || typeof player !== "object") return [];
    const seedRaw = getField(player, "seed");
    const produceCardsRaw = getField(player, "produceCards");
    if (seedRaw === undefined || !Array.isArray(produceCardsRaw)) return [];
    const seed = Number(BigInt(String(seedRaw)) & UINT32_MASK) >>> 0;
    const cards = produceCardsRaw.map((card) => normalizeProduceCard(card));
    return [{
      key: `${side}-${stageIndex}-${sectionIndex}`,
      side,
      stageIndex,
      sectionIndex,
      seed,
      cards,
      characterId: getField(player, "characterId"),
      idolCardId: getField(player, "idolCardId"),
      examEffectType: getField(player, "examEffectType"),
    }];
  });
}

export function extractStartPlayers(payload) {
  const situation = findSituation(payload);
  if (!situation) throw new Error("ExamContestSituation が見つかりません。");
  const stages = getField(situation, "stages");
  const players = [];
  stages.forEach((stage, stageIndex) => {
    players.push(...sectionPlayers(getField(stage, "selfSections"), "self", stageIndex));
    players.push(...sectionPlayers(getField(stage, "rivalSections"), "rival", stageIndex));
  });
  if (!players.length) throw new Error("Seed と ProduceCards を持つ Player が見つかりません。");
  return players;
}

export function simulateStartPlayer(payload, playerKey, drawCount = 5) {
  const players = extractStartPlayers(payload);
  const player = players.find((item) => item.key === playerKey) ?? players[0];
  return { player, ...simulateCards(player.cards, player.seed, drawCount) };
}

function normalizeMemoryCandidate(candidate, index = 0) {
  let wrapper = candidate;
  let memory = candidate;
  const wrapped = getField(candidate, "memory");
  if (wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)) memory = wrapped;
  let userMemoryId = getField(memory, "userMemoryId");
  const manual = Boolean(getField(memory, "manualEntry"));
  if ((userMemoryId === undefined || userMemoryId === null || String(userMemoryId) === "") && manual) {
    userMemoryId = `manual-${index}`;
  }
  if (userMemoryId === undefined || userMemoryId === null || String(userMemoryId) === "") return null;

  const rawCards = getField(memory, "examBattleProduceCards", "skillCards");
  const hasActiveProduceCardIds = hasField(wrapper, "activeProduceCardIds") || hasField(memory, "activeProduceCardIds");
  const activeIdsRaw = getField(wrapper, "activeProduceCardIds") ?? getField(memory, "activeProduceCardIds") ?? [];
  const activeIds = Array.isArray(activeIdsRaw) ? activeIdsRaw.map(String) : [];
  const cardList = Array.isArray(rawCards)
      ? rawCards.map((card) => {
          const normalized = normalizeProduceCard(card);
          return { ...normalized, upgradeCount: Number(normalized.upgradeCount) > 0 ? 1 : 0 };
        })
      : [];
  const byId = new Map(cardList.map((card) => [card.id, card]));
  const activeCards = activeIds.map((id) => ({ ...(byId.get(id) ?? { id, fixedDeckOrder: 0, upgradeCount: 0 }), sourceMemoryId: String(userMemoryId) }));

  const userIdText = String(userMemoryId);
  const explicitName = getField(memory, "name", "memoryName", "displayName");
  const idolCardId = getField(memory, "idolCardId");
  const power = Number(getField(memory, "power") ?? 0);
  const characterId = getField(memory, "characterId");
  const planType = getField(memory, "planType");
  const label = explicitName
    ? String(explicitName)
    : `${power > 0 ? `${power} · ` : ""}${idolCardId ? `${idolCardId} · ` : ""}${userIdText.length > 12 ? `…${userIdText.slice(-10)}` : userIdText}`;

  return {
    userMemoryId: userIdText,
    label,
    idolCardId: idolCardId === undefined ? null : String(idolCardId),
    characterId: characterId === undefined ? null : String(characterId),
    planType: planType ?? null,
    power,
    grade: getField(memory, "grade") ?? null,
    vocal: Number(getField(memory, "vocal") ?? 0),
    dance: Number(getField(memory, "dance") ?? 0),
    visual: Number(getField(memory, "visual") ?? 0),
    stamina: Number(getField(memory, "stamina") ?? 0),
    examBattleProduceItemIds: Array.isArray(getField(memory, "examBattleProduceItemIds"))
      ? getField(memory, "examBattleProduceItemIds").map(String)
      : [],
    hasActiveProduceCardIds,
    activeProduceCardIds: activeIds,
    examBattleProduceCards: cardList,
    activeCards,
    manual,
    raw: memory,
  };
}

export function extractUserMemoryList(payload) {
  const directLists = [];
  walkJson(payload, (value) => {
    if (Array.isArray(value)) return;
    const list = getField(value, "userMemoryList");
    if (Array.isArray(list)) directLists.push(list);
  });
  const source = directLists.flat();
  return source.map((item, index) => normalizeMemoryCandidate(item, index)).filter(Boolean);
}

function memoryCompletenessScore(memory) {
  const raw = memory?.raw ?? {};
  let score = (memory?.examBattleProduceCards?.length ?? 0) * 10;
  if (memory?.hasActiveProduceCardIds) score += 1000;
  for (const field of [
    "idolCardId", "characterId", "planType", "power", "grade",
    "vocal", "dance", "visual", "stamina", "examBattleProduceItemIds",
  ]) {
    if (hasField(raw, field)) score += 5;
  }
  const pitems = getField(raw, "examBattleProduceItemIds");
  if (Array.isArray(pitems)) score += pitems.length;
  return score;
}

export function extractMemories(payload) {
  const candidates = [];
  walkJson(payload, (value) => {
    if (Array.isArray(value)) return;
    const memory = getField(value, "memory");
    const directId = getField(value, "userMemoryId");
    if (directId !== undefined || (memory && getField(memory, "userMemoryId") !== undefined)) candidates.push(value);
  });
  const byId = new Map();
  for (const [index, candidate] of candidates.entries()) {
    const memory = normalizeMemoryCandidate(candidate, index);
    if (!memory) continue;
    const old = byId.get(memory.userMemoryId);
    // 同点なら後から観測したスナップショットを採用する。InternalMergeFrom は
    // 同一 UserMemory を段階的に埋めることがあるため、最初の断片を固定しない。
    if (!old || memoryCompletenessScore(memory) >= memoryCompletenessScore(old)) {
      byId.set(memory.userMemoryId, memory);
    }
  }
  return [...byId.values()];
}

export function createManualMemory({ userMemoryId, label, idolCardId = "", characterId = "", power = 0, planType = null, cards = [], activeProduceCardIds = [] }) {
  const id = String(userMemoryId || `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  return normalizeMemoryCandidate({
    manualEntry: true,
    userMemoryId: id,
    name: String(label || "手動メモリー"),
    idolCardId: String(idolCardId || ""),
    characterId: String(characterId || ""),
    power: Number(power || 0),
    planType,
    examBattleProduceCards: cards.map((card) => normalizeProduceCard(card)),
    activeProduceCardIds: activeProduceCardIds.map(String),
  });
}

export function mergeMemoryLibraries(...libraries) {
  const byId = new Map();
  for (const library of libraries) {
    for (const memory of library ?? []) {
      if (!memory?.userMemoryId) continue;
      byId.set(String(memory.userMemoryId), memory);
    }
  }
  return [...byId.values()];
}

export function resolveContestInitialDeck(idolCardId, initialDeckById) {
  if (!idolCardId || !initialDeckById?.get) return null;
  return initialDeckById.get(`initial_deck-contest-${idolCardId}`) ?? null;
}

export function composeSelectedMemories(memoryList, selections, baseCards = [], maxMemoryCount = 3) {
  const maxCount = Math.max(2, Number(maxMemoryCount) || 3);
  if (!Array.isArray(selections) || selections.length < 2 || selections.length > maxCount) {
    if (maxCount === 3) throw new Error("メモリーは2枚または3枚選択してください。");
    throw new Error(`メモリーは2枚から${maxCount}枚まで選択してください。`);
  }
  const ids = selections.map((selection) => String(selection.userMemoryId));
  if (new Set(ids).size !== ids.length) throw new Error("同じメモリーを複数の枠に選択できません。");
  const selected = selections.map((selection) => {
    const memory = memoryList.find((item) => String(item.userMemoryId) === String(selection.userMemoryId));
    if (!memory) throw new Error(`メモリー ${selection.userMemoryId} が一覧にありません。`);
    const requestedActiveIds = Array.isArray(selection.activeProduceCardIds)
      ? selection.activeProduceCardIds.map(String)
      : memory.activeProduceCardIds.map(String);
    if (!requestedActiveIds.length) throw new Error(`${memory.label}: 有効カードを1枚以上選択してください。`);
    const byId = new Map(memory.examBattleProduceCards.map((card) => [String(card.id), card]));
    for (const id of requestedActiveIds) {
      if (!byId.has(id)) throw new Error(`${memory.label}: カード ${id} はこのメモリーにありません。`);
    }
    const activeIdSet = new Set(requestedActiveIds);
    // Fisher–Yates の入力順は UI でチェックした順ではなく、UserMemory が持つ
    // examBattleProduceCards のネイティブ順を必ず使う。
    const activeCards = memory.examBattleProduceCards.filter((card) => activeIdSet.has(String(card.id)));
    const activeIds = activeCards.map((card) => String(card.id));
    return { memory, activeIds, activeCards };
  });

  const cards = [];
  selected.forEach(({ memory, activeCards }, index) => {
    const role = index === 0 ? "main" : `sub${index}`;
    for (const card of activeCards) cards.push({ ...card, source: `${role}: ${memory.label}` });
  });
  for (const card of baseCards ?? []) cards.push({ ...normalizeProduceCard(card), source: card.source ?? "initial" });
  if (!cards.length) throw new Error("デッキにカードがありません。 ");
  return {
    memories: selected.map((item) => item.memory),
    selections: selected,
    cards,
    hasBaseCards: Boolean(baseCards?.length),
  };
}

function collectTopLevelBaseCards(payload) {
  const direct = getField(payload, "baseProduceCards", "defaultProduceCards", "embedProduceCards");
  if (!Array.isArray(direct)) return [];
  return direct.map((card) => normalizeProduceCard(card, { source: "default" }));
}

function hasBaseCardField(payload) {
  return hasField(payload, "baseProduceCards", "defaultProduceCards", "embedProduceCards");
}

export function composeMemoryDeck(payload, selectedMemoryIds) {
  const memories = extractMemories(payload);
  const ids = selectedMemoryIds.map(String);
  if (ids.length < 2 || ids.length > 3) throw new Error("メモリーは2枚または3枚選択してください。");
  const selected = ids.map((id) => memories.find((memory) => memory.userMemoryId === id));
  if (selected.some((memory) => !memory)) throw new Error("選択したメモリーが入力データにありません。");
  const missingActive = selected.filter((memory) => !memory.hasActiveProduceCardIds);
  if (missingActive.length) throw new Error(`ActiveProduceCardIds がないメモリーがあります: ${missingActive.map((m) => m.label).join(" / ")}`);
  if (!hasBaseCardField(payload)) throw new Error("baseProduceCards がありません。空の場合も baseProduceCards: [] を明示してください。");
  const selections = selected.map((memory) => ({ userMemoryId: memory.userMemoryId, activeProduceCardIds: memory.activeProduceCardIds }));
  return composeSelectedMemories(memories, selections, collectTopLevelBaseCards(payload));
}

export function simulateMemorySelection(payload, selectedMemoryIds, seedInput, drawCount = 5) {
  const composition = composeMemoryDeck(payload, selectedMemoryIds);
  return { composition, ...simulateCards(composition.cards, seedInput, drawCount) };
}

export function simulateMemoryLibrary(memoryList, selections, baseCards, seedInput, drawCount = 5) {
  const composition = composeSelectedMemories(memoryList, selections, baseCards);
  return { composition, ...simulateCards(composition.cards, seedInput, drawCount) };
}
