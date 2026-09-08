import {
  CATALOG_URLS,
  fetchTextWithFallback,
  parseCharacterCatalog,
  parseIdolCardCatalog,
} from "./catalog_v4.js";

const memoryList = document.getElementById("memory-list");

function buildReplacements(characters, idolCards) {
  const characterById = new Map(characters.map((entry) => [String(entry.id), entry]));
  const idolReplacements = [];

  for (const card of idolCards) {
    const id = String(card.id ?? "");
    const name = String(card.name ?? "");
    if (!id || !name) continue;
    idolReplacements.push([id, name]);

    const characterId = String(card.characterId ?? "");
    const characterName = characterById.get(characterId)?.name;
    if (characterId && characterName && id.includes(characterId)) {
      idolReplacements.push([id.replace(characterId, characterName), name]);
    }
  }

  idolReplacements.sort((a, b) => b[0].length - a[0].length);
  const characterReplacements = [...characterById]
    .map(([id, character]) => [id, String(character.name ?? id)])
    .sort((a, b) => b[0].length - a[0].length);

  return { idolReplacements, characterReplacements };
}

function replaceKnownIds(text, replacements) {
  let next = String(text ?? "");
  for (const [id, name] of replacements.idolReplacements) next = next.replaceAll(id, name);
  for (const [id, name] of replacements.characterReplacements) next = next.replaceAll(id, name);
  return next;
}

function repairMemorySubtitles(replacements) {
  if (!memoryList) return;
  for (const subtitle of memoryList.querySelectorAll(".memory-card-v3-head small")) {
    const next = replaceKnownIds(subtitle.textContent, replacements);
    if (next !== subtitle.textContent) subtitle.textContent = next;
  }
}

async function initialize() {
  if (!memoryList) return;
  const [characterText, idolCardText] = await Promise.all([
    fetchTextWithFallback(CATALOG_URLS.characters),
    fetchTextWithFallback(CATALOG_URLS.idolCards),
  ]);
  const replacements = buildReplacements(
    parseCharacterCatalog(characterText),
    parseIdolCardCatalog(idolCardText),
  );

  let queued = false;
  const scheduleRepair = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      repairMemorySubtitles(replacements);
    });
  };

  repairMemorySubtitles(replacements);
  new MutationObserver(scheduleRepair).observe(memoryList, {
    childList: true,
    subtree: true,
  });
}

initialize().catch((error) => console.warn("memory display name fix failed", error));
