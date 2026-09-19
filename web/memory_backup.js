export const MEMORY_BACKUP_FORMAT = "gakumas-sim-memory-backup";
export const MEMORY_BACKUP_VERSION = 1;

export function createMemoryBackup(userMemoryList, exportedAt = new Date().toISOString()) {
  if (!Array.isArray(userMemoryList)) throw new Error("メモリー一覧が不正です。");
  return {
    format: MEMORY_BACKUP_FORMAT,
    version: MEMORY_BACKUP_VERSION,
    exportedAt: String(exportedAt),
    userMemoryList,
  };
}

export function parseMemoryBackup(input) {
  let payload = input;
  if (typeof input === "string") {
    try {
      payload = JSON.parse(input);
    } catch {
      throw new Error("バックアップJSONを読み込めませんでした。");
    }
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("バックアップ形式が不正です。");
  }
  if (payload.format !== MEMORY_BACKUP_FORMAT) {
    throw new Error("学マスシミュレーターのメモリーバックアップではありません。");
  }
  if (Number(payload.version) !== MEMORY_BACKUP_VERSION) {
    throw new Error(`未対応のバックアップバージョンです: ${payload.version}`);
  }
  if (!Array.isArray(payload.userMemoryList)) {
    throw new Error("バックアップにメモリー一覧がありません。");
  }
  return payload.userMemoryList;
}
