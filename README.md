# PuffFile

極致輕量、現代高效的 Windows 檔案總管。Tauri 2 雙層解耦架構：Rust 原生後端核心 + WebView2 前端 UI。

## 技術棧

| 層 | 技術 |
| --- | --- |
| 桌面框架 | Tauri 2.12 |
| 後端 | Rust（edition 2024）、Tokio、thiserror 2、sysinfo 0.39 |
| 前端 | Vue 3.5（Composition API / `<script setup>`）、TypeScript 6 |
| 建置 | Vite 8（Rolldown）、vue-tsc 3 |
| 樣式 | Tailwind CSS 4（CSS-first `@theme`） |
| 狀態 | Pinia 4 setup stores |

## 開發指令

```bash
npm install
npm run tauri dev            # 桌面應用程式（先起 Vite，再編譯 Rust）
npm run dev                  # 只跑前端，瀏覽器預覽模式（自動使用 Mock 資料）
npm run build                # vue-tsc 型別檢查 + Vite production build
cd src-tauri; cargo test     # 後端單元測試
```

> **Node 版本注意**：Vite 8 官方要求 Node `^20.19.0 || >=22.12.0`，目前機器是 20.17.0。
> 實測 dev server、production build、Tauri 編譯皆可運作，但 Vite 會印出升級提醒；
> 建議升級到 Node 24 LTS，以免踩到未支援的邊界情況。
>
> 若刪除 `node_modules` 重新安裝後出現 `Cannot find native binding`，表示 npm 因為引擎版本
> 不符而略過了 Rolldown 的 Windows 原生套件，補裝即可（升級 Node 後就不會發生）：
>
> ```bash
> npm install @rolldown/binding-win32-x64-msvc --no-save --force
> ```

## 目前功能（基本款）

- **側邊欄**：快速存取（本機／桌面／文件／下載／圖片／音樂／影片）＋ 磁碟機清單（含使用率與可用空間）。
- **導覽工具列**：上一頁／下一頁／上一層／重新整理、可點擊的麵包屑路徑、搜尋、新增資料夾、在檔案總管中顯示。
- **檔案列表**：名稱／修改日期／類型／大小四欄，可點欄位排序（資料夾永遠優先），依類型自動配圖示與顏色。
- **選取**：單選、Ctrl 多選、Shift 連選、Ctrl+A 全選、Esc 取消、方向鍵移動焦點。
- **開檔**：雙擊或 Enter 進入資料夾／以預設程式開啟檔案；右鍵選單可開啟、在檔案總管中顯示、複製路徑。
- **快速鍵**：F5 重新整理、Backspace 上一層、Alt+← / Alt+→ 上／下一頁、Ctrl+F 搜尋、Ctrl+L 輸入路徑。
- **深／淺色主題**：跟隨系統或手動切換，設定保存在 localStorage。

## 架構重點

- **IPC 隔離**：UI 不直接呼叫 `invoke`，一律經過 `src/services/api.ts`；沒有 Tauri 環境時自動降級為 Mock，因此 `npm run dev` 就能在瀏覽器開發 UI。
- **串流列舉**：後端以 Tauri 2 的 `Channel` 分批推送目錄內容（`start` → `batch`* → `done`），超大資料夾邊讀邊顯示。
- **統一錯誤處理**：後端 `AppError`（thiserror）序列化為 `{ kind, message, path }`，前端以 `normalizeBackendError` 轉成一致的錯誤畫面。
- **狀態單一真實來源**：跨組件狀態集中在 Pinia stores，元件只讀取狀態與觸發 action。
- **純函數工具層**：`utils/` 不依賴 Vue 或 IPC，可獨立測試。

## 後續可做

- 檔案操作：複製／剪下／貼上／重新命名／刪除（資源回收筒）。
- 檢視模式切換（大圖示／並排／詳細資料）與清單虛擬化（目前一次渲染所有項目）。
- 分頁、書籤、最近使用位置，以及拖放（drag & drop）搬移檔案。
- 檔案預覽窗格與內容搜尋。
