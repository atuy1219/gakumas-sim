import assert from "node:assert/strict";
import {
  FILTER_STORAGE_KEY,
  MEMORY_STORAGE_KEY,
  migrateStorageKeys,
} from "./web/storage_keys.js";

class FakeStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }
  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }
  setItem(key, value) {
    this.values.set(key, String(value));
  }
  removeItem(key) {
    this.values.delete(key);
  }
}

const legacy = new FakeStorage({
  "gakumas-sim-memory-library-v3": "[{\"userMemoryId\":\"m1\"}]",
  "gakumas-sim-builder-filter-v5": "{\"tower\":{\"planType\":\"p1\"}}",
});
migrateStorageKeys(legacy);
assert.equal(legacy.getItem(MEMORY_STORAGE_KEY), "[{\"userMemoryId\":\"m1\"}]");
assert.equal(legacy.getItem(FILTER_STORAGE_KEY), "{\"tower\":{\"planType\":\"p1\"}}");
assert.equal(legacy.getItem("gakumas-sim-memory-library-v3"), null);
assert.equal(legacy.getItem("gakumas-sim-builder-filter-v5"), null);

const currentWins = new FakeStorage({
  [MEMORY_STORAGE_KEY]: "[{\"userMemoryId\":\"new\"}]",
  "gakumas-sim-memory-library-v3": "[{\"userMemoryId\":\"old\"}]",
});
migrateStorageKeys(currentWins);
assert.equal(currentWins.getItem(MEMORY_STORAGE_KEY), "[{\"userMemoryId\":\"new\"}]");
assert.equal(currentWins.getItem("gakumas-sim-memory-library-v3"), null);

const oldest = new FakeStorage({
  "gakumas-card-order-memory-library-v2": "[{\"userMemoryId\":\"legacy\"}]",
});
migrateStorageKeys(oldest);
assert.equal(oldest.getItem(MEMORY_STORAGE_KEY), "[{\"userMemoryId\":\"legacy\"}]");
assert.equal(oldest.getItem("gakumas-card-order-memory-library-v2"), null);

console.log("storage key migration tests: ok");
