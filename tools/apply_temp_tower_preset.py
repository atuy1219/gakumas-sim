from pathlib import Path


def replace_exact(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"replacement target not found: {path}\n{old[:240]}")
    p.write_text(text.replace(old, new, 1))


# app_v3: import preset helpers.
replace_exact(
    "web/app_v3.js",
    '''import {
  deriveSeedChoiceVariants,
  makeCardInstances,
  runOrderMonteCarlo,
  seedIntervalFromChoices,
} from "./sim_v3.js";
''',
    '''import {
  deriveSeedChoiceVariants,
  makeCardInstances,
  runOrderMonteCarlo,
  seedIntervalFromChoices,
} from "./sim_v3.js";
import { createTowerPreset, parseTowerPreset } from "./tower_preset.js";
''',
)

replace_exact(
    "web/app_v3.js",
    '''const STORAGE_KEY = "gakumas-sim-memory-library-v3";
const LEGACY_STORAGE_KEY = "gakumas-card-order-memory-library-v2";
''',
    '''const STORAGE_KEY = "gakumas-sim-memory-library-v3";
const LEGACY_STORAGE_KEY = "gakumas-card-order-memory-library-v2";
const FILTER_STORAGE_KEY = "gakumas-sim-builder-filter-v5";
''',
)

# Insert preset helpers just before random seed utilities, after builder event binding.
replace_exact(
    "web/app_v3.js",
    '''$("contest-initial-auto").addEventListener("change", () => renderBaseCards("contest"));

function randomSeedBase() {
''',
    '''$("contest-initial-auto").addEventListener("change", () => renderBaseCards("contest"));

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
      baseCards: simState.tower.baseCards.map((card) => ({
        id: String(card.id),
        upgradeCount: Number(card.upgradeCount ?? 0),
        fixedDeckOrder: Number(card.fixedDeckOrder ?? 0),
        customizes: Array.isArray(card.customizes) ? card.customizes : [],
      })),
      filter,
    });
    const blob = new Blob([`${JSON.stringify(preset, null, 2)}\n`], { type: "application/json" });
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
  simState.tower.baseCards = preset.baseCards.map((card) => ({
    id: String(card.id),
    upgradeCount: Number(card.upgradeCount ?? 0),
    fixedDeckOrder: Number(card.fixedDeckOrder ?? 0),
    customizes: Array.isArray(card.customizes) ? card.customizes : [],
    source: "imported basic",
  }));
  saveTowerFilter(filter);
  $("tower-observed").value = "";
  $("tower-seed-results").innerHTML = "";
  $("tower-order-result").hidden = true;
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
''',
)

# app_v5: accept an in-page filter update when importing a preset.
replace_exact(
    "web/app_v5.js",
    '''  window.addEventListener("storage", (event) => {
    if (event.key === MEMORY_STORAGE_KEY) {
      memoryStorageSnapshot = null;
      scheduleRefresh();
    } else if (event.key === FILTER_STORAGE_KEY) {
      scheduleRefresh();
    }
  });
''',
    '''  window.addEventListener("storage", (event) => {
    if (event.key === MEMORY_STORAGE_KEY) {
      memoryStorageSnapshot = null;
      scheduleRefresh();
    } else if (event.key === FILTER_STORAGE_KEY) {
      scheduleRefresh();
    }
  });

  window.addEventListener("gakumas:tower-preset-filter", (event) => {
    const detail = event.detail ?? {};
    filterState.tower = {
      planType: String(detail.planType ?? ""),
      characterId: String(detail.characterId ?? ""),
      idolCardId: String(detail.idolCardId ?? ""),
    };
    memoryStorageSnapshot = null;
    saveFilterState(filterState);
    scheduleRefresh("tower");
  });
''',
)

# index: add import/export controls to tower header.
replace_exact(
    "web/index.html",
    '''        <div class="section-head"><div><p class="step">01</p><h2>アイドルへの道 編成</h2></div></div>
        <div class="sim-config-grid">
''',
    '''        <div class="section-head">
          <div><p class="step">01</p><h2>アイドルへの道 編成</h2></div>
          <div class="button-row">
            <button id="tower-export-preset" type="button" class="secondary">セットをエクスポート</button>
            <label class="file-button">セットをインポート<input id="tower-import-preset" type="file" accept="application/json,.json"></label>
          </div>
        </div>
        <p id="tower-preset-status" class="hint" aria-live="polite"></p>
        <div class="sim-config-grid">
''',
)

# CI: syntax-check and run preset tests.
replace_exact(
    ".github/workflows/ci.yml",
    '''          node --check web/sim_v3.js
          node --check web/seed_worker.js
''',
    '''          node --check web/sim_v3.js
          node --check web/tower_preset.js
          node --check web/seed_worker.js
''',
)
replace_exact(
    ".github/workflows/ci.yml",
    '''      - name: Memory detail tests
        run: node test_app_v6.mjs
''',
    '''      - name: Memory detail tests
        run: node test_app_v6.mjs
      - name: Tower preset tests
        run: node test_tower_preset.mjs
''',
)
