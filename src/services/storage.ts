/**
 * localStorage 的唯一存取點。
 *
 * 這裡刻意保持「無狀態、無響應式」：Pinia store 決定要存什麼，
 * 這個模組只負責安全地讀寫；任何解析失敗都退回預設值，不讓壞資料拖垮啟動。
 */

export function readJson<T>(key: string, fallback: T, validate?: (value: unknown) => boolean): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    const parsed: unknown = JSON.parse(raw);
    if (validate && !validate(parsed)) {
      return fallback;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 儲存空間不足或被停用時，寧可放棄持久化也不要中斷操作。
  }
}

export const STORAGE_KEYS = {
  folders: "pufffile:folders",
  history: "pufffile:history",
  session: "pufffile:session",
  settings: "pufffile:settings",
} as const;
