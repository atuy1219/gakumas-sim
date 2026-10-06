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

export function parseOfficialDescriptionParts(text) {
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
      active = match[1] === "produceDescriptions";
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
