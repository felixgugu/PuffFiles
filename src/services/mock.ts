/**
 * 瀏覽器開發用的假檔案系統。
 *
 * 只在沒有 Tauri 執行環境時啟用，讓 `npm run dev` 能直接在瀏覽器裡開發 UI；
 * 事件順序刻意與 Rust 端的 Channel 串流一致。
 */

import type { DirStreamEvent, DriveInfo, FileEntry, QuickLocation } from "@/types/fs";
import type { ViewerStreamEvent } from "@/types/viewer";
import { fileNameOf, joinPath, parentOf } from "@/utils/path";
import { viewerKindOfPath } from "@/utils/viewer";

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

  const created = mockCreated.get(path.toLocaleLowerCase()) ?? [];
  return [...folders, ...files, ...created];
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

/**
 * 模擬 `read_viewer_file`。
 *
 * Markdown 刻意包含標題、表格、程式碼區塊、相對圖片與相對連結，
 * 這樣在瀏覽器裡就能把檢視器的每個分支走過一遍。
 */
export async function mockReadViewerFile(
  path: string,
  onEvent: (event: ViewerStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  await delay(60);
  if (signal?.aborted) {
    return;
  }

  const kind = viewerKindOfPath(path);
  const name = fileNameOf(path);
  const base = {
    path,
    name,
    size: 0,
    modifiedMs: now,
  };

  if (kind === "image") {
    const svg = mockImageSvg(name);
    const bytes = new TextEncoder().encode(svg);
    onEvent({
      ...base,
      type: "start",
      size: bytes.length,
      encoding: null,
      mime: "image/svg+xml",
    });
    for (let index = 0; index < bytes.length; index += 48 * 1024) {
      await delay(20);
      if (signal?.aborted) {
        return;
      }
      onEvent({
        type: "chunk",
        text: null,
        base64: bytesToBase64(bytes.slice(index, index + 48 * 1024)),
      });
    }
    onEvent({ type: "done" });
    return;
  }

  const text = kind === "markdown" ? mockMarkdown(name) : mockPlainText(name);
  const bytes = new TextEncoder().encode(text);
  onEvent({
    ...base,
    type: "start",
    size: bytes.length,
    encoding: "UTF-8",
    mime: null,
  });
  for (let index = 0; index < text.length; index += 32 * 1024) {
    await delay(20);
    if (signal?.aborted) {
      return;
    }
    onEvent({ type: "chunk", text: text.slice(index, index + 32 * 1024), base64: null });
  }
  onEvent({ type: "done" });
}

function mockMarkdown(name: string): string {
  return `# ${name}

這是**瀏覽器預覽模式**的假 Markdown，用來檢查檢視器的排版。

| 欄位 | 說明 |
| --- | ---: |
| 標題 | 麵包屑與狀態列 |
| 圖片 | 相對路徑會走 IPC 讀取 |

## 清單

1. 第一項
2. 第二項
   - 巢狀項目
   - 另一個巢狀項目

> 引用區塊也會被渲染成獨立的樣式。

## 程式碼

\`\`\`ts
const answer = 42;
\`\`\`

行內 \`程式碼\`、*斜體*、**粗體**、~~刪除線~~，還有自動連結 https://example.com 。

![相對路徑圖片](./photo.png)

[相對連結：notes.txt](./notes.txt)
`;
}

function mockPlainText(name: string): string {
  const lines = [`${name}（瀏覽器預覽模式的假文字檔）`, ""];
  for (let index = 1; index <= 40; index++) {
    lines.push(`${String(index).padStart(2, "0")}｜這是一行測試文字，用來確認等寬字與換行。`);
  }
  return lines.join("\n");
}

/** 用 SVG 假裝一張圖片，讓 Mock 模式也有真的點陣內容可以縮放。 */
function mockImageSvg(name: string): string {
  const hue = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="hsl(${hue} 55% 62%)"/>
  <circle cx="980" cy="180" r="150" fill="hsl(${(hue + 40) % 360} 70% 78%)" opacity="0.7"/>
  <text x="60" y="640" font-family="Segoe UI, sans-serif" font-size="64" fill="white">${name}</text>
</svg>`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** 瀏覽器開發用的假剪貼簿，讓前端流程可以在沒有 Tauri 的情況下走完。 */
let mockClipboard: { paths: string[]; cut: boolean } = { paths: [], cut: false };

export function mockReadClipboard(): { paths: string[]; cut: boolean } {
  return { ...mockClipboard };
}

export function mockWriteClipboard(paths: string[], cut: boolean): void {
  mockClipboard = { paths: [...paths], cut };
}

export function mockClearClipboard(): void {
  mockClipboard = { paths: [], cut: false };
}

/** 瀏覽器預覽用：記住「建立」出來的項目，重新列舉時會出現。 */
const mockCreated = new Map<string, FileEntry[]>();

export function mockCreateEntry(parent: string, name: string, isDir: boolean): string {
  const path = joinPath(parent, name);
  const key = parent.toLocaleLowerCase();
  const entry: FileEntry = {
    name,
    path,
    isDir,
    isSymlink: false,
    isHidden: false,
    isReadonly: false,
    size: 0,
    modifiedMs: Date.now(),
    createdMs: Date.now(),
    extension: isDir || !name.includes(".") ? null : name.split(".").pop()!.toLowerCase(),
  };
  mockCreated.set(key, [...(mockCreated.get(key) ?? []), entry]);
  return path;
}
