"use strict";

/*
 * Dump the live Idol Road (TowerLayerExam) master records from Gakumas.
 *
 * Offsets are for the 2026-09-06 IL2CPP build used by this repository's
 * gakumas_analysis_fullcfg.elf (build-id c94ab574cfe2d62da43ec6167db4d96d429b18f8).
 *
 * Run after attaching Frida, then open アイドルへの道 once.
 */

const PACKAGE = "com.bandainamcoent.idolmaster_gakuen";
const OUTPUT_PATH = "/data/user/0/" + PACKAGE + "/files/TowerLayerExam.dump.json";

const OFF = Object.freeze({
  masterGetter: 0x73807e4,
  findByFullKey: 0x7372f58,
  masterTowerId: 0x7bc2624,
  masterNumber: 0x7bc26a8,
  masterExamEffectType: 0x7bc26b8,
  masterParameterBaseLine: 0x7bc26c8,
  masterBaseScore: 0x7bc26d8,
  masterGimmickId: 0x7bc26f0,
  masterBattleConfigId: 0x7bc2774,
  masterNpcGroupId: 0x7bc27f8,
  masterToString: 0x7bc2b50,
  apiGetLayerAsync: 0x72a5750,
  apiResponseInternalMergeFrom: 0x754f750,
  apiResponseToString: 0x754f13c,
});

const TOWER_IDS = Object.freeze([
  "tower_001-amao",
  "tower_001-atbm",
  "tower_001-fktn",
  "tower_001-hmsz",
  "tower_001-hrnm",
  "tower_001-hski",
  "tower_001-hume",
  "tower_001-jsna",
  "tower_001-kcna",
  "tower_001-kllj",
  "tower_001-shro",
  "tower_001-ssmk",
  "tower_001-ttmr",
]);

const EXAM_EFFECTS = Object.freeze([
  [2, "ExamParameterBuff"],
  [10, "ExamLessonBuff"],
  [31, "ExamReview"],
  [42, "ExamCardPlayAggressive"],
  [45, "ExamConcentration"],
  [47, "ExamFullPower"],
]);

const MAX_LAYER = 100;

function nowIso() {
  return new Date().toISOString();
}

function ptrJson(p) {
  return p && !p.isNull() ? p.toString() : "0x0";
}

function readIl2CppString(p) {
  if (!p || p.isNull()) return "";
  try {
    const length = p.add(0x10).readS32();
    if (length < 0 || length > 1000000) return "";
    return p.add(0x14).readUtf16String(length) || "";
  } catch (_) {
    return "";
  }
}

function main() {
  const il2cpp = Process.getModuleByName("libil2cpp.so");
  const base = il2cpp.base;
  const at = function (offset) { return base.add(offset); };

  const domainGet = new NativeFunction(il2cpp.getExportByName("il2cpp_domain_get"), "pointer", []);
  const threadAttach = new NativeFunction(il2cpp.getExportByName("il2cpp_thread_attach"), "pointer", ["pointer"]);
  const stringNew = new NativeFunction(il2cpp.getExportByName("il2cpp_string_new"), "pointer", ["pointer"]);

  const findByFullKey = new NativeFunction(
    at(OFF.findByFullKey),
    "pointer",
    ["pointer", "pointer", "int", "int", "pointer"]
  );

  const getTowerId = new NativeFunction(at(OFF.masterTowerId), "pointer", ["pointer", "pointer"]);
  const getNumber = new NativeFunction(at(OFF.masterNumber), "int", ["pointer", "pointer"]);
  const getExamEffectType = new NativeFunction(at(OFF.masterExamEffectType), "int", ["pointer", "pointer"]);
  const getParameterBaseLine = new NativeFunction(at(OFF.masterParameterBaseLine), "int", ["pointer", "pointer"]);
  const getBaseScore = new NativeFunction(at(OFF.masterBaseScore), "int", ["pointer", "pointer"]);
  const getGimmickId = new NativeFunction(at(OFF.masterGimmickId), "pointer", ["pointer", "pointer"]);
  const getBattleConfigId = new NativeFunction(at(OFF.masterBattleConfigId), "pointer", ["pointer", "pointer"]);
  const getNpcGroupId = new NativeFunction(at(OFF.masterNpcGroupId), "pointer", ["pointer", "pointer"]);
  const masterToString = new NativeFunction(at(OFF.masterToString), "pointer", ["pointer", "pointer"]);
  const apiResponseToString = new NativeFunction(at(OFF.apiResponseToString), "pointer", ["pointer", "pointer"]);

  let masterDumpStarted = false;
  let masterRows = [];
  const liveRows = [];
  let pendingRequest = null;
  let responseSerial = 0;

  function ensureAttached() {
    try {
      threadAttach(domainGet());
    } catch (_) {}
  }

  function managedString(text) {
    return stringNew(Memory.allocUtf8String(text));
  }

  function rowFromMaster(record) {
    let raw = "";
    try {
      raw = readIl2CppString(masterToString(record, ptr(0)));
    } catch (_) {}
    const effectValue = getExamEffectType(record, ptr(0));
    const effect = EXAM_EFFECTS.find(function (entry) { return entry[0] === effectValue; });
    return {
      towerId: readIl2CppString(getTowerId(record, ptr(0))),
      number: getNumber(record, ptr(0)),
      examEffectType: effectValue,
      examEffectTypeName: effect ? effect[1] : String(effectValue),
      parameterBaseLine: getParameterBaseLine(record, ptr(0)),
      baseScore: getBaseScore(record, ptr(0)),
      produceExamGimmickEffectGroupId: readIl2CppString(getGimmickId(record, ptr(0))),
      produceExamBattleConfigId: readIl2CppString(getBattleConfigId(record, ptr(0))),
      produceExamBattleNpcGroupId: readIl2CppString(getNpcGroupId(record, ptr(0))),
      rawProtoJson: raw,
    };
  }

  function writeSnapshot(reason) {
    const payload = {
      format: "gakumas-tower-layer-exam-dump",
      version: 1,
      generatedAt: nowIso(),
      source: {
        libil2cppBase: base.toString(),
        reason: reason,
      },
      masterRows: masterRows,
      liveApiRows: liveRows,
    };
    const json = JSON.stringify(payload, null, 2);
    try {
      const f = new File(OUTPUT_PATH, "w");
      f.write(json);
      f.flush();
      f.close();
      console.log("[TOWER_LAYER_EXAM] wrote " + OUTPUT_PATH);
    } catch (e) {
      console.log("[TOWER_LAYER_EXAM] file write failed: " + e);
    }
    console.log("[TOWER_LAYER_EXAM_JSON] " + JSON.stringify(payload));
  }

  function dumpMaster(master) {
    if (masterDumpStarted || !master || master.isNull()) return;
    masterDumpStarted = true;
    ensureAttached();

    console.log("[TOWER_LAYER_EXAM] master=" + master + " scan start");
    const rows = [];
    const seen = new Set();

    for (const towerId of TOWER_IDS) {
      const towerString = managedString(towerId);
      for (let number = 1; number <= MAX_LAYER; number++) {
        for (const effectEntry of EXAM_EFFECTS) {
          const effectValue = effectEntry[0];
          const effectName = effectEntry[1];
          let record = ptr(0);
          try {
            record = findByFullKey(master, towerString, number, effectValue, ptr(0));
          } catch (e) {
            console.log("[TOWER_LAYER_EXAM] FindByKey failed " + towerId + " #" + number + " " + effectName + ": " + e);
            continue;
          }
          if (!record || record.isNull()) continue;

          let row;
          try {
            row = rowFromMaster(record);
          } catch (e) {
            row = {
              towerId: towerId,
              number: number,
              examEffectType: effectValue,
              examEffectTypeName: effectName,
              pointer: ptrJson(record),
              error: String(e),
            };
          }

          const key = String(row.towerId || towerId) + "#" + String(row.number || number) + "#" + String(row.examEffectType == null ? effectValue : row.examEffectType);
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push(row);
          console.log("[TOWER_LAYER_EXAM_ROW] " + JSON.stringify(row));
        }
      }
    }

    masterRows = rows.sort(function (a, b) {
      const towerOrder = String(a.towerId).localeCompare(String(b.towerId));
      if (towerOrder) return towerOrder;
      const numberOrder = Number(a.number) - Number(b.number);
      if (numberOrder) return numberOrder;
      return Number(a.examEffectType) - Number(b.examEffectType);
    });

    console.log("[TOWER_LAYER_EXAM] master scan complete: " + masterRows.length + " rows");
    writeSnapshot(masterRows.length ? "master-scan" : "master-empty-live-api-fallback-enabled");
  }

  function scheduleMasterDump(master) {
    if (masterDumpStarted || !master || master.isNull()) return;
    setImmediate(function () { dumpMaster(master); });
  }

  Interceptor.attach(at(OFF.masterGetter), {
    onLeave: function (retval) {
      if (!retval.isNull()) scheduleMasterDump(retval);
    },
  });

  Interceptor.attach(at(OFF.apiGetLayerAsync), {
    onEnter: function (args) {
      const towerId = readIl2CppString(args[0]);
      const number = args[1].toInt32();
      if (!towerId.startsWith("tower_")) return;
      pendingRequest = { towerId: towerId, number: number, requestedAt: nowIso() };
      console.log("[TOWER_GET_LAYER_REQUEST] " + JSON.stringify(pendingRequest));
    },
  });

  Interceptor.attach(at(OFF.apiResponseInternalMergeFrom), {
    onEnter: function (args) {
      this.self = args[0];
    },
    onLeave: function () {
      const self = this.self;
      if (!self || self.isNull()) return;
      ensureAttached();
      let raw = "";
      try {
        raw = readIl2CppString(apiResponseToString(self, ptr(0)));
      } catch (e) {
        console.log("[TOWER_GET_LAYER_RESPONSE] ToString failed: " + e);
        return;
      }
      if (!raw || raw === "{}") return;

      const row = {
        serial: ++responseSerial,
        request: pendingRequest ? Object.assign({}, pendingRequest) : null,
        receivedAt: nowIso(),
        responseProtoJson: raw,
      };
      liveRows.push(row);
      console.log("[TOWER_GET_LAYER_RESPONSE] " + JSON.stringify(row));
      writeSnapshot("live-api");
    },
  });

  Interceptor.attach(at(OFF.findByFullKey), {
    onEnter: function (args) {
      if (!masterDumpStarted && args[0] && !args[0].isNull()) {
        scheduleMasterDump(args[0]);
      }
    },
  });

  console.log("[TOWER_LAYER_EXAM] installed; libil2cpp=" + base);
  console.log("[TOWER_LAYER_EXAM] open アイドルへの道 once to trigger the dump.");
}

setImmediate(main);
