#!/usr/bin/env node
// One-off master snapshot; not a long-term game-data authority.
import { writeFile } from "node:fs/promises";
import { fetchTemporaryContestCatalog } from "./contest_catalog_provider.mjs";

async function main() {
  const [output = "gakumas-contest-catalog.json", ref = "main"] = process.argv.slice(2);
  const catalog = await fetchTemporaryContestCatalog({ ref });
  await writeFile(output, JSON.stringify(catalog, null, 2) + "\n");
  console.log(JSON.stringify({
    output, source: catalog.provenance.repository, commit: catalog.provenance.commit,
    gameVersionVerified: false,
    cards: catalog.cards.length, variants: catalog.cardVariants.length,
    items: catalog.items.length, effects: catalog.examEffects.length,
    warning: "Temporary diff data is not verified against the captured game version",
  }, null, 2));
}
main().catch(error => { console.error(error?.stack || String(error)); process.exitCode = 1; });
