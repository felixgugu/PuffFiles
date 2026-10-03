# PuffFile 功能重新規劃（Apple Design 版）

> 依據 `$apple-design`（WWDC *Designing Fluid Interfaces* / *The Details of UI
> Typography* / *Principles of Great Design*）重新規劃。
> 本文件是「規劃」，尚未動工；核可後再依第 9 節的階段施工。

---

## 0. 北極星：這不是檔案總管，是「工作資料夾的快速通道」

原始需求的第一句話就是最重要的一句：

> 「無需完全取代檔案總管，而是用來快速使用工作上常常要使用的資料夾。」

**Purpose（設計八原則之 1）＝ 決定「不做什麼」。**
因此本版明確**不做**：檔案複製／搬移／刪除／重新命名、萬用搜尋、預覽窗格、格網模式、
磁碟重組、完整磁碟樹瀏覽。每一個砍掉的東西，都在替「三秒內回到我的工作資料夾」讓路。

產品的三個核心物件：

| 物件 | 定義 | 為什麼需要 |
| --- | --- | --- |
| **我的資料夾** | 使用者自己加入的資料夾根清單，可各自展開樹狀 | 這是「我常去的資料夾」的具體化身 |
| **分頁 (Tab)** | 一次瀏覽工作階段，內含 1～2 個窗格 | 不同工作（例如「後端／前端」）互不干擾 |
| **窗格 (Pane)** | 一個「資料夾樹 + 檔案清單」的瀏覽單元 | 讓左右／上下對照兩個資料夾 |

---

## 1. 目前的程式碼 vs. 目標落差

| 項目 | 現況 | 目標 |
| --- | --- | --- |
| 視窗外框 | 系統標題列（`decorations` 預設 true） | 無邊框 Win11 風格，自繪標題列 |
| 分頁 | 無 | 多分頁 + 快捷鍵 + 工作階段還原 |
| 版面 | 單一窗格 | 1～2 窗格，左右／上下分割，可拖曳 |
| 左側 | 固定寬度「快速存取 + 磁碟機」側欄 | 可調寬／可收合的「我的資料夾」樹（僅資料夾） |
| 右側 | 已是清單模式 | 保留清單、麵包屑、欄位可設定、虛擬捲動 |
| 歷史 | 只有 back / forward 兩疊 | 全域 MRU 瀏覽紀錄（上限 100、去重、可搜尋） |
| 右鍵 | 開啟／顯示／複製路徑 | + PowerShell / Cmd / 複製 Windows 路徑 / 複製 Linux 路徑；檔案 + Notepad++ / VS Code |
| 設定 | 無 | 設定面板 |
| 動態 | CSS transition 為主 | Spring 動態系統（可中斷、帶速度） |

現有架構（`services/` 單一 IPC 邊界、`AppError` 統一錯誤、Pinia SSOT、`utils/` 純函式）
**全部保留**，本規劃是在其上擴充，不是打掉重練。

---

## 2. 資訊架構

```
AppShell
├─ WindowChrome（自繪標題列，整條可拖曳）
│  ├─ TabStrip        分頁：＋ 新分頁、拖曳排序、中鍵關閉
│  ├─ ChromeActions   資料夾瀏覽紀錄 ▾ ｜ 設定 ⚙
│  └─ WindowControls  最小化 ｜ 放大／還原 ｜ 關閉
├─ TabToolbar（每個分頁一條，指向焦點窗格）
│  └─ 位置標籤｜導覽鈕｜麵包屑｜搜尋｜顯示於總管｜版面切換（一般／左右／上下）
├─ WorkspaceView
│  ├─ FolderTreePanel（每個分頁一份，跟著焦點窗格切換）
│  │  ├─ PanelToolbar  加入資料夾｜移除資料夾｜定位｜收合全部｜收合側欄
│  │  └─ FolderTree    我的資料夾清單，每個節點可獨立展開（只顯示資料夾）
│  └─ PaneLayout      1 或 2 個 Pane + 可拖曳分隔線（左右／上下）
│     └─ BrowserPane × 1..2
│        └─ FileListView
│           ├─ ColumnHeader  名稱｜類型｜大小｜修改日期｜（選用欄位，可拖曳調寬）
│           └─ FileList      單一條列模式，虛擬捲動
├─ StatusBar（全域，顯示焦點窗格資訊）
└─ Overlays
   ├─ ContextMenu（指標錨定、材質化進場）
   ├─ HistoryPanel／SettingsSheet（右側滑入）
   ├─ NoticeToast（含「復原」）
   └─ ErrorBanner
```

### 焦點模型（Wayfinding）

任何時候只有一個**焦點窗格**：外框有一道極細的 accent 光邊，狀態列也會標示（`左｜右`）。
鍵盤操作永遠作用於焦點窗格 —— 使用者永遠知道「我現在在哪」。
這也讓「兩個窗格」不會變成一場混亂：**同時看兩個資料夾，但只操作一個。**

---

## 3. 功能細部規劃

### 3.1 無邊框 Win11 視窗

- `tauri.conf.json`：`decorations: false`、`shadow: true`、`minWidth: 880`、`minHeight: 560`。
- 標題列用 `data-tauri-drag-region`；雙擊＝放大／還原。
- 新增 `core:window` 權限：`allow-start-dragging`、`allow-minimize`、`allow-toggle-maximize`、
  `allow-close`、`allow-set-effects`。
- **材質**：用 Tauri 內建 `window.set_effects(Effect::Mica)`（Win11）取得真正的 Mica；
  取不到時（Win10／效果被關）自動退回 CSS `backdrop-filter` 半透明。
  這是「材質編碼階層」而非裝飾：標題列最輕、側欄較重、內容最實。
- **已知限制（要實測）**：無邊框＋透明視窗在 Windows 上的縮放熱區與圓角；
  Win11 Snap Layouts（最大化鈕 hover 的版面配置）在自繪標題列下不會出現，
  需要自訂 WndProc hit-test（`HTMAXBUTTON`）才能復刻 —— 列入 Phase 7 選配。

### 3.2 分頁區

- `Ctrl+T` 新分頁、`Ctrl+W` 關閉、`Ctrl+Tab` / `Ctrl+Shift+Tab` 循環、`Ctrl+1..9` 跳頁、中鍵關閉。
- 分頁標題＝焦點窗格的資料夾名稱；tooltip 顯示完整路徑。
- 拖曳排序（spring、帶速度交接，可直接甩到定點）。
- 關閉最後一個分頁＝開一個新分頁（不關閉視窗，符合直覺且不會「把自己關掉」）。
- **工作階段還原**：可設定下次啟動是否還原上次的分頁／窗格／路徑。

### 3.3 功能列：資料夾瀏覽紀錄 ｜ 設定

**瀏覽紀錄**

- 全域 MRU 清單：上限 100 筆，以**正規化路徑**去重（Windows 大小寫不敏感），新到舊。
- 面板內可即時篩選、單筆刪除、「清空紀錄」。
- 點擊＝在焦點窗格開啟；`Alt+Click`＝在另一窗格開啟（有分割時）。
- 只在「確實載入成功」後才寫入，避免把失敗路徑塞進歷史。
- 持久化於 `pufffile:history`。

**設定**（整頁模式：蓋掉工具列與內容，保留標題列；左側依功能分類）

| 分類 | 項目 |
| --- | --- |
| 外觀 | 主題（淺色／深色／跟隨系統）、材質（Mica／純色）、密度 |
| 動態 | 動態效果（完整／跟隨系統／減少） |
| 瀏覽 | 顯示隱藏項目、預設排序、預設欄位、單／雙擊開啟 |
| 我的資料夾 | 管理清單、匯入／匯出 |
| 外部工具 | 可自訂的工具清單：執行檔、引數（一行一個）、工作目錄、顯示於檔案／資料夾、是否開新主控台、圖示 |
| 工作階段 | 啟動時還原上次分頁 |

外部工具的引數與工作目錄支援樣板變數：`$fullFilePath`、`$fullFolderPath`、
`$fileName`、`$folderName`，加上後綴 `1`／`2` 可固定取左／上或右／下窗格。
沒有後綴＝右鍵點擊的那個目標。內建四個工具（PowerShell、命令提示字元、
Notepad++、VS Code）可編輯但不能刪除，另有「恢復預設」。

### 3.4 左側：我的資料夾樹

工具列四顆按鈕的行為定義：

| 按鈕 | 行為 |
| --- | --- |
| 加入資料夾 | 開原生資料夾選擇器，加入為樹根（重複路徑自動去重並提示） |
| 移除資料夾 | 移除選取的樹根；**顯示含「復原」的通知**（Agency：給犯錯的空間） |
| 定位 | 移到清單中選取的資料夾；選到檔案時定位其父目錄，沒有選取則回到窗格目前的資料夾 |
| 收合 | 全部收合節點（面板本身的收合是面板邊緣的 `‹` 把手，兩者分開） |

> 樹本身沒有重新整理鈕：路徑功能列的「重新整理」（或 F5）會同時重讀
> 清單與資料夾樹（資料夾根＋目前展開的節點）。此外收合節點時也會丟棄
> 該節點的子項快取，下次展開即重新讀取。

- **只列資料夾**，不列檔案 —— 這是刻意的：樹負責「我要去哪」，清單負責「這裡有什麼」。
- 每個節點獨立展開，展開狀態持久化。
- **懶載入**：展開時才呼叫新的 `list_subdirs`（只回傳子資料夾，跳過檔案）→ 大目錄也秒開。
- 目前路徑所在的節點自動展開並高亮（空間一致性：東西從哪來，就在哪發光）。
- 面板可拖曳調寬、可整片收合（寬度歸零，記住上次寬度）。

### 3.5 右側：檔案清單

- 麵包屑顯示**完整路徑**，可點任何一段跳轉，雙擊／`Ctrl+L` 進入編輯。
- **只有條列模式**（明確不做格網）。
- 欄位（點標題排序，資料夾永遠優先）：
  `名稱` · `類型` · `大小` · `修改日期` ＋ 選用 `建立日期` · `屬性` · `路徑`。
- **虛擬捲動**是必要工程（後端上限 20,000 筆，DOM 全開會卡）。
- 選取：單擊／Ctrl／Shift／全選／鍵盤上下；焦點列捲進可視範圍。
- 檔案大小、日期用 `tabular-nums` 等寬數字，掃視時不會跳動。

### 3.6 分割版面

- 兩顆邏輯：**左右** 與 **上下**；`Ctrl+\` 左右分割、`Ctrl+Shift+\` 上下分割（沿用 VS Code 肌肉記憶）、
  `Ctrl+Shift+W` 關閉窗格、`F6` 在窗格／樹／清單之間循環焦點（沿用檔案總管肌肉記憶）。
- 新窗格預設開在**目前焦點路徑**。
- 分割線：Pointer Events + `setPointerCapture`、尊重抓取位移、最小寬度橡皮筋、
  放開時把指標速度交給 spring；雙擊分割線＝平均分配。
- 窗格高度不足（< 320px）時，樹面板自動收合到只剩把手 —— 讓上下分割在小視窗仍然可用（Flexibility）。

### 3.7 右鍵選單

**資料夾 / 空白處**

| 項目 | 說明 |
| --- | --- |
| 開啟至 PowerShell | 於該目錄開新 PowerShell 視窗（可用 Windows Terminal 取代） |
| 開啟至命令提示字元 | 於該目錄開新 Cmd 視窗 |
| 複製路徑（Windows） | `C:\Users\felix\專案` |
| 複製路徑（Linux） | `/mnt/c/Users/felix/專案`（UNC → `//server/share/...`） |

**檔案**

| 項目 | 說明 |
| --- | --- |
| 開啟 | 系統預設程式（沒有它這個 App 不成立，保留） |
| 開啟至 Notepad++ | 執行檔路徑可在設定指定（通常不在 PATH） |
| 開啟至 VS Code | 預設用 `code`，可在設定指定 |
| 複製路徑（Windows／Linux） | 同資料夾選單 |
| 在檔案總管中顯示 | 沿用既有 `reveal_path` |

實作：後端只有一個通用命令 `run_external(program, args, workingDir, newConsole)`，
所有工具都由設定清單描述 —— 引數在前端展開變數後才送出。
終端機類工具的做法是把 `workingDir` 設成目標資料夾（行程繼承工作目錄），
不需要組 `cd /d "..."` 這種容易被引號規則咬到的命令字串。

---

## 4. Apple Design 對應：動態系統

**原則**：可被使用者抓住的東西一律用 spring，不用 CSS transition／keyframes
（它們無法被中途抓取與反轉）。靜態的 hover／focus 才可以留 CSS。

為維持「極致輕量」，**不引入 Motion 等函式庫**，自建 `utils/spring.ts`
（rAF + 臨界阻尼近似，約 1～2 KB）與 `composables/useDragGesture.ts`。

| 互動 | 阻尼 damping | 響應 response | 備註 |
| --- | --- | --- | --- |
| 樹節點展開／收合 | 1.0 | 0.30 | 不彈跳，避免干擾 |
| 窗格分割／收合 | 1.0 | 0.35 | 從「presentation 值」起算，可中途反轉 |
| 分頁切換 | 1.0 | 0.25 | 只動 transform／opacity |
| 分割線放開吸附 | 1.0 | 0.40 | 帶入釋放速度 |
| 甩動收合樹／窗格 | 0.85 | 0.30 | 只有帶動量才允許回彈 |
| 右鍵選單材質化 | 1.0 | 0.25 | scale 0.96→1 ＋ opacity ＋ blur 半徑一起動 |
| 設定頁進出 | 0.9 | 0.35 | 整頁切換，以淡入淡出為主 |
| 通知 Toast | 1.0 | 0.30 | |

其他規則：

- **回應**：所有按鈕在 `pointerdown` 就給按壓回饋（`scale(0.97)`），不等 `click`。
- **1:1**：分割線、樹面板寬度拖曳全程跟手，不是放手才動畫。
- **速度交接**：放手時把指標速度（px/s）交給 spring 當初始速度，接縫不可見。
- **邊界處理**：拖曳越界時以橡皮筋漸進抵抗，放開後由彈簧（帶入釋放速度）回收。
- **空間一致性**：選單從指標長出來、往指標收回；設定頁由上方工具列的位置展開；關閉分頁時鄰頁往缺口滑。
- **方向暗示**：分割按鈕的圖示與動畫先預示「會往哪邊長」。
- **橡皮筋**：分割線越過最小寬度時漸進抵抗，不硬停。
- **手勢細節**：拖曳 10px 遲滯才判定方向；雙擊分割線回中。
- **影格**：只動 `transform`／`opacity`；拖曳中加 `will-change`；長清單一定要虛擬化。
- **多模態**：桌面端不濫用音效；只有「錯誤」與「移除可復原」等關鍵時刻才給回饋。

### 無障礙與偏好

`prefers-reduced-motion` → 位移改成 200ms 交叉淡入、取消回彈；
`prefers-reduced-transparency` → 材質轉不透明、關閉 blur；
`prefers-contrast: more` → 近不透明底 + 明確邊框。設定頁也提供「動態效果」覆寫（三態）。

### 字體排印

- 沿用系統字（`Segoe UI Variable`），已具備 optical sizing 與字距表。
- 字距依尺寸而變：標題列／面板標題 -0.01em～-0.02em；內文 0；10～11px 小字 +0.01em。
- 行高：大標題 1.1、清單列固定行高、狀態列 1.4。
- 間距用 `rem`，尊重系統文字縮放（Dynamic Type）。

---

## 5. 狀態架構（Pinia SSOT）

現有單一 `explorer` store 假設「全世界只有一個目前路徑」，必須先拆。

```
stores/
├─ tabs.ts       分頁、版面（layout）、焦點窗格、窗格註冊表
├─ explorer.ts   窗格化：panes: Record<PaneId, PaneState> + 以 paneId 為參數的動作
├─ folders.ts    我的資料夾樹根、展開狀態、子節點快取
├─ history.ts    瀏覽紀錄（MRU、上限 100、去重）
├─ settings.ts   設定（主題、欄位、外部工具路徑、動態效果…）
└─ ui.ts         短生命週期 UI 狀態（通知、焦點請求）— 保留部分，主題移往 settings
```

`PaneState`：

```ts
interface PaneState {
  id: PaneId;
  currentPath: string;
  currentName: string;
  parentPath: string | null;
  entries: ShallowRef<FileEntry[]>;
  status: "idle" | "loading" | "ready" | "error";
  error: AppErrorView | null;
  query: string;
  sortKey: SortKey;
  sortDirection: SortDirection;
  selected: string[];
  focusedIndex: number;
  backStack: string[];
  forwardStack: string[];
  treeCollapsed: boolean;
  treeWidth: number;
  controller: AbortController | null;
}
```

- 每個窗格自己的 `AbortController`：換路徑只中止自己那條串流。
- 大量項目維持 `shallowRef` + `triggerRef`（現有做法，保留）。
- 持久化集中在新 `services/storage.ts`（純存取，不碰響應式），store 負責呼叫。

---

## 6. 前後端介面變更

### Rust 新增／修改

| 位置 | 內容 |
| --- | --- |
| `core/dir.rs` | `list_subdirs(path)`（只回傳資料夾，供樹狀懶載入）；`FileEntry` 增加 `created_ms`、`readonly`、`attributes`（供「屬性」欄位） |
| `commands/fs.rs` | `list_subdirs`；`run_external(program, args, workingDir, newConsole)` |
| `commands/system.rs` | 偵測終端機種類（Windows Terminal / PowerShell / Cmd 是否存在） |
| `lib.rs` | 註冊新命令 |
| `tauri.conf.json` | `decorations: false`、`shadow: true`、`minWidth/minHeight`、Mica 預設效果 |
| `capabilities/default.json` | window 控制權限；若採原生資料夾選擇器則加 `dialog` 權限 |

### 前端新增／修改

| 檔案 | 動作 |
| --- | --- |
| `services/api.ts` | `listSubdirs`、`openWith`、視窗控制封裝、資料夾選擇；**全部要有 Mock 降級** |
| `services/mock.ts` | 對應假資料與事件順序 |
| `services/storage.ts` | 新增，localStorage 讀寫 |
| `utils/path.ts` | `toUnixPath`（drive → `/mnt/c`、UNC → `//server/share`）、`normalizeKey`（去重鍵） |
| `utils/spring.ts` | 新增，極輕量 spring |
| `composables/useDragGesture.ts` | 新增，pointer capture + 速度歷史 |
| `composables/useKeyboardShortcuts.ts` | 擴充：分頁、分割、F6、複製路徑 |
| `components/chrome/*` | 新增：`WindowChrome`、`TabStrip`、`ChromeActions`、`WindowControls` |
| `components/workspace/*` | 新增：`WorkspaceView`、`PaneLayout`、`PaneSplitter`、`BrowserPane` |
| `components/tree/*` | 新增：`FolderTreePanel`、`TreeToolbar`、`FolderTreeNode` |
| `components/files/*` | 重構：`FileListView`（虛擬化）、`ColumnHeader`、保留 `FileTableRow` |
| `components/overlays/*` | 新增：`ContextMenu`、`HistoryPanel`、`SettingsSheet` |
| `components/layout/*` | 改寫：`AppShell`、`StatusBar`；`AppHeader` 併入 `WindowChrome` |

---

## 7. 持久化格式

| Key | 內容 |
| --- | --- |
| `pufffile:folders` | `{ roots: [{ id, path, expanded: string[] }] }` |
| `pufffile:history` | `{ items: [{ path, name, at }] }`（≤ 100、去重、MRU） |
| `pufffile:session` | `{ tabs, activeTabId, layout, sizes }`（依設定決定是否還原） |
| `pufffile:settings` | 主題、欄位、排序、外部工具路徑、動態效果… |

---

## 8. 邊界條件與風險

1. **無邊框視窗**：透明＋無邊框在 Windows 的縮放熱區、圓角、陰影需實測；
   必要時退回「無邊框但不透明 + CSS 材質」。
2. **Snap Layouts**：自繪標題列不會有 Win11 原生版面配置彈出，需 P/Invoke hit-test（選配）。
3. **超長路徑**：`\\?\` 前綴已在 `core::display_path` 處理，複製 Linux 路徑時要另外處理 UNC。
4. **兩窗格同時串流**：驗證大量項目時兩個 `spawn_blocking` 不互相餓死。
5. **20,000 筆清單**：沒有虛擬化一定卡；此項列為必要工程而非加分項。
6. **右鍵選單與原生選單衝突**：WebView2 預設右鍵選單要全域關閉。

---

## 9. 施工順序（每階段都可獨立驗收）

| 階段 | 內容 | 驗收標準 |
| --- | --- | --- |
| 0 | 狀態重構：pane 化 explorer、`storage.ts`、`spring.ts`、`toUnixPath` | 型別檢查通過、單窗格行為與現在一致 |
| 1 | 無邊框視窗 + 自繪標題列 + 視窗控制 + Mica | 可拖曳／縮放／最大化還原／關閉 |
| 2 | 分頁 + 版面分割 + 可拖曳分隔線 | 兩個窗格可各自瀏覽、焦點清楚 |
| 3 | 我的資料夾樹（加入／移除／定位／收合、懶載入、持久化） | 重開 App 清單與展開狀態還在 |
| 4 | 檔案清單升級：虛擬化、欄位設定、每窗格麵包屑 | 20,000 筆可順暢捲動 |
| 5 | 右鍵選單 + `run_external` + 兩種路徑格式 + 自訂外部工具 | 內建與自訂工具皆可執行 |
| 6 | 瀏覽紀錄面板 + 設定面板 | 上限／去重／持久化正確 |
| 7 | 打磨：動態系統、reduced-* 三偏好、字距、空狀態、工作階段還原 | 逐項對照第 4 節檢查表 |

---

## 10. 已定案的決策（2026-10-02）

| 題目 | 決定 | 實作對應 |
| --- | --- | --- |
| 加入資料夾 | 原生資料夾選擇器 | `tauri-plugin-dialog` + `services/api.chooseFolder` |
| Linux 路徑 | 純路徑，去掉 `/mnt/c` 前綴 | `utils/path.toUnixPath`（`C:\Users\felix` → `/Users/felix`） |
| 終端機 | 改為可自訂的外部工具清單（執行檔可換成 `pwsh.exe` 等） | `commands/fs.rs::run_external` |
| 瀏覽紀錄 | 全域共用、上限 100、去重、MRU | `stores/history.ts` |
| 窗格上限 | 每個分頁固定 2 個 | `stores/tabs.ts` |
| 外觀 | **不透明視窗 + 分層純色材質**（效能優先） | `main.css` 的 `--color-chrome/rail/menu` |

外觀決策的理由：`transparent: true` 會讓 WebView2 走額外的合成路徑，且大面積
`backdrop-filter` 在捲動時每一格都要重算。改用不透明視窗 + 分層純色 + 亮邊與陰影，
在視覺上仍保有「材質有厚度」的階層感，但完全沒有額外的每格成本。
若日後要真正的 Mica，只需在 `lib.rs` 的 `setup` 呼叫 `set_effects` 並把材質權杖改回半透明，
其餘版面與動態都不必動。

## 11. 已知取捨與未完成項

- 分頁拖曳排序為「即時換位」，沒有跟著手指位移的浮動效果。
- 樹狀節點展開目前是瞬間出現，尚未加上淡入（Phase 7 打磨項）。
- 磁碟機清單已從側欄移除：改用原生選擇器或 `Ctrl+L` 輸入路徑前往。
- 「屬性」欄位已可顯示，但沒有重新命名／刪除等寫入操作 —— 這是刻意的範圍界線。
