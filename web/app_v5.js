import {
  CATALOG_URLS,
  fetchTextWithFallback,
  parseCharacterCatalog,
  parseIdolCardCatalog,
  planLabel,
} from "./catalog_v4.js";

const MEMORY_STORAGE_KEY = "gakumas-sim-memory-library-v3";
const FILTER_STORAGE_KEY = "gakumas-sim-builder-filter-v5";
const PLAN_ORDER = [
  "ProducePlanType_Plan1",
  "ProducePlanType_Plan2",
  "ProducePlanType_Plan3",
  "ProducePlanType_Common",
  "ProducePlanType_Unknown",
];

export function filterMemoriesForBuilder(memories, planType, characterId, idolCardId = "") {
  const plan = String(planType ?? "");
  const character = String(characterId ?? "");
  const idol = String(idolCardId ?? "");
  if (!plan || !character) return [];
  return (memories ?? []).filter((memory) =>
    String(memory?.planType ?? "") === plan &&
    String(memory?.characterId ?? "") === character &&
    (!idol || String(memory?.idolCardId ?? "") === idol)
  );
}

export function availablePlanTypes(memories) {
  const values = new Set();
  for (const memory of memories ?? []) {
    const value = String(memory?.planType ?? "");
    if (value) values.add(value);
  }
  return [...values].sort((a, b) => {
    const ai = PLAN_ORDER.indexOf(a);
    const bi = PLAN_ORDER.indexOf(b);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return planLabel(a).localeCompare(planLabel(b), "ja");
  });
}

export function availableCharacterIds(memories, planType) {
  const plan = String(planType ?? "");
  if (!plan) return [];
  const values = new Set();
  for (const memory of memories ?? []) {
    if (String(memory?.planType ?? "") !== plan) continue;
    const value = String(memory?.characterId ?? "");
    if (value) values.add(value);
  }
  return [...values];
}

export function availableIdolCardIds(memories, planType, characterId) {
  const plan = String(planType ?? "");
  const character = String(characterId ?? "");
  if (!plan || !character) return [];
  const values = new Set();
  for (const memory of memories ?? []) {
    if (String(memory?.planType ?? "") !== plan) continue;
    if (String(memory?.characterId ?? "") !== character) continue;
    const value = String(memory?.idolCardId ?? "");
    if (value) values.add(value);
  }
  return [...values];
}

let memoryStorageSnapshot = null;
let memoryCache = [];

function readMemories() {
  const snapshot = localStorage.getItem(MEMORY_STORAGE_KEY) || "[]";
  if (snapshot === memoryStorageSnapshot) return memoryCache;
  memoryStorageSnapshot = snapshot;
  try {
    const raw = JSON.parse(snapshot);
    memoryCache = Array.isArray(raw) ? raw : [];
  } catch {
    memoryCache = [];
  }
  return memoryCache;
}

function emptyModeFilter() {
  return { planType: "", characterId: "", idolCardId: "" };
}

function loadFilterState() {
  try {
    const raw = JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) || "{}");
    return {
      contest: {
        planType: String(raw?.contest?.planType ?? ""),
        characterId: String(raw?.contest?.characterId ?? ""),
        idolCardId: String(raw?.contest?.idolCardId ?? ""),
      },
      tower: {
        planType: String(raw?.tower?.planType ?? ""),
        characterId: String(raw?.tower?.characterId ?? ""),
        idolCardId: String(raw?.tower?.idolCardId ?? ""),
      },
    };
  } catch {
    return { contest: emptyModeFilter(), tower: emptyModeFilter() };
  }
}

let lastFilterStateJson = "";

function saveFilterState(state) {
  try {
    const serialized = JSON.stringify(state);
    if (serialized === lastFilterStateJson) return;
    localStorage.setItem(FILTER_STORAGE_KEY, serialized);
    lastFilterStateJson = serialized;
  } catch {}
}

function textOption(value, text) {
  const option = document.createElement("option");
  option.value = String(value ?? "");
  option.textContent = String(text ?? value ?? "");
  return option;
}

function syncSelectOptions(select, entries) {
  let unchanged = select.options.length === entries.length;
  if (unchanged) {
    for (let index = 0; index < entries.length; index += 1) {
      const option = select.options[index];
      const entry = entries[index];
      if (option.value !== entry.value || option.textContent !== entry.text) {
        unchanged = false;
        break;
      }
    }
  }
  if (unchanged) return false;

  const fragment = document.createDocumentFragment();
  for (const entry of entries) fragment.append(textOption(entry.value, entry.text));
  select.replaceChildren(fragment);
  return true;
}

function builderElements(mode) {
  return {
    panel: document.getElementById(`tab-${mode}`),
    builder: document.getElementById(`${mode}-builder`),
    plan: document.getElementById(`${mode}-plan-filter-v5`),
    character: document.getElementById(`${mode}-character-filter-v5`),
    idol: document.getElementById(`${mode}-idol-filter-v5`),
    hint: document.getElementById(`${mode}-filter-hint-v5`),
  };
}

let characterNames = new Map();
let idolCardsById = new Map();
const filterState = loadFilterState();
lastFilterStateJson = JSON.stringify(filterState);
let applyingFilter = false;
const refreshModes = new Set();
let refreshHandle = 0;

function deferRefresh(callback) {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
  return setTimeout(callback, 0);
}

function ensureFilterControls(mode) {
  let existing = builderElements(mode);
  const panel = existing.panel;
  const grid = panel?.querySelector(".input-panel .sim-config-grid");
  if (!panel || !grid) return existing;

  if (!existing.plan || !existing.character) {
    const planLabelElement = document.createElement("label");
    planLabelElement.className = "sim-filter-control-v5";
    const planTitle = document.createElement("span");
    planTitle.textContent = "プラン";
    const planSelect = document.createElement("select");
    planSelect.id = `${mode}-plan-filter-v5`;
    planLabelElement.append(planTitle, planSelect);

    const characterLabelElement = document.createElement("label");
    characterLabelElement.className = "sim-filter-control-v5";
    const characterTitle = document.createElement("span");
    characterTitle.textContent = "アイドル";
    const characterSelect = document.createElement("select");
    characterSelect.id = `${mode}-character-filter-v5`;
    characterLabelElement.append(characterTitle, characterSelect);

    grid.insertBefore(characterLabelElement, grid.firstElementChild);
    grid.insertBefore(planLabelElement, characterLabelElement);

    planSelect.addEventListener("change", () => {
      filterState[mode].planType = planSelect.value;
      filterState[mode].characterId = "";
      filterState[mode].idolCardId = "";
      saveFilterState(filterState);
      scheduleRefresh(mode);
    });

    characterSelect.addEventListener("change", () => {
      filterState[mode].characterId = characterSelect.value;
      filterState[mode].idolCardId = "";
      saveFilterState(filterState);
      scheduleRefresh(mode);
    });

    existing = builderElements(mode);
  }

  if (!existing.idol) {
    const idolLabelElement = document.createElement("label");
    idolLabelElement.className = "sim-filter-control-v5";
    const idolTitle = document.createElement("span");
    idolTitle.textContent = "Pアイドル（任意）";
    const idolSelect = document.createElement("select");
    idolSelect.id = `${mode}-idol-filter-v5`;
    idolLabelElement.append(idolTitle, idolSelect);
    existing.character?.closest("label")?.after(idolLabelElement);

    idolSelect.addEventListener("change", () => {
      filterState[mode].idolCardId = idolSelect.value;
      saveFilterState(filterState);
      scheduleRefresh(mode);
    });
    existing = builderElements(mode);
  }

  if (!existing.hint) {
    const hint = document.createElement("p");
    hint.id = `${mode}-filter-hint-v5`;
    hint.className = "hint sim-filter-hint-v5";
    grid.after(hint);
    existing = builderElements(mode);
  }

  return existing;
}

function populatePlanSelect(mode, memories) {
  const { plan } = ensureFilterControls(mode);
  if (!plan) return;
  const values = availablePlanTypes(memories);
  const preserve = filterState[mode].planType;
  const entries = [
    { value: "", text: "プランを選択" },
    ...values.map((value) => ({ value, text: planLabel(value) })),
  ];
  syncSelectOptions(plan, entries);

  if (preserve && values.includes(preserve)) {
    if (plan.value !== preserve) plan.value = preserve;
  } else {
    filterState[mode].planType = "";
    filterState[mode].characterId = "";
    filterState[mode].idolCardId = "";
    if (plan.value !== "") plan.value = "";
  }
}

function characterDisplayName(id) {
  return characterNames.get(String(id)) ?? String(id);
}

function idolDisplayName(id) {
  return idolCardsById.get(String(id))?.name ?? String(id);
}

function populateCharacterSelect(mode, memories) {
  const { character } = ensureFilterControls(mode);
  if (!character) return;
  const planType = filterState[mode].planType;
  const values = availableCharacterIds(memories, planType)
    .sort((a, b) => characterDisplayName(a).localeCompare(characterDisplayName(b), "ja"));
  const preserve = filterState[mode].characterId;
  const entries = [
    { value: "", text: planType ? "アイドルを選択" : "先にプランを選択" },
    ...values.map((value) => ({ value, text: characterDisplayName(value) })),
  ];
  syncSelectOptions(character, entries);

  const shouldDisable = !planType;
  if (character.disabled !== shouldDisable) character.disabled = shouldDisable;
  if (preserve && values.includes(preserve)) {
    if (character.value !== preserve) character.value = preserve;
  } else {
    filterState[mode].characterId = "";
    filterState[mode].idolCardId = "";
    if (character.value !== "") character.value = "";
  }
}

function populateIdolSelect(mode, memories) {
  const { idol } = ensureFilterControls(mode);
  if (!idol) return;
  const planType = filterState[mode].planType;
  const characterId = filterState[mode].characterId;
  const values = availableIdolCardIds(memories, planType, characterId)
    .sort((a, b) => idolDisplayName(a).localeCompare(idolDisplayName(b), "ja"));
  const preserve = filterState[mode].idolCardId;
  const entries = [
    {
      value: "",
      text: characterId ? "すべてのPアイドル" : "アイドル選択後に指定できます",
    },
    ...values.map((value) => ({ value, text: idolDisplayName(value) })),
  ];
  syncSelectOptions(idol, entries);

  const shouldDisable = !planType || !characterId;
  if (idol.disabled !== shouldDisable) idol.disabled = shouldDisable;
  if (preserve && values.includes(preserve)) {
    if (idol.value !== preserve) idol.value = preserve;
  } else {
    filterState[mode].idolCardId = "";
    if (idol.value !== "") idol.value = "";
  }
}

function setTextIfChanged(element, text) {
  if (element && element.textContent !== text) element.textContent = text;
}

function filterMemorySelects(mode, memories) {
  const { builder, hint } = builderElements(mode);
  if (!builder) return;

  const planType = filterState[mode].planType;
  const characterId = filterState[mode].characterId;
  const idolCardId = filterState[mode].idolCardId;
  const filtered = filterMemoriesForBuilder(memories, planType, characterId, idolCardId);
  const allowedIds = new Set(filtered.map((memory) => String(memory.userMemoryId ?? "")));
  const ready = Boolean(planType && characterId);

  if (!planType) setTextIfChanged(hint, "最初にプランを選択してください。");
  else if (!characterId) setTextIfChanged(hint, "次にアイドルを選択してください。");
  else {
    const detail = idolCardId ? ` / ${idolDisplayName(idolCardId)}` : "";
    setTextIfChanged(
      hint,
      filtered.length
        ? `${planLabel(planType)} / ${characterDisplayName(characterId)}${detail} のメモリー ${filtered.length}件に絞り込み中です。`
        : "この条件に一致するメモリーはありません。メモリー管理で登録内容を確認してください。"
    );
  }

  const blankText = !planType
    ? "先にプランを選択"
    : !characterId
      ? "アイドルを選択"
      : filtered.length
        ? `メモリーを選択（${filtered.length}件）`
        : "該当メモリーなし";
  const shouldDisableSelect = !ready || filtered.length === 0;
  let invalidSelect = null;

  for (const select of builder.querySelectorAll(".sim-memory-slot select")) {
    const blank = select.options[0];
    if (blank && blank.textContent !== blankText) blank.textContent = blankText;

    for (let index = 1; index < select.options.length; index += 1) {
      const option = select.options[index];
      const allowed = ready && allowedIds.has(option.value);
      if (option.hidden === allowed) option.hidden = !allowed;
      if (option.disabled !== !allowed) option.disabled = !allowed;
    }

    if (select.disabled !== shouldDisableSelect) select.disabled = shouldDisableSelect;
    if (!invalidSelect && select.value && !allowedIds.has(select.value)) invalidSelect = select;
  }

  if (invalidSelect) {
    setTimeout(() => {
      if (!invalidSelect.isConnected || !invalidSelect.value || allowedIds.has(invalidSelect.value)) return;
      invalidSelect.value = "";
      invalidSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }, 0);
    return false;
  }
  return true;
}

function refreshMode(mode) {
  if (applyingFilter) return;
  applyingFilter = true;
  try {
    const memories = readMemories();
    ensureFilterControls(mode);
    populatePlanSelect(mode, memories);
    populateCharacterSelect(mode, memories);
    populateIdolSelect(mode, memories);
    saveFilterState(filterState);
    filterMemorySelects(mode, memories);
  } finally {
    applyingFilter = false;
  }
}

function scheduleRefresh(mode = null) {
  if (mode) refreshModes.add(mode);
  else {
    refreshModes.add("contest");
    refreshModes.add("tower");
  }
  if (refreshHandle) return;
  refreshHandle = deferRefresh(() => {
    refreshHandle = 0;
    const modes = [...refreshModes];
    refreshModes.clear();
    for (const queuedMode of modes) refreshMode(queuedMode);
  });
}

async function loadDisplayNames() {
  try {
    const [characterText, idolText] = await Promise.all([
      fetchTextWithFallback(CATALOG_URLS.characters),
      fetchTextWithFallback(CATALOG_URLS.idolCards),
    ]);
    characterNames = new Map(parseCharacterCatalog(characterText).map((entry) => [String(entry.id), String(entry.name)]));
    idolCardsById = new Map(parseIdolCardCatalog(idolText).map((entry) => [String(entry.id), entry]));
  } catch (error) {
    console.warn("simulator filter catalogs unavailable", error);
  }
}

async function boot() {
  await loadDisplayNames();
  refreshMode("contest");
  refreshMode("tower");

  for (const mode of ["contest", "tower"]) {
    const builder = document.getElementById(`${mode}-builder`);
    if (builder) new MutationObserver(() => scheduleRefresh(mode)).observe(builder, { childList: true, subtree: true });
  }

  window.addEventListener("storage", (event) => {
    if (event.key === MEMORY_STORAGE_KEY) {
      memoryStorageSnapshot = null;
      scheduleRefresh();
    } else if (event.key === FILTER_STORAGE_KEY) {
      scheduleRefresh();
    }
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
}
