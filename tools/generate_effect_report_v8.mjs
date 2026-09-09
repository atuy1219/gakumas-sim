import fs from "node:fs/promises";
import { loadEffectMasterV8 } from "../web/effect_master_loader_v8.js";

async function main() {
  const result = await loadEffectMasterV8();

  const report = result.report;
  const output = {
    generatedAt: report.generatedAt,
    summary: report.summary,
    unsupported: report.unsupported,
    hookRequired: report.hookRequired,
  };

  await fs.mkdir("reports", { recursive: true });
  await fs.writeFile(
    "reports/unsupported_effects_v8.json",
    JSON.stringify(output, null, 2),
    "utf8",
  );

  console.log(JSON.stringify(report.summary, null, 2));

  if (report.unsupported.length > 0) {
    console.log("\nUnsupported effects:");
    for (const entry of report.unsupported) {
      console.log(
        `- [${entry.effect.source}] ${entry.effect.id} (${entry.effect.kind})`,
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
