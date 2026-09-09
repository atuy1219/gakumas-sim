import { buildEffectPipelineReport } from "../web/effect_pipeline_v8.js";

const report = buildEffectPipelineReport();

console.log(JSON.stringify({
  summary: report.summary,
  unsupportedByCategory: Object.fromEntries(
    Object.entries(report.unsupportedByCategory).map(([k, v]) => [k, v.length])
  )
}, null, 2));

if (process.env.EFFECT_REPORT_JSON === "1") {
  console.log(JSON.stringify(report, null, 2));
}
