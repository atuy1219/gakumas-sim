import assert from "node:assert/strict";
import {findNativeReplayCardIndex} from "../web/contest_native_replay.js";

// Native ExamCardData._baseUpgradeCount/_tmpUpgradeCount (v3.4.1).
assert.deepEqual(findNativeReplayCardIndex([
  {id:"one",upgradeCount:0},{id:"one",upgradeCount:1},
],{id:"one",baseUpgradeCount:0,temporaryUpgradeCount:1}),
{index:1,upgradeFallback:false},
"match actual effective upgrade rather than a base-only duplicate");
assert.deepEqual(findNativeReplayCardIndex([
  {id:"one",upgradeCount:0},
],{id:"one",baseUpgradeCount:0,temporaryUpgradeCount:1}),
{index:0,upgradeFallback:true},
"temporary upgrade absent in sim may be replayed but must be flagged");
assert.deepEqual(findNativeReplayCardIndex([
  {id:"other",upgradeCount:1},
],{id:"one",baseUpgradeCount:0,temporaryUpgradeCount:1}),
{index:-1,upgradeFallback:false});
assert.deepEqual(findNativeReplayCardIndex([
  {id:"one",upgradeCount:0},{id:"one",upgradeCount:0},
],{id:"one",baseUpgradeCount:0,temporaryUpgradeCount:1}),
{index:-1,upgradeFallback:false},
"ambiguous base-only fallback must not pick an arbitrary instance");
console.log("Native temporary-upgrade card replay matching: OK");
