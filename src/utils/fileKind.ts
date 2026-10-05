import type { IconName } from "@/components/common/icons";
import type { FileEntry } from "@/types/fs";

export type FileKindId =
  | "folder"
  | "image"
  | "video"
  | "audio"
  | "archive"
  | "code"
  | "text"
  | "document"
  | "sheet"
  | "program"
  | "file";

const EXTENSIONS: Record<FileKindId, readonly string[]> = {
  folder: [],
  image: ["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "ico", "avif", "heic", "tif", "tiff", "psd"],
  video: ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpg", "mpeg", "ts"],
  audio: ["mp3", "wav", "flac", "aac", "ogg", "m4a", "wma", "opus", "aiff"],
  archive: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "cab", "zst"],
  code: [
    "ts", "tsx", "js", "jsx", "mjs", "cjs", "vue", "rs", "py", "java", "c", "cc", "cpp", "h", "hpp",
    "cs", "go", "rb", "php", "swift", "kt", "html", "htm", "css", "scss", "json", "yaml", "yml", "toml",
    "xml", "sql", "sh", "ps1", "bat", "cmd",
  ],
  text: ["txt", "md", "log", "ini", "cfg", "conf", "env", "gitignore"],
  document: ["doc", "docx", "odt", "rtf", "pdf", "epub", "pages"],
  sheet: ["xls", "xlsx", "csv", "tsv", "ods", "numbers"],
  program: ["exe", "msi", "dll", "sys", "com", "appx", "msix"],
  file: [],
};

const LABELS: Record<FileKindId, string> = {
  folder: "資料夾",
  image: "影像",
  video: "影片",
  audio: "音樂",
  archive: "壓縮檔",
  code: "程式碼",
  text: "文字文件",
  document: "文件",
  sheet: "試算表",
  program: "應用程式",
  file: "檔案",
};

/** 圖示與色系刻意分開定義，讓深／淺色主題各自微調。 */
const PRESENTATION: Record<FileKindId, { icon: IconName; color: string }> = {
  folder: { icon: "folder", color: "text-amber-500" },
  image: { icon: "image", color: "text-emerald-500" },
  video: { icon: "video", color: "text-fuchsia-500" },
  audio: { icon: "music", color: "text-violet-500" },
  archive: { icon: "archive", color: "text-orange-500" },
  code: { icon: "code", color: "text-sky-500" },
  text: { icon: "text", color: "text-slate-500" },
  document: { icon: "document", color: "text-blue-500" },
  sheet: { icon: "document", color: "text-green-600" },
  program: { icon: "program", color: "text-rose-500" },
  file: { icon: "file", color: "text-slate-400" },
};

const LOOKUP = new Map<string, FileKindId>();
for (const [kind, extensions] of Object.entries(EXTENSIONS) as [FileKindId, readonly string[]][]) {
  for (const extension of extensions) {
    LOOKUP.set(extension, kind);
  }
}

export function fileKindOf(entry: Pick<FileEntry, "isDir" | "extension">): FileKindId {
  if (entry.isDir) {
    return "folder";
  }
  if (!entry.extension) {
    return "file";
  }
  return LOOKUP.get(entry.extension) ?? "file";
}

export function iconFor(entry: Pick<FileEntry, "isDir" | "extension" | "isSymlink">): IconName {
  if (entry.isSymlink) {
    return "link";
  }
  if (entry.isDir) {
    return PRESENTATION.folder.icon;
  }
  return PRESENTATION[fileKindOf(entry)].icon;
}

export function colorFor(entry: Pick<FileEntry, "isDir" | "extension">): string {
  return PRESENTATION[fileKindOf(entry)].color;
}

/** 用於「類型」欄位，例如 `PNG 影像`、`資料夾`。 */
export function kindLabel(entry: Pick<FileEntry, "isDir" | "extension">): string {
  const kind = fileKindOf(entry);
  const label = LABELS[kind];
  if (kind === "folder" || !entry.extension) {
    return label;
  }
  return `${entry.extension.toUpperCase()} ${label}`;
}
