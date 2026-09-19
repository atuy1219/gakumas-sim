import assert from "node:assert/strict";
import {
  MEMORY_BACKUP_FORMAT,
  MEMORY_BACKUP_VERSION,
  createMemoryBackup,
  parseMemoryBackup,
} from "./web/memory_backup.js";

const memories = [
  {
    userMemoryId: "m1",
    name: "one",
    vocal: 100,
    examBattleProduceCards: [{ id: "card-a", upgradeCount: 1, customizes: [{ id: "custom-a", customizeCount: 2 }] }],
    examBattleProduceItemIds: ["item-a"],
  },
  {
    userMemoryId: "m2",
    name: "two",
    activeProduceCardIds: ["card-b"],
    examBattleProduceCards: [{ id: "card-b", fixedDeckOrder: 3 }],
  },
];

const backup = createMemoryBackup(memories, "2026-09-19T00:00:00.000Z");
assert.equal(backup.format, MEMORY_BACKUP_FORMAT);
assert.equal(backup.version, MEMORY_BACKUP_VERSION);
assert.equal(backup.exportedAt, "2026-09-19T00:00:00.000Z");
assert.deepEqual(backup.userMemoryList, memories);
assert.deepEqual(parseMemoryBackup(JSON.stringify(backup)), memories);
assert.throws(() => parseMemoryBackup("{}"), /バックアップ/);
assert.throws(
  () => parseMemoryBackup(JSON.stringify({ ...backup, version: 999 })),
  /未対応/,
);

console.log("memory backup tests: ok");
