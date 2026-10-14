#!/usr/bin/env node
/** Analyze one exported contest capture; never echo native scores as simulator predictions. */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fetchTemporaryContestCatalog } from "./contest_catalog_provider.mjs";
import { compareContestCapture } from "../web/contest_capture_compare.js";
import { normalizeNativeContestSetup } from "../web/contest_native_setup.js";
import { replayObservedContest } from "../web/contest_native_replay.js";
import { prepareCustomizationOverrides } from "./contest_customization_overrides.mjs";

async function main(args) {
  const observedCustoms=args.includes("--observed-customs-provisional");
  const overrideIndex = args.indexOf("--customization-overrides");
  if (overrideIndex >= 0 && (!args[overrideIndex + 1] || args[overrideIndex + 1].startsWith("--"))) {
    throw new Error("--customization-overrides requires a JSON file");
  }
  const overridePath = overrideIndex >= 0 ? args[overrideIndex + 1] : null;
  const positional=args.filter((x, index)=>x!=="--observed-customs-provisional"
    && index !== overrideIndex && index !== (overrideIndex < 0 ? -1 : overrideIndex + 1));
  if(positional.length < 1 || args.includes("--help")) {
    console.error("Usage: node tools/compare_contest_capture.mjs <capture.json> [output.json] [catalog.json] [diff-ref] [--observed-customs-provisional] [--customization-overrides supplement.json]");
    process.exitCode = args.includes("--help") ? 0 : 2;
    return;
  }
  const captureBytes = await readFile(positional[0]);
  const source = JSON.parse(captureBytes.toString("utf8"));
  // External diff is explicitly provisional. Always record the immutable source SHA.
  // Passing catalog.json keeps this workflow offline and provider-independent.
  const output=positional[1] || "gakumas-contest-comparison.json";
  const autoCatalog=!positional[2];
  const catalog=autoCatalog
   ?await fetchTemporaryContestCatalog({ref:positional[3]||"main"})
   :JSON.parse(await readFile(positional[2],"utf8"));
  const catalogPath=autoCatalog?join(dirname(output),"gakumas-contest-catalog.json"):positional[2];
  if(autoCatalog)await writeFile(catalogPath,JSON.stringify(catalog,null,2)+"\n");
  const byId=rows=>new Map((rows??[]).map(x=>[x.id,x]));
  const overrides = overridePath ? prepareCustomizationOverrides(
    JSON.parse(await readFile(overridePath, "utf8")), captureBytes, byId(catalog.cardCustomizes),
  ) : null;
  const catalogs={
   examSettings:catalog.examSettings??[],
   cardCustomizeRuleById:byId(catalog.cardCustomizeRules),
   itemById:byId(catalog.items),itemEffectById:byId(catalog.itemEffects),
   examEffectById:byId(catalog.examEffects),
   examStatusEnchantById:byId(catalog.examStatusEnchants),
   examTriggerById:byId(catalog.examTriggers),
   cardSearchById:byId(catalog.cardSearches),
   cardRandomPoolById:byId(catalog.cardRandomPools),
   cardStatusEnchantById:byId(catalog.cardStatusEnchants),
   cardPoolById:new Map((catalog.cardPools??[]).map(x=>[x.id,x.cards??x])),
  };
  const result = compareContestCapture(source, {
   masterProvenance:catalog.provenance??{provider:"local-unspecified",gameVersionVerified:false},
   resolveInput: session => {
    const normalized = normalizeNativeContestSetup(session,{examItemCatalogs:catalogs,allowObservedCustomizations:observedCustoms});
    return overrides ? overrides.apply(session.sessionId, normalized) : normalized;
   },
   simulator: (session,input) => replayObservedContest(session,input,{
    cardById:byId(catalog.cards),
    cardVariantByKey:new Map((catalog.cardVariants??catalog.cards??[]).map(x=>[String(x.id)+"@@"+Number(x.upgradeCount??0),x])),
    customizeById:new Map((catalog.cardCustomizes??[]).map(x=>[x.id,{id:x.id,levels:new Map((x.levels??[]).map(row=>[Number(row.count),row.level]))}])),
    growEffectById:byId(catalog.cardGrowEffects),examItemCatalogs:catalogs}),
  });
  if (overrides) result.customizationSupplement = overrides.evidence;
  await writeFile(output, JSON.stringify(result,null,2)+"\n");
  const s=result.summary;
  console.log(JSON.stringify({
    output,catalogPath,observedCustomsProvisional:observedCustoms,masterProvenance:result.masterProvenance,
    status:result.status,realDeviceSessions:s.sessions,
    captureComplete:s.capturesComplete,steps:s.totalProgress,turns:s.totalTurns,
    independentSimulatorRuns:s.simulationCompared,simulatorBlocked:s.simulationBlocked,
    firstDivergence:result.firstDivergence,
    nativeAttributeBonusCaptures:s.nativeAttributeBonusCaptures,
    separatelyVerifiedAccountSupportBonuses:s.separatelyVerifiedAccountSupportBonuses,
  },null,2));
  if(s.sessions===0 || s.capturesComplete!==s.sessions)process.exitCode=1;
  // Simulator-unavailable is not a native capture failure; the report
  // explicitly preserves this limitation instead of returning a false pass.
}
main(process.argv.slice(2)).catch(error=>{
  console.error(error?.stack || String(error));
  process.exitCode=1;
});
