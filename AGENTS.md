# PuffFile 專案架構地圖 (AGENTS.md)

## 1. 專案簡介與技術棧
- **用途**：極致輕量、現代高效的 檔案總管。
- **核心架構**：Tauri v2 雙層解耦架構（Rust 原生後端核心 + WebView2 前端 UI）。
- **前端技術棧**：Vue 3 (Composition API / `<script setup>`)、TypeScript 6、Vite 8、Tailwind CSS。
- **前端核心庫**：Pinia 3 (狀態管理)。
- **後端技術棧**：Rust 2021、Tokio (非同步執行期)。

## 2. 目錄結構與職責

```
PuffFiles/
├─ index.html                  # Vite 進入點
├─ vite.config.ts              # Vue + Tailwind 4（CSS-first）外掛、@ 別名、Tauri 專用 server 設定
├─ tsconfig.json               # TS 6 strict；路徑別名 @/* -> src/*
├─ src/                        # 前端（Vue 3.5 + TypeScript）
│  ├─ main.ts                  # 建立 App、掛載 Pinia、載入全域樣式
│  ├─ App.vue                  # 只負責掛上 AppShell
│  ├─ assets/styles/main.css   # Tailwind 4 進入點：@theme 設計權杖、.dark 覆寫、@utility
│  ├─ types/fs.ts              # 與 Rust model.rs 一對一的前端型別
│  ├─ services/                # 唯一 IPC 邊界
│  │  ├─ api.ts                # invoke/Channel 封裝；無 Tauri 時自動降級 Mock
│  │  ├─ mock.ts               # 瀏覽器開發用的假檔案系統（事件順序同 Rust 端）
│  │  ├─ errors.ts             # BackendError 與 normalizeBackendError
│  │  └─ clipboard.ts          # 剪貼簿（含 WebView 相容降級）
│  ├─ stores/                  # Pinia 4 setup stores（狀態唯一真實來源）
│  │  ├─ explorer.ts           # 路徑、項目、選取、排序、瀏覽歷史
│  │  ├─ system.ts             # 磁碟機、快速存取位置
│  │  └─ ui.ts                 # 主題、通知、跨組件焦點請求
│  ├─ composables/             # 可重用行為（useKeyboardShortcuts）
│  ├─ components/
│  │  ├─ layout/               # AppShell、AppHeader、StatusBar
│  │  ├─ sidebar/              # SidebarNav（快速存取 + 磁碟機）
│  │  ├─ toolbar/              # NavToolbar、PathBreadcrumb
│  │  ├─ files/                # FileTable、FileTableRow
│  │  └─ common/               # AppIcon、SearchField、PromptDialog 等
│  └─ utils/                   # 無副作用純函數（path / format / fileKind）
└─ src-tauri/                  # 後端（Rust 2024）
   ├─ tauri.conf.json          # 視窗、bundle、圖示設定
   ├─ capabilities/default.json # 權限（core:default、opener:default）
   └─ src/
      ├─ main.rs               # Windows 子系統設定 + 呼叫 lib::run
      ├─ lib.rs                # Builder、外掛註冊、invoke_handler 清單
      ├─ error.rs              # AppError（thiserror）+ 自訂 Serialize 為 {kind,message,path}
      ├─ model.rs              # FileEntry / DirListing / DirEvent / DriveInfo / QuickLocation
      ├─ core/dir.rs           # 不依賴 Tauri 的目錄列舉核心（含單元測試）
      └─ commands/
         ├─ fs.rs              # list_dir_stream、create_folder、open_path、reveal_path
         └─ system.rs          # list_drives、quick_locations
```

- **邊界規則**：`commands/` 只做參數驗證與呼叫 `core/`；與 WebView 無關的邏輯放在 `core/`，才能獨立測試。

## 3. 核心資料流向

**載入資料夾（串流）**

1. 使用者在 UI 觸發導覽 → `stores/explorer.ts` 的 `load()`（會先中止前一個請求）。
2. `services/api.ts` 建立 `Channel<DirStreamEvent>` 並 `invoke("list_dir_stream")`。
3. Rust 端在 `spawn_blocking` 讀取目錄（不阻塞 UI 執行緒），排序後以每批 256 筆推送事件。
4. 事件序列：`start`（切換標題與上層路徑）→ `batch`*（累積列項目）→ `done`（總數、是否截斷）。
5. store 收到 `batch` 時以 `shallowRef` + `triggerRef` 更新，避免大量項目建立響應式代理。
6. `visibleEntries` 依搜尋字串、隱藏項目與排序條件計算出畫面資料；元件只讀不寫。

**錯誤流**

Rust `AppError` →（Serialize）`{ kind, message, path }` → `toBackendError()` → `normalizeBackendError()` → store 的 `error` → `ErrorBanner` 顯示。

**為什麼用 Channel 而不是一次回傳整個陣列**

超大資料夾若等掃描完才回傳，UI 會長時間空白；串流讓項目邊讀邊出現，也讓前端能在換路徑時中止過期請求（AbortController 停止接收事件）。

## 4. 開發與修改規範
- **模組職責與行數控制**：單一程式碼檔案行數建議控制在 400 行以內；若邏輯膨脹應拆分為 Composables、子組件或 Utils 工具函數。
- **IPC 隔離與 Web 相容**：UI 組件嚴禁直接呼叫 `@tauri-apps/api` 的 `invoke`，一律經由 `services/` 封裝；所有 IPC 呼叫需在 `api.ts` 提供 Mock 降級以支援瀏覽器開發。
- **統一錯誤處理規範**：後端統一採用 `AppError`（基於 `thiserror`）列舉型別回傳；前端一律透過 `normalizeBackendError` 統一轉譯，嚴禁未捕獲的 Promise 拋錯或靜默吞沒異常。
- **狀態單一真實來源 (SSOT)**：視窗層與跨組件狀態必須由 Pinia Stores（`stores/`）統一管理，禁止跨組件任意深層 Prop Drilling 或直接修改外部非自身負責之狀態。
- **無副作用與模組邊界**：`utils/` 必須維持無副作用的純函數，不依賴 Vue 響應式狀態或後端 IPC；後端 `drivers/` 專注 TDS 通訊協定，禁止依賴 Tauri IPC 命令邏輯。
