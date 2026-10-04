import type { PathSegment } from "@/types/fs";

/** 僅處理 Windows 路徑形態（`C:\...`、`\\server\share\...`）。 */

export function toBackslashes(path: string): string {
  return path.replace(/\//g, "\\");
}

/** 取路徑最後一段，做為標題或名稱使用。 */
export function fileNameOf(path: string): string {
  const normalized = toBackslashes(path).replace(/\\+$/, "");
  const index = normalized.lastIndexOf("\\");
  return index === -1 ? normalized : normalized.slice(index + 1);
}

/** 去掉最後一個副檔名的檔名；沒有副檔名（或只有開頭是點）時原樣回傳。 */
export function fileStemOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(0, index) : name;
}

/**
 * 取小寫、含點的副檔名（`archive.7z` → `.7z`）；沒有副檔名時回傳空字串。
 *
 * 與後端 `Path::extension()` 一致：`.gitignore` 這類開頭是點的檔名不算有副檔名。
 */
export function extensionOf(path: string): string {
  const name = fileNameOf(path);
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index).toLocaleLowerCase() : "";
}

export function joinPath(base: string, name: string): string {
  const normalized = toBackslashes(base);
  return normalized.endsWith("\\") ? `${normalized}${name}` : `${normalized}\\${name}`;
}

/** 拆成可供麵包屑使用的節點，第一段永遠是磁碟或網路根節點。 */
export function toSegments(path: string): PathSegment[] {
  const normalized = toBackslashes(path);

  if (normalized.startsWith("\\\\")) {
    const [server, share, ...rest] = normalized.slice(2).split("\\").filter(Boolean);
    if (!server || !share) {
      return [{ label: normalized, path: normalized }];
    }
    const root = `\\\\${server}\\${share}\\`;
    return appendSegments([{ label: `\\\\${server}\\${share}`, path: root }], root, rest);
  }

  const matched = /^([a-zA-Z]):\\?/.exec(normalized);
  if (!matched) {
    return [{ label: path, path }];
  }

  const drive = matched[1].toUpperCase();
  const root = `${drive}:\\`;
  const rest = normalized.slice(matched[0].length).split("\\").filter(Boolean);
  return appendSegments([{ label: `${drive}:`, path: root }], root, rest);
}

/** 上一層路徑；已在根目錄時回傳 `null`。 */
export function parentOf(path: string): string | null {
  const segments = toSegments(path);
  return segments.length > 1 ? segments[segments.length - 2].path : null;
}

/**
 * Windows 路徑 → Linux 風格純路徑。
 *
 * 依需求「去掉 /mnt/c」：只保留目錄結構，不帶磁碟機與 WSL 掛載前綴。
 * `C:\Users\felix\專案` → `/Users/felix/專案`
 * `\\server\share\a`    → `//server/share/a`
 */
export function toUnixPath(path: string): string {
  const normalized = toBackslashes(path);

  if (normalized.startsWith("\\\\")) {
    return normalized.replace(/\\/g, "/");
  }

  const drive = /^[a-zA-Z]:\\?/.exec(normalized);
  if (!drive) {
    return normalized.replace(/\\/g, "/");
  }

  const rest = normalized.slice(drive[0].length).replace(/\\/g, "/").replace(/\/+$/, "");
  return rest ? `/${rest}` : "/";
}

/** 用於去重與比較的正規化鍵：統一斜線、去尾端斜線、忽略大小寫。 */
export function normalizeKey(path: string): string {
  return toBackslashes(path).replace(/\\+$/, "").toLocaleLowerCase();
}

export function samePath(a: string, b: string): boolean {
  return normalizeKey(a) === normalizeKey(b);
}

/**
 * 把 Markdown 裡的連結或圖片位址接成 Windows 絕對路徑。
 *
 * 支援 `./`、`../`、`/`（相對於磁碟／網路根）與本來就是絕對的路徑，
 * 也接受 `%20` 這類 URL 編碼。解析不出來（基準資料夾是空的）時回傳空字串。
 */
export function resolveLocalPath(baseDir: string, reference: string): string {
  const raw = safeDecode(reference.trim().replace(/^file:\/\//i, ""));
  if (!raw) {
    return "";
  }

  const normalized = toBackslashes(raw);
  if (/^[a-zA-Z]:[\\/]/.test(raw) || normalized.startsWith("\\\\")) {
    return normalizeSegments(normalized);
  }
  // 帶 scheme 的網址（http、data…）不是本機路徑，呼叫端應該先處理掉。
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
    return "";
  }

  const base = toBackslashes(baseDir);
  if (!base) {
    return "";
  }

  // 開頭的 `\` 代表「這個磁碟／網路分享的根」，不是相對於目前資料夾。
  const root = normalized.startsWith("\\") ? (rootOf(base) ?? base) : base;
  return normalizeSegments(joinPath(root, normalized.replace(/^\\+/, "")));
}

/** 取磁碟機或網路分享的根（`C:\`、`\\server\share\`）；不是絕對路徑時回 null。 */
function rootOf(path: string): string | null {
  const unc = /^\\\\([^\\]+)\\([^\\]+)/.exec(path);
  if (unc) {
    return `\\\\${unc[1]}\\${unc[2]}\\`;
  }
  const drive = /^([a-zA-Z]):/.exec(path);
  return drive ? `${drive[1]}:\\` : null;
}

/** 收掉 `.` 與 `..`，並把 UNC／磁碟機前綴接回去。 */
function normalizeSegments(path: string): string {
  let prefix = "";
  let rest = path;

  const unc = /^\\\\([^\\]+)\\([^\\]+)/.exec(path);
  if (unc) {
    prefix = `\\\\${unc[1]}\\${unc[2]}`;
    rest = path.slice(unc[0].length);
  } else {
    const drive = /^([a-zA-Z]:)/.exec(path);
    if (drive) {
      prefix = drive[1];
      rest = path.slice(drive[0].length);
    }
  }

  const parts: string[] = [];
  for (const part of rest.split("\\")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  if (!prefix) {
    return parts.join("\\");
  }
  return parts.length ? `${prefix}\\${parts.join("\\")}` : `${prefix}\\`;
}

function safeDecode(value: string): string {
  if (!value.includes("%")) {
    return value;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function appendSegments(base: PathSegment[], root: string, parts: string[]): PathSegment[] {
  let current = root;
  for (const part of parts) {
    current = current.endsWith("\\") ? `${current}${part}` : `${current}\\${part}`;
    base.push({ label: part, path: current });
  }
  return base;
}
