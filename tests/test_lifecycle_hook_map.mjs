import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const map = JSON.parse(readFileSync(new URL("../tools/gakumas_v341_lifecycle_rvas.json", import.meta.url), "utf8"));
const code = readFileSync(new URL("../android/lsposed-progress-capture/src/main/cpp/progress_capture.cpp", import.meta.url), "utf8");
assert.equal(map.libil2cppBuildId, "77fda4e2a21f23954e2349b83fc113ede408f70b");
const keys = new Set();
for (const method of map.methods) {
  const key = method.type + "::" + method.method + "/" + method.args;
  assert.ok(!keys.has(key), "duplicate metadata method: " + key);
  keys.add(key);
  assert.match(method.token, /^0x06[0-9a-f]{6}$/i);
  const value = Number.parseInt(method.rva.slice(2), 16);
  assert.ok(Number.isInteger(value) && value >= 0x5d294b0 && value < 0xe0b26c0,
    "outside executable ELF segment: " + key);
}
for (const [name, rva] of [
  ["kV341ExamSequenceStart", "0x80a5354"],
  ["kV341ExamSequenceGetParameter", "0x80a15b4"],
  ["kV341ExamSequenceDispose", "0x80b0dc0"],
  ["kV341ExamParameterEndComplete", "0x809305c"],
  ["kV341ContestStartBattle", "0x6cec3cc"],
  ["kV341ContestEndBattle", "0x6cec3d8"],
]) {
  assert.match(code, new RegExp("constexpr uintptr_t " + name + " = 0x0*" + rva.slice(2) + ";", "i"));
}
assert.match(code, /image\.build_id != kV341BuildId/);
assert.match(code, /ExamParameterModel\.SetExamEndComplete/);
assert.match(code, /ExamSequence\.StartExam/);
console.log("v3.4.1 lifecycle token/RVA map tests: ok");
