import { CATALOG_URLS, buildCanonicalCardCatalog, fetchTextWithFallback, parseCharacterCatalog, parseIdolCardCatalog, planLabel } from "./catalog.js";
import { parseProduceCardCatalogYaml } from "./engine.js";
import { EXAM_CARD_POOL_MODE, applyExamDeckOrder, buildExamDeck, changeExamCardCount, examDeckOrderEntries, filterExamCards, filterExamIdols, moveExamDeckOrder } from "./exam_setup.js";
import { createExamPreset, parseExamPreset } from "./exam_preset.js";
import { makeCardInstances, prepareSeedBatchSearch, seedIntervalFromChoices } from "./simulation.js";
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
let examCounts = new Map();
let examDeckOrder = [];
let examObservedBatches = [[]];
let examSeedWorkers = [];
let examSearchCancelled = false;
const examCharacter = document.getElementById("exam-character");
const examPlan = document.getElementById("exam-plan");
const examIdol = document.getElementById("exam-idol");
const examCardPoolMode = document.getElementById("exam-card-pool-mode");
const examCardSearch = document.getElementById("exam-card-search");
const baseExamDeck = () => buildExamDeck(examCards, examCounts);
const examDeck = () => applyExamDeckOrder(baseExamDeck(), examDeckOrder);

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
      return "あさりゼミ: 共通＋3プランを候補表示。固有カードは選択中のキャラクター/Pアイドルだけです。開催回ごとの特別出現枠はこの候補から選択してください。";
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
  document.getElementById("exam-card-summary").textContent = `${examDeck().length}枚 · ${examCounts.size}種類選択`;
}

function invalidateExamDeckOrder() {
  examDeckOrder = [];
}

function ensureExamDeckOrder() {
  const entries = examDeckOrderEntries(baseExamDeck());
  const validKeys = new Set(entries.map((entry) => entry.key));
  const valid = examDeckOrder.length === entries.length
    && examDeckOrder.every((key) => validKeys.has(key))
    && new Set(examDeckOrder).size === entries.length;
  if (!valid) examDeckOrder = entries.map((entry) => entry.key);
  return examDeckOrder;
}

function moveExamOrder(fromIndex, toIndex) {
  ensureExamDeckOrder();
  examDeckOrder = moveExamDeckOrder(examDeckOrder, fromIndex, toIndex);
  resetExamObservation();
  renderExamDeckOrder();
}

function renderExamDeckOrder() {
  const container = document.getElementById("exam-deck-order");
  const count = document.getElementById("exam-order-count");
  if (!container) return;
  ensureExamDeckOrder();
  const deck = examDeck();
  container.replaceChildren();
  if (count) count.textContent = `${deck.length}枚 · 上から順にShuffleへ渡します`;

  deck.forEach((card, index) => {
    const row = document.createElement("div");
    row.className = "m3e-select-card m3e-quantity-card";
    row.draggable = true;
    row.dataset.orderIndex = String(index);

    const text = document.createElement("span");
    const title = document.createElement("strong");
    const meta = document.createElement("small");
    title.textContent = `${index + 1}. ${card.name ?? card.id}`;
    meta.textContent = String(card.id ?? "");
    text.append(title, meta);

    const controls = document.createElement("span");
    controls.className = "quantity-controls";
    const up = document.createElement("button");
    const down = document.createElement("button");
    up.type = down.type = "button";
    up.textContent = "↑";
    down.textContent = "↓";
    up.title = "1つ上へ";
    down.title = "1つ下へ";
    up.setAttribute("aria-label", `${card.name ?? card.id}を1つ上へ`);
    down.setAttribute("aria-label", `${card.name ?? card.id}を1つ下へ`);
    up.disabled = index === 0;
    down.disabled = index === deck.length - 1;
    up.addEventListener("click", () => moveExamOrder(index, index - 1));
    down.addEventListener("click", () => moveExamOrder(index, index + 1));
    controls.append(up, down);

    row.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/plain", String(index));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      const from = Number(event.dataTransfer?.getData("text/plain"));
      if (Number.isInteger(from)) moveExamOrder(from, index);
    });

    row.append(text, controls);
    container.append(row);
  });
}

function examPresetStatus(message) {
  document.getElementById("exam-preset-status").textContent = String(message ?? "");
}

function exportExamPreset() {
  try {
    const preset = createExamPreset({
      characterId: examCharacter.value,
      planType: examPlan.value,
      idolCardId: examIdol.value,
      cardPoolMode: examCardPoolMode?.value ?? EXAM_CARD_POOL_MODE.NORMAL,
      cards: [...examCounts].map(([id, count]) => ({ id, count })),
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
  invalidateExamDeckOrder();
  document.getElementById("exam-start-stamina").value = String(preset.stamina ?? 0);
  document.getElementById("exam-target-score").value = String(preset.targetScore ?? 0);
  examCardSearch.value = "";
  renderExamCards();
  resetExamObservation();
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
      examCounts = changeExamCardCount(examCounts, card, -1);
      invalidateExamDeckOrder();
      resetExamObservation();
      renderExamCards();
    });
    plus.addEventListener("click", () => {
      examCounts = changeExamCardCount(examCounts, card, 1);
      invalidateExamDeckOrder();
      resetExamObservation();
      renderExamCards();
    });
    controls.append(minus, count, plus);
    row.append(text, controls);
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
    chip.textContent = `${index + 1}. ${card.name ?? card.id}`;
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
    const [characterText, idolText, cardText] = await Promise.all([
      fetchTextWithFallback(CATALOG_URLS.characters),
      fetchTextWithFallback(CATALOG_URLS.idolCards),
      fetchTextWithFallback(CATALOG_URLS.cardsPrimary, CATALOG_URLS.cardsFallback),
    ]);
    examCharacters = parseCharacterCatalog(characterText).filter((character) => character.isPlayable);
    examCharacterById = new Map(examCharacters.map((character) => [String(character.id), character]));
    examIdols = parseIdolCardCatalog(idolText);
    examIdolById = new Map(examIdols.map((idol) => [String(idol.id), idol]));
    const fullExamCards = parseProduceCardCatalogYaml(cardText);
    examCardById = new Map(fullExamCards.map((card) => [String(card.id), card]));
    examCardVariantByKey = new Map(fullExamCards.map((card) => [`${String(card.id)}@@${Number(card.upgradeCount ?? 0)}`, card]));
    examCards = buildCanonicalCardCatalog(fullExamCards);
    examCharacter.replaceChildren(new Option("選択してください", ""));
    for (const character of examCharacters) examCharacter.add(new Option(character.name, character.id));
    refreshExamIdols();
    renderExamCards();
  } catch (error) {
    document.getElementById("exam-card-selection").textContent = "カードカタログを読み込めませんでした。再読み込みしてください。";
    showExamError(error);
  }
}

examCharacter.addEventListener("change", () => {
  examCounts = new Map();
  invalidateExamDeckOrder();
  refreshExamIdols();
  renderExamCards();
  resetExamObservation();
});
examPlan.addEventListener("change", () => {
  examCounts = new Map();
  invalidateExamDeckOrder();
  refreshExamIdols();
  renderExamCards();
  resetExamObservation();
});
examIdol.addEventListener("change", () => {
  examCounts = new Map();
  invalidateExamDeckOrder();
  renderExamCards();
  resetExamObservation();
});
examCardPoolMode?.addEventListener("change", () => {
  examCounts = new Map();
  invalidateExamDeckOrder();
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
document.getElementById("exam-next").addEventListener("click", () => {
  if (!examCharacter.value || !examPlan.value || !examIdol.value) return showExamError("キャラクター、プラン、Pアイドルを選択してください。");
  if (!examDeck().length) return showExamError("使用するカードを1枚以上追加してください。");
  document.getElementById("global-error").hidden = true;
  ensureExamDeckOrder();
  resetExamObservation();
  renderExamDeckOrder();
  setSimulationStage("exam", "order");
});
document.getElementById("exam-order-reset")?.addEventListener("click", () => {
  examDeckOrder = examDeckOrderEntries(baseExamDeck()).map((entry) => entry.key);
  resetExamObservation();
  renderExamDeckOrder();
});
document.getElementById("exam-order-next")?.addEventListener("click", () => {
  ensureExamDeckOrder();
  document.getElementById("global-error").hidden = true;
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
  document.dispatchEvent(new CustomEvent("exam-simulation-start", {
    detail: {
      cards: deck.map((card) => ({ ...card })),
      seed: document.getElementById("exam-seed").value,
      stamina: Number(document.getElementById("exam-start-stamina").value || 0),
      targetScore: Number(document.getElementById("exam-target-score").value || 0),
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

const initialRoute = new URLSearchParams(location.search).get("tab") || "memory";
markRoute(routeLabels[initialRoute] ? initialRoute : "memory");
initializeExamSetup();
