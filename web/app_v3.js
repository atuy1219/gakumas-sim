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
} from "./sim_v3.js";
import { createTowerPreset, parseTowerPreset } from "./tower_preset.js";
import {
  createTowerTurnState,
  drawTowerTurn,
  finishTowerTurn,
  playTowerCard,
  resolveTowerDefaultDeck,
} from "./tower_runtime.js";
import {
  describeCardEffects,
  describeProduceItemEffect,
  loadExamItemCatalogs,
  resolveProduceItems,
} from "./exam_effects_v7.js";

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "gakumas-sim-memory-library-v3";
const LEGACY_STORAGE_KEY = "gakumas-card-order-memory-library-v2";
const FILTER_STORAGE_KEY = "gakumas-sim-builder-filter-v5";
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
};

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
  for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || "[]");
      if (!Array.isArray(raw) || !raw.length) continue;
      memoryList = sanitizeManagedLibrary(extractMemories({ userMemoryList: raw }));
      return;
    } catch {}
  }
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

async function initializeExamItemCatalogs() {
  try {
    examItemCatalogs = await loadExamItemCatalogs();
    renderPItems("contest");
    renderPItems("tower");
    if (towerTurnState) renderTowerTurnState();
  } catch (error) {
    console.warn("P-item effect catalog load failed", error);
  }
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

async function importMemoryFiles(fileList) {
  const imported = [];
  for (const file of fileList) {
    const payload = parseMemoryJsonText(await file.text());
    imported.push(...sanitizeManagedLibrary(extractMemories(payload)));
  }
  if (!imported.length) throw new Error("UserMemoryを検出できませんでした。");
  memoryList = mergeMemoryLibraries(memoryList, imported);
  persistLibrary();
  sanitizeSelections();
  renderMemoryList();
  renderSimBuilder("contest");
  renderSimBuilder("tower");
}

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
    persistLibrary();
    sanitizeSelections();
    renderMemoryList();
    renderSimBuilder("contest");
    renderSimBuilder("tower");
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
  localStorage.removeItem(LEGACY_STORAGE_KEY);
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
  if (mode === "tower") renderObservationButtons();
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
  $(`${mode}-turn-meta`).textContent = `使用可能 ${state.playsRemaining}回 · 山札 ${state.deck.length} · 捨て札 ${state.discard.length} · 除外 ${state.lost.length} · 再シャッフル ${state.recycleCount}回 · RNG ${asHex(state.randomState)}`;
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
    use.disabled = Number(state.playsRemaining ?? 0) <= 0;
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
    const action = plays.length
      ? plays.map((play) => {
          const details = [...(play.cost ?? []), ...(play.effects ?? [])].filter(Boolean).join(" / ");
          return `使用: ${runtimeCardLabel(play.card)}${details ? `（${details}）` : ""}`;
        }).join(" → ")
      : "スキップ";
    const remains = (entry.hand ?? []).length ? ` · 終了時手札 ${entry.hand.map(runtimeCardLabel).join(" / ")}` : "";
    li.textContent = `Turn ${entry.turn}: ${action}${remains}`;
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
    const resolvedPItems = resolveProduceItems(pItemIds, examItemCatalogs.itemById, examItemCatalogs.itemEffectById);
    towerTurnState = createTowerTurnState(composition.cards, $("tower-seed").value, catalogs.cardById, {
      cardVariantByKey: catalogs.cardVariantByKey,
      stamina: Number(composition.memories[0]?.stamina ?? getField(composition.memories[0]?.raw, "stamina") ?? 0),
      pItems: resolvedPItems.items,
    });
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
      stamina: Number(event.detail?.stamina ?? 0),
      targetScore: Number(event.detail?.targetScore ?? 0),
    });
    examSelectedCardIndex = 0;
    drawTowerTurn(examTurnState, 3);
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

function parseObservedLine(line, composition) {
  const ids = new Set(composition.cards.map((card) => card.id));
  const byName = deckNameToIds(composition);
  if (ids.has(line)) return line;
  const suffix = line.match(/(?:—|\||\[)\s*(p_card-[^\]\s]+)\]?\s*$/)?.[1];
  if (suffix && ids.has(suffix)) return suffix;
  const normalizedLine = line.replace(/\+{2,}$/, "+");
  const names = byName.get(line) ?? byName.get(normalizedLine) ?? byName.get(line.replace(/\++$/, ""));
  if (names?.size === 1) return [...names][0];
  throw new Error(`観測カード「${line}」を現在のデッキに対応付けできません。カードIDで入力してください。`);
}

function parseObservedIds(composition) {
  return observedLines().map((line) => parseObservedLine(line, composition));
}

function parseObservedBatches(composition) {
  return observedTextBatches()
    .map((batch) => batch.map((line) => parseObservedLine(line, composition)))
    .filter((batch) => batch.length);
}

function parseObservedDraws(composition) {
  return parseObservedBatches(composition);
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
  const rawLines = observedLines();
  if (rawLines.length >= instances.length) {
    container.textContent = "山札1巡分の入力が完了しました。Seed候補を探索できます。";
    updateObservationCount(instances.length);
    return;
  }
  let observedIds = rawLines;
  try {
    observedIds = parseObservedIds(composition);
  } catch {}

  const used = new Map();
  for (const id of observedIds) used.set(id, (used.get(id) ?? 0) + 1);
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
  updateObservationCount(instances.length);
}

function updateObservationCount(deckCount = null) {
  if (deckCount === null) {
    try { deckCount = buildComposition("tower").cards.length; } catch { deckCount = 0; }
  }
  const total = observedLines().length;
  if (!deckCount) {
    $("tower-observed-count").textContent = "0枚";
    $("tower-find-seed").disabled = true;
    return;
  }
  const need = Math.max(0, deckCount - total);
  $("tower-observed-count").textContent = `${Math.min(total, deckCount)} / ${deckCount}枚${need ? ` · あと${need}枚` : " · 入力完了"}`;
  $("tower-find-seed").disabled = total < deckCount;
}

$("tower-observed").addEventListener("input", () => {
  renderObservationButtons();
  updateObservationCount();
});
$("tower-next-draw").addEventListener("click", () => {
  const batches = observedTextBatches();
  if (!batches.at(-1)?.length) return showError("先に新しく手札へ来たカードを入力してください。");
  if (observedLines().length < buildComposition("tower").cards.length) batches.push([]);
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
    button.addEventListener("click", () => {
      $("tower-seed").value = String(seed);
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
    const seedCards = cardsWithSeedMetadata(composition.cards);
    const prepared = prepareSeedBatchSearch(seedCards, parseObservedDraws(composition));
    const observationSummary = `山札由来${prepared.batches.flat().length}枚・${prepared.batches.length}ドロー`;

    const groups = new Map();
    for (const choices of prepared.choices) {
      const interval = seedIntervalFromChoices(choices);
      const key = `${interval.start}:${interval.end}`;
      if (!groups.has(key)) groups.set(key, { interval, choiceVariants: [] });
      groups.get(key).choiceVariants.push(choices);
    }
    const tasks = [];
    let total = 0;
    for (const group of groups.values()) {
      total += group.interval.size;
      for (let start = group.interval.start; start < group.interval.end; start += SEED_TASK_SIZE) {
        tasks.push({
          choiceVariants: group.choiceVariants,
          start,
          end: Math.min(group.interval.end, start + SEED_TASK_SIZE),
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
    renderSeedCandidates([], 0, total, false, `${observationSummary}を入力順どおり厳密照合。開始時手札も含む全カードのシャッフル状態を探索します。探索対象 ${total.toLocaleString()}状態。`);

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
          choiceVariants: task.choiceVariants,
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

const tabParam = new URLSearchParams(location.search).get("tab");
activateTab(["memory", "cards", "items", "exam", "contest", "tower"].includes(tabParam) ? tabParam : "memory");
restoreLibrary();
renderMemoryList();
renderSimBuilder("contest");
renderSimBuilder("tower");
initializeCatalogs();
initializeExamItemCatalogs();
