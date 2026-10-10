#!/usr/bin/env node
/**
 * Pull a single native-capture session from rooted Android over ADB, compare
 * it against the simulator when a verified profile is provided, and export one
 * AI-ready JSON. With --watch, update automatically as the game is played.
 *
 * Examples:
 *   node tools/watch_native_exam.mjs --watch
 *   node tools/watch_native_exam.mjs --once
 *   node tools/watch_native_exam.mjs --trace ./exam_seed_trace.jsonl --cards ./produce_cards.json
 *   node tools/watch_native_exam.mjs --watch --profile ./verified_tower_profile.json
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
import { createDiagnosticReport } from "./native_exam_diagnostic.mjs";

const execFileAsync = promisify(execFile);
const GAME = "com.bandainamcoent.idolmaster_gakuen";
const DIRECTORY = "/data/user/0/" + GAME + "/files/gakumas-sim";
const args = process.argv.slice(2);
function option(name, fallback = null) {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(name + " needs a value");
  return args[i + 1];
}
const watch = args.includes("--watch");
const once = args.includes("--once");
if (watch && once) throw new Error("choose --watch or --once");
const outputDir = resolve(option("--out", "out/gakumas-diagnostics"));
const serial = option("--serial");
const traceFile = option("--trace");
const cardsFile = option("--cards");
const profileFile = option("--profile");
const interval = Number(option("--interval", "2000"));
if (!Number.isFinite(interval) || interval < 500) throw new Error("--interval must be at least 500ms");

async function adbRead(name) {
  const cli = serial ? ["-s", serial] : [];
  // No user-provided shell command is passed to su. File names are constants.
  const path = DIRECTORY + "/" + name;
  const { stdout } = await execFileAsync("adb",
    [...cli, "exec-out", "su", "-c", "cat " + path],
    { encoding: "utf8", maxBuffer: 128 * 1024 * 1024, timeout: 30000 });
  return stdout;
}
async function loadCapture() {
  const traceText = traceFile ? await readFile(traceFile, "utf8") : await adbRead("exam_seed_trace.jsonl");
  let cardsText = "";
  try {
    cardsText = cardsFile ? await readFile(cardsFile, "utf8") : await adbRead("produce_cards.json");
  } catch (error) {
    if (cardsFile) throw error;
  }
  return { traceText, cardsText };
}
async function loadProfile() {
  return profileFile ? JSON.parse(await readFile(profileFile, "utf8")) : null;
}
function printSummary(report, path) {
  const c = report.comparison;
  console.log(
    "[" + new Date().toLocaleTimeString() + "] " + c.status.toUpperCase()
    + " / RNG " + c.comparedRandomCalls
    + " / checkpoints " + c.comparedGameCheckpoints
    + " / differences " + c.differences.length
    + " / warnings " + c.warnings.length
  );
  if (c.firstDivergence) console.log("  First difference: " + JSON.stringify(c.firstDivergence));
  else if (!c.complete) console.log("  Full gameplay parity is NOT verified.");
  console.log("  Report: " + path);
}
async function saveReport(report) {
  const stamp = report.environment.nativeSessionStarted ?? "unknown-session";
  const suffix = report.environment.nativeBuildId?.slice(0, 12) ?? "no-build";
  const filename = "gakumas-diagnostic-" + String(stamp) + "-" + suffix + ".json";
  const target = join(outputDir, filename);
  await mkdir(outputDir, { recursive: true });
  const temporary = target + ".tmp";
  await writeFile(temporary, JSON.stringify(report, null, 2) + "\n", "utf8");
  await rename(temporary, target);
  // Stable path for users to drag into ChatGPT, overwritten atomically.
  const latest = join(outputDir, "gakumas-diagnostic-latest.json");
  const tmpLatest = latest + ".tmp";
  await writeFile(tmpLatest, JSON.stringify(report, null, 2) + "\n", "utf8");
  await rename(tmpLatest, latest);
  return latest;
}
let previousHash = null;
async function check() {
  const { traceText, cardsText } = await loadCapture();
  const hash = createHash("sha256").update(traceText).update("\0").update(cardsText).digest("hex");
  if (hash === previousHash) return;
  const profile = await loadProfile();
  const report = createDiagnosticReport({
    traceText, cardsText, profile, origin: traceFile ? "local-file" : "adb",
  });
  const output = await saveReport(report);
  previousHash = hash;
  printSummary(report, output);
}
async function main() {
  if (watch) {
    console.log("Watching LSPosed native capture. Press Ctrl+C to stop.");
    while (true) {
      try { await check(); }
      catch (error) { console.error("Capture unavailable: " + String(error.message)); }
      await new Promise((r) => setTimeout(r, interval));
    }
  } else await check();
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
