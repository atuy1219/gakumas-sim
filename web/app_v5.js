import {
  CATALOG_URLS,
  fetchTextWithFallback,
  parseCharacterCatalog,
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

export function filterMemoriesForBuilder(memories, planType, characterId) {
  const plan = String(planType ?? "");
  const character = String(characterId ?? "");
  if (!plan || !character) return [];
  return (memories ?? []).filter((memory) =>
    String(memory?.planType ?? "") === plan &&
    String(memory?.characterId ?? "") === character
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

function readMemories() {
  try {
    const raw = JSON.parse(localStorage.getItem(MEMORY_STORAGE_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function loadFilterState() {
  try {
    const raw = JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) || "{}");
    return {
      contest: {
        planType: String(raw?.contest?.planType ?? ""),
        characterId: String(raw?.contest?.characterId ?? ""),
      },
      tower: {
        planType: String(raw?.tower?.planType ?? ""),
        characterId: String(raw?.tower?.characterId ?? ""),
      },
    };
  } catch {
    return {
      contest: { planType: "", characterId: "" },
      tower: { planType: "", characterId: "" },
    };
  }
}

function saveFilterState(state) {
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function textOption(value, text) {
  const option = document.createElement("option");
  option.value = String(value ?? "");
  option.textContent = String(text ?? value ?? "");
  return option;
}

function builderElements(mode) {
  return {
    panel: document.getElementById(`tab-${mode}`),
    builder: document.getElementById(`${mode}-builder`),
    plan: document.getElementById(`${mode}-plan-filter-v5`),
    character: document.getElementById(`${mode}-character-filter-v5`),
    hint: document.getElementById(`${mode}-filter-hint-v5`),
  };
}

let characterNames = new Map();
const filterState = loadFilterState();
let refreshQueued = false;
let applyingFilter = false;

function ensureFilterControls(mode) {
  const existing = builderElements(mode);
  if (existing.plan && existing.character) return existing;

  const panel = existing.panel;
  const grid = panel?.querySelector(".input-panel .sim-config-grid");
  if (!panel || !grid) return existing;

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

  const hint = document.createElement("p");
  hint.id = `${mode}-filter-hint-v5`;
  hint.className = "hint sim-filter-hint-v5";
  grid.after(hint);

  planSelect.addEventListener("change", () => {
    filterState[mode].planType = planSelect.value;
    filterState[mode].characterId = "";
    saveFilterState(filterState);
    refreshMode(mode);
  });

  characterSelect.addEventListener("change", () => {
    filterState[mode].characterId = characterSelect.value;
    saveFilterState(filterState);
    refreshMode(mode);
  });

  return builderElements(mode);
}

function populatePlanSelect(mode, memories) {
  const { plan } = ensureFilterControls(mode);
  if (!plan) return;
  const values = availablePlanTypes(memories);
  const preserve = filterState[mode].planType;
  plan.innerHTML = "";
  plan.append(textOption("", "プランを選択"));
  for (const value of values) plan.append(textOption(value, planLabel(value)));
  if (preserve && values.includes(preserve)) plan.value = preserve;
  else {
    filterState[mode].planType = "";
    filterState[mode].characterId = "";
    plan.value = "";
  }
}

function characterDisplayName(id) {
  return characterNames.get(String(id)) ?? String(id);
}

function populateCharacterSelect(mode, memories) {
  const { character } = ensureFilterControls(mode);
  if (!character) return;
  const planType = filterState[mode].planType;
  const values = availableCharacterIds(memories, planType)
    .sort((a, b) => characterDisplayName(a).localeCompare(characterDisplayName(b), "ja"));
  const preserve = filterState[mode].characterId;
  character.innerHTML = "";
  character.append(textOption("", planType ? "アイドルを選択" : "先にプランを選択"));
  for (const value of values) character.append(textOption(value, characterDisplayName(value)));
  character.disabled = !planType;
  if (preserve && values.includes(preserve)) character.value = preserve;
  else {
    filterState[mode].characterId = "";
    character.value = "";
  }
}

function filterMemorySelects(mode, memories) {
  const { builder, hint } = builderElements(mode);
  if (!builder) return;

  const planType = filterState[mode].planType;
  const characterId = filterState[mode].characterId;
  const filtered = filterMemoriesForBuilder(memories, planType, characterId);
  const allowedIds = new Set(filtered.map((memory) => String(memory.userMemoryId ?? "")));
  const ready = Boolean(planType && characterId);

  if (hint) {
    if (!planType) hint.textContent = "最初にプランを選択してください。";
    else if (!characterId) hint.textContent = "次にアイドルを選択してください。";
    else hint.textContent = filtered.length
      ? `${planLabel(planType)} / ${characterDisplayName(characterId)} のメモリー ${filtered.length}件に絞り込み中です。`
      : "この条件に一致するメモリーはありません。メモリー管理で登録内容を確認してください。";
  }

  const selects = [...builder.querySelectorAll(".sim-memory-slot select")];
  for (const select of selects) {
    const blank = select.options[0];
    if (blank) {
      blank.textContent = !planType
        ? "先にプランを選択"
        : !characterId
          ? "アイドルを選択"
          : filtered.length
            ? `メモリーを選択（${filtered.length}件）`
            : "該当メモリーなし";
    }

    for (const option of [...select.options].slice(1)) {
      const allowed = ready && allowedIds.has(option.value);
      option.hidden = !allowed;
      option.disabled = !allowed;
    }

    select.disabled = !ready || filtered.length === 0;
    if (select.value && !allowedIds.has(select.value)) {
      select.value = "";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return false;
    }
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
    saveFilterState(filterState);
    filterMemorySelects(mode, memories);
  } finally {
    applyingFilter = false;
  }
}

function scheduleRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  queueMicrotask(() => {
    refreshQueued = false;
    refreshMode("contest");
    refreshMode("tower");
  });
}

async function loadCharacterNames() {
  try {
    const text = await fetchTextWithFallback(CATALOG_URLS.characters);
    characterNames = new Map(parseCharacterCatalog(text).map((entry) => [String(entry.id), String(entry.name)]));
  } catch (error) {
    console.warn("character catalog for simulator filter unavailable", error);
  }
}

async function boot() {
  await loadCharacterNames();
  refreshMode("contest");
  refreshMode("tower");

  for (const mode of ["contest", "tower"]) {
    const builder = document.getElementById(`${mode}-builder`);
    if (builder) new MutationObserver(scheduleRefresh).observe(builder, { childList: true, subtree: true });
  }

  window.addEventListener("storage", (event) => {
    if ([MEMORY_STORAGE_KEY, FILTER_STORAGE_KEY].includes(event.key)) scheduleRefresh();
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
}
