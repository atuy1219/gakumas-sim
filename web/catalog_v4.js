export const CATALOG_URLS = Object.freeze({
  cardsPrimary: "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/ProduceCard.yaml",
  cardsFallback: "https://raw.githubusercontent.com/zliu-aki/simple_gakuen_idolmaster/main/yaml/ProduceCard.yaml",
  itemsPrimary: "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/ProduceItem.yaml",
  itemsFallback: "https://raw.githubusercontent.com/zliu-aki/simple_gakuen_idolmaster/main/yaml/ProduceItem.yaml",
  characters: "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/Character.yaml",
  idolCards: "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/IdolCard.yaml",
  grades: "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/ProduceGrade.yaml",
});

function yamlScalar(raw) {
  const text = String(raw ?? "").trim();
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

export function parseTopLevelYamlRecords(text, wantedFields = []) {
  const wanted = new Set(["id", ...wantedFields]);
  const records = [];
  let current = null;
  const flush = () => {
    if (current?.id) records.push(current);
  };

  for (const line of String(text ?? "").split(/\r?\n/)) {
    let match = line.match(/^- id:\s*(.*?)\s*$/);
    if (match) {
      flush();
      current = { id: String(yamlScalar(match[1])) };
      continue;
    }
    if (!current) continue;
    match = line.match(/^  ([A-Za-z][A-Za-z0-9_]*):\s*(.*?)\s*$/);
    if (!match || !wanted.has(match[1])) continue;
    current[match[1]] = yamlScalar(match[2]);
  }
  flush();
  return records;
}

export function parseCharacterCatalog(text) {
  return parseTopLevelYamlRecords(text, ["lastName", "firstName", "isPlayable", "order"])
    .map((entry) => ({
      ...entry,
      name: `${entry.lastName ?? ""}${entry.firstName ?? ""}` || entry.id,
      isPlayable: entry.isPlayable !== false,
    }))
    .sort((a, b) => Number(a.order ?? 9999) - Number(b.order ?? 9999) || a.name.localeCompare(b.name, "ja"));
}

export function parseIdolCardCatalog(text) {
  return parseTopLevelYamlRecords(text, [
    "characterId",
    "name",
    "rarity",
    "planType",
    "assetId",
    "produceVocal",
    "produceDance",
    "produceVisual",
    "produceStamina",
    "beforeProduceItemId",
    "afterProduceItemId",
    "beforeLevelLimitProduceItemId",
    "afterLevelLimitProduceItemId",
  ])
    .filter((entry) => entry.name)
    .map((entry) => ({
      ...entry,
      name: String(entry.name),
      produceVocal: Number(entry.produceVocal ?? 0),
      produceDance: Number(entry.produceDance ?? 0),
      produceVisual: Number(entry.produceVisual ?? 0),
      produceStamina: Number(entry.produceStamina ?? 0),
    }));
}

export function parseProduceCardCatalog(text) {
  return parseTopLevelYamlRecords(text, [
    "upgradeCount",
    "name",
    "planType",
    "category",
    "rarity",
    "assetId",
    "stamina",
    "evaluation",
    "noDeckDuplication",
    "isLimited",
  ])
    .filter((entry) => entry.name)
    .map((entry) => ({
      ...entry,
      name: String(entry.name),
      upgradeCount: Number(entry.upgradeCount ?? 0),
      stamina: Number(entry.stamina ?? 0),
      evaluation: Number(entry.evaluation ?? 0),
      noDeckDuplication: entry.noDeckDuplication === true,
      isLimited: entry.isLimited === true,
    }));
}

export function canonicalCardName(name, upgradeCount = 0) {
  const raw = String(name ?? "").trim();
  if (Number(upgradeCount) <= 0) return raw;
  return raw.replace(/\s*\++\s*$/, "").trim() || raw;
}

export function buildCanonicalCardCatalog(entries) {
  const byId = new Map();
  for (const entry of entries ?? []) {
    if (!entry?.id) continue;
    const id = String(entry.id);
    const normalized = {
      ...entry,
      id,
      upgradeCount: Number(entry.upgradeCount ?? 0),
      baseName: canonicalCardName(entry.name, entry.upgradeCount),
    };
    const old = byId.get(id);
    if (!old || normalized.upgradeCount < old.upgradeCount) {
      byId.set(id, {
        ...normalized,
        maxMasterStage: Math.max(Number(old?.maxMasterStage ?? 0), normalized.upgradeCount),
        noDeckDuplication: Boolean(normalized.noDeckDuplication || old?.noDeckDuplication),
      });
    } else {
      old.maxMasterStage = Math.max(Number(old.maxMasterStage ?? 0), normalized.upgradeCount);
      old.noDeckDuplication ||= Boolean(normalized.noDeckDuplication);
    }
  }
  return [...byId.values()].sort((a, b) => a.baseName.localeCompare(b.baseName, "ja") || a.id.localeCompare(b.id));
}

export function parseProduceItemCatalog(text) {
  return parseTopLevelYamlRecords(text, ["name", "planType", "rarity", "assetId", "isUpgraded", "libraryHidden", "order"])
    .filter((entry) => entry.name && entry.libraryHidden !== true)
    .map((entry) => ({ ...entry, name: String(entry.name) }))
    .sort((a, b) => Number(a.order ?? Number.MAX_SAFE_INTEGER) - Number(b.order ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name, "ja"));
}

export function parseGradeCatalog(text) {
  const values = [];
  const seen = new Set();
  for (const match of String(text ?? "").matchAll(/^\s*grade:\s*(ResultGrade_[A-Za-z0-9_]+)\s*$/gm)) {
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    values.push(match[1]);
  }
  return values;
}

export function gradeLabel(value) {
  if (value === null || value === undefined || value === "") return "未指定";
  const numeric = Number(value);
  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const numericLabels = [
      "未指定", "F", "E", "D", "C", "C+", "B", "B+", "A", "A+",
      "S", "S+", "SS", "SS+", "SSS", "SSS+", "SSSS", "SSSS+", "SSSSS", "SSSSS+",
    ];
    if (Number.isInteger(numeric) && numeric >= 0 && numeric < numericLabels.length) return numericLabels[numeric];
  }

  const suffix = String(value).trim().replace(/^ResultGrade_/i, "");
  const key = suffix.replace(/[\s_-]+/g, "").toLowerCase();
  const direct = {
    unknown: "未指定",
    f: "F", e: "E", d: "D", c: "C", cplus: "C+",
    b: "B", bplus: "B+", a: "A", aplus: "A+",
    s: "S", splus: "S+", ss: "SS", ssplus: "SS+",
    sss: "SSS", sssplus: "SSS+", ssss: "SSSS", ssssplus: "SSSS+",
    sssss: "SSSSS", sssssplus: "SSSSS+",
  };
  return direct[key] ?? suffix.replace(/_PLUS$/i, "+").replaceAll("_", "") || "未指定";
}

export function planLabel(value) {
  return ({
    ProducePlanType_Unknown: "未指定",
    ProducePlanType_Common: "共通",
    ProducePlanType_Plan1: "センス",
    ProducePlanType_Plan2: "ロジック",
    ProducePlanType_Plan3: "アノマリー",
  })[String(value ?? "")] ?? String(value ?? "未指定");
}

export async function fetchTextWithFallback(primary, fallback = null, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("カタログを取得する fetch がありません。");
  try {
    const response = await fetchImpl(primary);
    if (response.ok) {
      const text = await response.text();
      if (text.trim()) return text;
    }
  } catch {}
  if (!fallback) throw new Error(`カタログを取得できません: ${primary}`);
  const response = await fetchImpl(fallback);
  if (!response.ok) throw new Error(`カタログを取得できません (${response.status}): ${fallback}`);
  const text = await response.text();
  if (!text.trim()) throw new Error(`カタログが空です: ${fallback}`);
  return text;
}

export function buildUniqueNameIndex(entries, nameField = "name") {
  const index = new Map();
  const ambiguous = new Set();
  for (const entry of entries ?? []) {
    const name = String(entry?.[nameField] ?? "").trim();
    if (!name) continue;
    if (index.has(name) && String(index.get(name).id) !== String(entry.id)) ambiguous.add(name);
    else index.set(name, entry);
  }
  for (const name of ambiguous) index.delete(name);
  return index;
}
