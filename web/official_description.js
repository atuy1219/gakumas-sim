// Description fragments come from the game's master, including rich-text tags
// and empty literal blocks used as line separators. Keep metadata for custom
// values instead of flattening the fragments at load time.
function scalar(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  if (raw.startsWith('"')) {
    try { return JSON.parse(raw); } catch {}
  }
  return raw.startsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : raw;
}

export function parseOfficialDescriptionParts(text, section = "produceDescriptions") {
  const result = new Map();
  let id = "", upgrade = 0, parts = [], part = null, active = false, block = null;
  const flush = () => { if (id) result.set(`${id}@@${upgrade}`, parts); };
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (block && (line.startsWith("      ") || !line.trim())) {
      block.lines.push(line.slice(6));
      part.text = block.lines.join(block.fold ? " " : "\n");
      continue;
    }
    block = null;
    let match = line.match(/^- id:\s*(.*?)\s*$/);
    if (match) {
      flush(); id = String(scalar(match[1])); upgrade = 0; parts = []; part = null; active = false;
      continue;
    }
    match = line.match(/^  (\w+):\s*(.*?)\s*$/);
    if (match) {
      if (match[1] === "upgradeCount") upgrade = Number(match[2]) || 0;
      active = match[1] === section;
      part = null;
      continue;
    }
    if (!active) continue;
    match = line.match(/^  - (\w+):\s*(.*?)\s*$/);
    if (match) { part = {}; parts.push(part); }
    else match = line.match(/^    (\w+):\s*(.*?)\s*$/);
    if (!match || !part) continue;
    if (match[1] === "text" && /^[|>][+-]?$/.test(match[2])) {
      part.text = ""; part.lineBreak = true;
      block = { lines: [], fold: match[2][0] === ">" };
    } else part[match[1]] = scalar(match[2]);
  }
  flush();
  return result;
}

export function officialDescriptionText(parts, valueText = null) {
  return (parts ?? []).map(part => {
    const override = valueText?.(part);
    if (override !== undefined && override !== null) return String(override);
    return part.lineBreak && !part.text ? "\n" : String(part.text ?? "");
  }).join("").replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim();
}

const newline = () => ({ text: "", lineBreak: true });

// Replace each contiguous occurrence separately: equal effects in different
// conditional branches must retain their multiplicity and surrounding text.
function replaceParts(parts, matches, replacement) {
  const result = [];
  for (let index = 0; index < parts.length;) {
    if (!matches(parts[index])) { result.push(parts[index++]); continue; }
    const start = index;
    while (index < parts.length && matches(parts[index])) index += 1;
    const original = parts.slice(start, index);
    const lastText = original.findLastIndex(part => String(part.text ?? "").trim());
    // A leading bullet can refer to an effect while its condition is a
    // separate block. Replacing that empty bullet would duplicate the effect.
    if (lastText < 0) { result.push(...original); continue; }
    result.push(...replacement.map(part => ({ ...part })));
    if (original.slice(lastText + 1).some(part => part.lineBreak) && !replacement.at(-1)?.lineBreak) result.push(newline());
  }
  return result;
}

export function customizeOfficialCardParts(card, catalogs = {}) {
  let parts = (card?.produceDescriptionParts ?? []).map(part => ({ ...part }));
  const unresolved = [];
  const templates = (map, id, field) => {
    if (!id) return [];
    const row = catalogs[map]?.get?.(String(id));
    const value = row?.[field];
    if (!value?.length) { unresolved.push(`${map}:${id}:${field}`); return []; }
    return value.map(part => ({ ...part }));
  };
  const insertEffects = extra => {
    if (!extra.length) return;
    let index = parts.findIndex(part => part.examDescriptionType === "ExamDescriptionType_CustomizeEffectAdd");
    if (index < 0) index = parts.findIndex(part => !part.originProduceExamEffectId &&
      (part.targetId === "Label_NoDeckDuplication" || /ProduceCardMovePositionType_/.test(part.targetId ?? "")));
    if (index < 0) index = parts.length;
    parts.splice(index, 0, newline(), ...extra, newline());
  };
  for (const grow of card?.customGrowEffects ?? []) {
    const type = String(grow.effectType ?? "").replace("ProduceCardGrowEffectType_", "");
    if (type === "InitialAdd") {
      if (!parts.some(part => part.text === "開始時手札に入る")) {
        const initial = templates("descriptionLabelById", "Description_ProduceCardIsInitial", "produceDescriptionParts");
        const index = parts.findIndex(part => part.examDescriptionType === "ExamDescriptionType_CustomizeInitialAdd");
        if (index >= 0) parts.splice(index, 1, ...initial, newline());
        else parts.unshift(...initial, newline());
      }
    } else if (type === "EffectAdd") {
      const effectId = grow.playProduceExamEffectId ?? grow.playEffectId;
      const condition = templates("examTriggerById", grow.playEffectProduceExamTriggerId, "playEffectProduceDescriptionParts");
      const effect = templates("examEffectById", effectId, "customizeProduceDescriptionParts");
      insertEffects([...condition, ...effect]);
    } else if (type === "EffectChange") {
      const targets = new Set(grow.targetPlayProduceExamEffectIds?.length ? grow.targetPlayProduceExamEffectIds
        : parts.map(part => part.originProduceExamEffectId).filter(Boolean));
      if (!parts.some(part => targets.has(part.originProduceExamEffectId))) continue;
      const effect = templates("examEffectById", grow.playProduceExamEffectId ?? grow.playEffectId, "customizeProduceDescriptionParts");
      parts = replaceParts(parts, part => targets.has(part.originProduceExamEffectId), effect);
    } else if (type === "PlayTriggerChange" || type === "PlayEffectTriggerChange") {
      const targets = new Set(grow.targetPlayEffectProduceExamTriggerIds?.length ? grow.targetPlayEffectProduceExamTriggerIds
        : parts.map(part => part.originProduceExamTriggerId).filter(Boolean));
      if (!parts.some(part => targets.has(part.originProduceExamTriggerId))) continue;
      const field = type === "PlayTriggerChange" ? "playProduceDescriptionParts" : "playEffectProduceDescriptionParts";
      const id = type === "PlayTriggerChange" ? grow.playProduceExamTriggerId : grow.playEffectProduceExamTriggerId;
      const condition = templates("examTriggerById", id, field);
      parts = replaceParts(parts, part => targets.has(part.originProduceExamTriggerId) && !part.originProduceExamEffectId, condition);
    } else if (type === "CardStatusEnchantChange") {
      const old = part => Boolean(part.originProduceCardStatusEnchantId);
      const enchant = templates("cardStatusEnchantById", grow.produceCardStatusEnchantId ?? grow.statusEnchantId, "produceDescriptionParts");
      if (parts.some(old)) parts = replaceParts(parts, old, enchant);
      else insertEffects(enchant);
    } else if (type === "PlayMovePositionTypeChange") {
      // Grave is the default destination and has no extra card restriction.
      parts = parts.filter(part => part.targetId !== "Label_ProduceCardMovePositionType_Lost" &&
        part.produceCardMovePositionType !== "ProduceCardMovePositionType_Lost" &&
        part.examDescriptionType !== "ExamDescriptionType_CustomizePlayMovePositionLost");
      const position = String(grow.playMovePositionType ?? grow.movePositionType ?? "");
      if (position.endsWith("_Lost")) {
        const label = catalogs.descriptionLabelById?.get?.("Label_ProduceCardMovePositionType_Lost");
        if (label?.name) insertEffects([{ text: label.name, targetId: label.id }]);
        else unresolved.push("descriptionLabelById:Label_ProduceCardMovePositionType_Lost");
      } else if (position.endsWith("_Hold")) {
        const label = catalogs.descriptionLabelById?.get?.("Label_ProduceCardPositionType_Hold");
        if (label?.name) insertEffects([{ text: label.name, targetId: label.id }]);
        else unresolved.push("descriptionLabelById:Label_ProduceCardPositionType_Hold");
      }
    }
  }
  return { parts, unresolved };
}
