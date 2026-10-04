import { SIMULATION_FIELD_LABELS } from "./simulation_history.js";
const sourceNames = { card: "スキルカード", pItem: "Pアイテム", enchant: "継続効果", gimmick: "ギミック", drink: "ドリンク", system: "応援・進行" };
const positions = { deck: "山札", hand: "手札", discard: "捨て札", lost: "除外", hold: "保留", playing: "使用中", created: "生成" };
const attributes = { Vocal: "ボーカル", Dance: "ダンス", Visual: "ビジュアル" };
function valueText(value, field = "") {
  if (["panic", "slump", "blockRestriction", "staminaRecoverRestriction"].includes(field)) return value ? "∞" : "0";
  if (typeof value === "number") {
    if (field.endsWith("Permil")) return `${Number((value / 10).toFixed(4))}%`;
    if (field === "lessonParameterDown") return `${Number((value * 100).toFixed(4))}%`;
    if (field === "lessonParameterMultiple") return `${Number(((value - 1) * 100).toFixed(4))}%`;
  }
  if (value === "infinity") return "∞";
  if (Array.isArray(value)) return `${value.length}件`;
  if (value && typeof value === "object") return JSON.stringify(value);
  if (value === null || value === undefined) return "なし";
  return String(value);
}
function paragraph(parent, text, className = "") {
  const node = document.createElement("p"); node.textContent = text; node.className = className; parent.append(node); return node;
}
function cardText(card) { return card.name || card.id; }
export function renderSimulationHistory(host, state) {
  if (!host) return;
  host.replaceChildren();
  const turns = state.simulationLog?.turns ?? [];
  if (!turns.length) {
    paragraph(host, "詳細履歴は新しく開始したシミュレーションから記録します。", "hint");
    return;
  }
  for (const turn of [...turns].reverse()) {
    const li = document.createElement("li"), details = document.createElement("details"), summary = document.createElement("summary");
    const context = turn.scoreContext ?? {};
    const attribute = attributes[context.parameterType] ?? context.parameterType ?? "";
    const percent = context.battleBonusPermil == null ? "" : ` ${context.battleBonusPermil / 10}%`;
    summary.textContent = `${turn.turn}ターン目 ${attribute}${percent}${turn.complete ? "" : "（進行中）"}`;
    details.open = !turn.complete; details.append(summary);
    paragraph(details, "使用したスキルカード: " + (turn.usedCards.map(cardText).join(" / ") || "なし"));
    paragraph(details, "手札に加わったカード: " + (turn.handAdded.map(cardText).join(" / ") || "なし"));
    const list = document.createElement("ol"); list.className = "simulation-effect-log";
    for (const event of state.simulationLog.events.filter(event => event.turn === turn.turn && event.kind === "effect")) {
      const item = document.createElement("li"), title = document.createElement("strong");
      title.textContent = `${sourceNames[event.source?.type] ?? "効果"}「${event.source?.name || event.source?.id || "不明"}」`;
      item.append(title);
      for (const change of event.changes ?? []) {
        if (change.field === "activeEffects") {
          const before = change.before ?? [], after = change.after ?? [];
          const named = row => {
            if (row.sourceType === "pItem") return state.pItems?.find(item => item.id === row.sourceId)?.name ?? row.sourceId;
            const owner = [...(state.cardById?.values?.() ?? [])].find(card => row.sourceId?.includes(card.id));
            return owner ? `${owner.name}の継続効果` : row.sourceId || row.id;
          };
          for (const row of after.filter(row => !before.some(old => old.registrationId === row.registrationId))) paragraph(item, `${named(row)}を付与`);
          for (const row of before.filter(row => !after.some(next => next.registrationId === row.registrationId))) paragraph(item, `${named(row)}が解除`);
          continue;
        }
        if (["randomState", "cardPlayCount", "turnCardPlayCount", "playCardCountSum", "staminaConsumptionSum", "blockConsumptionSum", "reviewConsumptionSum"].includes(change.field)) continue;
        paragraph(item, `${change.label || SIMULATION_FIELD_LABELS[change.field] || change.field} ${valueText(change.before, change.field)} → ${valueText(change.after, change.field)}`);
      }
      for (const move of event.moves ?? []) paragraph(item, `${cardText(move.card)}: ${positions[move.from] ?? move.from} → ${positions[move.to] ?? move.to}`);
      if (!event.changes?.length && !event.moves?.length) paragraph(item, "発動（値の変化なし）");
      if (item.children.length > 1) list.append(item);
    }
    details.append(list); li.append(details); host.append(li);
  }
}
