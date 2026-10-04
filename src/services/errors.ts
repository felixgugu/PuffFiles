/** 後端 `AppError` 的種類（與 Rust 端序列化的 `kind` 對應）。 */
export type AppErrorKind =
  | "notFound"
  | "permissionDenied"
  | "notADirectory"
  | "notAFile"
  | "invalidPath"
  | "invalidName"
  | "alreadyExists"
  | "unsupported"
  | "io"
  | "unknown";

const TITLES: Record<AppErrorKind, string> = {
  notFound: "找不到這個位置",
  permissionDenied: "沒有存取權限",
  notADirectory: "這不是資料夾",
  notAFile: "這不是檔案",
  invalidPath: "路徑無效",
  invalidName: "名稱不合法",
  alreadyExists: "名稱重複",
  unsupported: "尚未支援",
  io: "系統錯誤",
  unknown: "發生未預期的錯誤",
};

export interface AppErrorView {
  kind: AppErrorKind;
  title: string;
  message: string;
  /** 發生錯誤的路徑（若後端有提供）。 */
  path?: string;
}

/** 由 IPC 邊界拋出的錯誤，保證一定帶有可辨識的種類。 */
export class BackendError extends Error {
  readonly kind: AppErrorKind;
  readonly path?: string;

  constructor(kind: AppErrorKind, message: string, path?: string) {
    super(message);
    this.name = "BackendError";
    this.kind = kind;
    this.path = path;
  }
}

const KNOWN_KINDS = new Set<string>(Object.keys(TITLES));

/** 把任何來源的錯誤統一轉成可顯示的結構。 */
export function normalizeBackendError(error: unknown): AppErrorView {
  const kind = kindOf(error);
  const path = typeof (error as { path?: unknown })?.path === "string"
    ? (error as { path: string }).path
    : undefined;

  return {
    kind,
    title: TITLES[kind],
    message: messageOf(error),
    path,
  };
}

/** IPC 服務層專用：將原始錯誤轉為 [`BackendError`] 後再往外拋。 */
export function toBackendError(error: unknown): BackendError {
  const kind = kindOf(error);
  const path = typeof (error as { path?: unknown })?.path === "string"
    ? (error as { path: string }).path
    : undefined;
  return new BackendError(kind, messageOf(error), path);
}

function kindOf(error: unknown): AppErrorKind {
  if (error instanceof BackendError) {
    return error.kind;
  }
  const kind = (error as { kind?: unknown })?.kind;
  return typeof kind === "string" && KNOWN_KINDS.has(kind) ? (kind as AppErrorKind) : "unknown";
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  const message = (error as { message?: unknown })?.message;
  if (typeof message === "string") {
    return message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
