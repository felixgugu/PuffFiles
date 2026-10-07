# PuffFile 專案架構地圖 (AGENTS.md)

## 1. 專案簡介與技術棧

- **用途**：極致輕量、現代高效的 Windows 檔案總管。定位**不是**取代檔案總管，而是解決
  「每天工作時不斷反覆進出同幾個資料夾」——左側「我的資料夾」、分頁與分割、可自訂的右鍵選單。
- **核心架構**：Tauri v2 雙層解耦架構（Rust 原生後端核心 + WebView2 前端 UI）。
- **前端技術棧**：Vue 3.5（Composition API / `<script setup>`）、TypeScript 6、Vite 8（Rolldown）、
  Tailwind CSS 4（CSS-first `@theme`）。
- **前端核心庫**：Pinia 4 setup stores（狀態管理）。
- **後端技術棧**：Rust edition 2024、Tokio、thiserror 2、sysinfo、windows-rs（Shell／剪貼簿／目錄監控）。
- **打包**：`npm run build:portable`（＝ `tauri build --no-bundle`）或 `build-portable.ps1`，
  產出單檔免安裝的 `dist-portable\PuffFile.exe`。

## 2. 目錄結構與職責

```
PuffFiles/
├─ index.html                  # Vite 進入點
├─ vite.config.ts              # Vue + Tailwind 4（CSS-first）外掛、@ 別名、Tauri 專用 server 設定
├─ tsconfig.json               # TS 6 strict；路徑別名 @/* -> src/*
├─ build-portable.ps1          # 單檔免安裝版打包（UTF-8 with BOM）
├─ src/                        # 前端（Vue 3.5 + TypeScript）
│  ├─ main.ts                  # 建立 App、掛載 Pinia、載入全域樣式
│  ├─ App.vue                  # 只負責掛上 AppShell
│  ├─ assets/styles/main.css   # Tailwind 4 進入點：@theme 設計權杖、.dark 覆寫、@utility
│  ├─ types/                   # fs.ts（與 Rust model.rs 對應）、menu.ts（選單列）、tools.ts（外部工具）
│  ├─ services/                # 唯一 IPC 邊界
│  │  ├─ api.ts                # invoke/Channel 封裝；無 Tauri 時自動降級 Mock
│  │  ├─ mock.ts               # 瀏覽器開發用的假檔案系統（事件順序同 Rust 端）
│  │  ├─ errors.ts             # BackendError 與 normalizeBackendError
│  │  ├─ storage.ts            # localStorage 的唯一存取點（readJson / writeJson）
│  │  ├─ clipboard.ts          # 文字剪貼簿（含 WebView 相容降級）
│  │  └─ window.ts             # 無邊框視窗控制
│  ├─ stores/                  # Pinia 4 setup stores（狀態唯一真實來源）
│  │  ├─ explorer.ts           # 每個窗格的路徑、項目、選取、排序、欄寬、瀏覽歷史
│  │  ├─ tabs.ts               # 分頁與分割版面、窗格生命週期、工作階段還原
│  │  ├─ folders.ts            # 左側「我的資料夾」清單（含虛擬目錄、順序、展開狀態）
│  │  ├─ clipboard.ts          # 剪下／複製／貼上／刪除／重新命名、送到另一窗格、忙碌狀態
│  │  ├─ history.ts            # 瀏覽紀錄（MRU，含分割版面）
│  │  ├─ settings.ts           # 主題、欄位、外部工具、動態效果、樹寬、上次分割
│  │  ├─ system.ts             # 磁碟機、快速存取位置（只用於啟動時的起始路徑）
│  │  ├─ viewer.ts             # 檢視器：內容讀取、圖片 blob URL、外部變更自動重載
│  │  └─ ui.ts                 # 通知、確認／輸入對話框、焦點請求、浮層開關
│  ├─ composables/
│  │  ├─ useKeyboardShortcuts.ts # 全域快速鍵（分頁、分割、剪貼簿、檔案操作）
│  │  ├─ usePathMenu.ts        # 右鍵選單的內容與動作（依選取情境分流、外部工具篩選）
│  │  ├─ useDragGesture.ts     # 通用拖曳手勢（含速度取樣，交給彈簧接手）
│  │  ├─ useSpringValue.ts     # 以自製彈簧驅動的數值
│  │  └─ useRefreshView.ts     # 重新整理（清單＋資料夾樹）
│  ├─ components/
│  │  ├─ chrome/               # 無邊框標題列：WindowChrome、TabStrip、ChromeActions、WindowControls
│  │  ├─ layout/               # AppShell、StatusBar
│  │  ├─ workspace/            # 工作區：WorkspaceView（樹面板＋窗格區）、BrowserPane（窗格）
│  │  ├─ tree/                 # 資料夾樹面板：FolderTreePanel、FolderTreeNode（「我的資料夾」樹）
│  │  ├─ toolbar/              # TabToolbar（每個分頁一條路徑列）、PathBreadcrumb
│  │  ├─ files/                # FileListView（虛擬滾動＋選取）、FileTableRow
│  │  ├─ viewer/               # ViewerPane、MarkdownView、ImageView、TextView
│  │  ├─ settings/             # SettingsView、ToolsSettings（整頁設定）
│  │  ├─ overlays/             # ContextMenu、HistoryPanel
│  │  └─ common/               # AppIcon（含 icons.ts 內嵌圖示集）、PromptDialog、ConfirmDialog 等
│  └─ utils/                   # 無副作用純函數（path / format / fileKind / markdown / spring / viewer …）
├─ tools/make-icons.py         # 由 icon-source.png 產生 icon.ico（16/24/32/48 用簡化版頭像）
├─ docs/redesign-plan.md       # 設計與取捨的完整記錄（含未完成項）
└─ src-tauri/                  # 後端（Rust 2024）
   ├─ tauri.conf.json          # 視窗、bundle、圖示設定
   ├─ capabilities/default.json # 權限（core:default、opener:default）
   └─ src/
      ├─ main.rs               # Windows 子系統設定 + 呼叫 lib::run
      ├─ lib.rs                # Builder、外掛註冊、invoke_handler 清單
      ├─ error.rs              # AppError（thiserror）+ 自訂 Serialize 為 {kind,message,path}
      ├─ model.rs              # FileEntry / DirListing / DirEvent / ViewerEvent / DriveInfo / QuickLocation
      ├─ core/                 # 不依賴 Tauri 的核心邏輯（可獨立測試）
      │  ├─ dir.rs             # 目錄列舉、路徑正規化、display_path
      │  ├─ shell.rs           # IFileOperation 檔案操作（複製／搬移／刪除／重新命名）、CF_HDROP 剪貼簿
      │  ├─ watch.rs           # ReadDirectoryChangesW 目錄監控
      │  ├─ viewer.rs          # 檢視器：文字編碼偵測、圖片 MIME、分批切塊
      │  └─ oplog.rs           # 檔案操作紀錄（%LOCALAPPDATA%\PuffFile\logs）
      └─ commands/
         ├─ fs.rs              # list_dir_stream、list_subdirs、建立資料夾／檔案、外部工具、reveal
         ├─ viewer.rs          # read_viewer_file：把檔案內容分批串流給檢視器
         ├─ shell.rs           # 剪貼簿讀寫、複製／搬移／刪除／重新命名、操作紀錄
         ├─ watch.rs           # 目錄監控的啟動／停止
         └─ system.rs          # list_drives、quick_locations
```

- **邊界規則**：`commands/` 只做參數驗證與呼叫 `core/`；與 WebView 無關的邏輯放在 `core/`，才能獨立測試。

## 3. 核心資料模型與流向

### 3.1 載入資料夾（串流）

1. 使用者在 UI 觸發導覽 → `stores/explorer.ts` 的 `load()`（會先中止前一個請求）。
2. `services/api.ts` 建立 `Channel<DirStreamEvent>` 並 `invoke("list_dir_stream")`。
3. Rust 端在 `spawn_blocking` 讀取目錄（不阻塞 UI 執行緒），排序後以每批 256 筆推送事件。
4. 事件序列：`start`（切換標題與上層路徑）→ `batch`*（累積列項目）→ `done`（總數、是否截斷）。
5. store 收到 `batch` 時以 `shallowRef` + `triggerRef` 更新，避免大量項目建立響應式代理。
6. `visibleEntries` 依搜尋字串、隱藏項目與排序條件計算出畫面資料；元件只讀不寫。

目錄變更由 `core/watch.rs`（ReadDirectoryChangesW）推送，前端以**增量**套用（插入／移除／就地更新），
不重讀整份清單；只有通知溢位時才退回整份重讀。

### 3.2 我的資料夾（含虛擬目錄）

`stores/folders.ts` 是左側清單的唯一真實來源，資料形狀：

```ts
interface FolderNode {
  id: string;
  label: string;
  kind: "folder" | "group"; // group＝虛擬目錄，純分組、沒有實體路徑
  path?: string;            // 只有 folder 有
  children?: FolderNode[];  // 只有 group 有，內容只能是 folder
}
```

- **只允許兩層**：第一層可混搭虛擬目錄與真實資料夾，虛擬目錄裡只能是真實資料夾。
- **容器（container）以 id 識別**：第一層是 `TREE_ROOT_CONTAINER`（空字串），其餘是群組的節點 id。
- **拖曳只在同一個容器內排序**（`moveNode(containerId, from, to)`）；搬進虛擬目錄走右鍵
  「移動到虛擬目錄…」→ `moveNodeToGroup(nodeId, groupId)`。
- **排序範圍＝選取節點所在的那一層**（`sortNodes(containerId)`），用
  `Intl.Collator("zh-Hant", { numeric: true })`。沒有選取時退回焦點窗格路徑所屬的那一層。
- **展開狀態分開存**：真實資料夾存路徑（`expanded`），虛擬目錄存節點 id（`expandedGroups`）。
  `reveal(path)` 會先展開所在的群組再展開沿路資料夾；`collapseAll()` 兩者都清。
- **展開／收合只由節點左邊的箭頭圖示控制**：點節點名稱只選取（真實資料夾會一併導覽），
  不會展開或收合；虛擬目錄沒有實體路徑，選取後就結束。
- **窗格瀏覽不會自動展開樹**：切換窗格路徑只讓樹跟著高亮（`selectByPath`），不呼叫
  `reveal()`。唯一的自動展開是樹工具列的「定位」；加入資料夾只會打開所在的虛擬目錄
  （`reveal(path, { expandTarget: false })`），不會展開新資料夾本身。
- **選取以節點 id 為準**（`activeId`，因為群組沒有路徑）；檔案系統的子資料夾不在清單上，
  用路徑當鍵，`selectedNode()` 對它們會回 `null`（呼叫端再用 `folderNodeFor(path)` 回推）。
- **全樹去重**：同一個實體路徑只會出現一次（`addFolder` 會擋，大小寫不敏感）。
- 持久化於 `pufffile:folders`（`{ roots, expanded, expandedGroups }`）；舊格式（沒有 `kind`／`id`）
  讀取時自動補齊，不需要遷移程式。

### 3.3 錯誤流

Rust `AppError` →（Serialize）`{ kind, message, path }` → `toBackendError()` →
`normalizeBackendError()` → store 的 `error` → `ErrorBanner`／通知顯示。

**為什麼用 Channel 而不是一次回傳整個陣列**：超大資料夾若等掃描完才回傳，UI 會長時間空白；
串流讓項目邊讀邊出現，也讓前端能在換路徑時中止過期請求（AbortController 停止接收事件）。

### 3.4 右鍵選單

內容集中在 `composables/usePathMenu.ts`：`menuFor(request, options)` 依「選取情境」決定項目
（清單空白處／單一資料夾／單一檔案／多選），`run(id, request, options)` 負責執行
（`options.keepFocus` 只影響資料夾的 `open-pane`，供檔案清單的 `Space` 預覽使用，見 §3.5）。
`request.target` 是右鍵的那一項，`request.targets` 是這次真正會作用的項目。

`MenuOptions` 決定要不要加入剪貼組（剪下／複製／貼上／刪除）與重新命名：
檔案清單的一般右鍵選單**不含**這一組，按住 **Shift 再右鍵**才顯示（「擴充選單」）；
空白處的擴充選單只提供「貼上」（剪下／複製／刪除會作用在目前這個資料夾本身，不提供）。
左側資料夾樹是書籤清單、不直接操作實體檔案，因此不顯示剪貼組，也不提供重新命名。
「重新命名」由 `FileListView` 攔截選單 id `rename` 與 F2 就地編輯，不經過 `run()`，見 §3.6。
外部工具依 `toolMatches()`（顯示於檔案／資料夾、副檔名篩選）過濾；樹的節點選單另外由
`FolderTreePanel` 組（虛擬目錄的三項動作、真實資料夾的「移動到虛擬目錄…」）。

「複製到另一窗格／移動到另一窗格」執行前會以 `ui.confirm` 彈窗，訊息列出**來源窗格與
路徑**、**目標窗格與路徑**以及會作用的項目數量與名稱，按確定才動手 —— 避免左右／上下
方向搞錯（見 `stores/clipboard.ts` 的 `transferMessage()`）。

### 3.5 檢視器（Viewer）

檢視器是**窗格內容模式之一**，不是第三種版面：窗格預設顯示檔案清單，被檢視器佔用時
改顯示內容，關閉後回到同一個資料夾的清單。狀態住在 `stores/viewer.ts`（以 PaneId 為鍵），
與 `explorer` 的瀏覽狀態分開，但生命週期綁在一起：

- **入口**：`usePathMenu` 對支援的檔案加上 `open-pane`（單一窗格＝「在新窗格開啟」，
  分割時＝「在○窗格開啟」，說法與資料夾一致）。未分割時 `tabs.split()` 建立的新窗格
  沿用來源窗格的資料夾，檢視器再疊上去；已分割時直接把內容開在相鄰窗格。
  **焦點一律留在原本的檔案清單**（連續用方向鍵＋`Space` 快速換檔案預覽）；
  點進檢視器窗格才會把焦點移過去（Esc、文字選取複製、Ctrl+W 等才作用在它身上）。
- **支援範圍**：`.md／.markdown`（`utils/markdown.ts` 渲染）、`.html／.htm`（靜態預覽，見下）、
  WebView2 能解的圖檔（`VIEWER_IMAGE_EXTENSIONS`）、以及 `fileKind.ts` 歸類為
  `text`／`code` 的純文字檔。**沒有檢視器的類型**（`.pdf`／`.mp4`／`.exe`…）不會讀取內容，
  但仍會佔用窗格並顯示「這個檔案類型還沒有檢視器」——`ViewerState.kind` 為 `null`，
  `open()` 不呼叫 `load()`、標頭的重整鈕不出現；它仍是「目前顯示的目標」，供 `Space` 判斷前進。
- **語法高亮**：`utils/codeHighlight.ts` 用 highlight.js（`lib/common` ＋精選語言，**不匯入
  全量 193 種**）替 `fileKind.ts` 的「程式碼」類上色，Markdown 的圍籬區塊與 HTML 的原始碼
  模式共用同一條；顏色是 `main.css` 的 `--color-syntax-*` 權杖（淺／深色各一組）。
  超過 `MAX_HIGHLIGHT_BYTES`（1 MB）就整份當純文字並顯示提示 —— highlight.js 是同步 API，
  丟大檔進去會凍住 UI。
- **目錄索引（Markdown）**：檢視器標頭的目錄鈕切換右上角的浮動面板（預設開啟）。
  `utils/markdown.ts` 替每個 h1～h6 產生文件內唯一的 id 並回傳 `headings`；面板依層級
  縮排列出標題、捲動內文時同步高亮目前章節，點項目或文件內的 `[文字](#標題)` 都會捲到
  該行。面板可拖曳、可調整寬高、可收合成只剩標題列，左下角把手往外拖＝放大；
  底色不透明度（預設 50%）與最小寬度（預設 200px）在設定頁的「瀏覽 → 檢視器」調整
  （`settings.viewerPanelOpacity`／`viewerPanelMinWidth`，兩種浮動面板共用）。
  **面板的收合、位置與尺寸不持久化、也不跨文件沿用**：住在 `ViewerState.tocPanel`
  （每個檢視器一份），開啟新文件一律回到預設（展開、`x === null` 維持右上角對齊、
  預設寬度與自適應高度）。文件沒有標題、或窗格窄於「最小寬度＋兩側留白」時面板自動隱藏，
  標頭開關維持可見但反灰停用；兩個窗格同時開 Markdown 時各自渲染，DOM 查詢限定在自己的內容根節點。
- **搜尋（所有文字類檢視器）**：檢視器標頭的搜尋鈕或 `Ctrl+F` 開關右上角的浮動面板，
  面板本身是每個窗格各自的狀態（預設關閉）。搜尋的是**畫面上看得到的文字**：
  Markdown 渲染後的內容、純文字與程式碼（含 HTML 原始碼模式）、HTML 靜態預覽 iframe
  內的頁面文字。大小寫、完整字詞、Regex 三個選項預設全關，輸入即時搜尋（去抖 150ms）；
  命中清單顯示「目前索引／總數」與命中所在的行（純文字／程式碼，含行號）或區塊
  （渲染後的內容），`Enter`／`Shift+Enter` 上下一個、點列直接跳，內文同步標示全部命中
  與目前命中。內容超過 4 MB 停用搜尋、命中超過 2000 筆只列前段，兩者都會在面板上說明。
  **搜尋條件預設不跨文件沿用**：開啟新文件會整份回到預設（面板關閉、字串與三個選項清空）；
  面板上的「**保留搜尋字串**」勾選項（`settings.viewerSearchKeepQuery`，持久化、預設不勾）
  勾選後才與現行相同 —— 同一個窗格換檔案沿用搜尋條件、面板維持開啟。
  **面板的收合、位置與尺寸同樣不持久化、也不跨文件沿用**：住在 `ViewerState.searchPanel`，
  開啟新文件回到預設；最小寬度與不透明度與目錄索引共用。
- **HTML 靜態預覽**：`HtmlView` 以 `iframe[srcdoc]` 呈現，`sandbox` 只給 `allow-same-origin`
  （不給 `allow-scripts`）—— 頁面**不執行 JavaScript**、**不載入 http(s) 遠端資源**；
  `utils/html.ts` 先移除 `<script>`／`<base>`／meta refresh／`on*`，再由父層進入
  `contentDocument` 把相對路徑的圖片、外部 CSS 與 CSS 內的 `url()`／`@import` 換成
  經 IPC 讀取的 blob URL。標頭的切換鈕在「預覽／原始碼」之間切換（`ViewerState.mode`），
  預設是預覽；有 `<script>` 或略過的資源時在內容上方顯示提示條。
- **Mermaid**：` ```mermaid ` 區塊**預設自動渲染成內嵌 SVG**（官方 mermaid 12、lazy 載入），
  每個區塊標題列可「圖表／原始碼」各自切換、複製原始碼、另存 PNG。實作在
  `composables/useMarkdownMermaid.ts`：在內容進 DOM 之後後處理，`utils/markdown.ts`
  維持零依賴純函式。原始碼 > 200 KB 或整份圖表 > 50 個只顯示原始碼，渲染失敗保留
  原始碼並顯示原因；搜尋會跳過圖表模式下收起的原始碼（`[data-search-skip]`）；
  `settings.mermaidEnabled` 可整份關閉自動渲染。評估與實測數字見 `docs/redesign-plan.md` §11。
- **PDF**：不進檢視器（`.pdf` 屬 `document` 類），交給系統預設程式。內嵌 WebView2 PDF
  viewer 的評估（含 wry 預設 `--disable-features=…,msPdfOOUI` 這個關鍵事實）見
  `docs/redesign-plan.md` §11，決議同為先不做。
- **渲染保證**：`utils/markdown.ts` 是零依賴的純函數；每一輪區塊解析都保證往前推進
  （避免卡死），任何例外都會退回「警告＋原始文字」。**檢視器永遠不會只留一片空白**：
  內容為空但檔案有大小時，store 會直接顯示讀取錯誤。
- **讀取**：`services/api.ts` 的 `readViewerFile` → 後端 `read_viewer_file`
  （`core/viewer.rs`）。文字回編碼後的字串片段（UTF-8 → Big5／GBK → lossy），
  圖片回 base64 片段（每塊 3 的倍數，可直接串接）；**不設大小上限**。
- **關閉時機**：Esc、標頭關閉鈕、窗格被銷毀、以及任何「使用者主動換位置」的導覽
  （`explorer.navigate／goBack／goForward／goUp`）。清單類的重新整理（剪貼簿完成後的
  `refreshPanes`）刻意不關閉檢視器。
- **自動重載**：開啟後以 `viewer:<paneId>` 為 id 監控檔案所在資料夾（與窗格的監控
  完全隔離），只有這個檔案的事件才去抖 250ms 後重載；刪除時顯示錯誤狀態。
- **快速鍵**：焦點在檢視器窗格時，清單類快速鍵一律不攔截（文字要能選取複製），
  只保留 Esc（關閉，搜尋面板開著時先關面板）、F5（重新載入）、Ctrl+F（搜尋面板開關）、
  F6 與分頁／版面層級的操作。
  在檔案清單按 `Space`＝把焦點列的項目顯示到另一窗格（走右鍵 `open-pane` 同一條路徑，
  但帶 `keepFocus`）：資料夾在新窗格開成一般清單、檔案開檢視器（沒有檢視器的類型顯示
  「這個檔案類型還沒有檢視器」的提示，仍佔用該窗格），**焦點一律留在原清單**，才能連續
  用方向鍵＋`Space` 掃描。
  **智慧前進**：焦點項目若已經顯示在另一窗格（檔案在檢視器、或資料夾正是另一窗格目前
  瀏覽的位置，`useKeyboardShortcuts.ts` 的 `isDisplayedInNeighbor`），按 `Space` 會自動
  前進到清單的下一列（不分類型，資料夾與沒有檢視器的檔案都算），焦點與選取一起移動；
  已經是最後一列時停在原地、不做任何事。
- **外觀**：檢視器窗格不套用未使用窗格的淡化（`pane-inactive`）—— 淡化是給沒有焦點的
  檔案清單用的，檢視器是「旁邊的顯示區」，任何時候都維持正常對比。
- 檢視器是唯讀的：不寫操作紀錄、不編輯、不儲存。

### 3.6 重新命名（就地編輯，僅檔案清單）

重新命名是**檔案清單**的功能，資料夾樹與檢視器都不提供：

- **入口**：Shift+右鍵的擴充選單「重新命名」，或焦點在清單時按 **F2**
  （`ui.renameRequest` 計數器 → `FileListView` 對焦點列開始編輯）。
- **就地編輯**：`FileTableRow` 在名稱欄換成輸入框；檔案的初始選取範圍只到主檔名
  （最後一個句點之前），資料夾全選。Enter／失去焦點確認、Esc 取消；名稱清空或沒變
  直接結束，不叫後端。
- **後端**：`clipboard.renameEntry` → `api.renameItem` → `commands::shell::rename_item`
  → `core::shell::rename`（`IFileOperation::RenameItem`）。同名衝突、權限問題由 Windows
  出面處理，成功後也能在檔案總管 Ctrl+Z 復原；非 Windows 回 `Unsupported`。
  名稱驗證沿用建立新項目的 `validated_name`。
- **成功後**：重讀窗格並選取新名字；被剪下的項目、開著的檢視器（`viewer.retarget`）
  一起改指向新路徑。使用者取消時維持原名、不留錯誤狀態。

## 4. 開發與修改規範

- **模組職責與行數控制**：單一程式碼檔案行數建議控制在 400 行以內；若邏輯膨脹應拆分為
  Composables、子組件或 Utils 工具函數。
- **IPC 隔離與 Web 相容**：UI 組件嚴禁直接呼叫 `@tauri-apps/api` 的 `invoke`，一律經由
  `services/` 封裝；所有 IPC 呼叫需在 `api.ts` 提供 Mock 降級以支援瀏覽器開發
  （`npm run dev` 就是靠這一層跑起來的）。
- **統一錯誤處理規範**：後端統一採用 `AppError`（基於 `thiserror`）列舉型別回傳；
  前端一律透過 `normalizeBackendError` 統一轉譯，嚴禁未捕獲的 Promise 拋錯或靜默吞沒異常。
- **狀態單一真實來源 (SSOT)**：視窗層與跨組件狀態必須由 Pinia Stores（`stores/`）統一管理，
  禁止跨組件任意深層 Prop Drilling 或直接修改外部非自身負責之狀態。
- **無副作用與模組邊界**：`utils/` 必須維持無副作用的純函數，不依賴 Vue 響應式狀態或後端 IPC；
  平台整合（Shell／剪貼簿／目錄監控）一律放在 `src-tauri/src/core/`，不可混進 `commands/`。
- **命名用語**：UI 區塊與版面功能的名稱以第 5 節為唯一來源；寫文案、tooltip 或註解前先查表，
  不要另造同義詞（例如把「左右分割」寫成「垂直分割」）。
- **檔案系統路徑**：Rust 端回傳的是 `display_path()` 處理過的一般路徑（去掉 `\\?\`）；
  要交給 Shell API 前若拿到 canonicalize 的結果，務必先過 `display_path()`，否則會踩 `0x80070057`。

## 5. 版面區塊與命名用語

這一節是 UI 區塊與版面功能的**唯一命名來源**。文件、註解、UI 字串與 tooltip 一律照這裡的說法，
不要為了順口另造新詞。

### 5.1 區塊（由外而內）

| 正式名稱 | 範圍 | 實作 |
| --- | --- | --- |
| 標題列（Window Chrome） | 視窗最上方整條、可拖曳；內含分頁列、紀錄／設定動作、視窗控制 | `components/chrome/` |
| 分頁列（Tab Strip） | 標題列內的分頁籤與新增鈕 | `chrome/TabStrip.vue` |
| 路徑列（Path Bar） | 標題列下方，**每個分頁一條**、永遠指向焦點窗格：位置標籤｜導覽鈕｜麵包屑｜搜尋｜顯示於總管｜版面切換（含交換窗格） | `toolbar/TabToolbar.vue`、`toolbar/PathBreadcrumb.vue` |
| 工作區（Workspace） | 路徑列與狀態列之間：左邊「資料夾樹面板」＋右邊「窗格區」 | `workspace/WorkspaceView.vue` |
| 資料夾樹面板（Folder Tree Panel） | 左側「我的資料夾」；頂端是**樹工具列**（加入／移除／別名／排序／定位／收合全部／收合側欄），右緣是寬度把手 | `tree/FolderTreePanel.vue` |
| 窗格（Pane） | 工作區裡的瀏覽單元：預設是檔案清單，也可以被檢視器暫時佔用；一個分頁有 1～2 個 | `workspace/BrowserPane.vue` |
| 檔案清單（File List） | 窗格內容：欄位標頭＋虛擬滾動的列 | `files/FileListView.vue` |
| 檢視器（Viewer） | 窗格內容模式：顯示 Markdown、圖檔或純文字，可關閉回到檔案清單 | `viewer/ViewerPane.vue` |
| 目錄索引（Table of Contents） | Markdown 檢視器右上角的浮動面板：標題列「目錄索引」＋h1～h6 清單，可拖曳／縮放／收合 | `viewer/MarkdownToc.vue` |
| 搜尋（Find in Viewer） | 文字類檢視器右上角的浮動面板：搜尋框＋大小寫／全字／Regex 選項＋命中清單，可拖曳／縮放／收合 | `viewer/ViewerSearchPanel.vue` |
| 狀態列（Status Bar） | 視窗最下方；分割時一個窗格一行，可點擊切換焦點 | `layout/StatusBar.vue` |
| 設定頁（Settings） | 整頁浮層：蓋住路徑列與工作區、保留標題列 | `settings/SettingsView.vue` |

- 「工具列」這個詞不再單獨使用：上方那條叫**路徑列**，左側樹面板那排按鈕叫**樹工具列**。
- **檢視器**是窗格內容模式的名稱（動詞用法沿用「開啟」）；不要寫成「預覽窗格」「預覽器」。
  開啟到窗格時的說法與資料夾共用：單一窗格是「在新窗格開啟」，分割時是「在左／右／上／下窗格開啟」。
- **資料夾樹面板的可見性只有一個來源**：`settings.treeCollapsed`（使用者按樹工具列的收合側欄或
  F6）。不做任何依寬度／高度的自動退場 —— 分割比例與視窗尺寸都不會讓它自己消失。

### 5.2 版面與分割

| 正式名稱 | `TabState.direction` | 窗格位置 | 圖示 | 分隔線 |
| --- | --- | --- | --- | --- |
| 單一窗格 | （`paneIds.length === 1`） | 只有一個 | `layoutSingle` | 無 |
| 左右分割 | `"row"` | `paneIds[0]`＝左、`paneIds[1]`＝右 | `splitColumns` | 垂直分隔線 |
| 上下分割 | `"column"` | `paneIds[0]`＝上、`paneIds[1]`＝下 | `splitRows` | 水平分隔線 |

- **分割模式一律以窗格排列方向命名**（左右／上下）；「垂直／水平」只拿來形容分隔線與圖示形狀，
  不當作模式名稱。
- `"row"`／`"column"` 是純程式碼值（`SplitDirection`），**不代表列／欄**；對應關係就是上表，
  UI 與文件一律講左右分割／上下分割。
- **窗格位置標籤**＝左／右（左右分割）或上／下（上下分割），由 `utils/layout.ts` 的
  `paneSlotLabel()` 產生。狀態列、路徑列的位置標籤、右鍵選單的「在○窗格開啟」都共用它，
  不可各自造詞。
- **焦點窗格**：任何時刻只有一個窗格是焦點；鍵盤操作、路徑列與資料夾樹都跟著它。
- **分割**是動詞（把一個分頁切成兩個窗格），**窗格**是名詞（那個窗格本身）；
  兩顆分割按鈕的正式名稱是「左右分割」與「上下分割」。
- **交換窗格**是動詞：把兩個窗格連同大小一起對調（`paneIds` 反轉、`ratio` 鏡射成
  `1 - ratio`），焦點跟著窗格走；按鈕併在路徑列最右邊的**版面切換膠囊**裡（三顆版面鈕
  之後），單一窗格（或收合動畫進行中）時停用。
