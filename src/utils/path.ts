import type { PathSegment } from "@/types/fs";

/** 僅處理 Windows 路徑形態（`C:\...`、`\\server\share\...`）。 */

export function toBackslashes(path: string): string {
  return path.replace(/\//g, "\\");
}

export function isDriveRoot(path: string): boolean {
  return /^[a-zA-Z]:\\?$/.test(path);
}

export function isUncRoot(path: string): boolean {
  return /^\\\\[^\\]+\\[^\\]+\\?$/.test(path);
}

export function isRoot(path: string): boolean {
  return isDriveRoot(path) || isUncRoot(path);
}

/** 取路徑最後一段，做為標題或名稱使用。 */
export function fileNameOf(path: string): string {
  const normalized = toBackslashes(path).replace(/\\+$/, "");
  const index = normalized.lastIndexOf("\\");
  return index === -1 ? normalized : normalized.slice(index + 1);
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

function appendSegments(base: PathSegment[], root: string, parts: string[]): PathSegment[] {
  let current = root;
  for (const part of parts) {
    current = current.endsWith("\\") ? `${current}${part}` : `${current}\\${part}`;
    base.push({ label: part, path: current });
  }
  return base;
}
