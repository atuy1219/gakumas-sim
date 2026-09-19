export const MEMORY_STORAGE_KEY = "gakumas-sim-memory-library";
export const FILTER_STORAGE_KEY = "gakumas-sim-builder-filter";

const PREVIOUS_MEMORY_STORAGE_KEYS = [
  "gakumas-sim-memory-library-v3",
  "gakumas-card-order-memory-library-v2",
];
const PREVIOUS_FILTER_STORAGE_KEYS = [
  "gakumas-sim-builder-filter-v5",
];

function migrateOne(storage, currentKey, previousKeys) {
  if (!storage) return;
  let current = storage.getItem(currentKey);
  if (current === null) {
    for (const key of previousKeys) {
      const previous = storage.getItem(key);
      if (previous === null) continue;
      storage.setItem(currentKey, previous);
      current = previous;
      break;
    }
  }
  for (const key of previousKeys) storage.removeItem(key);
}

export function migrateStorageKeys(storage) {
  migrateOne(storage, MEMORY_STORAGE_KEY, PREVIOUS_MEMORY_STORAGE_KEYS);
  migrateOne(storage, FILTER_STORAGE_KEY, PREVIOUS_FILTER_STORAGE_KEYS);
}
