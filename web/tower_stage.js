import { calculateWeightedTurnParameterTypes } from "./turn_parameters.js";

export const TOWER_STAGE_MASTER_URLS = Object.freeze({
  battleConfigs: "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/ProduceExamBattleConfig.yaml",
  scoreConfigs: "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/ProduceExamBattleScoreConfig.yaml",
  towers: "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/Tower.yaml",
  layerExams: "https://raw.githubusercontent.com/vertesan/gakumasu-diff/main/TowerLayerExam.yaml",
  liveLayers: "./data/tower_layer_config.json.gz",
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

export function parseTowerLiveLayerMap(payload) {
  const effects = Array.isArray(payload?.effects) ? payload.effects.map(String) : [];
  const configs = Array.isArray(payload?.configs) ? payload.configs.map(String) : [];
  const result = [];
  const towers = payload?.towers && typeof payload.towers === "object" ? payload.towers : {};
  for (const [towerId, floors] of Object.entries(towers)) {
    if (!Array.isArray(floors)) continue;
    for (const floor of floors) {
      if (!Array.isArray(floor) || floor.length < 3) continue;
      const number = Number(floor[0] ?? 0);
      const maxSubMemoryCount = Number(floor[1] ?? 0);
      const indices = Array.isArray(floor[2]) ? floor[2] : [];
      indices.forEach((configIndexRaw, effectIndex) => {
        const configIndex = Number(configIndexRaw);
        if (!Number.isInteger(configIndex) || configIndex < 0) return;
        const produceExamBattleConfigId = configs[configIndex] ?? "";
        const examEffectType = effects[effectIndex] ?? "";
        if (!towerId || number <= 0 || !produceExamBattleConfigId || !examEffectType) return;
        result.push({
          towerId: String(towerId),
          number,
          examEffectType,
          maxSubMemoryCount,
          produceExamBattleConfigId,
        });
      });
    }
  }
  return result.sort((a, b) =>
    a.towerId.localeCompare(b.towerId)
    || a.number - b.number
    || a.examEffectType.localeCompare(b.examEffectType)
  );
}

function towerCharacterId(catalog, towerId) {
  const fromMaster = String(catalog?.towerById?.get?.(towerId)?.characterId ?? "");
  if (fromMaster) return fromMaster;
  const match = String(towerId ?? "").match(/^tower_\d+-(.+)$/);
  return match?.[1] ?? "";
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

async function fetchOptionalCompressedJson(url, fetchImpl) {
  try {
    const response = await fetchImpl(url);
    if (!response?.ok || typeof response.arrayBuffer !== "function") return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    let text = "";
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      if (typeof DecompressionStream !== "function") return null;
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      text = await new Response(stream).text();
    } else {
      text = new TextDecoder().decode(bytes);
    }
    return text.trim() ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export async function loadTowerStageCatalog(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("ドル道マスタを取得する fetch がありません。");
  const [battleText, scoreText, towerText, layerText, liveLayerPayload] = await Promise.all([
    fetchRequired(TOWER_STAGE_MASTER_URLS.battleConfigs, fetchImpl),
    fetchRequired(TOWER_STAGE_MASTER_URLS.scoreConfigs, fetchImpl),
    fetchOptional(TOWER_STAGE_MASTER_URLS.towers, fetchImpl),
    fetchOptional(TOWER_STAGE_MASTER_URLS.layerExams, fetchImpl),
    fetchOptionalCompressedJson(TOWER_STAGE_MASTER_URLS.liveLayers, fetchImpl),
  ]);
  const configs = parseTowerBattleConfigs(battleText);
  const configById = new Map(configs.map((config) => [config.id, config]));
  const towers = parseTowerCatalog(towerText);
  const towerById = new Map(towers.map((tower) => [tower.id, tower]));
  const liveLayers = parseTowerLiveLayerMap(liveLayerPayload);
  const masterLayers = parseTowerLayerExams(layerText);
  const rawLayerExams = liveLayers.length ? liveLayers : masterLayers;
  const layerExams = rawLayerExams.filter((layer) => configById.has(layer.produceExamBattleConfigId));
  const scoreRowsById = parseTowerScoreConfigs(scoreText);
  const layerFloorCount = new Set(layerExams.map((layer) => `${layer.towerId}#${layer.number}`)).size;
  return {
    configs,
    configById,
    towers,
    towerById,
    layerExams,
    scoreRowsById,
    layerFloorCount,
    layerSource: liveLayers.length ? "api-snapshot" : (masterLayers.length ? "master" : "config-fallback"),
    liveLayerMeta: liveLayers.length ? {
      generatedAt: String(liveLayerPayload?.generatedAt ?? ""),
      appVersion: String(liveLayerPayload?.appVersion ?? ""),
      masterVersion: String(liveLayerPayload?.masterVersion ?? ""),
    } : null,
  };
}

export function buildTowerStageChoices(catalog, characterId = "", examEffectType = "") {
  const character = String(characterId ?? "");
  const effectType = String(examEffectType ?? "");
  const layers = Array.isArray(catalog?.layerExams) ? catalog.layerExams : [];
  if (layers.length) {
    const matching = layers.filter((layer) => {
      if (character && towerCharacterId(catalog, layer.towerId) !== character) return false;
      if (effectType && layer.examEffectType !== effectType) return false;
      return catalog?.configById?.has?.(layer.produceExamBattleConfigId);
    });

    const byFloor = new Map();
    for (const layer of matching) {
      const key = `${layer.towerId}#${layer.number}`;
      if (!byFloor.has(key)) byFloor.set(key, layer);
    }

    return [...byFloor.values()].map((layer) => {
      const config = catalog.configById.get(layer.produceExamBattleConfigId);
      const tower = catalog.towerById.get(layer.towerId);
      return {
        key: `${layer.towerId}#${layer.number}`,
        configId: config.id,
        towerId: layer.towerId,
        number: layer.number,
        examEffectType: layer.examEffectType,
        maxSubMemoryCount: Number(layer.maxSubMemoryCount ?? 0),
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
    examEffectType: "",
    maxSubMemoryCount: 0,
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

export function calculateTowerTurnTypes(config, seedInput) {
  if (!config) throw new Error("ドル道ステージ設定を選択してください。");
  return calculateWeightedTurnParameterTypes(config, seedInput);
}

export function towerParameterLabel(type) {
  return ({ Vocal: "Vo", Dance: "Da", Visual: "Vi" })[String(type ?? "")] ?? String(type ?? "");
}
