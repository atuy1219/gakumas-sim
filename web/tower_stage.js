import { XorShift32, parseSeed } from "./engine.js";

export const TOWER_STAGE_MASTER_URLS = Object.freeze({
  battleConfigs: "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/ProduceExamBattleConfig.yaml",
  scoreConfigs: "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/ProduceExamBattleScoreConfig.yaml",
  towers: "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/Tower.yaml",
  layerExams: "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/TowerLayerExam.yaml",
});

function scalar(raw) {
  const text = String(raw ?? "").trim();
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    try {
      if (text.startsWith('"')) return JSON.parse(text);
    } catch {}
    return text.slice(1, -1);
  }
  return text;
}

function yamlRecords(text) {
  const records = [];
  let current = null;
  const flush = () => {
    if (current) records.push(current);
  };
  for (const line of String(text ?? "").split(/\r?\n/)) {
    let match = line.match(/^- ([A-Za-z][A-Za-z0-9_]*):\s*(.*?)\s*$/);
    if (match) {
      flush();
      current = { [match[1]]: scalar(match[2]) };
      continue;
    }
    if (!current) continue;
    match = line.match(/^  ([A-Za-z][A-Za-z0-9_]*):\s*(.*?)\s*$/);
    if (match) current[match[1]] = scalar(match[2]);
  }
  flush();
  return records;
}

export function parseTowerBattleConfigs(text) {
  return yamlRecords(text)
    .filter((row) => String(row.id ?? "").startsWith("p_exam_battle_config-tower_"))
    .map((row) => ({
      id: String(row.id),
      turn: Number(row.turn ?? 0),
      vocal: Number(row.vocal ?? 0),
      dance: Number(row.dance ?? 0),
      visual: Number(row.visual ?? 0),
      vocalExcellent: Number(row.vocalExcellent ?? 0),
      danceExcellent: Number(row.danceExcellent ?? 0),
      visualExcellent: Number(row.visualExcellent ?? 0),
      vocalBad: Number(row.vocalBad ?? 0),
      danceBad: Number(row.danceBad ?? 0),
      visualBad: Number(row.visualBad ?? 0),
      produceExamBattleScoreConfigId: String(row.produceExamBattleScoreConfigId ?? ""),
    }))
    .filter((row) => row.turn > 0 && row.vocal + row.dance + row.visual > 0)
    .sort((a, b) =>
      a.turn - b.turn
      || a.vocal - b.vocal
      || a.dance - b.dance
      || a.visual - b.visual
      || a.id.localeCompare(b.id)
    );
}

export function parseTowerScoreConfigs(text) {
  const result = new Map();
  for (const row of yamlRecords(text)) {
    const id = String(row.id ?? "");
    if (!id.startsWith("p_exam_battle_score_config-tower_")) continue;
    if (!result.has(id)) result.set(id, []);
    result.get(id).push({
      parameter: Number(row.parameter ?? 0),
      vocalPermil: Number(row.vocalPermil ?? 0),
      dancePermil: Number(row.dancePermil ?? 0),
      visualPermil: Number(row.visualPermil ?? 0),
    });
  }
  for (const rows of result.values()) rows.sort((a, b) => a.parameter - b.parameter);
  return result;
}

export function parseTowerCatalog(text) {
  return yamlRecords(text)
    .filter((row) => String(row.id ?? "").startsWith("tower_"))
    .map((row) => ({
      id: String(row.id),
      characterId: String(row.characterId ?? ""),
      title: String(row.title ?? row.id),
      order: Number(row.order ?? 999999),
    }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function parseTowerLayerExams(text) {
  return yamlRecords(text)
    .map((row) => ({
      towerId: String(row.towerId ?? ""),
      number: Number(row.number ?? 0),
      examEffectType: String(row.examEffectType ?? ""),
      parameterBaseLine: Number(row.parameterBaseLine ?? 0),
      baseScore: Number(row.baseScore ?? 0),
      produceExamGimmickEffectGroupId: String(row.produceExamGimmickEffectGroupId ?? ""),
      produceExamBattleConfigId: String(row.produceExamBattleConfigId ?? ""),
      produceExamBattleNpcGroupId: String(row.produceExamBattleNpcGroupId ?? ""),
    }))
    .filter((row) => row.towerId && row.number > 0 && row.produceExamBattleConfigId)
    .sort((a, b) => a.towerId.localeCompare(b.towerId) || a.number - b.number);
}

async function fetchRequired(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response?.ok) throw new Error(`ドル道マスタを取得できません (${response?.status ?? "network"}): ${url}`);
  const text = await response.text();
  if (!text.trim()) throw new Error(`ドル道マスタが空です: ${url}`);
  return text;
}

async function fetchOptional(url, fetchImpl) {
  try {
    const response = await fetchImpl(url);
    if (!response?.ok) return "";
    return await response.text();
  } catch {
    return "";
  }
}

export async function loadTowerStageCatalog(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("ドル道マスタを取得する fetch がありません。");
  const [battleText, scoreText, towerText, layerText] = await Promise.all([
    fetchRequired(TOWER_STAGE_MASTER_URLS.battleConfigs, fetchImpl),
    fetchRequired(TOWER_STAGE_MASTER_URLS.scoreConfigs, fetchImpl),
    fetchOptional(TOWER_STAGE_MASTER_URLS.towers, fetchImpl),
    fetchOptional(TOWER_STAGE_MASTER_URLS.layerExams, fetchImpl),
  ]);
  const configs = parseTowerBattleConfigs(battleText);
  const configById = new Map(configs.map((config) => [config.id, config]));
  const towers = parseTowerCatalog(towerText);
  const towerById = new Map(towers.map((tower) => [tower.id, tower]));
  const layerExams = parseTowerLayerExams(layerText).filter((layer) => configById.has(layer.produceExamBattleConfigId));
  const scoreRowsById = parseTowerScoreConfigs(scoreText);
  return { configs, configById, towers, towerById, layerExams, scoreRowsById };
}

export function buildTowerStageChoices(catalog, characterId = "") {
  const character = String(characterId ?? "");
  const layers = Array.isArray(catalog?.layerExams) ? catalog.layerExams : [];
  if (layers.length) {
    return layers
      .filter((layer) => {
        if (!character) return true;
        return String(catalog?.towerById?.get?.(layer.towerId)?.characterId ?? "") === character;
      })
      .map((layer) => {
        const config = catalog.configById.get(layer.produceExamBattleConfigId);
        const tower = catalog.towerById.get(layer.towerId);
        return {
          key: `${layer.towerId}#${layer.number}`,
          configId: config.id,
          towerId: layer.towerId,
          number: layer.number,
          exactLayer: true,
          label: `${tower?.title ?? layer.towerId} · ${layer.number}階 · ${config.turn}T · Vo ${config.vocal} / Da ${config.dance} / Vi ${config.visual}`,
        };
      });
  }

  return (catalog?.configs ?? []).map((config) => ({
    key: config.id,
    configId: config.id,
    towerId: "",
    number: 0,
    exactLayer: false,
    label: `${config.turn}T · Vo ${config.vocal} / Da ${config.dance} / Vi ${config.visual}`,
  }));
}

export function memoryStat(memory, key) {
  const direct = memory?.[key];
  if (direct !== null && direct !== undefined && Number.isFinite(Number(direct))) return Number(direct);
  const raw = memory?.raw;
  const fallback = raw && typeof raw === "object" ? raw[key] : 0;
  return Number.isFinite(Number(fallback)) ? Number(fallback) : 0;
}

export function calculateTowerMemoryParameters(memories, subMemoryPermil = 200) {
  const list = (memories ?? []).filter(Boolean);
  const result = { vocal: 0, dance: 0, visual: 0 };
  if (!list.length) return result;
  for (const key of Object.keys(result)) result[key] = Math.trunc(memoryStat(list[0], key));
  for (const memory of list.slice(1)) {
    for (const key of Object.keys(result)) {
      result[key] += Math.trunc(memoryStat(memory, key) * Number(subMemoryPermil) / 1000);
    }
  }
  return result;
}

function interpolatePermil(rows, valueInput, field) {
  const value = Number(valueInput ?? 0);
  if (!rows?.length) return null;
  if (value <= rows[0].parameter) return Number(rows[0][field] ?? 0);
  const last = rows[rows.length - 1];
  if (value >= last.parameter) return Number(last[field] ?? 0);

  let lower = rows[0];
  let upper = last;
  for (let index = 1; index < rows.length; index += 1) {
    if (value < rows[index].parameter) {
      upper = rows[index];
      lower = rows[index - 1];
      break;
    }
  }
  if (upper.parameter === lower.parameter) return Number(lower[field] ?? 0);
  const delta = Number(upper[field] ?? 0) - Number(lower[field] ?? 0);
  return Number(lower[field] ?? 0)
    + Math.ceil(delta / (upper.parameter - lower.parameter) * (value - lower.parameter));
}

function penaltyPermil(actualInput, baselineInput, minPermil, maxPermil) {
  const actual = Number(actualInput ?? 0);
  const baseline = Number(baselineInput ?? 0);
  if (baseline <= 0 || actual >= baseline) return 0;
  return Math.trunc(
    Number(minPermil)
    + (Number(maxPermil) - Number(minPermil)) / baseline * (baseline - actual)
  );
}

function ceilTo10(value) {
  return Math.ceil(Number(value) / 10) * 10;
}

export function calculateTowerParameterBonus(config, scoreRowsById, parameters, options = {}) {
  if (!config) return null;
  const rows = scoreRowsById?.get?.(config.produceExamBattleScoreConfigId);
  if (!rows?.length) return null;
  const minPermil = Number(options.penaltyMinPermil ?? 100);
  const maxPermil = Number(options.penaltyMaxPermil ?? 250);
  const penalties = {
    vocal: penaltyPermil(parameters?.vocal, config.vocal, minPermil, maxPermil),
    dance: penaltyPermil(parameters?.dance, config.dance, minPermil, maxPermil),
    visual: penaltyPermil(parameters?.visual, config.visual, minPermil, maxPermil),
  };
  const totalPenaltyPermil = penalties.vocal + penalties.dance + penalties.visual;
  const factorPermil = Math.max(0, 1000 - totalPenaltyPermil);

  const result = {};
  for (const [key, field] of [["vocal", "vocalPermil"], ["dance", "dancePermil"], ["visual", "visualPermil"]]) {
    const basePermil = interpolatePermil(rows, parameters?.[key], field);
    const bonusPermil = ceilTo10(1000 + Math.trunc(basePermil * factorPermil / 1000));
    result[key] = {
      basePermil,
      bonusPermil,
      percent: bonusPermil / 10,
      penaltyPermil: penalties[key],
    };
  }
  return {
    ...result,
    totalPenaltyPermil,
    factorPermil,
  };
}

function roundToEven(value) {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction < 0.5) return floor;
  if (fraction > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

export function calculateTowerTurnTypes(config, seedInput) {
  if (!config) throw new Error("ドル道ステージ設定を選択してください。");
  const limitTurn = Math.trunc(Number(config.turn ?? 0));
  if (limitTurn <= 0) return [];
  const ordered = [
    { type: "Vocal", order: 0, weight: Math.trunc(Number(config.vocal ?? 0)) },
    { type: "Dance", order: 1, weight: Math.trunc(Number(config.dance ?? 0)) },
    { type: "Visual", order: 2, weight: Math.trunc(Number(config.visual ?? 0)) },
  ].sort((a, b) => b.weight - a.weight || a.order - b.order);

  const [high, middle, low] = ordered;
  const randomTurnCount = limitTurn - 3;
  const pool = [];
  if (randomTurnCount > 0) {
    const totalWeight = high.weight + middle.weight + low.weight;
    if (!totalWeight) throw new Error("ドル道ステージのVo/Da/Vi設定値がすべて0です。");
    const highRatio = Math.fround(
      Math.fround(Math.fround(randomTurnCount) * Math.fround(high.weight))
      / Math.fround(totalWeight)
    );
    const highCount = Math.ceil(highRatio);
    const remaining = randomTurnCount - highCount;
    const middleLowWeight = middle.weight + low.weight;
    const middleRatio = remaining
      ? Math.fround(
          Math.fround(Math.fround(remaining) * Math.fround(middle.weight))
          / Math.fround(middleLowWeight)
        )
      : 0;
    const middleCount = remaining ? roundToEven(middleRatio) : 0;
    const lowCount = remaining - middleCount;
    pool.push(...Array(Math.max(0, highCount)).fill(high.type));
    pool.push(...Array(Math.max(0, middleCount)).fill(middle.type));
    pool.push(...Array(Math.max(0, lowCount)).fill(low.type));
  }

  const rng = new XorShift32(parseSeed(seedInput));
  const result = [];
  while (pool.length) result.push(pool.splice(rng.nextInt(0, pool.length), 1)[0]);
  result.push(...[low.type, middle.type, high.type].slice(3 - Math.min(limitTurn, 3)));
  return result;
}

export function towerParameterLabel(type) {
  return ({ Vocal: "Vo", Dance: "Da", Visual: "Vi" })[String(type ?? "")] ?? String(type ?? "");
}
