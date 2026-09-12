import { isPItemExamMasterReady, loadPItemExamMaster } from "./pitem_exam_runtime_v9.js";
import { formatTurnSequence, parseTurnSequence } from "./turn_sequence_v9.js";

const MODE_CONFIG = Object.freeze({
  exam: { runId: "exam-run", turnId: "exam-turn-number", storageKey: "gakumas.exam.turnSequence.v9" },
  tower: { runId: "tower-run", turnId: "tower-turn-number", storageKey: "gakumas.tower.turnSequence.v9" },
});

function setGlobalSequence(mode, sequence) {
  globalThis.__gakumasTurnSequenceByMode ??= {};
  globalThis.__gakumasTurnSequenceByMode[mode] = [...sequence];
  globalThis.__gakumasActiveTurnSequence = [...sequence];
  globalThis.__gakumasActiveTurnSequenceMode = mode;
}

function showInputError(control, message) {
  control.error.textContent = String(message ?? "");
  control.error.hidden = !message;
}

function createControl(mode, config) {
  const runButton = document.getElementById(config.runId);
  if (!runButton || document.getElementById(`${mode}-turn-sequence`)) return null;

  const label = document.createElement("label");
  label.className = "turn-sequence-v9";
  const title = document.createElement("span");
  title.textContent = "Vo / Da / Vi ターン順（任意）";
  const input = document.createElement("input");
  input.id = `${mode}-turn-sequence`;
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "例: Vo Da Vi Vo Da Vi";
  const hint = document.createElement("small");
  hint.textContent = "1ターン目から順に入力。本家の正確な順番を自動取得できない場合、この値を優先します。";
  const current = document.createElement("small");
  current.id = `${mode}-turn-attribute-state`;
  current.textContent = "ターン属性: 未指定";
  const error = document.createElement("small");
  error.className = "error";
  error.hidden = true;
  label.append(title, input, hint, current, error);
  runButton.parentNode?.insertBefore(label, runButton);

  try {
    input.value = localStorage.getItem(config.storageKey) ?? "";
  } catch {}

  input.addEventListener("change", () => {
    try {
      const sequence = parseTurnSequence(input.value);
      input.value = formatTurnSequence(sequence);
      showInputError({ error }, "");
      try { localStorage.setItem(config.storageKey, input.value); } catch {}
    } catch (parseError) {
      showInputError({ error }, parseError.message);
    }
  });

  const updateCurrent = () => {
    const turn = Number(document.getElementById(config.turnId)?.textContent ?? 0);
    let sequence = [];
    try { sequence = parseTurnSequence(input.value); } catch {}
    const type = turn > 0 ? sequence[turn - 1] ?? null : null;
    current.textContent = type ? `ターン属性: Turn ${turn} = ${type}` : (turn > 0 ? `ターン属性: Turn ${turn} = 未指定` : "ターン属性: 未指定");
  };
  const turnNode = document.getElementById(config.turnId);
  if (turnNode) new MutationObserver(updateCurrent).observe(turnNode, { childList: true, characterData: true, subtree: true });
  updateCurrent();
  return { mode, config, runButton, label, input, error, current };
}

async function ensureTowerPItemMaster(button) {
  if (isPItemExamMasterReady()) return true;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Pアイテム効果マスタ読込中…";
  try {
    await loadPItemExamMaster();
    return true;
  } catch (error) {
    console.warn("P item exam master load failed", error);
    return false;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function initialize() {
  const controls = Object.fromEntries(
    Object.entries(MODE_CONFIG)
      .map(([mode, config]) => [mode, createControl(mode, config)])
      .filter(([, control]) => control),
  );

  document.addEventListener("click", async (event) => {
    const button = event.target?.closest?.("#exam-run, #tower-run");
    if (!button) return;
    const mode = button.id === "tower-run" ? "tower" : "exam";
    const control = controls[mode];
    if (!control) return;

    let sequence;
    try {
      sequence = parseTurnSequence(control.input.value);
      showInputError(control, "");
      setGlobalSequence(mode, sequence);
      try { localStorage.setItem(control.config.storageKey, formatTurnSequence(sequence)); } catch {}
    } catch (error) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showInputError(control, error.message);
      return;
    }

    if (mode !== "tower" || isPItemExamMasterReady() || button.dataset.pitemMasterRetry === "1") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const loaded = await ensureTowerPItemMaster(button);
    button.dataset.pitemMasterRetry = "1";
    if (!loaded) showInputError(control, "Pアイテム効果マスタを取得できません。未対応として続行します。");
    button.click();
    delete button.dataset.pitemMasterRetry;
  }, true);
}

if (typeof document !== "undefined") initialize();
