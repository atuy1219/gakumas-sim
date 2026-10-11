#!/usr/bin/env node
/** Analyze one exported contest capture; never echo native scores as simulator predictions. */
import { readFile, writeFile } from "node:fs/promises";
import { compareContestCapture } from "../web/contest_capture_compare.js";
import { normalizeNativeContestSetup } from "../web/contest_native_setup.js";
import { replayObservedContest } from "../web/contest_native_replay.js";

async function main(args) {
  if(args.length < 1 || args.includes("--help")) {
    console.error("Usage: node tools/compare_contest_capture.mjs <capture.json> [output.json] [catalog.json]");
    process.exitCode = args.includes("--help") ? 0 : 2;
    return;
  }
  const source = JSON.parse(await readFile(args[0], "utf8"));
  // All catalogs must be exact-version masters; never invent missing effects.
  const catalog=args[2]?JSON.parse(await readFile(args[2],"utf8")):{};
  const byId=rows=>new Map((rows??[]).map(x=>[x.id,x]));
  const catalogs={
   examSettings:catalog.examSettings??[],
   itemById:byId(catalog.items),itemEffectById:byId(catalog.itemEffects),
   examEffectById:byId(catalog.examEffects),
   examStatusEnchantById:byId(catalog.examStatusEnchants),
   examTriggerById:byId(catalog.examTriggers),
   cardSearchById:byId(catalog.cardSearches),
   cardRandomPoolById:byId(catalog.cardRandomPools),
   cardStatusEnchantById:byId(catalog.cardStatusEnchants),
   cardPoolById:byId(catalog.cardPools),
  };
  const result = compareContestCapture(source, {
   resolveInput: session => normalizeNativeContestSetup(session,{examItemCatalogs:catalogs}),
   simulator: (session,input) => replayObservedContest(session,input,{
    cardById:byId(catalog.cards),examItemCatalogs:catalogs}),
  });
  const output=args[1] || "gakumas-contest-comparison.json";
  await writeFile(output, JSON.stringify(result,null,2)+"\n");
  const s=result.summary;
  console.log(JSON.stringify({
    output,status:result.status,realDeviceSessions:s.sessions,
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
