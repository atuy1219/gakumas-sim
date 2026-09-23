import {
  cardDisplayName,
  composeSelectedMemories,
  extractMemories,
  getField,
  loadCatalogs,
  mergeMemoryLibraries,
  parseMemoryJsonText,
  resolveCardInput,
  resolveContestInitialDeck,
} from "./engine.js";
import {
  makeCardInstances,
  observationCardLabel,
  prepareSeedBatchSearch,
  runOrderMonteCarlo,
  seedIntervalFromChoices,
} from "./simulation.js";
import { createTowerPreset, parseTowerPreset } from "./tower_preset.js";
import {
  createTowerTurnState,
  drawTowerTurn,
  finishTowerTurn,
  playTowerCard,
  resolveTowerDefaultDeck,
  useTowerDrink,
} from "./tower_runtime.js";
import {
  describeCardEffects,
  describeProduceItemEffect,
  loadExamItemCatalogs,
  resolveProduceDrinks,
  resolveProduceItems,
} from "./exam_effects.js";
import {
  generatedObservationLabel,
  partitionSeedObservations,
} from "./seed_observation.js";
import { createMemoryBackup, parseMemoryBackup } from "./memory_backup.js";
import {
  buildTowerStageChoices,
  calculateTowerMemoryParameters,
  calculateTowerParameterBonus,
  calculateTowerTurnTypes,
  loadTowerStageCatalog,
  towerParameterLabel,
} from "./tower_stage.js";
import {
  FILTER_STORAGE_KEY,
  MEMORY_STORAGE_KEY,
} from "./storage_keys.js";

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = MEMORY_STORAGE_KEY;
const MEMORY_PAGE_SIZE = 40;
const MAX_SEED_MATCHES = 100;
const SEED_TASK_SIZE = 1_000_000;

let catalogs = {
  cards: [], cardById: new Map(), initialDecks: [], initialDeckById: new Map(),
  idolCards: [], idolCardById: new Map(),
};
let memoryList = [];
let memoryVisible = MEMORY_PAGE_SIZE;
let editingMemoryId = null;
let seedWorkers = [];
let seedSearchCancelled = false;
let towerTurnState = null;
let towerSelectedCardIndex = 0;
let examTurnState = null;
let examSelectedCardIndex = 0;
let examItemCatalogs = {
  items: [], itemById: new Map(), itemEffects: [], itemEffectById: new Map(),
  cardRandomPools: [], cardRandomPoolById: new Map(),
  drinks: [], drinkById: new Map(), drinkEffects: [], drinkEffectById: new Map(),
};
let towerStageCatalog = null;
let towerStageChoicesByKey = new Map();

const simState = {
  contest: { slots: [], baseCards: [] },
  tower: { slots: [], baseCards: [] },
};

function asHex(value) {
  return `0x${(Number(value) >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
}

function showError(message) {
  const box = $("global-error");
  box.textContent = message instanceof Error ? message.message : String(message);
  box.hidden = false;
}

function clearError() {
  $("global-error").hidden = true;
  $("global-error").textContent = "";
}

function activateTab(name) {
  document.querySelectorAll(".app-tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((panel) => { panel.hidden = panel.id !== `tab-${name}`; });
  clearError();
  history.replaceState(null, "", `${location.pathname}?tab=${encodeURIComponent(name)}`);
  if (name === "tower") {
    renderObservationButtons();
    updateObservationCount();
  }
}

document.querySelectorAll(".app-tab").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.tab)));

function rawArray(memory, ...names) {
  const value = getField(memory?.raw, ...names);
  return Array.isArray(value) ? value : [];
}

function compactStoredMemory(memory) {
  const raw = memory.raw ?? {};
  return {
    userMemoryId: memory.userMemoryId,
    name: memory.label,
    manualEntry: Boolean(memory.manual || getField(raw, "manualEntry")),
    idolCardId: memory.idolCardId ?? "",
    characterId: memory.characterId ?? "",
    planType: memory.planType ?? null,
    power: memory.power ?? 0,
    grade: getField(raw, "grade") ?? null,
    vocal: Number(getField(raw, "vocal") ?? 0),
    dance: Number(getField(raw, "dance") ?? 0),
    visual: Number(getField(raw, "visual") ?? 0),
    stamina: Number(getField(raw, "stamina") ?? 0),
    produceId: getField(raw, "produceId") ?? null,
    produceCard: getField(raw, "produceCard") ?? null,
    produceCardPhaseType: getField(raw, "produceCardPhaseType") ?? null,
    examBattleProduceCards: memory.examBattleProduceCards.map((card) => ({
      id: card.id,
      upgradeCount: Number(card.upgradeCount ?? 0),
      fixedDeckOrder: Number(card.fixedDeckOrder ?? 0),
      customizes: Array.isArray(card.customizes) ? card.customizes : [],
    })),
    examBattleProduceItemIds: rawArray(memory, "examBattleProduceItemIds"),
    abilities: rawArray(memory, "abilities"),
    activeProduceCardIds: Array.isArray(memory.activeProduceCardIds) ? memory.activeProduceCardIds : [],
  };
}

function persistLibrary() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryList.map(compactStoredMemory)));
  } catch (error) {
    console.warn("memory persistence failed", error);
  }
}

function restoreLibrary() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(raw) || !raw.length) return;
    memoryList = sanitizeManagedLibrary(extractMemories({ userMemoryList: raw }));
  } catch {}
}

function catalogName(cardOrId) {
  return cardDisplayName(cardOrId, catalogs.cardById);
}

const MEMORY_FORBIDDEN_CARD_NAMES = new Set(["眠気", "眠気+"]);

function normalizeMemoryUpgradeCount(value) {
  return Number(value ?? 0) > 0 ? 1 : 0;
}

function isForbiddenMemoryCard(card) {
  const id = String(card?.id ?? "");
  const directName = String(card?.name ?? "");
  const catalogNameValue = String(catalogs.cardById?.get?.(id)?.name ?? directName);
  return MEMORY_FORBIDDEN_CARD_NAMES.has(catalogNameValue);
}

function sanitizeManagedMemory(memory) {
  const cards = (memory.examBattleProduceCards ?? [])
    .filter((card) => !isForbiddenMemoryCard(card))
    .map((card) => ({ ...card, upgradeCount: normalizeMemoryUpgradeCount(card.upgradeCount) }));
  const allowedIds = new Set(cards.map((card) => String(card.id)));
  const activeIds = (memory.activeProduceCardIds ?? []).map(String).filter((id) => allowedIds.has(id));
  const raw = { ...(memory.raw ?? {}), examBattleProduceCards: cards };
  if (memory.hasActiveProduceCardIds) raw.activeProduceCardIds = activeIds;
  return {
    ...memory,
    examBattleProduceCards: cards,
    activeProduceCardIds: activeIds,
    activeCards: (memory.activeCards ?? [])
      .filter((card) => allowedIds.has(String(card.id)))
      .map((card) => ({ ...card, upgradeCount: normalizeMemoryUpgradeCount(card.upgradeCount) })),
    raw,
  };
}

function sanitizeManagedLibrary(library) {
  return (library ?? []).map(sanitizeManagedMemory);
}

function renderCatalogOptions() {
  const cardList = $("produce-card-options");
  cardList.innerHTML = "";
  const cardFragment = document.createDocumentFragment();
  for (const card of catalogs.cards) {
    const option = document.createElement("option");
    option.value = `${card.name} — ${card.id}`;
    cardFragment.append(option);
  }
  cardList.append(cardFragment);

  const deckList = $("initial-deck-options");
  deckList.innerHTML = "";
  const deckFragment = document.createDocumentFragment();
  for (const deck of catalogs.initialDecks) {
    const option = document.createElement("option");
    option.value = deck.id;
    deckFragment.append(option);
  }
  deckList.append(deckFragment);
}

async function initializeCatalogs() {
  try {
    catalogs = await loadCatalogs();
    memoryList = sanitizeManagedLibrary(memoryList);
    persistLibrary();
    sanitizeSelections();
    $("catalog-dot").classList.add("ok");
    $("catalog-status").textContent = `カード名 ${catalogs.cards.length}件 / 初期デッキ ${catalogs.initialDecks.length}件 / Pアイドル ${catalogs.idolCards.length}件`;
    renderCatalogOptions();
    renderMemoryList();
    renderSimBuilder("contest");
    renderSimBuilder("tower");
  } catch (error) {
    $("catalog-dot").classList.add("warn");
    $("catalog-status").textContent = "カード名データを取得できません。ID入力で続行します。";
    console.warn(error);
  }
}

function renderExamDrinkOptions() {
  const select = $("exam-drink-select");
  if (!select) return;
  const selected = select.value;
  select.replaceChildren(new Option("ドリンクを選択", ""));
  const drinks = [...(examItemCatalogs.drinks ?? [])].sort((a, b) => (
    String(a.order ?? "").localeCompare(String(b.order ?? ""), "ja", { numeric: true })
    || String(a.name ?? a.id).localeCompare(String(b.name ?? b.id), "ja")
  ));
  for (const drink of drinks) {
    select.add(new Option(
      `${drink.name ?? drink.id}${drink.rarity ? ` · ${String(drink.rarity).replace("ProduceDrinkRarity_", "")}` : ""}`,
      String(drink.id),
    ));
  }
  if ([...select.options].some((option) => option.value === selected)) select.value = selected;
}

async function initializeExamItemCatalogs() {
  try {
    examItemCatalogs = await loadExamItemCatalogs();
    renderPItems("contest");
    renderPItems("tower");
    renderExamDrinkOptions();
    if (towerTurnState) renderTowerTurnState();
    if (examTurnState) renderTurnState("exam", examTurnState);
  } catch (error) {
    console.warn("P-item / drink effect catalog load failed", error);
  }
}

async function initializeTowerStageCatalog() {
  const select = $("tower-stage-config");
  const status = $("tower-stage-source-status");
  if (!select) return;
  try {
    towerStageCatalog = await loadTowerStageCatalog();
    renderTowerStageOptions();
    if (status) {
      if (towerStageCatalog.layerSource === "api-snapshot") {
        status.textContent = "MainメモリーのPアイドルに対応するドル道だけを自動表示します。";
      } else if (towerStageCatalog.layerExams.length) {
        status.textContent = "MainメモリーのPアイドルに対応するドル道だけを自動表示します。";
      } else {
        status.textContent = "階層対応表がないため、試験設定（ターン数・Vo/Da/Vi）から選択します。";
      }
    }
  } catch (error) {
    towerStageCatalog = null;
    towerStageChoicesByKey = new Map();
    select.replaceChildren(new Option("ステージ設定を取得できません", ""));
    if (status) status.textContent = "ドル道ステージ設定を取得できません。";
    console.warn("tower stage catalog load failed", error);
  }
  renderTowerStageSummary();
}

function searchMemoryText(memory) {
  const raw = memory.raw ?? {};
  return [
    memory.label,
    memory.userMemoryId,
    memory.idolCardId,
    memory.characterId,
    memory.planType,
    memory.power,
    getField(raw, "grade"),
    ...memory.examBattleProduceCards.flatMap((card) => [card.id, catalogName(card)]),
    ...rawArray(memory, "examBattleProduceItemIds"),
  ].filter((value) => value !== null && value !== undefined).join(" ").toLowerCase();
}

function memorySubtitle(memory) {
  const raw = memory.raw ?? {};
  const parts = [];
  const grade = getField(raw, "grade");
  if (grade) parts.push(String(grade).replace("ResultGrade_", ""));
  if (memory.power) parts.push(`Power ${memory.power}`);
  if (memory.characterId) parts.push(memory.characterId);
  if (memory.idolCardId) parts.push(memory.idolCardId);
  parts.push(`${memory.examBattleProduceCards.length} cards`);
  return parts.join(" · ");
}

function renderMemoryList() {
  const container = $("memory-list");
  const query = $("memory-search").value.trim().toLowerCase();
  const filtered = query ? memoryList.filter((memory) => searchMemoryText(memory).includes(query)) : memoryList;
  $("memory-count-label").textContent = `${memoryList.length}件${query ? ` / ${filtered.length}件ヒット` : ""}`;
  container.innerHTML = "";

  if (!filtered.length) {
    container.className = "memory-grid-v3 empty-state";
    container.textContent = memoryList.length ? "検索条件に一致するメモリーがありません。" : "メモリーを読み込むか、手動で追加してください。";
    $("memory-show-more").hidden = true;
    return;
  }
  container.className = "memory-grid-v3";

  for (const memory of filtered.slice(0, memoryVisible)) {
    const article = document.createElement("article");
    article.className = "memory-card-v3";
    const head = document.createElement("div");
    head.className = "memory-card-v3-head";
    const titleBox = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = memory.label;
    const detail = document.createElement("small");
    detail.textContent = memorySubtitle(memory);
    titleBox.append(title, detail);
    const actions = document.createElement("div");
    actions.className = "button-row";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "secondary compact";
    edit.textContent = "編集";
    edit.addEventListener("click", () => openMemoryEditor(memory));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ghost-button";
    remove.textContent = "削除";
    remove.addEventListener("click", () => {
      memoryList = memoryList.filter((item) => item.userMemoryId !== memory.userMemoryId);
      persistLibrary();
      sanitizeSelections();
      renderMemoryList();
      renderSimBuilder("contest");
      renderSimBuilder("tower");
    });
    actions.append(edit, remove);
    head.append(titleBox, actions);

    const stats = document.createElement("div");
    stats.className = "stat-line";
    const raw = memory.raw ?? {};
    const vocal = Number(getField(raw, "vocal") ?? 0);
    const dance = Number(getField(raw, "dance") ?? 0);
    const visual = Number(getField(raw, "visual") ?? 0);
    const stamina = Number(getField(raw, "stamina") ?? 0);
    stats.textContent = `Vo ${vocal} · Da ${dance} · Vi ${visual} · 体力 ${stamina}`;

    const cards = document.createElement("div");
    cards.className = "chip-list dense";
    for (const card of memory.examBattleProduceCards) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.title = card.id;
      const customizeCount = (card.customizes ?? []).reduce((sum, item) => sum + Math.max(1, Number(item?.customizeCount ?? 1)), 0);
      chip.textContent = `${catalogName(card)}${card.upgradeCount ? " +" : ""}${customizeCount ? ` · カスタム${customizeCount}` : ""}`;
      cards.append(chip);
    }
    const pItems = rawArray(memory, "examBattleProduceItemIds");
    const pItemLine = document.createElement("small");
    pItemLine.className = "muted-line";
    pItemLine.textContent = pItems.length ? `Pアイテム: ${pItems.join(" / ")}` : "Pアイテム: なし / 未取得";
    article.append(head, stats, cards, pItemLine);
    container.append(article);
  }

  $("memory-show-more").hidden = filtered.length <= memoryVisible;
  $("memory-show-more").textContent = `さらに表示 (${Math.min(MEMORY_PAGE_SIZE, filtered.length - memoryVisible)}件)`;
}

function addEditCardRow(card = {}) {
  const row = document.createElement("div");
  row.className = "edit-card-row";
  row.__originalCard = { ...card };
  const id = document.createElement("input");
  id.setAttribute("list", "produce-card-options");
  id.placeholder = "カード名または p_card-...";
  id.value = card.id ? `${catalogName(card)} — ${card.id}` : "";
  const upgrade = document.createElement("input");
  upgrade.type = "number";
  upgrade.min = "0";
  upgrade.max = "1";
  upgrade.step = "1";
  upgrade.value = String(normalizeMemoryUpgradeCount(card.upgradeCount));
  upgrade.title = "強化 (0 / 1)";
  upgrade.addEventListener("input", () => {
    if (upgrade.value === "") return;
    upgrade.value = String(normalizeMemoryUpgradeCount(upgrade.value));
  });
  const fixed = document.createElement("input");
  fixed.type = "number";
  fixed.value = String(Number(card.fixedDeckOrder ?? 0));
  fixed.title = "FixedDeckOrder";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "ghost-button";
  remove.textContent = "削除";
  remove.addEventListener("click", () => row.remove());
  row.append(id, upgrade, fixed, remove);
  $("edit-card-rows").append(row);
}

function openMemoryEditor(memory = null) {
  editingMemoryId = memory?.userMemoryId ?? null;
  const raw = memory?.raw ?? {};
  $("memory-editor").hidden = false;
  $("edit-title").textContent = memory ? "メモリーを編集" : "メモリーを新規追加";
  $("edit-id").value = memory?.userMemoryId ?? "";
  $("edit-name").value = memory?.label ?? "";
  $("edit-idol").value = memory?.idolCardId ?? "";
  $("edit-character").value = memory?.characterId ?? "";
  $("edit-plan").value = memory?.planType ?? "";
  $("edit-power").value = String(memory?.power ?? 0);
  $("edit-grade").value = String(getField(raw, "grade") ?? "");
  $("edit-vocal").value = String(Number(getField(raw, "vocal") ?? 0));
  $("edit-dance").value = String(Number(getField(raw, "dance") ?? 0));
  $("edit-visual").value = String(Number(getField(raw, "visual") ?? 0));
  $("edit-stamina").value = String(Number(getField(raw, "stamina") ?? 0));
  $("edit-pitems").value = rawArray(memory, "examBattleProduceItemIds").join("\n");
  $("edit-card-rows").innerHTML = "";
  for (const card of memory?.examBattleProduceCards ?? []) addEditCardRow(card);
  if (!memory?.examBattleProduceCards?.length) for (let i = 0; i < 6; i += 1) addEditCardRow();
  $("memory-editor").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeMemoryEditor() {
  editingMemoryId = null;
  $("memory-editor").hidden = true;
}

function resolveEditorCard(text) {
  const value = String(text).trim();
  if (!value) return null;
  if (!catalogs.cards.length) return { id: value };
  return resolveCardInput(value, catalogs.cards);
}

function saveMemoryEditor() {
  clearError();
  try {
    const existing = editingMemoryId ? memoryList.find((item) => item.userMemoryId === editingMemoryId) : null;
    const raw = { ...(existing?.raw ?? {}) };
    const requestedId = $("edit-id").value.trim();
    const id = requestedId || existing?.userMemoryId || `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const cards = [];
    for (const row of $("edit-card-rows").querySelectorAll(".edit-card-row")) {
      const inputs = row.querySelectorAll("input");
      const resolved = resolveEditorCard(inputs[0].value);
      if (!resolved) continue;
      const original = row.__originalCard ?? {};
      if (row.dataset.customizeValid === "0") throw new Error(`${catalogName(resolved)}: カスタマイズ条件を満たしていません。`);
      const candidate = { ...original, ...resolved, id: String(resolved.id) };
      if (isForbiddenMemoryCard(candidate)) throw new Error("メモリーに「眠気」は設定できません。");
      const rawUpgrade = Number(inputs[1].value || 0);
      if (!Number.isInteger(rawUpgrade) || rawUpgrade < 0 || rawUpgrade > 1) {
        throw new Error(`${catalogName(candidate)}: メモリーのカード強化は0または1のみです。`);
      }
      cards.push({
        ...original,
        id: String(resolved.id),
        upgradeCount: rawUpgrade,
        fixedDeckOrder: Number(inputs[2].value || 0),
      });
    }
    if (!cards.length) throw new Error("スキルカードを1枚以上入力してください。");

    Object.assign(raw, {
      manualEntry: existing ? Boolean(existing.manual || getField(existing.raw, "manualEntry")) : true,
      userMemoryId: id,
      name: $("edit-name").value.trim() || `メモリー ${id.slice(-8)}`,
      idolCardId: $("edit-idol").value.trim(),
      characterId: $("edit-character").value.trim(),
      planType: $("edit-plan").value.trim() || null,
      power: Number($("edit-power").value || 0),
      grade: $("edit-grade").value.trim() || null,
      vocal: Number($("edit-vocal").value || 0),
      dance: Number($("edit-dance").value || 0),
      visual: Number($("edit-visual").value || 0),
      stamina: Number($("edit-stamina").value || 0),
      examBattleProduceCards: cards,
      examBattleProduceItemIds: $("edit-pitems").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    });

    const normalized = extractMemories({ userMemoryList: [raw] })[0];
    if (!normalized) throw new Error("編集内容をメモリーとして保存できませんでした。");
    if (editingMemoryId && editingMemoryId !== normalized.userMemoryId) {
      memoryList = memoryList.filter((item) => item.userMemoryId !== editingMemoryId);
    }
    memoryList = mergeMemoryLibraries(memoryList, [normalized]);
    persistLibrary();
    sanitizeSelections();
    renderMemoryList();
    renderSimBuilder("contest");
    renderSimBuilder("tower");
    closeMemoryEditor();
  } catch (error) {
    showError(error);
  }
}

function refreshMemoryConsumers() {
  persistLibrary();
  sanitizeSelections();
  renderMemoryList();
  renderSimBuilder("contest");
  renderSimBuilder("tower");
}

function setMemoryBackupStatus(message) {
  const target = $("memory-backup-status");
  if (target) target.textContent = String(message ?? "");
}

function exportAllMemories() {
  clearError();
  try {
    const stored = memoryList.map(compactStoredMemory);
    const backup = createMemoryBackup(stored);
    const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    anchor.href = url;
    anchor.download = `gakumas-memory-backup-${stamp}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setMemoryBackupStatus(`${stored.length}件のメモリーをエクスポートしました。`);
  } catch (error) {
    showError(error);
  }
}

async function importAllMemoriesBackup(file) {
  if (!file) throw new Error("バックアップファイルを選択してください。");
  const entries = parseMemoryBackup(await file.text());
  const imported = sanitizeManagedLibrary(extractMemories({ userMemoryList: entries }));
  if (entries.length && !imported.length) throw new Error("バックアップからメモリーを復元できませんでした。");
  memoryList = mergeMemoryLibraries(memoryList, imported);
  refreshMemoryConsumers();
  setMemoryBackupStatus(`${imported.length}件を読み込みました。既存の同一UserMemoryIdはバックアップ側で更新しました。`);
}

async function importMemoryFiles(fileList) {
  const imported = [];
  for (const file of fileList) {
    const payload = parseMemoryJsonText(await file.text());
    imported.push(...sanitizeManagedLibrary(extractMemories(payload)));
  }
  if (!imported.length) throw new Error("UserMemoryを検出できませんでした。");
  memoryList = mergeMemoryLibraries(memoryList, imported);
  refreshMemoryConsumers();
}

$("export-memory-backup").addEventListener("click", exportAllMemories);

$("memory-backup-file").addEventListener("change", async () => {
  try {
    clearError();
    await importAllMemoriesBackup($("memory-backup-file").files?.[0] ?? null);
  } catch (error) {
    showError(error);
  } finally {
    $("memory-backup-file").value = "";
  }
});

$("memory-file").addEventListener("change", async () => {
  try {
    clearError();
    await importMemoryFiles([...( $("memory-file").files ?? [])]);
  } catch (error) {
    showError(error);
  } finally {
    $("memory-file").value = "";
  }
});

$("load-memory-text").addEventListener("click", () => {
  try {
    clearError();
    const imported = sanitizeManagedLibrary(extractMemories(parseMemoryJsonText($("memory-text").value)));
    if (!imported.length) throw new Error("UserMemoryを検出できませんでした。");
    memoryList = mergeMemoryLibraries(memoryList, imported);
    refreshMemoryConsumers();
  } catch (error) {
    showError(error);
  }
});

$("memory-search").addEventListener("input", () => {
  memoryVisible = MEMORY_PAGE_SIZE;
  renderMemoryList();
});
$("memory-show-more").addEventListener("click", () => {
  memoryVisible += MEMORY_PAGE_SIZE;
  renderMemoryList();
});
$("new-memory").addEventListener("click", () => openMemoryEditor());
$("edit-add-card").addEventListener("click", () => addEditCardRow());
$("edit-save").addEventListener("click", saveMemoryEditor);
$("edit-cancel").addEventListener("click", closeMemoryEditor);
$("clear-memory-library").addEventListener("click", () => {
  if (!confirm("保存しているメモリー一覧をすべて消去しますか？")) return;
  memoryList = [];
  localStorage.removeItem(STORAGE_KEY);
  simState.contest.slots = [];
  simState.tower.slots = [];
  renderMemoryList();
  renderSimBuilder("contest");
  renderSimBuilder("tower");
});

function sanitizeSelections() {
  const ids = new Set(memoryList.map((memory) => memory.userMemoryId));
  for (const mode of ["contest", "tower"]) {
    simState[mode].slots = simState[mode].slots.map((slot) => (slot && ids.has(slot.memoryId) ? slot : null));
  }
}

function simIds(mode) {
  return {
    count: `${mode}-memory-count`,
    builder: `${mode}-builder`,
    initialId: `${mode}-initial-id`,
    baseList: `${mode}-base-list`,
    baseInput: `${mode}-base-input`,
    pitems: `${mode}-pitems`,
  };
}

function desiredSlotCount(mode) {
  return Number($(simIds(mode).count).value || 3);
}

function ensureSlots(mode) {
  const count = desiredSlotCount(mode);
  const slots = simState[mode].slots;
  while (slots.length < count) slots.push(null);
  slots.length = count;
  return slots;
}

function memoryOption(memory) {
  const option = document.createElement("option");
  option.value = memory.userMemoryId;
  option.textContent = `${memory.label} · ${memory.examBattleProduceCards.length}枚`;
  return option;
}

function renderSimBuilder(mode) {
  const ids = simIds(mode);
  const container = $(ids.builder);
  if (!container) return;
  const slots = ensureSlots(mode);
  container.innerHTML = "";
  const roles = slots.length === 2
    ? ["Main", "Sub"]
    : ["Main", ...Array.from({ length: slots.length - 1 }, (_, index) => `Sub ${index + 1}`)];

  roles.forEach((roleName, index) => {
    const box = document.createElement("section");
    box.className = "sim-memory-slot";
    const head = document.createElement("div");
    head.className = "sim-slot-head";
    const role = document.createElement("strong");
    role.textContent = roleName;
    const select = document.createElement("select");
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = memoryList.length ? "メモリーを選択" : "メモリー管理から追加してください";
    select.append(blank);
    for (const memory of memoryList) select.append(memoryOption(memory));
    if (slots[index]?.memoryId) select.value = slots[index].memoryId;
    select.addEventListener("change", () => {
      const memory = memoryList.find((item) => item.userMemoryId === select.value);
      slots[index] = memory ? { memoryId: memory.userMemoryId, activeIds: new Set(memory.activeProduceCardIds ?? []) } : null;
      renderSimBuilder(mode);
    });
    head.append(role, select);
    box.append(head);

    const slot = slots[index];
    const memory = slot ? memoryList.find((item) => item.userMemoryId === slot.memoryId) : null;
    if (memory) {
      const allBar = document.createElement("div");
      allBar.className = "slot-toolbar";
      const note = document.createElement("small");
      note.textContent = "採用するカードを選択";
      const all = document.createElement("button");
      all.type = "button";
      all.className = "ghost-button";
      all.textContent = slot.activeIds.size === memory.examBattleProduceCards.length ? "全解除" : "全選択";
      all.addEventListener("click", () => {
        if (slot.activeIds.size === memory.examBattleProduceCards.length) slot.activeIds.clear();
        else slot.activeIds = new Set(memory.examBattleProduceCards.map((card) => card.id));
        renderSimBuilder(mode);
      });
      allBar.append(note, all);
      box.append(allBar);
      const cardList = document.createElement("div");
      cardList.className = "sim-card-checks";
      for (const card of memory.examBattleProduceCards) {
        const label = document.createElement("label");
        label.className = "card-check";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = slot.activeIds.has(card.id);
        check.addEventListener("change", () => {
          if (check.checked) slot.activeIds.add(card.id);
          else slot.activeIds.delete(card.id);
          renderPItems(mode);
          if (mode === "tower") renderObservationButtons();
        });
        const text = document.createElement("span");
        const name = document.createElement("strong");
        name.textContent = catalogName(card);
        const detail = document.createElement("small");
        detail.textContent = `${card.id}${card.upgradeCount ? ` · +${card.upgradeCount}` : ""}`;
        text.append(name, detail);
        label.append(check, text);
        cardList.append(label);
      }
      box.append(cardList);
    }
    container.append(box);
  });
  renderBaseCards(mode);
  renderPItems(mode);
  if (mode === "tower") {
    renderTowerStageOptions();
    renderTowerStageSummary();
    renderObservationButtons();
  }
}

function selectedTowerMemories() {
  return ensureSlots("tower")
    .map((slot) => slot ? memoryList.find((memory) => memory.userMemoryId === slot.memoryId) : null)
    .filter(Boolean);
}

function currentTowerStageChoice() {
  return towerStageChoicesByKey.get(String($("tower-stage-config")?.value ?? "")) ?? null;
}

function currentTowerStageConfig() {
  const choice = currentTowerStageChoice();
  return choice && towerStageCatalog ? towerStageCatalog.configById.get(choice.configId) ?? null : null;
}

function renderTowerStageOptions() {
  const select = $("tower-stage-config");
  if (!select || !towerStageCatalog) return;
  const previous = String(select.value ?? "");
  const mainSlot = ensureSlots("tower")[0];
  const mainMemory = mainSlot ? memoryList.find((memory) => memory.userMemoryId === mainSlot.memoryId) : null;
  const mainIdol = mainMemory ? catalogs.idolCardById.get(String(mainMemory.idolCardId ?? "")) : null;
  const characterId = String(mainIdol?.characterId ?? mainMemory?.characterId ?? "");
  const examEffectType = String(mainIdol?.examEffectType ?? "");

  if (!mainMemory || !characterId || !examEffectType) {
    towerStageChoicesByKey = new Map();
    select.replaceChildren(new Option("先にMainメモリーを選択してください", ""));
    return;
  }

  const choices = buildTowerStageChoices(towerStageCatalog, characterId, examEffectType);
  towerStageChoicesByKey = new Map(choices.map((choice) => [choice.key, choice]));

  select.replaceChildren(new Option("階を選択してください", ""));
  let lastTurn = null;
  let group = null;
  for (const choice of choices) {
    const config = towerStageCatalog.configById.get(choice.configId);
    if (!choice.exactLayer && config?.turn !== lastTurn) {
      lastTurn = config?.turn;
      group = document.createElement("optgroup");
      group.label = `${lastTurn}ターン`;
      select.append(group);
    }
    const option = new Option(choice.label, choice.key);
    (group && !choice.exactLayer ? group : select).append(option);
  }
  if (towerStageChoicesByKey.has(previous)) select.value = previous;

  const status = $("tower-stage-source-status");
  if (status && towerStageCatalog.layerSource === "api-snapshot") {
    const towerId = choices[0]?.towerId ?? "";
    const floorCount = new Set(choices.map((choice) => choice.number).filter(Boolean)).size;
    const idolLabel = String(mainIdol?.name ?? characterId);
    status.textContent = towerId
      ? `${idolLabel}に対応するドル道 ${floorCount}階だけを表示しています。`
      : `${idolLabel}に対応するドル道階層が見つかりません。`;
  }
}

function towerPercentText(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString("ja-JP")}%` : "—";
}

function renderTowerStageSummary() {
  const host = $("tower-stage-summary");
  if (!host) return;
  host.replaceChildren();
  const config = currentTowerStageConfig();
  if (!config) {
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "ドル道ステージを選択すると、メモリー実効ステータスと各属性ターンの倍率を表示します。";
    host.append(hint);
    const orderHost = $("tower-turn-order-preview");
    if (orderHost) {
      orderHost.replaceChildren();
      const orderHint = document.createElement("span");
      orderHint.className = "hint";
      orderHint.textContent = "ステージとSeedを指定するとターン属性順を表示します。";
      orderHost.append(orderHint);
    }
    return;
  }

  const memories = selectedTowerMemories();
  const parameters = calculateTowerMemoryParameters(memories);
  const bonus = towerStageCatalog
    ? calculateTowerParameterBonus(config, towerStageCatalog.scoreRowsById, parameters)
    : null;
  const cards = [
    ["ステージ", `${config.turn}T`],
    ["実効 Vo", parameters.vocal.toLocaleString("ja-JP")],
    ["実効 Da", parameters.dance.toLocaleString("ja-JP")],
    ["実効 Vi", parameters.visual.toLocaleString("ja-JP")],
    ["Voターン", towerPercentText(bonus?.vocal?.percent)],
    ["Daターン", towerPercentText(bonus?.dance?.percent)],
    ["Viターン", towerPercentText(bonus?.visual?.percent)],
  ];
  for (const [label, value] of cards) {
    const item = document.createElement("span");
    item.className = "tower-stage-stat";
    const small = document.createElement("small");
    const strong = document.createElement("strong");
    small.textContent = label;
    strong.textContent = value;
    item.append(small, strong);
    host.append(item);
  }

  const note = document.createElement("p");
  note.className = "hint tower-stage-note";
  note.textContent = memories.length
    ? `実効値 = Main 100% + Sub各20%。ステージ基準 Vo ${config.vocal} / Da ${config.dance} / Vi ${config.visual}。`
    : "メモリーを選択すると実効ステータスを計算します。";
  host.append(note);

  const orderHost = $("tower-turn-order-preview");
  if (!orderHost) return;
  orderHost.replaceChildren();
  const seedText = String($("tower-seed")?.value ?? "").trim();
  if (!seedText) {
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "Seedを入力するとターン属性順を表示します。";
    orderHost.append(hint);
    return;
  }
  try {
    const order = calculateTowerTurnTypes(config, seedText);
    order.forEach((type, index) => {
      const chip = document.createElement("span");
      chip.className = "chip tower-turn-chip";
      const percent = bonus?.[String(type).toLowerCase()]?.percent;
      chip.textContent = `${index + 1}T ${towerParameterLabel(type)}${Number.isFinite(Number(percent)) ? ` ${percent}%` : ""}`;
      orderHost.append(chip);
    });
  } catch (error) {
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = String(error?.message ?? error);
    orderHost.append(hint);
  }
}

function selectedMemoryComposition(mode) {
  const slots = ensureSlots(mode);
  if (slots.some((slot) => !slot?.memoryId)) throw new Error("メモリーをすべて選択してください。");
  const ids = slots.map((slot) => slot.memoryId);
  if (new Set(ids).size !== ids.length) throw new Error("同じメモリーを複数枠に選択できません。");
  return slots.map((slot) => ({ userMemoryId: slot.memoryId, activeProduceCardIds: [...slot.activeIds] }));
}

function towerDefaultDeckResolution() {
  const main = ensureSlots("tower")[0];
  if (!main?.memoryId) return null;
  const memory = memoryList.find((item) => item.userMemoryId === main.memoryId);
  if (!memory?.idolCardId) return null;
  return resolveTowerDefaultDeck(memory.idolCardId, catalogs.idolCardById, catalogs.initialDeckById);
}

function automaticBaseCards(mode) {
  if (mode === "tower") {
    const resolved = towerDefaultDeckResolution();
    return resolved ? resolved.cards.map((card) => ({ ...card, source: `tower default: ${resolved.deckId}` })) : [];
  }
  const ids = simIds(mode);
  const selectedId = $(ids.initialId)?.value.trim() ?? "";
  let deck = selectedId ? catalogs.initialDeckById.get(selectedId) : null;
  if (mode === "contest" && $("contest-initial-auto").checked) {
    const main = ensureSlots(mode)[0];
    const memory = main ? memoryList.find((item) => item.userMemoryId === main.memoryId) : null;
    if (memory?.idolCardId) deck = resolveContestInitialDeck(memory.idolCardId, catalogs.initialDeckById) ?? deck;
  }
  return deck ? deck.cards.map((card) => ({ ...card, source: `initial: ${deck.id}` })) : [];
}

function baseCards(mode) {
  if (mode === "tower") return automaticBaseCards(mode);
  return [...automaticBaseCards(mode), ...simState[mode].baseCards];
}

function renderBaseCards(mode) {
  const ids = simIds(mode);
  const container = $(ids.baseList);
  if (!container) return;
  container.innerHTML = "";
  const auto = automaticBaseCards(mode);
  const manual = mode === "tower" ? [] : simState[mode].baseCards;
  [...auto, ...manual].forEach((card, index) => {
    const chip = document.createElement("span");
    chip.className = `chip ${index < auto.length ? "auto-chip" : ""}`;
    chip.textContent = catalogName(card);
    chip.title = card.id;
    if (index >= auto.length) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        manual.splice(index - auto.length, 1);
        renderBaseCards(mode);
        if (mode === "tower") renderObservationButtons();
      });
      chip.append(remove);
    }
    container.append(chip);
  });
  if (!auto.length && !manual.length) {
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = mode === "tower" ? "MainのPアイドルを選択すると基本カードを自動追加します" : "初期/共通カード未設定";
    container.append(hint);
  }
}

function addBaseCard(mode) {
  const ids = simIds(mode);
  try {
    clearError();
    const text = $(ids.baseInput).value.trim();
    if (!text) return;
    const card = catalogs.cards.length ? resolveCardInput(text, catalogs.cards) : { id: text, upgradeCount: 0 };
    simState[mode].baseCards.push({ id: String(card.id), upgradeCount: Number(card.upgradeCount ?? 0), fixedDeckOrder: 0, source: "manual base" });
    $(ids.baseInput).value = "";
    renderBaseCards(mode);
    if (mode === "tower") renderObservationButtons();
  } catch (error) {
    showError(error);
  }
}

function buildComposition(mode) {
  const selected = selectedMemoryComposition(mode);
  const extras = baseCards(mode);
  if (mode === "tower" && catalogs.idolCards.length && !extras.length) {
    const main = memoryList.find((item) => item.userMemoryId === selected[0]?.userMemoryId);
    throw new Error(`${main?.label ?? "Main"}: Pアイドルのタイプからドル道の基本カードを特定できません。`);
  }
  return composeSelectedMemories(
    memoryList,
    selected,
    extras,
    mode === "tower" ? 4 : 3,
  );
}

function cardsWithSeedMetadata(cards) {
  return cards.map((card) => {
    const variant = catalogs.cardVariantByKey?.get?.(`${String(card.id)}@@${Number(card.upgradeCount ?? 0)}`);
    const master = variant ?? catalogs.cardById.get(String(card.id)) ?? {};
    return { ...card, isInitial: Boolean(master.isInitial ?? card.isInitial) };
  });
}

function renderPItems(mode) {
  const container = $(simIds(mode).pitems);
  if (!container) return;
  container.innerHTML = "";
  const seen = new Set();
  for (const slot of ensureSlots(mode)) {
    if (!slot) continue;
    const memory = memoryList.find((item) => item.userMemoryId === slot.memoryId);
    const ids = memory?.examBattleProduceItemIds?.length
      ? memory.examBattleProduceItemIds
      : rawArray(memory, "examBattleProduceItemIds");
    for (const id of ids ?? []) seen.add(String(id));
  }
  const resolved = resolveProduceItems([...seen], examItemCatalogs.itemById, examItemCatalogs.itemEffectById);
  for (const item of resolved.items) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = item.name && item.name !== item.id ? item.name : item.id;
    chip.title = [item.id, ...(item.effects ?? []).map(describeProduceItemEffect)].join("\n");
    container.append(chip);
  }
  if (!seen.size) container.textContent = "Pアイテムなし / 未取得";
}

for (const mode of ["contest", "tower"]) {
  $(simIds(mode).count).addEventListener("change", () => renderSimBuilder(mode));
  const initialIdInput = $(simIds(mode).initialId);
  initialIdInput?.addEventListener("change", () => {
    renderBaseCards(mode);
    if (mode === "tower") renderObservationButtons();
  });
  $(`${mode}-add-base`)?.addEventListener("click", () => addBaseCard(mode));
}
$("contest-initial-auto").addEventListener("change", () => renderBaseCards("contest"));

function towerPresetStatus(text) {
  const element = $("tower-preset-status");
  if (element) element.textContent = String(text ?? "");
}

function storedTowerFilter() {
  try {
    const raw = JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) || "{}");
    return {
      planType: String(raw?.tower?.planType ?? ""),
      characterId: String(raw?.tower?.characterId ?? ""),
      idolCardId: String(raw?.tower?.idolCardId ?? ""),
    };
  } catch {
    return { planType: "", characterId: "", idolCardId: "" };
  }
}

function effectiveTowerFilter(requested, memories) {
  const list = (memories ?? []).filter(Boolean);
  if (!list.length) return { planType: "", characterId: "", idolCardId: "" };
  const planType = String(list[0].planType ?? "");
  const characterId = String(list[0].characterId ?? "");
  if (list.some((memory) => String(memory.planType ?? "") !== planType || String(memory.characterId ?? "") !== characterId)) {
    throw new Error("ドル道セット内のメモリーは同じプラン・アイドルである必要があります。");
  }
  const requestedIdol = String(requested?.idolCardId ?? "");
  const sameIdol = list.every((memory) => String(memory.idolCardId ?? "") === String(list[0].idolCardId ?? ""));
  const commonIdol = sameIdol ? String(list[0].idolCardId ?? "") : "";
  return {
    planType: String(requested?.planType ?? "") || planType,
    characterId: String(requested?.characterId ?? "") || characterId,
    idolCardId: requestedIdol && list.every((memory) => String(memory.idolCardId ?? "") === requestedIdol)
      ? requestedIdol
      : commonIdol,
  };
}

function saveTowerFilter(filter) {
  try {
    const raw = JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) || "{}");
    raw.tower = {
      planType: String(filter?.planType ?? ""),
      characterId: String(filter?.characterId ?? ""),
      idolCardId: String(filter?.idolCardId ?? ""),
    };
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(raw));
  } catch {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({ tower: filter }));
  }
  window.dispatchEvent(new CustomEvent("gakumas:tower-preset-filter", { detail: filter }));
}

function exportTowerPreset() {
  clearError();
  towerPresetStatus("");
  try {
    const slots = selectedMemoryComposition("tower");
    const selected = slots.map((slot) => memoryList.find((memory) => memory.userMemoryId === slot.userMemoryId));
    if (selected.some((memory) => !memory)) throw new Error("選択中のメモリーを一覧から取得できません。");
    const filter = effectiveTowerFilter(storedTowerFilter(), selected);
    const preset = createTowerPreset({
      memoryCount: desiredSlotCount("tower"),
      slots,
      memories: selected.map(compactStoredMemory),
      baseCards: [],
      filter,
    });
    const blob = new Blob([`${JSON.stringify(preset, null, 2)}
`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    anchor.href = url;
    anchor.download = `gakumas-tower-set-${stamp}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    towerPresetStatus(`${slots.length}メモリーのドル道セットをエクスポートしました。`);
  } catch (error) {
    showError(error);
  }
}

async function importTowerPreset(file) {
  clearError();
  towerPresetStatus("");
  const preset = parseTowerPreset(await file.text());
  const imported = sanitizeManagedLibrary(extractMemories({ userMemoryList: preset.memories }));
  if (imported.length !== preset.memoryCount) throw new Error("プリセットのメモリー本体を正しく復元できませんでした。");
  const importedById = new Map(imported.map((memory) => [String(memory.userMemoryId), memory]));
  for (const slot of preset.slots) {
    const memory = importedById.get(slot.userMemoryId);
    if (!memory) throw new Error(`メモリー ${slot.userMemoryId} を復元できませんでした。`);
    const cardIds = new Set(memory.examBattleProduceCards.map((card) => String(card.id)));
    for (const id of slot.activeProduceCardIds) {
      if (!cardIds.has(String(id))) throw new Error(`${memory.label}: 採用カード ${id} がメモリー本体にありません。`);
    }
  }
  const selected = preset.slots.map((slot) => importedById.get(slot.userMemoryId));
  const filter = effectiveTowerFilter(preset.filter, selected);

  cancelSeedSearch();
  memoryList = mergeMemoryLibraries(memoryList, imported);
  persistLibrary();
  $("tower-memory-count").value = String(preset.memoryCount);
  simState.tower.slots = preset.slots.map((slot) => ({
    memoryId: slot.userMemoryId,
    activeIds: new Set(slot.activeProduceCardIds.map(String)),
  }));
  simState.tower.baseCards = [];
  saveTowerFilter(filter);
  $("tower-observed").value = "";
  $("tower-seed-results").innerHTML = "";
  renderMemoryList();
  renderSimBuilder("tower");
  updateObservationCount();
  towerPresetStatus(`${preset.memoryCount}メモリーのドル道セットをインポートしました。`);
}

$("tower-export-preset").addEventListener("click", exportTowerPreset);
$("tower-import-preset").addEventListener("change", async () => {
  const input = $("tower-import-preset");
  const file = input.files?.[0];
  if (!file) return;
  try {
    await importTowerPreset(file);
  } catch (error) {
    showError(error);
  } finally {
    input.value = "";
  }
});

function randomSeedBase() {
  const data = new Uint32Array(1);
  crypto.getRandomValues(data);
  return data[0] >>> 0;
}

function renderContestResult(summary) {
  const box = $("contest-result");
  box.hidden = false;
  $("contest-summary").innerHTML = `
    <div class="state-card"><span>試行回数</span><strong>${summary.count.toLocaleString()}</strong></div>
    <div class="state-card"><span>乱数系列Base</span><strong>${summary.seedBase} / ${asHex(summary.seedBase)}</strong></div>
    <div class="state-card"><span>デッキ枚数</span><strong>${summary.deckCount}</strong></div>
    <div class="state-card warning-state"><span>スコア</span><strong>未計算</strong></div>`;

  const first = $("contest-first-card");
  first.innerHTML = "";
  for (const row of summary.firstCard.slice(0, 12)) {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    const count = document.createElement("td");
    const ratio = document.createElement("td");
    name.textContent = catalogName(row.key);
    count.textContent = row.count.toLocaleString();
    ratio.textContent = `${(row.ratio * 100).toFixed(2)}%`;
    tr.append(name, count, ratio);
    first.append(tr);
  }

  const samples = $("contest-samples");
  samples.innerHTML = "";
  for (const sample of summary.samples.slice(0, 10)) {
    const li = document.createElement("li");
    li.textContent = `${sample.seed} (${asHex(sample.seed)}): ${sample.draw.map((id) => catalogName(id)).join(" → ")}`;
    samples.append(li);
  }
}

$("contest-run").addEventListener("click", () => {
  try {
    clearError();
    const composition = buildComposition("contest");
    const count = Number($("contest-run-count").value);
    const drawCount = Number($("contest-draw-count").value);
    const summary = runOrderMonteCarlo(composition.cards, count, randomSeedBase(), drawCount);
    renderContestResult(summary);
  } catch (error) {
    $("contest-result").hidden = true;
    showError(error);
  }
});

function runtimeCardLabel(card) {
  return observationCardLabel(catalogName(card), Number(card?.upgradeCount ?? 0));
}

function examStateTiles(exam) {
  const stamina = Number(exam?.maxStamina ?? 0) > 0
    ? `${Number(exam.stamina ?? 0)}/${Number(exam.maxStamina ?? 0)}`
    : String(Number(exam?.stamina ?? 0));
  return [
    ["スコア", Number(exam?.parameter ?? 0)],
    ...(Number(exam?.targetScore ?? 0) > 0 ? [["目標判定", Number(exam.parameter ?? 0) >= Number(exam.targetScore) ? "達成" : `あと${Math.max(0, Number(exam.targetScore) - Number(exam.parameter ?? 0))}`]] : []),
    ["体力", stamina],
    ["元気", Number(exam?.block ?? 0)], ["好印象", Number(exam?.review ?? 0)],
    ["やる気", Number(exam?.aggressive ?? 0)], ["集中", Number(exam?.lessonBuff ?? 0)],
    ["好調", `${Number(exam?.parameterBuff ?? 0)}T`],
  ];
}

function renderTurnState(mode, state) {
  const box = $(`${mode}-turn-result`);
  if (!box) return;
  box.hidden = !state;
  if (!state) return;

  $(`${mode}-turn-number`).textContent = String(state.turn);
  const turnTypes = Array.isArray(state.turnParameterTypes) ? state.turnParameterTypes : [];
  const currentTurnIndex = Math.max(0, Number(state.turn) - 1);
  const currentType = turnTypes.length
    ? turnTypes[Math.min(currentTurnIndex, turnTypes.length - 1)]
    : null;
  const currentBonus = currentType ? state.parameterBonus?.[String(currentType).toLowerCase()]?.percent : null;
  const turnAttribute = currentType
    ? `${towerParameterLabel(currentType)}ターン${Number.isFinite(Number(currentBonus)) ? ` · ${currentBonus}%` : ""} · `
    : "";
  const seedMeta = mode === "exam" && state.initialRandomState !== undefined
    ? `Seed ${state.seed} · 初期Shuffle ${asHex(state.initialRandomState)} · `
    : "";
  $(`${mode}-turn-meta`).textContent = `${turnAttribute}${seedMeta}${state.ended ? "試験終了 · " : ""}使用可能 ${state.playsRemaining}回 · 山札 ${state.deck.length} · 捨て札 ${state.discard.length} · 除外 ${state.lost.length} · 再シャッフル ${state.recycleCount}回 · RNG ${asHex(state.randomState)}`;
  const statusGrid = $(`${mode}-status-grid`);
  statusGrid.replaceChildren(...examStateTiles(state.exam).map(([label, value]) => {
    const tile = document.createElement("div");
    const small = document.createElement("small");
    const strong = document.createElement("strong");
    small.textContent = label;
    strong.textContent = String(value);
    tile.append(small, strong);
    return tile;
  }));

  if (mode === "tower") {
    const pItemNames = (state.pItems ?? []).map((item) => item.name || item.id);
    $("tower-turn-pitems-state").textContent = pItemNames.length ? `Pアイテム: ${pItemNames.join(" / ")}` : "Pアイテム: なし";
  }

  const warningLine = $(`${mode}-turn-effect-warning`);
  warningLine.hidden = !(state.unsupported?.length);
  warningLine.textContent = state.unsupported?.length
    ? `未対応の効果/条件: ${state.unsupported.join(" / ")}`
    : "";

  let selectedIndex = mode === "tower" ? towerSelectedCardIndex : examSelectedCardIndex;
  selectedIndex = Math.max(0, Math.min(selectedIndex, state.hand.length - 1));
  if (mode === "tower") towerSelectedCardIndex = selectedIndex;
  else examSelectedCardIndex = selectedIndex;

  const selectedBox = $(`${mode}-selected-card`);
  selectedBox.replaceChildren();
  const selected = state.hand[selectedIndex];
  if (selected) {
    const copy = document.createElement("div");
    const eyebrow = document.createElement("small");
    const title = document.createElement("strong");
    const detail = document.createElement("p");
    const use = document.createElement("button");
    eyebrow.textContent = selected.onceOnly ? "レッスン中1回" : "SKILL CARD";
    title.textContent = runtimeCardLabel(selected);
    detail.textContent = describeCardEffects(selected).join(" · ") || "追加効果なし";
    use.type = "button";
    use.className = "primary";
    use.textContent = "このカードを使用";
    use.disabled = Boolean(state.ended) || Number(state.playsRemaining ?? 0) <= 0;
    use.addEventListener("click", () => advanceSimulationTurn(mode, { type: "use", index: selectedIndex }));
    copy.append(eyebrow, title, detail);
    selectedBox.append(copy, use);
  }

  const handBox = $(`${mode}-turn-hand`);
  handBox.innerHTML = "";
  state.hand.forEach((card, index) => {
    const article = document.createElement("button");
    article.type = "button";
    article.className = "m3e-hand-card";
    article.classList.toggle("selected", index === selectedIndex);
    article.setAttribute("aria-pressed", String(index === selectedIndex));
    const title = document.createElement("strong");
    title.textContent = runtimeCardLabel(card);
    const detail = document.createElement("small");
    const move = card.onceOnly ? "使用後に除外" : "使用後に捨て札";
    const effects = describeCardEffects(card);
    detail.textContent = [move, ...effects].join(" · ");
    article.addEventListener("click", () => {
      if (mode === "tower") towerSelectedCardIndex = index;
      else examSelectedCardIndex = index;
      renderTurnState(mode, state);
    });
    article.append(title, detail);
    handBox.append(article);
  });

  const history = $(`${mode}-turn-history`);
  history.innerHTML = "";
  for (const entry of [...state.history].reverse()) {
    const li = document.createElement("li");
    const plays = entry.plays ?? [];
    const drinks = entry.drinks ?? [];
    const drinkText = drinks.map((drink) => {
      const details = (drink.effects ?? []).filter(Boolean).join(" / ");
      return `ドリンク: ${drink.drink?.name ?? drink.drink?.id ?? "不明"}${details ? `（${details}）` : ""}`;
    });
    const playText = plays.map((play) => {
      const details = [...(play.cost ?? []), ...(play.effects ?? [])].filter(Boolean).join(" / ");
      return `使用: ${runtimeCardLabel(play.card)}${details ? `（${details}）` : ""}`;
    });
    const actions = [...drinkText, ...playText];
    const action = actions.length ? actions.join(" → ") : "スキップ";
    const startEffects = (entry.turnStartEffects ?? []).filter(Boolean);
    const start = startEffects.length ? `ターン開始: ${startEffects.join(" / ")} → ` : "";
    const supportRolls = (entry.turnStartSupportCardRolls ?? []).map((roll) =>
      `${roll.supportCardId}: ${roll.result}/${roll.permil}${roll.succeeded ? " 成功" : " 失敗"}`
    );
    const support = supportRolls.length ? ` · サポ抽選 ${supportRolls.join(" / ")}` : "";
    const remains = (entry.hand ?? []).length ? ` · 終了時手札 ${entry.hand.map(runtimeCardLabel).join(" / ")}` : "";
    const endEffects = (entry.turnEndEffects ?? []).filter(Boolean);
    const end = endEffects.length ? ` · ターン終了: ${endEffects.join(" / ")}` : "";
    li.textContent = `Turn ${entry.turn}: ${start}${action}${support}${remains}${end}`;
    history.append(li);
  }
}

function renderTowerTurnState() {
  renderTurnState("tower", towerTurnState);
}

function advanceSimulationTurn(mode, action) {
  const state = mode === "tower" ? towerTurnState : examTurnState;
  try {
    clearError();
    if (String(action?.type) === "use") {
      playTowerCard(state, action.index);
      if (Number(state.playsRemaining ?? 0) <= 0) {
        finishTowerTurn(state, { type: "end" });
        drawTowerTurn(state, 3);
      }
    } else {
      finishTowerTurn(state, action);
      drawTowerTurn(state, 3);
    }
    if (mode === "tower") towerSelectedCardIndex = 0;
    else examSelectedCardIndex = 0;
    renderTurnState(mode, state);
  } catch (error) {
    showError(error);
    renderTurnState(mode, state);
  }
}

$("tower-run").addEventListener("click", () => {
  try {
    clearError();
    const composition = buildComposition("tower");
    const pItemIds = [...new Set(composition.memories.flatMap((memory) =>
      memory.examBattleProduceItemIds?.length ? memory.examBattleProduceItemIds : rawArray(memory, "examBattleProduceItemIds")
    ).map(String))];
    const resolvedPItems = resolveProduceItems(
      pItemIds,
      examItemCatalogs.itemById,
      examItemCatalogs.itemEffectById,
      examItemCatalogs,
    );
    const stageConfig = currentTowerStageConfig();
    if (!stageConfig) throw new Error("ドル道ステージを選択してください。");
    const effectiveParameters = calculateTowerMemoryParameters(composition.memories);
    const parameterBonus = towerStageCatalog
      ? calculateTowerParameterBonus(stageConfig, towerStageCatalog.scoreRowsById, effectiveParameters)
      : null;
    const turnParameterTypes = calculateTowerTurnTypes(stageConfig, $("tower-seed").value);
    towerTurnState = createTowerTurnState(composition.cards, $("tower-seed").value, catalogs.cardById, {
      cardVariantByKey: catalogs.cardVariantByKey,
      customizeById: catalogs.customizeById,
      growEffectById: catalogs.growEffectById,
      stamina: Number(composition.memories[0]?.stamina ?? getField(composition.memories[0]?.raw, "stamina") ?? 0),
      pItems: resolvedPItems.items,
      examEffectById: examItemCatalogs.examEffectById,
      examStatusEnchantById: examItemCatalogs.examStatusEnchantById,
      examTriggerById: examItemCatalogs.examTriggerById,
      cardSearchById: examItemCatalogs.cardSearchById,
      cardRandomPoolById: examItemCatalogs.cardRandomPoolById,
      turnLimit: Number(stageConfig.turn),
    });
    towerTurnState.stageConfig = { ...stageConfig };
    towerTurnState.effectiveParameters = { ...effectiveParameters };
    towerTurnState.parameterBonus = parameterBonus;
    towerTurnState.turnParameterTypes = [...turnParameterTypes];
    towerTurnState.turnLimit = Number(stageConfig.turn);
    towerSelectedCardIndex = 0;
    drawTowerTurn(towerTurnState, 3);
    renderTowerTurnState();
  } catch (error) {
    towerTurnState = null;
    $("tower-turn-result").hidden = true;
    showError(error);
  }
});
$("tower-skip-turn").addEventListener("click", () => {
  if (towerTurnState) advanceSimulationTurn("tower", { type: "skip" });
});

document.addEventListener("exam-simulation-start", (event) => {
  try {
    clearError();
    const cards = Array.isArray(event.detail?.cards) ? event.detail.cards : [];
    examTurnState = createTowerTurnState(cards, event.detail?.seed, catalogs.cardById, {
      cardVariantByKey: catalogs.cardVariantByKey,
      customizeById: catalogs.customizeById,
      growEffectById: catalogs.growEffectById,
      stamina: Number(event.detail?.stamina ?? 0),
      targetScore: Number(event.detail?.targetScore ?? 0),
      examEffectById: examItemCatalogs.examEffectById,
      examStatusEnchantById: examItemCatalogs.examStatusEnchantById,
      examTriggerById: examItemCatalogs.examTriggerById,
      cardSearchById: examItemCatalogs.cardSearchById,
      cardRandomPoolById: examItemCatalogs.cardRandomPoolById,
      supportCards: event.detail?.supportCards ?? [],
      turnParameterTypes: event.detail?.turnParameterTypes ?? [],
      preShuffleAdvanceSteps: Number(event.detail?.preShuffleAdvanceSteps ?? 0),
      turnLimit: event.detail?.turnParameterTypes?.length || null,
    });
    examSelectedCardIndex = 0;
    drawTowerTurn(examTurnState, 3);
    const drinkStatus = $("exam-drink-status");
    if (drinkStatus) drinkStatus.textContent = "実機で使用したタイミングに合わせてドリンクを選択してください。";
    renderTurnState("exam", examTurnState);
  } catch (error) {
    examTurnState = null;
    $("exam-turn-result").hidden = true;
    showError(error);
  }
});
$("exam-skip-turn").addEventListener("click", () => {
  if (examTurnState) advanceSimulationTurn("exam", { type: "skip" });
});

$("exam-use-drink")?.addEventListener("click", () => {
  if (!examTurnState) return showError("先に試験シミュレーションを開始してください。");
  const id = String($("exam-drink-select")?.value ?? "");
  if (!id) return showError("使用するドリンクを選択してください。");
  try {
    clearError();
    const resolved = resolveProduceDrinks(
      [id],
      examItemCatalogs.drinkById,
      examItemCatalogs.drinkEffectById,
      examItemCatalogs,
    );
    const drink = resolved.drinks[0];
    if (!drink || drink.unresolved) throw new Error(`ドリンク ${id} のマスタを解決できません。`);
    const event = useTowerDrink(examTurnState, drink);
    examSelectedCardIndex = 0;
    const effects = (event.effects ?? []).filter(Boolean);
    const status = $("exam-drink-status");
    if (status) {
      status.textContent = `${drink.name ?? drink.id}を使用`
        + (effects.length ? ` · ${effects.join(" / ")}` : "")
        + ` · RNG ${asHex(event.randomStateBefore)} → ${asHex(event.randomStateAfter)}`;
    }
    renderTurnState("exam", examTurnState);
  } catch (error) {
    showError(error);
    renderTurnState("exam", examTurnState);
  }
});

function observedLines() {
  return observedTextBatches().flat();
}

function observedTextBatches() {
  const value = $("tower-observed").value;
  if (!value) return [[]];
  return value.split(/\r?\n\s*\r?\n/).map((part) => part.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
}

function writeObservedTextBatches(batches) {
  $("tower-observed").value = batches.map((batch) => batch.join("\n")).join("\n\n");
}

function observationCardName(card) {
  return observationCardLabel(catalogName(card), Number(card?.upgradeCount ?? 0));
}

function deckNameToIds(composition) {
  const byName = new Map();
  for (const card of composition.cards) {
    const baseName = observationCardLabel(catalogName(card), 0);
    const displayName = observationCardName(card);
    for (const name of new Set([baseName, displayName])) {
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name).add(card.id);
    }
  }
  return byName;
}

function seedObservationState(composition) {
  return partitionSeedObservations(
    observedLines(),
    composition.cards,
    catalogs.cardById,
    catalogs.cardVariantByKey,
  );
}

function parseObservedDraws(composition) {
  const observation = seedObservationState(composition);
  if (!observation.complete) {
    throw new Error(`元デッキの観測が不足しています（${observation.observedInitialCount}/${observation.initialCount}枚）。生成カードは元デッキ枚数には数えません。`);
  }
  // Generated cards such as 眠気 are inserted after the initial shuffle. Remove
  // them only for the Fisher–Yates inversion; the full visible order remains in
  // tower-observed and is consumed later by the runtime replay.
  return [observation.initialIds];
}

function renderObservationButtons() {
  const container = $("tower-observation-buttons");
  if (!container) return;
  container.innerHTML = "";
  let composition;
  try {
    composition = buildComposition("tower");
  } catch {
    container.textContent = "メモリーと採用カードを設定すると、観測入力ボタンが表示されます。";
    return;
  }

  const instances = makeCardInstances(composition.cards);
  let observation;
  try {
    observation = seedObservationState(composition);
  } catch (error) {
    container.textContent = String(error?.message ?? error);
    updateObservationCount(instances.length);
    return;
  }

  if (observation.complete) {
    const complete = document.createElement("p");
    complete.className = "hint seed-message";
    complete.textContent = observation.generatedIds.length
      ? `元デッキ1巡分は完了済みです（生成カード ${observation.generatedIds.length}枚も記録済み）。生成カードがさらに見えた場合は下から追加できます。`
      : "元デッキ1巡分は完了済みです。生成カードがこの後に見えた場合は下から追加できます。";
    container.append(complete);
  } else {
    const used = new Map();
    for (const id of observation.initialIds) used.set(id, (used.get(id) ?? 0) + 1);
    const seen = new Map();
    const totals = new Map();
    for (const instance of instances) totals.set(instance.id, (totals.get(instance.id) ?? 0) + 1);
    for (const instance of instances) {
      const ordinal = (seen.get(instance.id) ?? 0) + 1;
      seen.set(instance.id, ordinal);
      const total = totals.get(instance.id) ?? 1;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "observation-card";
      button.textContent = `${observationCardName(instance.card)}${total > 1 ? ` #${ordinal}` : ""}`;
      button.title = instance.id;
      button.disabled = ordinal <= (used.get(instance.id) ?? 0);
      button.addEventListener("click", () => {
        const batches = observedTextBatches();
        batches.at(-1).push(observationCardName(instance.card));
        writeObservedTextBatches(batches);
        renderObservationButtons();
        updateObservationCount();
      });
      container.append(button);
    }
  }

  for (const target of observation.generatedTargets.values()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "observation-card generated-observation-card-v15";
    button.title = target.id;
    button.textContent = `生成: ${generatedObservationLabel(target, catalogs.cardById, catalogs.cardVariantByKey)}`;
    button.addEventListener("click", () => {
      const batches = observedTextBatches();
      const label = generatedObservationLabel(target, catalogs.cardById, catalogs.cardVariantByKey);
      batches.at(-1).push(`${label} — ${target.id} [生成]`);
      writeObservedTextBatches(batches);
      renderObservationButtons();
      updateObservationCount();
    });
    container.append(button);
  }
  updateObservationCount(instances.length);
}

function renderTowerObservedPreview() {
  const host = $("tower-observed-preview-v14");
  if (!host) return;
  const lines = observedLines();
  host.replaceChildren();
  if (!lines.length) {
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "まだカードがありません。";
    host.append(hint);
    return;
  }
  lines.forEach((line, index) => {
    const chip = document.createElement("span");
    chip.className = "observed-card";
    chip.textContent = `${index + 1}. ${line}`;
    host.append(chip);
  });
}

function updateObservationCount(deckCount = null) {
  renderTowerObservedPreview();
  let composition;
  try {
    composition = buildComposition("tower");
    if (deckCount === null) deckCount = composition.cards.length;
  } catch {
    deckCount = Number(deckCount ?? 0);
  }
  if (!deckCount || !composition) {
    $("tower-observed-count").textContent = "0枚";
    $("tower-find-seed").disabled = true;
    return;
  }
  try {
    const observation = seedObservationState(composition);
    const generated = observation.generatedIds.length ? ` · 生成${observation.generatedIds.length}枚` : "";
    $("tower-observed-count").textContent =
      `${observation.observedInitialCount} / ${deckCount}枚${observation.missingCount ? ` · あと${observation.missingCount}枚` : " · 入力完了"}${generated}`;
    $("tower-find-seed").disabled = !observation.complete;
  } catch {
    $("tower-observed-count").textContent = "入力を確認";
    $("tower-find-seed").disabled = true;
  }
}

$("tower-observed").addEventListener("input", () => {
  renderObservationButtons();
  updateObservationCount();
});
$("tower-next-draw").addEventListener("click", () => {
  const batches = observedTextBatches();
  if (!batches.at(-1)?.length) return showError("先に新しく手札へ来たカードを入力してください。");
  const composition = buildComposition("tower");
  if (!seedObservationState(composition).complete) batches.push([]);
  writeObservedTextBatches(batches);
  renderObservationButtons();
  updateObservationCount();
});
$("tower-undo-observation").addEventListener("click", () => {
  const batches = observedTextBatches();
  while (batches.length > 1 && !batches.at(-1).length) batches.pop();
  batches.at(-1)?.pop();
  writeObservedTextBatches(batches);
  renderObservationButtons();
  updateObservationCount();
});
$("tower-reset-observation").addEventListener("click", () => {
  $("tower-observed").value = "";
  $("tower-seed-results").innerHTML = "";
  renderObservationButtons();
  updateObservationCount();
});

function cancelSeedSearch() {
  seedSearchCancelled = true;
  for (const worker of seedWorkers) worker.terminate();
  seedWorkers = [];
  $("tower-cancel-seed").hidden = true;
}
$("tower-cancel-seed").addEventListener("click", cancelSeedSearch);

function renderSeedCandidates(matches, scanned, total, complete, note = "") {
  const container = $("tower-seed-results");
  container.innerHTML = "";
  if (note) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = note;
    container.append(p);
  }
  if (!matches.length && complete) {
    const p = document.createElement("p");
    p.textContent = "一致するSeedがありません。最初の山札1巡分の順番と編成を確認してください。";
    container.append(p);
    return;
  }
  for (const seed of matches) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "seed-candidate";
    button.textContent = `${seed} / ${asHex(seed)}`;
    const currentSeed = String($("tower-seed")?.value ?? "").trim();
    const seedMatchesCurrent = currentSeed === String(seed) || currentSeed.toLowerCase() === asHex(seed).toLowerCase();
    button.classList.toggle("selected", seedMatchesCurrent);
    button.setAttribute("aria-pressed", seedMatchesCurrent ? "true" : "false");
    button.addEventListener("click", () => {
      $("tower-seed").value = String(seed);
      renderTowerStageSummary();
      for (const candidate of container.querySelectorAll(".seed-candidate")) {
        candidate.classList.remove("selected");
        candidate.setAttribute("aria-pressed", "false");
      }
      button.classList.add("selected");
      button.setAttribute("aria-pressed", "true");
    });
    container.append(button);
  }
  if (matches.length >= MAX_SEED_MATCHES) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = `候補が${MAX_SEED_MATCHES}件に達したため表示を打ち切りました。編成と入力順を確認してください。`;
    container.append(p);
  }
  if (!complete) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = `${scanned.toLocaleString()} / ${total.toLocaleString()}候補状態を検査中…`;
    container.append(p);
  }
}

async function startSeedSearch() {
  cancelSeedSearch();
  seedSearchCancelled = false;
  clearError();
  $("tower-find-seed").disabled = true;
  $("tower-cancel-seed").hidden = false;
  try {
    const composition = buildComposition("tower");
    const observation = seedObservationState(composition);
    const seedCards = cardsWithSeedMetadata(composition.cards);
    const prepared = prepareSeedBatchSearch(seedCards, parseObservedDraws(composition));
    const observationSummary = observation.generatedIds.length
      ? `元デッキ${observation.initialIds.length}枚 + 生成カード観測${observation.generatedIds.length}枚`
      : `元デッキ${observation.initialIds.length}枚`;

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

    let scanned = 0;
    const matches = new Set();
    let active = 0;
    let nextTask = 0;
    let finished = false;
    const concurrency = Math.max(1, Math.min(8, Number(navigator.hardwareConcurrency || 4)));
    $("tower-seed-progress").hidden = false;
    $("tower-seed-progress").max = total;
    $("tower-seed-progress").value = 0;
    renderSeedCandidates([], 0, total, false, `${observationSummary}を使用。各ドロー内は順不同。探索対象 ${total.toLocaleString()}状態。`);

    await new Promise((resolve, reject) => {
      function maybeDone() {
        if (finished) return;
        if (seedSearchCancelled) {
          finished = true;
          resolve();
          return;
        }
        if (nextTask >= tasks.length && active === 0) {
          finished = true;
          resolve();
        }
      }

      function assign(worker) {
        if (seedSearchCancelled || matches.size >= MAX_SEED_MATCHES || nextTask >= tasks.length) {
          worker.terminate();
          active -= 1;
          maybeDone();
          return;
        }
        const task = tasks[nextTask++];
        worker.__task = task;
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
      }

      for (let i = 0; i < Math.min(concurrency, tasks.length); i += 1) {
        const worker = new Worker("./seed_worker.js");
        seedWorkers.push(worker);
        active += 1;
        worker.onerror = (event) => {
          if (!finished) {
            finished = true;
            reject(new Error(`seed探索Workerでエラー: ${event.message || "unknown"}`));
          }
        };
        worker.onmessage = (event) => {
          const data = event.data ?? {};
          if (data.type !== "done" || finished) return;
          scanned += Number(data.scanned ?? 0);
          for (const seed of data.found ?? []) matches.add(Number(seed) >>> 0);
          $("tower-seed-progress").value = Math.min(scanned, total);
          renderSeedCandidates([...matches].sort((a, b) => a - b), scanned, total, false);
          assign(worker);
        };
        assign(worker);
      }
    });

    const result = [...matches].sort((a, b) => a - b);
    const complete = !seedSearchCancelled;
    renderSeedCandidates(result, scanned, total, complete, complete ? `探索完了: ${result.length}候補` : "探索を停止しました。" );
    if (complete && result.length === 1) {
      $("tower-seed").value = String(result[0]);
      renderTowerStageSummary();
    }
  } finally {
    for (const worker of seedWorkers) worker.terminate();
    seedWorkers = [];
    $("tower-find-seed").disabled = false;
    $("tower-cancel-seed").hidden = true;
    $("tower-seed-progress").hidden = true;
  }
}

$("tower-find-seed").addEventListener("click", () => startSeedSearch().catch(showError));
$("tower-stage-config")?.addEventListener("change", renderTowerStageSummary);
$("tower-seed")?.addEventListener("input", renderTowerStageSummary);

const tabParam = new URLSearchParams(location.search).get("tab");
activateTab(["memory", "cards", "items", "exam", "contest", "tower"].includes(tabParam) ? tabParam : "memory");
restoreLibrary();
renderMemoryList();
renderSimBuilder("contest");
renderSimBuilder("tower");
initializeCatalogs();
initializeExamItemCatalogs();
initializeTowerStageCatalog();
