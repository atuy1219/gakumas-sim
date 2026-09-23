import { CATALOG_URLS, buildCanonicalCardCatalog, fetchTextWithFallback, parseCharacterCatalog, parseIdolCardCatalog, planLabel } from "./catalog.js";
import { parseProduceCardCatalogYaml } from "./engine.js";
import { EXAM_CARD_POOL_MODE, buildExamDeck, changeExamCardCount, filterExamCards, filterExamIdols } from "./exam_setup.js";
import { createExamPreset, parseExamPreset } from "./exam_preset.js";
import { parseProgressProduceCardsJson, progressDeckCounts } from "./exam_progress.js";
import {
  EXAM_SUPPORT_CARD_COUNT,
  defaultSupportUpgradePercent,
  formatExamTurnParameterTypes,
  inferSupportLimitBreak,
  normalizeManualSupportCards,
  parseExamTurnParameterTypes,
  supportCardRateBonusPercent,
} from "./exam_support_cards.js";
import {
  describeCustomize,
  normalizeCustomizes,
  parseCardMemoryRules,
  parseCustomizeCatalog,
  parseGrowEffectCatalog,
} from "./memory_judgement.js";
import { makeCardInstances, prepareSeedBatchSearch, seedIntervalFromChoices } from "./simulation.js";
import {
  calculateExamTurnTypes,
  describeExamTurnConfig,
  examJudgingStyleLabel,
  getExamTurnProfile,
  getExamTurnStage,
} from "./exam_turns.js";
import { generatedObservationLabel, partitionSeedObservations } from "./seed_observation.js";

const routeLabels = Object.freeze({ memory: "メモリー管理", cards: "P図鑑 · カード", items: "P図鑑 · Pアイテム", exam: "試験（オーディション）", contest: "コンテスト", tower: "ドル道" });
const MAX_SEED_MATCHES = 100;
const SEED_TASK_SIZE = 1_000_000;
const menuButton = document.getElementById("m3e-menu");
const drawer = document.getElementById("m3e-drawer");
const scrim = document.getElementById("m3e-scrim");
const currentPage = document.getElementById("m3e-current-page");

function setDrawer(open) {
  drawer.classList.toggle("open", open);
  drawer.setAttribute("aria-hidden", String(!open));
  menuButton.setAttribute("aria-expanded", String(open));
  scrim.hidden = !open;
  document.body.classList.toggle("m3e-drawer-open", open);
  if (open) drawer.querySelector("button")?.focus();
}

function markRoute(route) {
  currentPage.textContent = routeLabels[route] ?? routeLabels.memory;
  for (const button of drawer.querySelectorAll("[data-route]")) {
    button.classList.toggle("active", button.dataset.route === route);
    button.toggleAttribute("aria-current", button.dataset.route === route);
  }
}

function openRoute(route) {
  const tab = document.querySelector(`.app-tab[data-tab="${route}"]`);
  if (!tab) return;
  tab.click();
  markRoute(route);
  if (route === "exam") setSimulationStage(route, "setup");
  if (["contest", "tower"].includes(route)) setSimulationStage(route, "memory");
  setDrawer(false);
}

menuButton.addEventListener("click", () => setDrawer(!drawer.classList.contains("open")));
scrim.addEventListener("click", () => setDrawer(false));
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && drawer.classList.contains("open")) setDrawer(false); });
for (const button of drawer.querySelectorAll("[data-route]")) button.addEventListener("click", () => openRoute(button.dataset.route));

function addFlowNavigation(mode) {
  const panel = document.getElementById(`tab-${mode}`);
  if (!panel || panel.querySelector(".m3e-flow-nav")) return;
  panel.classList.add("m3e-simulator");
  const first = panel.querySelector(":scope > .input-panel");
  const allRest = [...panel.querySelectorAll(":scope > .panel")].filter((item) => item !== first);
  const rest = allRest.filter((item) => !item.classList.contains("simulation-result"));
  const results = allRest.filter((item) => item.classList.contains("simulation-result"));
  first?.setAttribute("data-sim-stage", "memory");
  rest.forEach((item) => item.setAttribute("data-sim-stage", "simulation"));
  results.forEach((item) => item.setAttribute("data-sim-result", ""));
  const flow = document.createElement("div");
  flow.className = "m3e-flow-nav";
  flow.innerHTML = '<span data-stage="memory">1&nbsp; メモリー選択</span><i></i><span data-stage="simulation">2&nbsp; シミュレーション</span>';
  panel.prepend(flow);
  const next = document.createElement("button");
  next.type = "button";
  next.className = "primary m3e-flow-next";
  next.textContent = "シミュレーション設定へ";
  next.addEventListener("click", () => setSimulationStage(mode, "simulation"));
  first?.append(next);
  const back = document.createElement("button");
  back.type = "button";
  back.className = "secondary m3e-flow-back";
  back.textContent = "メモリー選択へ戻る";
  back.addEventListener("click", () => setSimulationStage(mode, "memory"));
  rest[0]?.prepend(back);
}

function setSimulationStage(mode, stage) {
  const panel = document.getElementById(`tab-${mode}`);
  if (!panel) return;
  for (const element of panel.querySelectorAll("[data-sim-stage]")) element.hidden = element.dataset.simStage !== stage;
  if (["memory", "setup"].includes(stage)) for (const result of panel.querySelectorAll("[data-sim-result]")) result.hidden = true;
  for (const chip of panel.querySelectorAll(".m3e-flow-nav [data-stage]")) chip.classList.toggle("active", chip.dataset.stage === stage);
  panel.dataset.stage = stage;
  const activeStage = panel.querySelector(`[data-sim-stage="${stage}"]`);
  requestAnimationFrame(() => activeStage?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

addFlowNavigation("contest");
addFlowNavigation("tower");
setSimulationStage("contest", "memory");
setSimulationStage("tower", "memory");
setSimulationStage("exam", "setup");

let examCharacters = [];
let examCharacterById = new Map();
let examIdols = [];
let examIdolById = new Map();
let examCards = [];
let examCardById = new Map();
let examCardVariantByKey = new Map();
let examCardRules = new Map();
let examCustomizeById = new Map();
let examGrowEffectById = new Map();
let examCounts = new Map();
let examManualInstances = new Map();
let examProgressDeck = [];
let examProgressInstances = [];
let examProgressPath = "";
let examProgressSupportCards = [];
let examObservedBatches = [[]];
let examSeedWorkers = [];
let examSearchCancelled = false;
const examCharacter = document.getElementById("exam-character");
const examPlan = document.getElementById("exam-plan");
const examIdol = document.getElementById("exam-idol");
const examCardPoolMode = document.getElementById("exam-card-pool-mode");
const examCardSearch = document.getElementById("exam-card-search");
const examTurnStage = document.getElementById("exam-turn-stage");
const manualExamDeck = () => buildExamDeck(examCards, examCounts, examManualInstances);
const examDeck = () => examProgressDeck.length
  ? examProgressDeck.map((card) => ({ ...card }))
  : manualExamDeck();

function parameterTypeForSupportInput(value) {
  const text = String(value ?? "");
  if (text.endsWith("_Vocal") || text.toLowerCase() === "vocal") return "ProduceParameterType_Vocal";
  if (text.endsWith("_Dance") || text.toLowerCase() === "dance") return "ProduceParameterType_Dance";
  if (text.endsWith("_Visual") || text.toLowerCase() === "visual") return "ProduceParameterType_Visual";
  if (text.endsWith("_Unknown") || text.toLowerCase() === "unknown") return "ProduceParameterType_Unknown";
  return "";
}


function readExamSupportCardInputs({ requireAll = true } = {}) {
  const rows = [...document.querySelectorAll(".exam-support-row-v18")].map((row, index) => ({
    slot: index + 1,
    supportCardId: row.dataset.supportCardId || `manual-support-${index + 1}`,
    rarity: row.querySelector("[data-support-rarity]")?.value ?? "",
    filterParameterType: row.querySelector("[data-support-parameter]")?.value ?? "",
    limitBreak: row.querySelector("[data-support-limit-break]")?.value ?? "",
  }));
  return normalizeManualSupportCards(rows, { requireAll });
}
function readExamTurnParameterTypes(supportCards = examProgressSupportCards, seedInput = null) {
  const stageId = String(examTurnStage?.value ?? "");
  const needsAttribute = (supportCards ?? []).some((card) => (
    !String(card?.filterParameterType ?? "").endsWith("_Unknown")
  ));

  if (stageId && stageId !== "manual") {
    if (!getExamTurnStage(stageId)) throw new Error("試験・オーディションを選択してください。");
    if (!getExamTurnProfile(examCharacter.value)) {
      throw new Error("このキャラクターの審査基準は自動計算データに未登録です。「その他（属性順を手動入力）」を使用してください。");
    }
    if (seedInput !== null && String(seedInput ?? "").trim()) {
      return calculateExamTurnTypes(examCharacter.value, stageId, seedInput);
    }
    return [];
  }

  const input = document.getElementById("exam-turn-parameter-types")?.value ?? "";
  const types = parseExamTurnParameterTypes(input);
  if (needsAttribute && !types.length) {
    throw new Error("サポートカード強化を再現するには、試験・オーディションを選択するか、属性順を手動入力してください。");
  }
  return types;
}

function updateExamTurnConfigUi() {
  const manual = document.getElementById("exam-turn-parameters-manual");
  const status = document.getElementById("exam-turn-config-status");
  const stageId = String(examTurnStage?.value ?? "");
  if (manual) manual.hidden = stageId !== "manual";
  if (!status) return;

  if (!stageId) {
    status.textContent = "試験・オーディションを選択してください。";
    return;
  }
  if (stageId === "manual") {
    const types = parseExamTurnParameterTypes(document.getElementById("exam-turn-parameter-types")?.value ?? "");
    status.textContent = types.length
      ? `手動: ${formatExamTurnParameterTypes(types)}`
      : "手動入力を使用します。";
    return;
  }

  const config = describeExamTurnConfig(examCharacter.value, stageId);
  if (!config) {
    status.textContent = examCharacter.value
      ? "このキャラクターの自動配分は未登録です。手動入力を使用してください。"
      : "キャラクターを選択すると審査基準を表示します。";
    return;
  }

  const flow = config.order.map((type) => ({ Vocal: "Vo", Dance: "Da", Visual: "Vi" })[type] ?? type);
  const base = `${config.label} · ${examJudgingStyleLabel(config.style)} · 流1 ${flow[0]} / 流2 ${flow[1]} / 流3 ${flow[2]} · ${config.turn}T（${config.counts.join("/")}）`;
  const seed = document.getElementById("exam-seed")?.value ?? "";
  if (!String(seed).trim()) {
    status.textContent = base;
    return;
  }
  try {
    const types = calculateExamTurnTypes(examCharacter.value, stageId, seed);
    status.textContent = `${base} · ${formatExamTurnParameterTypes(types)}`;
  } catch {
    status.textContent = base;
  }
}


function updateExamSupportStatus() {
  const status = document.getElementById("exam-support-status");
  if (!status) return;
  try {
    const cards = readExamSupportCardInputs({ requireAll: false });
    status.textContent = cards.length
      ? `${cards.length}/${EXAM_SUPPORT_CARD_COUNT}枚入力済み · レアリティの基礎率 × 上限解放補正を自動計算 · CardSearchは手札で内部固定`
      : "未入力の場合、サポートカード強化抽選は行いません。";
  } catch (error) {
    status.textContent = String(error?.message ?? error);
  }
}

function renderExamSupportCardInputs(cards = examProgressSupportCards) {
  const host = document.getElementById("exam-support-card-inputs");
  if (!host) return;
  host.replaceChildren();
  for (let index = 0; index < EXAM_SUPPORT_CARD_COUNT; index += 1) {
    const source = cards[index] ?? {};
    const parameterType = parameterTypeForSupportInput(source.filterParameterType);
    const explicitLimitBreak = Number(source.limitBreak);
    const inferredLimitBreak = inferSupportLimitBreak(
      source.rarity,
      parameterType,
      source.produceCardUpgradePermil,
    );
    const initialLimitBreak = Number.isInteger(explicitLimitBreak)
      && explicitLimitBreak >= 0
      && explicitLimitBreak <= 4
      ? explicitLimitBreak
      : inferredLimitBreak;
    const row = document.createElement("div");
    row.className = "exam-support-grid-v18 exam-support-row-v18";
    row.dataset.supportCardId = String(source.supportCardId ?? `manual-support-${index + 1}`);
    row.innerHTML = `
      <span class="exam-support-slot-v18">${index + 1}</span>
      <label><span>レアリティ</span><select data-support-rarity>
        <option value="">未選択</option><option value="R">R</option><option value="SR">SR</option><option value="SSR">SSR</option>
      </select></label>
      <label><span>対象属性</span><select data-support-parameter>
        <option value="">未選択</option>
        <option value="ProduceParameterType_Vocal">Vo</option>
        <option value="ProduceParameterType_Dance">Da</option>
        <option value="ProduceParameterType_Visual">Vi</option>
        <option value="ProduceParameterType_Unknown">全属性</option>
      </select></label>
      <label><span>上限解放</span><select data-support-limit-break></select><small data-support-rate-preview></small></label>`;
    const rarity = row.querySelector("[data-support-rarity]");
    const parameter = row.querySelector("[data-support-parameter]");
    const limitBreak = row.querySelector("[data-support-limit-break]");
    const preview = row.querySelector("[data-support-rate-preview]");
    rarity.value = String(source.rarity ?? "").toUpperCase();
    parameter.value = parameterType;

    const refreshLimitBreakOptions = () => {
      const current = limitBreak.value || (initialLimitBreak === null ? "" : String(initialLimitBreak));
      limitBreak.replaceChildren(new Option("未選択", ""));
      for (let value = 0; value <= 4; value += 1) {
        const bonus = supportCardRateBonusPercent(rarity.value, value);
        const name = value === 0 ? "無凸" : `${value}凸`;
        limitBreak.add(new Option(
          bonus === null ? name : `${name}（+${bonus.toFixed(1)}%）`,
          String(value),
        ));
      }
      if ([...limitBreak.options].some((option) => option.value === current)) limitBreak.value = current;
    };

    const refreshPreview = () => {
      const bonus = supportCardRateBonusPercent(rarity.value, limitBreak.value);
      const base = defaultSupportUpgradePercent(rarity.value, parameter.value);
      preview.textContent = bonus === null || base === null
        ? ""
        : `基礎 ${base.toFixed(1)}% · 発生率 +${bonus.toFixed(1)}%`;
      updateExamSupportStatus();
    };

    refreshLimitBreakOptions();
    if (initialLimitBreak !== null) limitBreak.value = String(initialLimitBreak);
    refreshPreview();
    rarity.addEventListener("change", () => {
      refreshLimitBreakOptions();
      refreshPreview();
    });
    parameter.addEventListener("change", refreshPreview);
    limitBreak.addEventListener("change", refreshPreview);
    host.append(row);
  }
  updateExamSupportStatus();
}
function cloneExamInstanceConfig(source = {}) {
  return {
    upgradeCount: Number(source?.upgradeCount ?? 0) > 0 ? 1 : 0,
    customizes: normalizeCustomizes(source?.customizes),
  };
}

function seedExamManualInstances(cards = []) {
  const grouped = new Map();
  for (const card of cards ?? []) {
    const id = String(card?.id ?? card?.produceCardId ?? "").trim();
    if (!id) continue;
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(cloneExamInstanceConfig(card));
  }
  examManualInstances = grouped;
}

function syncExamManualInstances(cardIdInput, countInput) {
  const id = String(cardIdInput ?? "");
  const count = Math.max(0, Math.trunc(Number(countInput ?? 0) || 0));
  const values = [...(examManualInstances.get(id) ?? [])];
  while (values.length < count) values.push({ upgradeCount: 0, customizes: [] });
  values.length = Math.min(values.length, count);
  if (values.length) examManualInstances.set(id, values);
  else examManualInstances.delete(id);
}

function customizationActionIds(customizes) {
  return normalizeCustomizes(customizes).flatMap((item) => (
    Array.from({ length: item.customizeCount }, () => item.id)
  ));
}

function examCustomizeSummary(config) {
  const items = normalizeCustomizes(config?.customizes);
  if (!items.length) return "カスタムなし";
  return items.map((item) => {
    const detail = describeCustomize(item.id, item.customizeCount, examCustomizeById, examGrowEffectById);
    return detail.valid
      ? `${detail.label}${item.customizeCount > 1 ? `（${item.customizeCount}段階）` : ""}`
      : `${item.id}（${item.customizeCount}段階）`;
  }).join(" / ");
}

function examCardStateSuffix(card) {
  const upgrade = Number(card?.upgradeCount ?? 0) > 0 ? "+" : "";
  const customCount = normalizeCustomizes(card?.customizes)
    .reduce((sum, item) => sum + Number(item.customizeCount ?? 0), 0);
  return `${upgrade}${customCount ? ` · カスタム${customCount}` : ""}`;
}

function renderExamInstanceConfig(host, card, config, index) {
  host.replaceChildren();
  host.className = "exam-instance-row-v17";

  const heading = document.createElement("strong");
  heading.textContent = `${index + 1}枚目`;

  const upgradeLabel = document.createElement("label");
  const upgradeCaption = document.createElement("span");
  upgradeCaption.textContent = "強化";
  const upgrade = document.createElement("select");
  upgrade.add(new Option("未強化", "0"));
  upgrade.add(new Option("強化済み (+)", "1"));
  upgrade.value = Number(config.upgradeCount ?? 0) > 0 ? "1" : "0";
  upgradeLabel.append(upgradeCaption, upgrade);

  const customHost = document.createElement("div");
  customHost.className = "exam-instance-custom-v17";
  const rule = examCardRules.get(String(card.id));
  const max = Math.max(0, Number(rule?.maxCustomizeCount ?? 0));
  const actions = customizationActionIds(config.customizes);

  if (upgrade.value !== "1") {
    const note = document.createElement("small");
    note.textContent = max > 0 ? "カスタムする場合は先に強化済みにしてください。" : "このカードにカスタム候補はありません。";
    customHost.append(note);
  } else if (!max || !(rule?.customizeIds?.length)) {
    const note = document.createElement("small");
    note.textContent = "このカードにカスタム候補はありません。";
    customHost.append(note);
  } else {
    const selects = [];
    for (let slot = 0; slot < max; slot += 1) {
      const label = document.createElement("label");
      const caption = document.createElement("span");
      caption.textContent = `カスタム${slot + 1}`;
      const select = document.createElement("select");
      select.add(new Option("なし", ""));
      for (const id of rule.customizeIds) {
        const detail = describeCustomize(id, 1, examCustomizeById, examGrowEffectById);
        select.add(new Option(detail.valid ? detail.label : id, id));
      }
      select.value = actions[slot] ?? "";
      label.append(caption, select);
      customHost.append(label);
      selects.push(select);
    }
    const summary = document.createElement("small");
    summary.className = "exam-custom-summary-v17";
    const update = () => {
      config.customizes = normalizeCustomizes(
        selects.map((select) => select.value).filter(Boolean).map((id) => ({ id, customizeCount: 1 })),
      );
      summary.textContent = examCustomizeSummary(config);
      renderExamDeckSummary();
      updateExamSummary();
    };
    for (const select of selects) select.addEventListener("change", update);
    summary.textContent = examCustomizeSummary(config);
    customHost.append(summary);
  }

  upgrade.addEventListener("change", () => {
    config.upgradeCount = upgrade.value === "1" ? 1 : 0;
    if (!config.upgradeCount) config.customizes = [];
    renderExamInstanceConfig(host, card, config, index);
    renderExamDeckSummary();
    updateExamSummary();
  });

  host.append(heading, upgradeLabel, customHost);
}

function currentExamCardFilter(search = examCardSearch?.value ?? "") {
  return {
    planType: examPlan.value,
    characterId: examCharacter.value,
    idolCardId: examIdol.value,
    poolMode: examCardPoolMode?.value ?? EXAM_CARD_POOL_MODE.NORMAL,
    search,
    idolById: examIdolById,
  };
}

function examCardPoolHint() {
  switch (String(examCardPoolMode?.value ?? EXAM_CARD_POOL_MODE.NORMAL)) {
    case EXAM_CARD_POOL_MODE.RESEARCH:
      return "あさりゼミ: 共通＋3プランの通常カードを候補表示。他プランの基本カードは除外し、固有カードは選択中のキャラクター/Pアイドルだけです。開催回ごとの特別出現枠はこの候補から選択してください。";
    case EXAM_CARD_POOL_MODE.HIGH_SCORE:
      return "強化月間: 共通＋選択プランに加え、他キャラのSSR固有カードも候補表示します。開催回ごとの対象差は手動で選択してください。";
    default:
      return "通常: 共通＋選択プラン。固有カードは選択中のキャラクター/Pアイドルだけ表示します。";
  }
}

function updateExamCardPoolHint() {
  const hint = document.getElementById("exam-card-pool-hint");
  if (hint) hint.textContent = examCardPoolHint();
}

function examCardOriginLabel(card) {
  const originIdolId = String(card?.originIdolCardId ?? card?.originPrimaStellaIdolCardId ?? "").trim();
  if (originIdolId) {
    const idol = examIdolById.get(originIdolId);
    return idol?.name ? `固有: ${idol.name}` : "Pアイドル固有";
  }
  const originCharacterId = String(card?.originCharacterId ?? "").trim();
  if (originCharacterId) {
    const character = examCharacterById.get(originCharacterId);
    return character?.name ? `固有: ${character.name}` : "キャラ固有";
  }
  return "";
}

function showExamError(message) {
  const box = document.getElementById("global-error");
  box.textContent = message instanceof Error ? message.message : String(message);
  box.hidden = false;
}

function refreshExamIdols() {
  const selected = examIdol.value;
  const idols = filterExamIdols(examIdols, examCharacter.value, examPlan.value);
  examIdol.replaceChildren(new Option(idols.length ? "選択してください" : "対象のPアイドルがありません", ""));
  for (const idol of idols) examIdol.add(new Option(`${idol.name} · ${idol.rarity ?? ""}`, idol.id));
  if (idols.some((idol) => idol.id === selected)) examIdol.value = selected;
}

function updateExamSummary() {
  const deck = examDeck();
  const suffix = examProgressDeck.length
    ? " · 進行中produceCards / Number昇順"
    : ` · ${examCounts.size}種類選択`;
  document.getElementById("exam-card-summary").textContent = `${deck.length}枚${suffix}`;
}

function renderExamProgressCards() {
  const container = document.getElementById("exam-progress-card-list");
  if (!container) return;
  container.replaceChildren();
  if (!examProgressInstances.length) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  for (const card of examProgressInstances) {
    const chip = document.createElement("span");
    chip.className = "chip";
    if (card.deleted) chip.dataset.deleted = "true";
    chip.textContent = `No.${card.number} ${card.name ?? card.id}${examCardStateSuffix(card)}${card.deleted ? " · 削除済み" : ""}`;
    container.append(chip);
  }
}

function renderExamProgressStatus(message = "") {
  const status = document.getElementById("exam-progress-status");
  if (!status) return;
  if (message) {
    status.textContent = message;
    return;
  }
  if (!examProgressDeck.length) {
    status.textContent = "Seed特定には、Number付きproduceCardsを含むproduce_cards.jsonまたは進行中プロデュースJSONを読み込んでください。既知Seedでのシミュレーションは手動編成でも利用できます。";
    return;
  }
  const first = examProgressDeck[0]?.number;
  const last = examProgressDeck.at(-1)?.number;
  const deletedCount = examProgressInstances.filter((card) => card.deleted).length;
  status.textContent = `有効${examProgressDeck.length}枚${deletedCount ? ` · 削除済み${deletedCount}枚` : ""}${examProgressSupportCards.length ? ` · サポート強化${examProgressSupportCards.length}件` : ""} · Seed用はDeleted除外 · Number ${first}→${last} 昇順 · ${examProgressPath || "produceCards"}`;
}

function clearExamProgressDeck(message = "") {
  examProgressDeck = [];
  examProgressInstances = [];
  examProgressPath = "";
  examProgressSupportCards = [];
  const turnTypes = document.getElementById("exam-turn-parameter-types");
  if (turnTypes) turnTypes.value = "";
  renderExamSupportCardInputs();
  renderExamProgressCards();
  renderExamProgressStatus(message);
}

function applyExamProgressJson(input, sourceLabel = "produce_cards.json") {
  const parsed = parseProgressProduceCardsJson(input, examCardById, examCardVariantByKey);
  examProgressDeck = parsed.cards;
  examProgressInstances = parsed.allCards ?? parsed.cards;
  examProgressPath = parsed.path;
  examProgressSupportCards = parsed.supportCards ?? [];
  renderExamSupportCardInputs();
  examCounts = progressDeckCounts(parsed.cards);
  seedExamManualInstances(parsed.cards);
  examCardSearch.value = "";
  resetExamObservation();
  renderExamCards();
  renderExamProgressCards();
  const deletedCount = parsed.deletedCards?.length ?? 0;
  renderExamProgressStatus(`${sourceLabel}: 有効${parsed.cards.length}枚${deletedCount ? ` · 削除済み${deletedCount}枚` : ""}${examProgressSupportCards.length ? ` · サポート強化${examProgressSupportCards.length}件` : ""}を読み込みました · Seed逆算では削除済みを除外しNumber昇順を使用します · ${parsed.path}`);
  renderExamDeckSummary();
}

function examPresetStatus(message) {
  document.getElementById("exam-preset-status").textContent = String(message ?? "");
}

function exportExamPreset() {
  try {
    examProgressSupportCards = readExamSupportCardInputs();
    const turnParameterTypes = readExamTurnParameterTypes(examProgressSupportCards);
    const preset = createExamPreset({
      characterId: examCharacter.value,
      planType: examPlan.value,
      idolCardId: examIdol.value,
      cardPoolMode: examCardPoolMode?.value ?? EXAM_CARD_POOL_MODE.NORMAL,
      cards: [...examCounts].map(([id, count]) => ({ id, count })),
      manualCards: examProgressDeck.length
        ? []
        : manualExamDeck().map((card) => ({
            id: card.id,
            upgradeCount: card.upgradeCount,
            customizes: normalizeCustomizes(card.customizes),
          })),
      progressCards: examProgressDeck.map((card) => ({
        ...(card.progressCard ?? card),
        customizes: normalizeCustomizes(card.customizes),
      })),
      supportCards: examProgressSupportCards,
      turnStageId: examTurnStage?.value ?? "",
      turnParameterTypes,
      stamina: Number(document.getElementById("exam-start-stamina").value || 0),
      targetScore: Number(document.getElementById("exam-target-score").value || 0),
    });
    const blob = new Blob([`${JSON.stringify(preset, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    anchor.href = url;
    anchor.download = `gakumas-exam-deck-${stamp}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    examPresetStatus(`${examDeck().length}枚の編成をエクスポートしました。`);
  } catch (error) {
    showExamError(error);
  }
}

async function importExamPreset(file) {
  const preset = parseExamPreset(await file.text());
  if (![...examCharacter.options].some((option) => option.value === preset.characterId)) throw new Error(`キャラクター ${preset.characterId} が現在のデータにありません。`);
  if (![...examPlan.options].some((option) => option.value === preset.planType)) throw new Error(`プラン ${preset.planType} が現在のデータにありません。`);
  if (!filterExamIdols(examIdols, preset.characterId, preset.planType).some((idol) => idol.id === preset.idolCardId)) {
    throw new Error(`Pアイドル ${preset.idolCardId} が現在のキャラクター・プランにありません。`);
  }
  const availableCards = new Map(filterExamCards(examCards, {
    planType: preset.planType,
    characterId: preset.characterId,
    idolCardId: preset.idolCardId,
    poolMode: preset.cardPoolMode,
    idolById: examIdolById,
  }).map((card) => [String(card.id), card]));
  const nextCounts = new Map();
  for (const entry of preset.cards) {
    const card = availableCards.get(entry.id);
    if (!card) throw new Error(`カード ${entry.id} が現在のプランにありません。`);
    if (card.noDeckDuplication && entry.count > 1) throw new Error(`${card.baseName ?? card.name}: デッキ内1枚までです。`);
    nextCounts.set(entry.id, entry.count);
  }
  examCharacter.value = preset.characterId;
  examPlan.value = preset.planType;
  refreshExamIdols();
  examIdol.value = preset.idolCardId;
  if (examCardPoolMode) examCardPoolMode.value = preset.cardPoolMode ?? EXAM_CARD_POOL_MODE.NORMAL;
  examCounts = nextCounts;
  if (preset.manualCards?.length) seedExamManualInstances(preset.manualCards);
  else {
    examManualInstances = new Map();
    for (const [id, count] of examCounts) syncExamManualInstances(id, count);
  }
  if (preset.progressCards?.length) {
    const parsedProgress = parseProgressProduceCardsJson(
      { produceCards: preset.progressCards },
      examCardById,
      examCardVariantByKey,
    );
    examProgressDeck = parsedProgress.cards;
    examProgressInstances = parsedProgress.allCards;
    examProgressPath = "preset.progressCards";
    examProgressSupportCards = parsedProgress.supportCards ?? [];
    examCounts = progressDeckCounts(examProgressDeck);
    seedExamManualInstances(examProgressDeck);
    renderExamProgressCards();
  } else {
    clearExamProgressDeck();
  }
  examProgressSupportCards = preset.supportCards ?? examProgressSupportCards;
  renderExamSupportCardInputs();
  const turnTypes = document.getElementById("exam-turn-parameter-types");
  if (turnTypes) turnTypes.value = formatExamTurnParameterTypes(preset.turnParameterTypes ?? []);
  if (examTurnStage) {
    const requestedStage = String(preset.turnStageId ?? "");
    examTurnStage.value = [...examTurnStage.options].some((option) => option.value === requestedStage)
      ? requestedStage
      : ((preset.turnParameterTypes ?? []).length ? "manual" : "");
  }
  updateExamTurnConfigUi();
  document.getElementById("exam-start-stamina").value = String(preset.stamina ?? 0);
  document.getElementById("exam-target-score").value = String(preset.targetScore ?? 0);
  examCardSearch.value = "";
  renderExamCards();
  resetExamObservation();
  renderExamProgressStatus();
  examPresetStatus(`${examDeck().length}枚の編成をインポートしました。`);
}

function renderExamCards() {
  const container = document.getElementById("exam-card-selection");
  const cards = filterExamCards(examCards, currentExamCardFilter());
  updateExamCardPoolHint();
  container.replaceChildren();
  if (!examPlan.value || !examCharacter.value || !cards.length) {
    const missingBase = !examCharacter.value || !examPlan.value;
    container.innerHTML = `<p class="hint">${missingBase ? "キャラクターとプランを選択してください。" : "条件に一致するカードがありません。"}</p>`;
    updateExamSummary();
    return;
  }
  for (const card of cards) {
    const row = document.createElement("div");
    row.className = "m3e-select-card m3e-quantity-card";
    const text = document.createElement("span");
    const title = document.createElement("strong");
    const meta = document.createElement("small");
    title.textContent = card.baseName ?? card.name;
    const origin = examCardOriginLabel(card);
    meta.textContent = [
      planLabel(card.planType),
      card.category ?? "カード",
      card.rarity ?? "",
      origin,
      card.noDeckDuplication ? "デッキ内1枚まで" : "",
    ].filter(Boolean).join(" · ");
    text.append(title, meta);
    const controls = document.createElement("span");
    controls.className = "quantity-controls";
    const minus = document.createElement("button");
    const count = document.createElement("b");
    const plus = document.createElement("button");
    minus.type = plus.type = "button";
    minus.textContent = "−";
    plus.textContent = "+";
    count.textContent = String(examCounts.get(card.id) ?? 0);
    minus.setAttribute("aria-label", `${title.textContent}を1枚減らす`);
    plus.setAttribute("aria-label", `${title.textContent}を1枚増やす`);
    minus.disabled = !examCounts.get(card.id);
    plus.disabled = card.noDeckDuplication && examCounts.get(card.id) === 1;
    minus.addEventListener("click", () => {
      clearExamProgressDeck("カードを手動編集したため、進行中produceCardsのinstance情報を解除しました。");
      examCounts = changeExamCardCount(examCounts, card, -1);
      syncExamManualInstances(card.id, examCounts.get(card.id) ?? 0);
      resetExamObservation();
      renderExamCards();
    });
    plus.addEventListener("click", () => {
      clearExamProgressDeck("カードを手動編集したため、進行中produceCardsのinstance情報を解除しました。");
      examCounts = changeExamCardCount(examCounts, card, 1);
      syncExamManualInstances(card.id, examCounts.get(card.id) ?? 0);
      resetExamObservation();
      renderExamCards();
    });
    controls.append(minus, count, plus);
    row.append(text, controls);
    const selectedCount = Number(examCounts.get(card.id) ?? 0);
    if (selectedCount > 0) {
      syncExamManualInstances(card.id, selectedCount);
      const details = document.createElement("details");
      details.className = "exam-card-config-v17";
      const summary = document.createElement("summary");
      summary.textContent = "強化・カスタムを設定";
      const instanceList = document.createElement("div");
      instanceList.className = "exam-instance-list-v17";
      const configs = examManualInstances.get(String(card.id)) ?? [];
      configs.forEach((config, index) => {
        const host = document.createElement("div");
        renderExamInstanceConfig(host, card, config, index);
        instanceList.append(host);
      });
      details.append(summary, instanceList);
      row.append(details);
    }
    container.append(row);
  }
  updateExamSummary();
}

function renderExamDeckSummary() {
  const container = document.getElementById("exam-deck-summary");
  container.replaceChildren();
  for (const [index, card] of examDeck().entries()) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = examProgressDeck.length
      ? `${index + 1}. No.${card.number} ${card.name ?? card.id}${examCardStateSuffix(card)}`
      : `${index + 1}. ${card.name ?? card.id}${examCardStateSuffix(card)}`;
    container.append(chip);
  }
}

function examObservationState() {
  return partitionSeedObservations(
    examObservedBatches.flat(),
    examDeck(),
    examCardById,
    examCardVariantByKey,
  );
}

function renderExamObservation() {
  const deck = examDeck();
  const instances = makeCardInstances(deck);
  const observed = examObservedBatches.flat();
  const list = document.getElementById("exam-observed-list");
  const buttons = document.getElementById("exam-observation-buttons");
  let observation;
  try {
    observation = examObservationState();
  } catch (error) {
    list.replaceChildren();
    const message = document.createElement("span");
    message.className = "hint error";
    message.textContent = String(error?.message ?? error);
    list.append(message);
    buttons.replaceChildren();
    document.getElementById("exam-observed-count").textContent = "入力を確認";
    document.getElementById("exam-find-seed").disabled = true;
    return;
  }

  const names = new Map(deck.map((card) => [String(card.id), card.name]));
  for (const target of observation.generatedTargets.values()) {
    names.set(String(target.id), generatedObservationLabel(target, examCardById, examCardVariantByKey));
  }

  list.replaceChildren();
  if (!observed.length) list.innerHTML = '<span class="hint">まだカードがありません。</span>';
  let sequence = 0;
  examObservedBatches.forEach((batch, batchIndex) => {
    if (!batch.length) return;
    const group = document.createElement("span");
    group.className = "observed-batch";
    const label = document.createElement("small");
    label.textContent = `ドロー${batchIndex + 1}`;
    group.append(label);
    for (const id of batch) {
      sequence += 1;
      const chip = document.createElement("span");
      chip.className = "observed-card";
      const isGenerated = observation.entries[sequence - 1]?.kind === "generated";
      chip.textContent = `${sequence}. ${names.get(String(id)) ?? id}${isGenerated ? " [生成]" : ""}`;
      group.append(chip);
    }
    list.append(group);
  });

  const generatedSuffix = observation.generatedIds.length ? ` · 生成${observation.generatedIds.length}枚` : "";
  document.getElementById("exam-observed-count").textContent =
    `${observation.observedInitialCount} / ${deck.length}枚${observation.complete ? " · 入力完了" : ` · あと${observation.missingCount}枚`}${generatedSuffix}`;
  document.getElementById("exam-find-seed").disabled = !observation.complete;
  buttons.replaceChildren();
  if (observation.complete) {
    const complete = document.createElement("p");
    complete.className = "hint seed-message";
    complete.textContent = observation.generatedIds.length
      ? "元デッキ1巡分は完了済みです。生成カードがさらに見えた場合は下から追加できます。"
      : "元デッキ1巡分は完了済みです。生成カードがこの後に見えた場合は下から追加できます。";
    buttons.append(complete);
  } else {
    const used = new Map();
    const seen = new Map();
    const totals = new Map();
    for (const id of observation.initialIds) used.set(String(id), (used.get(String(id)) ?? 0) + 1);
    for (const instance of instances) totals.set(instance.id, (totals.get(instance.id) ?? 0) + 1);
    for (const instance of instances) {
      const ordinal = (seen.get(instance.id) ?? 0) + 1;
      seen.set(instance.id, ordinal);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "observation-card";
      button.textContent = `${names.get(instance.id) ?? instance.id}${(totals.get(instance.id) ?? 0) > 1 ? ` #${ordinal}` : ""}`;
      button.disabled = ordinal <= (used.get(instance.id) ?? 0);
      button.addEventListener("click", () => {
        examObservedBatches.at(-1).push(instance.id);
        renderExamObservation();
      });
      buttons.append(button);
    }
  }

  for (const target of observation.generatedTargets.values()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "observation-card generated-observation-card-v15";
    button.textContent = `生成: ${generatedObservationLabel(target, examCardById, examCardVariantByKey)}`;
    button.title = target.id;
    button.addEventListener("click", () => {
      examObservedBatches.at(-1).push(target.id);
      renderExamObservation();
    });
    buttons.append(button);
  }
}

function cancelExamSeedSearch() {
  examSearchCancelled = true;
  for (const worker of examSeedWorkers) worker.terminate();
  examSeedWorkers = [];
  document.getElementById("exam-cancel-seed").hidden = true;
}

function resetExamObservation() {
  cancelExamSeedSearch();
  examObservedBatches = [[]];
  document.getElementById("exam-seed-results").replaceChildren();
  renderExamObservation();
}

function asHex(value) {
  return `0x${(Number(value) >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
}

function renderExamSeedCandidates(matches, scanned, total, complete, note = "") {
  const container = document.getElementById("exam-seed-results");
  container.replaceChildren();
  if (note) {
    const message = document.createElement("p");
    message.className = "hint seed-message";
    message.textContent = note;
    container.append(message);
  }
  if (!matches.length && complete) {
    const message = document.createElement("p");
    message.textContent = "一致するSeedがありません。編成と観測した順番を確認してください。";
    container.append(message);
  }
  for (const seed of matches) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "seed-candidate";
    button.textContent = `${seed} / ${asHex(seed)}`;
    button.title = "このSeedを使用";
    const seedInput = document.getElementById("exam-seed");
    const currentSeed = String(seedInput?.value ?? "").trim();
    const selected = currentSeed === String(seed) || currentSeed.toLowerCase() === asHex(seed).toLowerCase();
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    button.addEventListener("click", () => {
      seedInput.value = String(seed);
      for (const candidate of container.querySelectorAll(".seed-candidate")) {
        candidate.classList.remove("selected");
        candidate.setAttribute("aria-pressed", "false");
      }
      button.classList.add("selected");
      button.setAttribute("aria-pressed", "true");
      navigator.clipboard?.writeText(String(seed)).catch(() => {});
    });
    container.append(button);
  }
  if (matches.length >= MAX_SEED_MATCHES) {
    const message = document.createElement("p");
    message.className = "hint seed-message";
    message.textContent = `候補が${MAX_SEED_MATCHES}件に達したため表示を打ち切りました。編成と入力順を確認してください。`;
    container.append(message);
  }
  if (!complete) {
    const message = document.createElement("p");
    message.className = "hint seed-message";
    message.textContent = `${scanned.toLocaleString()} / ${total.toLocaleString()}候補状態を検査中…`;
    container.append(message);
  }
}

async function startExamSeedSearch() {
  cancelExamSeedSearch();
  examSearchCancelled = false;
  if (!examProgressDeck.length) {
    throw new Error("Seed特定にはNumber付きproduceCardsを含む進行中プロデュースJSONが必要です。編成画面で読み込んでください。");
  }
  const deck = examDeck();
  const observation = examObservationState();
  if (!observation.complete) throw new Error(`元デッキの観測が不足しています（${observation.observedInitialCount}/${observation.initialCount}枚）。`);
  const prepared = prepareSeedBatchSearch(deck, [observation.initialIds]);
  const tasks = [];
  let total = 0;
  const choiceGroups = prepared.choiceGroups?.length
    ? prepared.choiceGroups
    : prepared.choices.map((choices) => ({ variants: [choices], interval: seedIntervalFromChoices(choices) }));
  for (const group of choiceGroups) {
    const interval = group.interval ?? seedIntervalFromChoices(group.variants[0] ?? []);
    total += interval.size;
    for (let start = interval.start; start < interval.end; start += SEED_TASK_SIZE) {
      tasks.push({
        choiceVariants: group.variants,
        start,
        end: Math.min(interval.end, start + SEED_TASK_SIZE),
      });
    }
  }
  const progress = document.getElementById("exam-seed-progress");
  const findButton = document.getElementById("exam-find-seed");
  const cancelButton = document.getElementById("exam-cancel-seed");
  progress.hidden = false;
  progress.max = total;
  progress.value = 0;
  findButton.disabled = true;
  cancelButton.hidden = false;
  renderExamSeedCandidates([], 0, total, false,
    observation.generatedIds.length
      ? `元デッキ${deck.length}枚の順番から探索します（生成カード観測 ${observation.generatedIds.length}枚は初期Shuffle逆算から除外）。`
      : `山札${deck.length}枚の順番から探索します。`);
  let scanned = 0;
  const matches = new Set();
  let nextTask = 0;
  let active = 0;
  let finished = false;
  const concurrency = Math.max(1, Math.min(8, Number(navigator.hardwareConcurrency || 4)));
  try {
    await new Promise((resolve, reject) => {
      const maybeDone = () => {
        if (!finished && (examSearchCancelled || (nextTask >= tasks.length && active === 0))) {
          finished = true;
          resolve();
        }
      };
      const assign = (worker) => {
        if (examSearchCancelled || matches.size >= MAX_SEED_MATCHES || nextTask >= tasks.length) {
          worker.terminate();
          active -= 1;
          maybeDone();
          return;
        }
        const task = tasks[nextTask++];
        worker.postMessage({
          type: "scan",
          taskId: nextTask,
          choices: task.choiceVariants?.[0] ?? [],
          choiceVariants: task.choiceVariants ?? [],
          batchSearch: { shuffleIds: prepared.shuffleIds, shuffledBatches: prepared.shuffledBatches, prefixVariants: prepared.prefixVariants },
          start: task.start,
          end: task.end,
          maxMatches: MAX_SEED_MATCHES - matches.size,
        });
      };
      for (let index = 0; index < Math.min(concurrency, tasks.length); index += 1) {
        const worker = new Worker("./seed_worker.js");
        examSeedWorkers.push(worker);
        active += 1;
        worker.onerror = (event) => reject(new Error(`Seed探索中にエラーが発生しました: ${event.message || "unknown"}`));
        worker.onmessage = (event) => {
          if (event.data?.type !== "done" || finished) return;
          scanned += Number(event.data.scanned ?? 0);
          for (const seed of event.data.found ?? []) matches.add(Number(seed) >>> 0);
          progress.value = Math.min(scanned, total);
          renderExamSeedCandidates([...matches].sort((a, b) => a - b), scanned, total, false);
          assign(worker);
        };
        assign(worker);
      }
    });
    const result = [...matches].sort((a, b) => a - b);
    const complete = !examSearchCancelled;
    renderExamSeedCandidates(result, scanned, total, complete, complete ? `探索完了: ${result.length}候補` : "探索を停止しました。");
  } finally {
    for (const worker of examSeedWorkers) worker.terminate();
    examSeedWorkers = [];
    progress.hidden = true;
    cancelButton.hidden = true;
    try {
      findButton.disabled = !examObservationState().complete;
    } catch {
      findButton.disabled = true;
    }
  }
}

async function initializeExamSetup() {
  try {
    const [characterText, idolText, cardText, customizeText, growEffectText] = await Promise.all([
      fetchTextWithFallback(CATALOG_URLS.characters),
      fetchTextWithFallback(CATALOG_URLS.idolCards),
      fetchTextWithFallback(CATALOG_URLS.cardsPrimary, CATALOG_URLS.cardsFallback),
      fetchTextWithFallback(CATALOG_URLS.cardCustomizes),
      fetchTextWithFallback(CATALOG_URLS.cardGrowEffects),
    ]);
    examCharacters = parseCharacterCatalog(characterText).filter((character) => character.isPlayable);
    examCharacterById = new Map(examCharacters.map((character) => [String(character.id), character]));
    examIdols = parseIdolCardCatalog(idolText);
    examIdolById = new Map(examIdols.map((idol) => [String(idol.id), idol]));
    const fullExamCards = parseProduceCardCatalogYaml(cardText);
    examCardById = new Map(fullExamCards.map((card) => [String(card.id), card]));
    examCardVariantByKey = new Map(fullExamCards.map((card) => [`${String(card.id)}@@${Number(card.upgradeCount ?? 0)}`, card]));
    examCardRules = parseCardMemoryRules(cardText);
    examCustomizeById = parseCustomizeCatalog(customizeText);
    examGrowEffectById = parseGrowEffectCatalog(growEffectText);
    examCards = buildCanonicalCardCatalog(fullExamCards);
    examCharacter.replaceChildren(new Option("選択してください", ""));
    for (const character of examCharacters) examCharacter.add(new Option(character.name, character.id));
    refreshExamIdols();
    renderExamCards();
    renderExamSupportCardInputs();
    renderExamProgressStatus();
  } catch (error) {
    document.getElementById("exam-card-selection").textContent = "カードカタログを読み込めませんでした。再読み込みしてください。";
    showExamError(error);
  }
}

examCharacter.addEventListener("change", () => {
  examCounts = new Map();
  examManualInstances = new Map();
  clearExamProgressDeck();
  refreshExamIdols();
  renderExamCards();
  resetExamObservation();
});
examPlan.addEventListener("change", () => {
  examCounts = new Map();
  examManualInstances = new Map();
  clearExamProgressDeck();
  refreshExamIdols();
  renderExamCards();
  resetExamObservation();
});
examIdol.addEventListener("change", () => {
  examCounts = new Map();
  examManualInstances = new Map();
  clearExamProgressDeck();
  renderExamCards();
  resetExamObservation();
});
examCardPoolMode?.addEventListener("change", () => {
  examCounts = new Map();
  examManualInstances = new Map();
  clearExamProgressDeck();
  renderExamCards();
  resetExamObservation();
});
examCardSearch.addEventListener("input", renderExamCards);
document.getElementById("exam-export-preset").addEventListener("click", exportExamPreset);
document.getElementById("exam-import-preset").addEventListener("change", async (event) => {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  try {
    document.getElementById("global-error").hidden = true;
    examPresetStatus("");
    await importExamPreset(file);
  } catch (error) {
    showExamError(error);
  } finally {
    input.value = "";
  }
});
document.getElementById("exam-progress-file")?.addEventListener("change", async (event) => {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  try {
    document.getElementById("global-error").hidden = true;
    applyExamProgressJson(await file.text(), file.name);
  } catch (error) {
    showExamError(error);
  } finally {
    input.value = "";
  }
});
document.getElementById("exam-load-progress-text")?.addEventListener("click", () => {
  try {
    document.getElementById("global-error").hidden = true;
    const text = document.getElementById("exam-progress-text")?.value ?? "";
    if (!String(text).trim()) throw new Error("produce_cards.jsonまたは進行中プロデュースJSONを貼り付けてください。");
    applyExamProgressJson(text, "貼り付けJSON");
  } catch (error) {
    showExamError(error);
  }
});
document.getElementById("exam-next").addEventListener("click", () => {
  if (!examCharacter.value || !examPlan.value || !examIdol.value) return showExamError("キャラクター、プラン、Pアイドルを選択してください。");
  if (!examDeck().length) return showExamError("使用するカードを1枚以上追加してください。");
  try {
    examProgressSupportCards = readExamSupportCardInputs();
    readExamTurnParameterTypes(examProgressSupportCards);
  } catch (error) {
    return showExamError(error);
  }
  document.getElementById("global-error").hidden = true;
  resetExamObservation();
  renderExamDeckSummary();
  setSimulationStage("exam", "seed");
});
for (const button of document.querySelectorAll("#tab-exam [data-exam-back]")) {
  button.addEventListener("click", () => setSimulationStage("exam", button.dataset.examBack));
}
document.getElementById("exam-seed-next").addEventListener("click", () => {
  const input = document.getElementById("exam-seed");
  if (!String(input?.value ?? "").trim()) {
    showExamError("Seedを入力するか、下の手順でSeed候補を特定してください。");
    input?.focus();
    return;
  }
  document.getElementById("global-error").hidden = true;
  setSimulationStage("exam", "simulation");
});
document.getElementById("exam-run").addEventListener("click", () => {
  const deck = examDeck();
  if (!deck.length) return showExamError("使用するカードを1枚以上追加してください。");
  let turnParameterTypes;
  try {
    examProgressSupportCards = readExamSupportCardInputs();
    turnParameterTypes = readExamTurnParameterTypes(
      examProgressSupportCards,
      document.getElementById("exam-seed")?.value ?? "",
    );
  } catch (error) {
    return showExamError(error);
  }
  document.dispatchEvent(new CustomEvent("exam-simulation-start", {
    detail: {
      cards: deck.map((card) => ({ ...card })),
      seed: document.getElementById("exam-seed").value,
      stamina: Number(document.getElementById("exam-start-stamina").value || 0),
      targetScore: Number(document.getElementById("exam-target-score").value || 0),
      supportCards: examProgressSupportCards.map((item) => ({ ...item })),
      turnParameterTypes,
    },
  }));
});
for (const button of document.querySelectorAll("#tab-tower [data-tower-next]")) {
  button.addEventListener("click", () => {
    if (button.dataset.towerNext === "seed") {
      const stage = document.getElementById("tower-stage-config");
      if (!String(stage?.value ?? "").trim()) {
        showExamError("先にドル道ステージを選択してください。");
        stage?.focus();
        return;
      }
    }
    if (button.dataset.towerNext === "simulation") {
      const input = document.getElementById("tower-seed");
      if (!String(input?.value ?? "").trim()) {
        showExamError("Seedを入力するか、下の手順でSeed候補を特定してください。");
        input?.focus();
        return;
      }
      document.getElementById("global-error").hidden = true;
    }
    setSimulationStage("tower", button.dataset.towerNext);
  });
}
for (const button of document.querySelectorAll("#tab-tower [data-tower-back]")) {
  button.addEventListener("click", () => setSimulationStage("tower", button.dataset.towerBack));
}
document.getElementById("exam-next-draw").addEventListener("click", () => {
  const current = examObservedBatches.at(-1);
  if (!current?.length) return showExamError("先に新しく手札へ来たカードを選択してください。");
  if (examObservedBatches.flat().length < examDeck().length) examObservedBatches.push([]);
  renderExamObservation();
});
document.getElementById("exam-undo-observation").addEventListener("click", () => {
  while (examObservedBatches.length > 1 && !examObservedBatches.at(-1).length) examObservedBatches.pop();
  examObservedBatches.at(-1)?.pop();
  renderExamObservation();
});
document.getElementById("exam-reset-observation").addEventListener("click", resetExamObservation);
document.getElementById("exam-cancel-seed").addEventListener("click", cancelExamSeedSearch);
document.getElementById("exam-find-seed").addEventListener("click", () => startExamSeedSearch().catch(showExamError));
examTurnStage?.addEventListener("change", updateExamTurnConfigUi);
examCharacter?.addEventListener("change", updateExamTurnConfigUi);
document.getElementById("exam-turn-parameter-types")?.addEventListener("input", updateExamTurnConfigUi);
document.getElementById("exam-seed")?.addEventListener("input", updateExamTurnConfigUi);
updateExamTurnConfigUi();

const initialRoute = new URLSearchParams(location.search).get("tab") || "memory";
markRoute(routeLabels[initialRoute] ? initialRoute : "memory");
initializeExamSetup();
