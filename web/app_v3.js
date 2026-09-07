import {
  cardDisplayName,
  composeSelectedMemories,
  extractMemories,
  getField,
  loadCatalogs,
  mergeMemoryLibraries,
  parseMemoryExportText,
  resolveCardInput,
  resolveContestInitialDeck,
  simulateCards,
} from "./engine.js";
import {
  deriveSeedChoiceVariants,
  makeCardInstances,
  runOrderMonteCarlo,
  seedIntervalFromChoices,
} from "./sim_v3.js";

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "gakumas-sim-memory-library-v3";
const LEGACY_STORAGE_KEY = "gakumas-card-order-memory-library-v2";
const MEMORY_PAGE_SIZE = 40;
const MAX_SEED_VARIANTS = 64;
const MAX_SEED_MATCHES = 100;
const SEED_TASK_SIZE = 1_000_000;

let catalogs = { cards: [], cardById: new Map(), initialDecks: [], initialDeckById: new Map() };
let memoryList = [];
let memoryVisible = MEMORY_PAGE_SIZE;
let editingMemoryId = null;
let seedWorkers = [];
let seedSearchCancelled = false;

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
    $("catalog-status").textContent = `カード名 ${catalogs.cards.length}件 / 初期デッキ ${catalogs.initialDecks.length}件`;
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
      chip.textContent = `${catalogName(card)}${card.upgradeCount ? ` +${card.upgradeCount}` : ""}`;
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
    const payload = parseMemoryExportText(await file.text());
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
    const imported = sanitizeManagedLibrary(extractMemories(parseMemoryExportText($("memory-text").value)));
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
  const roles = slots.length === 2 ? ["Main", "Sub"] : ["Main", "Sub 1", "Sub 2"];

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

function automaticBaseCards(mode) {
  const ids = simIds(mode);
  const selectedId = $(ids.initialId).value.trim();
  let deck = selectedId ? catalogs.initialDeckById.get(selectedId) : null;
  if (mode === "contest" && $("contest-initial-auto").checked) {
    const main = ensureSlots(mode)[0];
    const memory = main ? memoryList.find((item) => item.userMemoryId === main.memoryId) : null;
    if (memory?.idolCardId) deck = resolveContestInitialDeck(memory.idolCardId, catalogs.initialDeckById) ?? deck;
  }
  return deck ? deck.cards.map((card) => ({ ...card, source: `initial: ${deck.id}` })) : [];
}

function baseCards(mode) {
  return [...automaticBaseCards(mode), ...simState[mode].baseCards];
}

function renderBaseCards(mode) {
  const ids = simIds(mode);
  const container = $(ids.baseList);
  if (!container) return;
  container.innerHTML = "";
  const auto = automaticBaseCards(mode);
  const manual = simState[mode].baseCards;
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
    hint.textContent = "初期/共通カード未設定";
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
  return composeSelectedMemories(memoryList, selectedMemoryComposition(mode), baseCards(mode));
}

function renderPItems(mode) {
  const container = $(simIds(mode).pitems);
  if (!container) return;
  container.innerHTML = "";
  const seen = new Set();
  for (const slot of ensureSlots(mode)) {
    if (!slot) continue;
    const memory = memoryList.find((item) => item.userMemoryId === slot.memoryId);
    for (const id of rawArray(memory, "examBattleProduceItemIds")) seen.add(String(id));
  }
  for (const id of seen) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = id;
    container.append(chip);
  }
  if (!seen.size) container.textContent = "Pアイテムなし / 未取得";
}

for (const mode of ["contest", "tower"]) {
  $(simIds(mode).count).addEventListener("change", () => renderSimBuilder(mode));
  $(simIds(mode).initialId).addEventListener("change", () => {
    renderBaseCards(mode);
    if (mode === "tower") renderObservationButtons();
  });
  $(`${mode}-add-base`).addEventListener("click", () => addBaseCard(mode));
}
$("contest-initial-auto").addEventListener("change", () => renderBaseCards("contest"));

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

function renderTowerOrder(result) {
  const box = $("tower-order-result");
  box.hidden = false;
  $("tower-order-meta").textContent = `Seed ${result.seed} / ${asHex(result.seed)} · Shuffle後 ${result.randomState} / ${asHex(result.randomState)}`;
  const list = $("tower-order-list");
  list.innerHTML = "";
  result.initialDeck.forEach((card, index) => {
    const li = document.createElement("li");
    const strong = document.createElement("strong");
    strong.textContent = `${index + 1}. ${catalogName(card)}`;
    const small = document.createElement("small");
    small.textContent = `${card.id}${card.upgradeCount ? ` · +${card.upgradeCount}` : ""}`;
    li.append(strong, small);
    list.append(li);
  });
}

$("tower-run").addEventListener("click", () => {
  try {
    clearError();
    const composition = buildComposition("tower");
    renderTowerOrder(simulateCards(composition.cards, $("tower-seed").value, Number($("tower-draw-count").value)));
  } catch (error) {
    $("tower-order-result").hidden = true;
    showError(error);
  }
});

function observedLines() {
  return $("tower-observed").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function deckNameToIds(composition) {
  const byName = new Map();
  for (const card of composition.cards) {
    const name = catalogName(card);
    if (!byName.has(name)) byName.set(name, new Set());
    byName.get(name).add(card.id);
  }
  return byName;
}

function parseObservedIds(composition) {
  const ids = new Set(composition.cards.map((card) => card.id));
  const byName = deckNameToIds(composition);
  return observedLines().map((line) => {
    if (ids.has(line)) return line;
    const suffix = line.match(/(?:—|\||\[)\s*(p_card-[^\]\s]+)\]?\s*$/)?.[1];
    if (suffix && ids.has(suffix)) return suffix;
    const names = byName.get(line);
    if (names?.size === 1) return [...names][0];
    throw new Error(`観測カード「${line}」を現在のデッキに対応付けできません。カードIDで入力してください。`);
  });
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
  const used = new Map();
  for (const id of observedLines()) used.set(id, (used.get(id) ?? 0) + 1);
  const seen = new Map();
  for (const instance of instances) {
    const ordinal = (seen.get(instance.id) ?? 0) + 1;
    seen.set(instance.id, ordinal);
    const total = instances.filter((item) => item.id === instance.id).length;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "observation-card";
    button.textContent = `${catalogName(instance.card)}${total > 1 ? ` #${ordinal}` : ""}`;
    button.title = instance.id;
    button.disabled = ordinal <= (used.get(instance.id) ?? 0);
    button.addEventListener("click", () => {
      const lines = observedLines();
      lines.push(instance.id);
      $("tower-observed").value = lines.join("\n");
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
  $("tower-observed-count").textContent = `${observedLines().length} / ${deckCount}枚`;
}

$("tower-observed").addEventListener("input", () => {
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
    p.textContent = "一致するseedがありません。観測順・採用カード・初期デッキを確認してください。";
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
      try {
        renderTowerOrder(simulateCards(buildComposition("tower").cards, seed, Number($("tower-draw-count").value)));
      } catch (error) { showError(error); }
    });
    container.append(button);
  }
  if (matches.length >= MAX_SEED_MATCHES) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = `候補が${MAX_SEED_MATCHES}件に達したため表示を打ち切りました。観測情報を増やしてください。`;
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
    const observed = parseObservedIds(composition);
    const { variants, truncated } = deriveSeedChoiceVariants(composition.cards, observed, MAX_SEED_VARIANTS);
    if (truncated) {
      throw new Error("同一カードの重複によるseed条件が64通りを超えました。完全特定を保証できないため、重複カードを見分けられる情報を追加してください。");
    }

    const tasks = [];
    let total = 0;
    variants.forEach((choices, variantIndex) => {
      const interval = seedIntervalFromChoices(choices);
      total += interval.size;
      for (let start = interval.start; start < interval.end; start += SEED_TASK_SIZE) {
        tasks.push({ variantIndex, start, end: Math.min(interval.end, start + SEED_TASK_SIZE) });
      }
    });

    let scanned = 0;
    const matches = new Set();
    let active = 0;
    let nextTask = 0;
    let finished = false;
    const concurrency = Math.max(1, Math.min(8, Number(navigator.hardwareConcurrency || 4)));
    $("tower-seed-progress").hidden = false;
    $("tower-seed-progress").max = total;
    $("tower-seed-progress").value = 0;
    renderSeedCandidates([], 0, total, false, `${variants.length}通りの重複割当を考慮。探索対象 ${total.toLocaleString()}状態。`);

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
          choices: variants[task.variantIndex],
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
    const complete = !seedSearchCancelled && result.length < MAX_SEED_MATCHES;
    renderSeedCandidates(result, scanned, total, complete, complete ? `探索完了: ${result.length}候補` : "探索を停止しました。" );
    if (complete && result.length === 1) {
      $("tower-seed").value = String(result[0]);
      renderTowerOrder(simulateCards(composition.cards, result[0], Number($("tower-draw-count").value)));
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
activateTab(["memory", "contest", "tower"].includes(tabParam) ? tabParam : "memory");
restoreLibrary();
renderMemoryList();
renderSimBuilder("contest");
renderSimBuilder("tower");
initializeCatalogs();
