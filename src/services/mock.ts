/**
 * 瀏覽器開發用的假檔案系統。
 *
 * 只在沒有 Tauri 執行環境時啟用，讓 `npm run dev` 能直接在瀏覽器裡開發 UI；
 * 事件順序刻意與 Rust 端的 Channel 串流一致。
 */

import type { DirStreamEvent, DriveInfo, FileEntry, QuickLocation } from "@/types/fs";
import { fileNameOf, joinPath, parentOf } from "@/utils/path";

const now = Date.now();

export const MOCK_DRIVES: DriveInfo[] = [
  {
    name: "C:\\",
    mountPoint: "C:\\",
    label: "Windows",
    kind: "fixed",
    totalBytes: 512 * 1024 ** 3,
    availableBytes: 173 * 1024 ** 3,
    isRemovable: false,
  },
  {
    name: "D:\\",
    mountPoint: "D:\\",
    label: "Data",
    kind: "fixed",
    totalBytes: 2048 * 1024 ** 3,
    availableBytes: 902 * 1024 ** 3,
    isRemovable: false,
  },
  {
    name: "E:\\",
    mountPoint: "E:\\",
    label: "USB Drive",
    kind: "removable",
    totalBytes: 64 * 1024 ** 3,
    availableBytes: 12 * 1024 ** 3,
    isRemovable: true,
  },
];

export const MOCK_QUICK_LOCATIONS: QuickLocation[] = [
  { id: "home", label: "本機", path: "C:\\Users\\felix", kind: "home" },
  { id: "desktop", label: "桌面", path: "C:\\Users\\felix\\Desktop", kind: "desktop" },
  { id: "documents", label: "文件", path: "C:\\Users\\felix\\Documents", kind: "documents" },
  { id: "downloads", label: "下載", path: "C:\\Users\\felix\\Downloads", kind: "downloads" },
  { id: "pictures", label: "圖片", path: "C:\\Users\\felix\\Pictures", kind: "pictures" },
  { id: "videos", label: "影片", path: "C:\\Users\\felix\\Videos", kind: "videos" },
];

const FOLDER_NAMES = ["專案", "文件", "下載", "圖片", "音樂", "backup"];
const FILE_NAMES = [
  "readme.md",
  "app.ts",
  "簡報.pdf",
  "財報.xlsx",
  "demo.mp4",
  "photo.png",
  "notes.txt",
  "archive.zip",
  "setup.exe",
  "unknown.dat",
];

export function buildMockEntries(path: string): FileEntry[] {
  const folders: FileEntry[] = FOLDER_NAMES.map((name, index) => ({
    name,
    path: joinPath(path, name),
    isDir: true,
    isSymlink: false,
    isHidden: false,
    isReadonly: false,
    size: 0,
    modifiedMs: now - index * 86_400_000,
    createdMs: now - index * 172_800_000,
    extension: null,
  }));

  const files: FileEntry[] = FILE_NAMES.map((name, index) => {
    const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : null;
    return {
      name,
      path: joinPath(path, name),
      isDir: false,
      isSymlink: false,
      isHidden: name.startsWith("."),
      isReadonly: index % 7 === 0,
      size: 1024 * (index + 1) * 37,
      modifiedMs: now - index * 3_600_000,
      createdMs: now - index * 7_200_000,
      extension,
    };
  });

  return [...folders, ...files];
}

/** 模擬 `list_subdirs`：只回傳資料夾。 */
export function mockListSubdirs(path: string): FileEntry[] {
  return buildMockEntries(path).filter((entry) => entry.isDir);
}

/** 模擬 `list_dir_stream`：分批送出事件，節奏與 Rust 端一致。 */
export async function mockListDirectory(
  path: string,
  onEvent: (event: DirStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  await delay(90);
  if (signal?.aborted) return;

  const entries = buildMockEntries(path);
  onEvent({
    type: "start",
    path,
    name: fileNameOf(path) || path,
    parent: parentOf(path),
  });

  for (let index = 0; index < entries.length; index += 4) {
    await delay(30);
    if (signal?.aborted) return;
    onEvent({ type: "batch", entries: entries.slice(index, index + 4) });
  }

  onEvent({ type: "done", total: entries.length, truncated: false });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
