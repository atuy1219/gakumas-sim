export const TOWER_PRESET_FORMAT = "gakumas-sim-tower-preset";
export const TOWER_PRESET_VERSION = 1;

function asObject(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value;
}

function cleanFilter(value = {}) {
  const filter = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    planType: String(filter.planType ?? ""),
    characterId: String(filter.characterId ?? ""),
    idolCardId: String(filter.idolCardId ?? ""),
  };
}

function cleanSlots(slots, memoryCount) {
  if (!Array.isArray(slots) || slots.length !== memoryCount) {
    throw new Error(`プリセットのメモリー枠数が不正です。${memoryCount}枠必要です。`);
  }
  const cleaned = slots.map((slot, index) => {
    const source = asObject(slot, `メモリー枠${index + 1}の形式が不正です。`);
    const userMemoryId = String(source.userMemoryId ?? "").trim();
    if (!userMemoryId) throw new Error(`メモリー枠${index + 1}にUserMemoryIdがありません。`);
    const ids = Array.isArray(source.activeProduceCardIds) ? source.activeProduceCardIds : [];
    const activeProduceCardIds = ids.map((id) => String(id).trim()).filter(Boolean);
    if (!activeProduceCardIds.length) throw new Error(`メモリー枠${index + 1}に採用カードがありません。`);
    return { userMemoryId, activeProduceCardIds };
  });
  const ids = cleaned.map((slot) => slot.userMemoryId);
  if (new Set(ids).size !== ids.length) throw new Error("プリセット内で同じメモリーを複数枠に使用しています。");
  return cleaned;
}

function cleanMemories(memories, slots) {
  if (!Array.isArray(memories)) throw new Error("プリセットにメモリーデータがありません。");
  const byId = new Map();
  for (const memory of memories) {
    if (!memory || typeof memory !== "object" || Array.isArray(memory)) continue;
    const id = String(memory.userMemoryId ?? "").trim();
    if (id) byId.set(id, memory);
  }
  for (const slot of slots) {
    if (!byId.has(slot.userMemoryId)) {
      throw new Error(`プリセット内にメモリー ${slot.userMemoryId} の本体データがありません。`);
    }
  }
  return slots.map((slot) => byId.get(slot.userMemoryId));
}

function cleanBaseCards(cards) {
  if (!Array.isArray(cards)) return [];
  return cards.map((card, index) => {
    const source = asObject(card, `基本カード${index + 1}の形式が不正です。`);
    const id = String(source.id ?? "").trim();
    if (!id) throw new Error(`基本カード${index + 1}にカードIDがありません。`);
    return {
      ...source,
      id,
      upgradeCount: Number(source.upgradeCount ?? 0),
      fixedDeckOrder: Number(source.fixedDeckOrder ?? 0),
      customizes: Array.isArray(source.customizes) ? source.customizes : [],
    };
  });
}

export function createTowerPreset({ memoryCount, slots, memories, baseCards = [], filter = {} }) {
  const count = Number(memoryCount);
  if (!Number.isInteger(count) || count < 2 || count > 4) throw new Error("ドル道のメモリー枚数は2〜4枚です。");
  const cleanSlotList = cleanSlots(slots, count);
  const cleanMemoryList = cleanMemories(memories, cleanSlotList);
  return {
    format: TOWER_PRESET_FORMAT,
    version: TOWER_PRESET_VERSION,
    exportedAt: new Date().toISOString(),
    memoryCount: count,
    slots: cleanSlotList,
    memories: cleanMemoryList,
    baseCards: cleanBaseCards(baseCards),
    filter: cleanFilter(filter),
  };
}

export function parseTowerPreset(input) {
  let raw = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      throw new Error("ドル道セットJSONを解析できませんでした。");
    }
  }
  const source = asObject(raw, "ドル道セットの形式が不正です。");
  if (source.format !== TOWER_PRESET_FORMAT) throw new Error("このJSONはドル道セットではありません。");
  if (Number(source.version) !== TOWER_PRESET_VERSION) {
    throw new Error(`未対応のドル道セットversionです: ${source.version}`);
  }
  return createTowerPreset({
    memoryCount: source.memoryCount,
    slots: source.slots,
    memories: source.memories,
    baseCards: source.baseCards,
    filter: source.filter,
  });
}
