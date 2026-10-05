# PuffFile 功能重新規劃（Apple Design 版）

> 依據 `$apple-design`（WWDC *Designing Fluid Interfaces* / *The Details of UI
> Typography* / *Principles of Great Design*）重新規劃。
> 本文件是「規劃」，尚未動工；核可後再依第 9 節的階段施工。

---

## 0. 北極星：這不是檔案總管，是「工作資料夾的快速通道」

原始需求的第一句話就是最重要的一句：

> 「無需完全取代檔案總管，而是用來快速使用工作上常常要使用的資料夾。」

**Purpose（設計八原則之 1）＝ 決定「不做什麼」。**
因此本版明確**不做**：萬用搜尋、圖示模式、完整磁碟樹瀏覽、檔案編輯。
每一個砍掉的東西，都在替「三秒內回到我的工作資料夾」讓路。

（2026-10-04 追加：**檢視器**進入範圍，見 §3.8。它仍然只是窗格的一種暫時內容模式，
關掉就回到檔案清單，不改變「不做檔案編輯／不做萬用搜尋」的立場。）

**例外：檔案操作交給 shell。** 剪下／複製／貼上／刪除是後來加入的，做法是把實際
搬移交給 Windows 的 `IFileOperation`（衝突對話框、進度、取消、資源回收筒全部由
作業系統提供），剪貼簿則讀寫 `CF_HDROP` 與 `CFSTR_PREFERREDDROPEFFECT`，
因此與檔案總管雙向互通。另外提供分割畫面時「送到另一窗格」的複製與搬移：只在右鍵
選單與 `Ctrl+Shift+C`／`Ctrl+Shift+M`，不佔路徑列（路徑列留給導覽、版面與搜尋）。

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
├─ TabToolbar（路徑列：每個分頁一條，指向焦點窗格）
│  └─ 位置標籤｜導覽鈕｜麵包屑｜搜尋｜顯示於總管｜版面切換膠囊（單一窗格／左右分割／上下分割＋交換窗格）
├─ WorkspaceView
│  ├─ FolderTreePanel（每個分頁一份，跟著焦點窗格切換）
│  │  ├─ PanelToolbar  加入資料夾｜移除資料夾｜定位｜收合全部｜收合側欄
│  │  └─ FolderTree    我的資料夾清單，每個節點可獨立展開（只顯示資料夾）
│  └─ PaneLayout      1 或 2 個 Pane + 可拖曳分隔線（左右／上下）
│     └─ BrowserPane × 1..2
│        └─ FileListView
│           ├─ ColumnHeader  名稱｜類型｜大小｜修改日期｜（選用欄位，可拖曳調寬、雙擊自動調寬）
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

- `Ctrl+N` 新分頁、`Ctrl+W` 關閉、`Ctrl+Tab` / `Ctrl+Shift+Tab` 循環、`Ctrl+1..9` 跳頁、中鍵關閉。
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

**設定**（整頁模式：蓋掉路徑列與工作區，保留標題列；左側依功能分類）

| 分類 | 項目 |
| --- | --- |
| 外觀 | 主題（淺色／深色／跟隨系統）、材質（Mica／純色）、密度 |
| 字型 | 字型家族（自由輸入，留空＝系統預設）、字級（11–18px，只縮放文字不縮放版面） |
| 動態 | 動態效果（完整／跟隨系統／減少） |
| 瀏覽 | 顯示隱藏項目、預設排序、預設欄位、單／雙擊開啟 |
| 我的資料夾 | 管理清單、匯入／匯出 |
| 顯示名稱 | 別名格式字串（變數 `$aliasName`、`$RealFolderName`，預設 `$aliasName-$RealFolderName`；留空＝預設格式） |
| 外部工具 | **清單 → 獨立編輯頁**：清單可依名稱／執行檔篩選；編輯頁的欄位有執行檔、引數（一行一個）、工作目錄、顯示於檔案／資料夾、副檔名篩選（選填）、是否開新主控台、圖示 |
| 工作階段 | 啟動時還原上次分頁 |
| 關於 | 版號（唯一來源 `package.json`，由 `src/version.ts` 內嵌）、外部工具數量、設定存放位置、操作紀錄路徑、**快速鍵一覽**（資料在 `utils/shortcuts.ts`，分頁／導覽／檢視器／選取／剪貼簿／對話框六組） |

版面：左側分類固定 176px，內容**緊接其右（左靠，不置中）**、上限 768px，所以視窗最大化時
不會在分類與表單之間拉出大片空白；區塊之間以 `--color-line` 畫一條分隔線分段，區塊的次要動作
（重設字型、重設顯示格式、重設欄寬）統一放在標題列右側。

外部工具的引數與工作目錄支援樣板變數：`$fullFilePath`、`$fullFolderPath`、
`$fileName`、`$folderName`，加上後綴 `1`／`2` 可固定取左／上或右／下窗格。
沒有後綴＝右鍵點擊的那個目標。內建四個工具（PowerShell、命令提示字元、
Notepad++、VS Code）可編輯但不能刪除，另有「恢復預設」。

編輯採**草稿 + 明確儲存**：所有欄位先寫進 `stores/toolEditor.ts` 的草稿，
按「儲存」才寫回 settings（原本的逐鍵即時儲存已移除）。名稱與執行檔必填，
未填時欄位下方顯示錯誤、儲存鈕停用；footer 固定貼底，長表單也不用回頭找按鈕。
有未儲存的變更時，編輯頁的返回／取消、左側分類切換、右上返回、Esc、
標題列右上的齒輪都會先跳三選一（`ui.choose` ＋ `ChoiceDialog`）：取消／捨棄變更／儲存並離開。
新增工具走 `create` 草稿，沒按儲存就不會在清單留下半成品；自訂工具只能在編輯頁刪除並跳確認。
「可用變數」的切換鈕貼在引數欄位右下角（藍色文字鈕，展開鈕樣式同「刪除工具」），
展開後直接接在引數下方、不加外框——變數本來就是給引數用的，不該吊在表單最下面。

「副檔名（選填）」填了之後，這個工具只會出現在符合的檔案上（不分大小寫，可用空白、
逗號或分號分隔，例如 `.7z .zip .rar`）；留空表示所有檔案。設了副檔名就只認檔案，
資料夾一律不算符合。多選時，單獨一行的 `$fullFilePath` 會展開成多個引數
（每個選取項目一個），寫在文字中間時仍只代表右鍵的那一項。

### 3.4 左側：我的資料夾樹

樹工具列七顆按鈕的行為定義（最小寬度 224px 要放得下）：

| 按鈕 | 行為 |
| --- | --- |
| ＋ | 在按鈕旁彈出小選單：**新增虛擬目錄**（輸入名稱）或**加入真實資料夾**（原生資料夾選擇器，加到第一層；重複路徑自動去重並提示） |
| 移除 | 移除選取的節點；虛擬目錄會先確認「只從清單移除、不會刪除實體檔案」，兩者都**顯示含「復原」的通知**（Agency：給犯錯的空間） |
| 別名 | 對**第一層的真實資料夾**（含虛擬目錄下的第一層）設定／修改／清除別名；對象不合格時呈現停用樣式。留空即清除 |
| 排序 | 依名稱排序（A→Z）。用 `Intl.Collator("zh-Hant", { numeric: true })`，中文照繁中規則、`資料夾 2` 排在 `資料夾 10` 前面；排完仍是同一份可拖曳的清單 |
| 定位 | 移到清單中選取的資料夾；選到檔案時定位其父目錄，沒有選取則回到窗格目前的資料夾 |
| 收合 | 全部收合節點（面板本身的收合是面板邊緣的 `‹` 把手，兩者分開） |

> 樹本身沒有重新整理鈕：路徑列的「重新整理」（或 F5）會同時重讀
> 清單與資料夾樹（資料夾根＋目前展開的節點）。此外收合節點時也會丟棄
> 該節點的子項快取，下次展開即重新讀取。

- **只列資料夾**，不列檔案 —— 這是刻意的：樹負責「我要去哪」，清單負責「這裡有什麼」。
- **虛擬目錄（分組）**：第一層可混搭真實資料夾與虛擬目錄，虛擬目錄沒有實體路徑、裡面只能是
  真實資料夾（只允許兩層）。它有自己的圖示，點一下是展開／收合而不是導覽；右鍵可重新命名、
  加入資料夾到此群組、移除（含內容，可復原）。同一個實體路徑全樹只會出現一次。
- **自訂排序**：拖曳只作用於「清單上的節點」且**只在同一個容器內搬動**（第一層的互相排、
  同一個虛擬目錄裡的互相排）；跨容器一律不搬，要搬進虛擬目錄走右鍵「移動到虛擬目錄…」
  （兩段式選單）。做法與分頁列一致：指標一進入鄰居的範圍就立刻搬動，結果連續可見，
  不需要插入線；移動距離小於 4px 視為點擊。檔案系統的子資料夾不在清單上，不能拖。
- **排序範圍**：選取節點所在的那一層（第一層的項目含虛擬目錄本身一起排；虛擬目錄內的
  資料夾只排該群組）。沒有選取時用焦點窗格路徑所屬的那一層。排序用**顯示名稱**
  （有別名時依設定格式組成），所以畫面順序與看到的名稱一致。
- **別名**：只有第一層的真實資料夾（含虛擬目錄下的第一層）能設定，入口是樹工具列的
  別名鈕（對象不合格時呈停用樣式）。別名只影響左側清單的顯示名稱與排序；分頁標題、
  麵包屑、通知與右鍵選單仍用原始名稱。顯示格式在「設定 → 一般」調整，預設
  `$aliasName-$RealFolderName`，可用變數 `$aliasName`、`$RealFolderName`（不分大小寫）。
  別名跟著節點一起持久化，移除再「復原」會連別名一起回來。
- 每個節點獨立展開，展開狀態持久化。
- **懶載入**：展開時才呼叫新的 `list_subdirs`（只回傳子資料夾，跳過檔案）→ 大目錄也秒開。
- 目前路徑所在的節點自動展開並高亮（空間一致性：東西從哪來，就在哪發光）。
- 面板可拖曳調寬、可整片收合（寬度歸零，記住上次寬度）。

### 3.5 右側：檔案清單

- 麵包屑顯示**完整路徑**，可點任何一段跳轉，雙擊／`Ctrl+L` 進入編輯。
- **只有條列模式**（明確不做格網）。
- 欄位（點標題排序，資料夾永遠優先）：
  `名稱` · `類型` · `大小` · `修改日期` ＋ 選用 `建立日期` · `屬性` · `路徑`。
- **欄寬**：拖曳把手 1:1 跟手；**雙擊＝自動調整到最寬的內容**（含表頭文字與排序箭頭，
  量測涵蓋目前清單的全部項目，不是只看畫面上那幾十列），上限 600px，超過就停在那裡；
  `Alt`+雙擊＝回復該欄的預設寬度。名稱欄的圖示與「連結」徽章一併計入。
- **虛擬捲動**是必要工程（後端上限 20,000 筆，DOM 全開會卡）。
- **自動更新**：監控目前資料夾（`ReadDirectoryChangesW`），外部變更以增量方式套用
  —— 只插入／移除／就地更新受影響的那幾筆，**不重讀整份清單**，所以選取與捲軸
  不會被動到。只有通知溢位（系統漏掉中間的變更）時才退回整份重讀。
  設定可關閉（「清單自動更新」）。
- 選取：**按下即選取**（對齊檔案總管）、Ctrl 切換、Shift 範圍、拖曳列延伸範圍、
  空白處拖曳框選、到邊界自動捲動、全選／鍵盤上下；焦點列捲進可視範圍。
- 檔案大小、日期用 `tabular-nums` 等寬數字，掃視時不會跳動。

### 3.6 分割版面

- 兩顆邏輯：**左右** 與 **上下**；`Ctrl+\` 左右分割、`Ctrl+Shift+\` 上下分割（沿用 VS Code 肌肉記憶）、
  `Ctrl+Shift+W` 關閉窗格、`F6` 在窗格／樹／清單之間循環焦點（沿用檔案總管肌肉記憶）。
- 新窗格預設開在**目前焦點路徑**。
- 分割線：Pointer Events + `setPointerCapture`、尊重抓取位移、最小寬度橡皮筋、
  放開時把指標速度交給 spring；雙擊分割線＝平均分配。
- **交換窗格**：併在路徑列最右邊的版面切換膠囊裡（三顆版面鈕之後）；`paneIds` 反轉、`ratio` 鏡射成 `1 - ratio`，焦點跟著窗格走。
  窗格容器以窗格 id 為 key，交換時只搬移既有的 DOM 節點、不重新掛載，兩邊檔案清單的捲動位置
  與檢視器才能原樣跟著窗格過去；單一窗格（或收合動畫進行中）時按鈕停用。
- 左側資料夾樹**只由使用者自己收合**（樹工具列的收合側欄或 F6）：分割比例（左右或上下）與視窗
  尺寸都不會讓它自動退場。上下分割本來就不壓縮寬度，收掉樹也換不到高度；左右分割自動退場則會
  讓版面在使用者拖曳時自己跳動。

### 3.7 右鍵選單

選單內容依「選取的數量與種類」決定，與檔案總管一致：只有對當下這組對象成立的動作
才會出現。`targets` 的規則是「右鍵的項目若在選取範圍內＝整個選取，否則只有它自己」。

| 情境 | 選單內容 |
| --- | --- |
| 清單空白處 | 建立新資料夾／新檔案、貼上、資料夾類外部工具、複製路徑（Windows／Linux）、在檔案總管中顯示。<br>沒有被選取的項目，所以不出現剪下／複製／刪除。 |
| 單一資料夾 | 開啟、在新分頁開啟、在新窗格開啟、建立新資料夾／新檔案、剪下／複製／貼上／刪除、資料夾類外部工具、送到另一窗格、複製路徑、在檔案總管中顯示 |
| 單一檔案 | 開啟、（支援的檔案）在新窗格開啟、剪下／複製／刪除、檔案類外部工具（再依副檔名篩選）、送到另一窗格、複製路徑、在檔案總管中顯示 |
| 多選 | 剪下／複製／刪除、整組都符合的外部工具、送到另一窗格、複製路徑（全部，一行一個）、在檔案總管中顯示右鍵的項目。<br>開啟／新增／貼上都是單一目標的動作，多選時不出現。 |

左側資料夾樹的節點選單固定等同「單一資料夾」，只作用於該節點，與清單的選取無關。

單一窗格時是「在新窗格開啟」，沿用上次分割的方向（`settings.lastSplit.direction`），圖示會跟著
切換成左右分割或上下分割；分頁已經分割時，這一項改成「在左／右／上／下窗格開啟」（位置由
`paneSlotLabel()` 依分割方向決定，與狀態列、路徑列同一套說法），按下後直接把資料夾開在相鄰的
那一個窗格並把焦點移過去，不會再開第三個窗格。

路徑格式：`C:\Users\felix\專案` 與 `/mnt/c/Users/felix/專案`（UNC → `//server/share/...`）。

實作：後端只有一個通用命令 `run_external(program, args, workingDir, newConsole)`，
所有工具都由設定清單描述 —— 引數在前端展開變數後才送出。
終端機類工具的做法是把 `workingDir` 設成目標資料夾（行程繼承工作目錄），
不需要組 `cd /d "..."` 這種容易被引號規則咬到的命令字串。

### 3.8 檢視器（2026-10-04 追加）

Markdown／圖檔／純文字可以在**另一個窗格**直接看內容 —— 這是「快速取用工作資料夾」的
延伸：不用為了看一眼筆記或截圖而離開 PuffFile。

- **窗格內容模式，不是新物件**：檢視器佔用一個窗格顯示內容，關閉（`Esc`、標頭關閉鈕、
  窗格被關掉，或使用者主動導覽）就回到該窗格原本的資料夾清單。工作階段**不還原**檢視器，
  重啟後只還原資料夾。
- **入口與說法**：與資料夾共用同一套 `open-pane`。單一窗格＝「在新窗格開啟」，沿用
  `settings.lastSplit.direction`，新窗格沿用來源窗格的資料夾；已分割＝「在左／右／上／下
  窗格開啟」，直接開在相鄰窗格。**焦點留在檔案清單**，方向鍵＋`Space` 就能連續預覽同一個
  資料夾裡的檔案；焦點要進到檢視器（Esc、Ctrl+C、Ctrl+W）得先點它。
- **外觀**：檢視器窗格不套用未使用窗格的淡化（`pane-inactive`），維持正常對比。
- **支援範圍**：`.md`／`.markdown`、WebView2 能顯示的圖檔（png／jpg／jpeg／jfif／gif／
  bmp／webp／svg／ico／avif），以及 `fileKind.ts` 歸類為文字／程式碼的檔案。
- **Markdown 渲染**：`utils/markdown.ts`（自帶、零依賴；原本要用的 markdown-it 在離線環境
  裝不了，介面刻意保持可替換）。涵蓋標題、清單、表格、引用、程式碼區塊、刪除線、
  自動連結、連結與圖片，**不執行原始 HTML**；相對路徑的圖片走 IPC 讀取後以 blob URL 內嵌，
  相對連結關閉檢視器、在該窗格導覽到目標資料夾並選取。
- **圖片**：fit 置中、滾輪以游標為錨點縮放、拖曳平移、雙擊切換 fit／實際大小。
- **純文字**：等寬、自動換行、標示偵測到的編碼（UTF-8／UTF-16 BOM 或 NUL 特徵／Big5／GBK）。
- **讀取**：`read_viewer_file`（`core/viewer.rs` + `commands/viewer.rs`）分批串流；
  **不設大小上限**（已與使用者確認），代價是超大檔會吃記憶體。
- **外部變更**：以 `viewer:<paneId>` 為 id 監控檔案所在資料夾（與窗格的監控隔離），
  去抖 250ms 後自動重載；刪除時顯示錯誤狀態。

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
| 設定頁進出 | 1.0 | 0.3 | 浮在工作區之上，淡入 + 微縮放，原點錨定右上角齒輪 |
| 窗格分割／收合 | 1.0 | 0.32 | 新窗格由邊緣長出；收合動畫結束才銷毀窗格 |
| 樹節點展開／收合 | 1.0 | 0.28 | 以 `grid-template-rows` 驅動，可中途反轉 |
| 通知 Toast | 1.0 | 0.30 | |

其他規則：

- **回應**：所有按鈕在 `pointerdown` 就給按壓回饋（`scale(0.97)`），不等 `click`。
- **1:1**：分割線、樹面板寬度拖曳全程跟手，不是放手才動畫。
- **速度交接**：放手時把指標速度（px/s）交給 spring 當初始速度，接縫不可見。
- **邊界處理**：拖曳越界時以橡皮筋漸進抵抗，放開後由彈簧（帶入釋放速度）回收。
- **空間一致性**：選單從指標長出來、往指標收回；設定頁由標題列右上的齒輪展開；關閉分頁時鄰頁往缺口滑。
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
├─ toolEditor.ts 外部工具編輯草稿（dirty、驗證、儲存、離開守衛）
└─ ui.ts         短生命週期 UI 狀態（通知、焦點請求、對話框）— 保留部分，主題移往 settings
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
| `commands/watch.rs` | `watch_dir(id, path, on_event)`／`unwatch_dir(id)` —— 目錄變更監控 |
| `core/watch.rs` | `ReadDirectoryChangesW` + 重疊式 I/O；溢位回 `Rescan`、改名視為移除＋新增 |
| `core/viewer.rs` | 檢視器核心：文字編碼偵測（UTF-8／UTF-16／Big5／GBK）、圖片 MIME、分批切塊與自帶 base64 |
| `commands/viewer.rs` | `read_viewer_file(path, on_event)` —— 文字送解碼後的字串片段，圖片送 base64 片段 |
| `commands/shell.rs` | 系統剪貼簿（`CF_HDROP`）與 `IFileOperation` 的複製／搬移／刪除，含操作紀錄 |
| `commands/system.rs` | 偵測終端機種類（Windows Terminal / PowerShell / Cmd 是否存在） |
| `lib.rs` | 註冊新命令 |
| `tauri.conf.json` | `decorations: false`、`shadow: true`、`minWidth/minHeight`、Mica 預設效果 |
| `capabilities/default.json` | window 控制權限；若採原生資料夾選擇器則加 `dialog` 權限 |

### 前端新增／修改

| 檔案 | 動作 |
| --- | --- |
| `services/api.ts` | `listSubdirs`、`openWith`、視窗控制封裝、資料夾選擇；**全部要有 Mock 降級** |
| `services/mock.ts` | 對應假資料與事件順序（含檢視器的假 Markdown／文字／SVG 圖片） |
| `services/api.ts` | `readViewerFile`（檢視器內容串流），Tauri 與 Mock 兩條路 |
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
6. **右鍵選單與原生選單衝突**：已在 `main.ts` 用全域 `contextmenu` 攔截（capture 階段
   `preventDefault`、不 `stopPropagation`）關掉 WebView2 的原生選單，自繪選單不受影響；
   `input`／`textarea`／`contenteditable` 例外，保留系統的剪下／複製／貼上選單。
   （Tauri 2.11 尚未暴露 WebView2 的 `AreDefaultContextMenusEnabled`，故採前端攔截。）

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
- 重新命名已納入（2026-10-05）：**檔案清單**就地編輯，入口是 F2 或 Shift+右鍵的擴充選單，
  後端走 `IFileOperation::RenameItem`，與剪下／複製／貼上／刪除、建立新資料夾／新檔案
  同一條 shell 路徑（同名衝突、復原都交給 Windows）；資料夾樹與檢視器仍不提供重新命名。
- 檔案清單的一般右鍵選單只留常用動作，剪下／複製／貼上／刪除／重新命名移到
  **Shift+右鍵**的擴充選單，讓預設選單明顯變短；左側資料夾樹維持完整選單。
- 檢視器（2026-10-04）：**不設檔案大小上限**，超大檔的記憶體成本由使用者承擔；
  不支援的圖片格式（heic／tif／psd）與影音、PDF、Office 仍交給系統預設程式；
  Markdown 不執行原始 HTML，也不產生標題錨點（`#anchor` 連結只呈現文字）。
  Markdown 渲染目前是自帶實作（離線環境裝不了 markdown-it），介面保持可替換。

### 目錄監控的後續（2026-10-03 決議：先記下來，暫不做）

清單自動更新（`core/watch.rs`）已完成並驗證，以下三項刻意延後：

1. **網路磁碟的輪詢備援**：目前遇到不支援 `ReadDirectoryChangesW` 的位置（部分
   SMB／網路磁碟）會放棄自動更新，清單仍可手動重新整理。要做就是加入低頻輪詢，
   並在「有事件」與「輪詢」之間切換。
2. **左側樹的節點監控**：樹目前維持「收合即丟棄子項快取、展開時重讀」。
   若要即時反映外部新增的資料夾，需要對展開中的節點掛監控 —— 成本是每個節點
   一個控制代碼，所以要先決定上限（例如只監控可見範圍）。
3. **樹與清單的自動更新連動**：外部新增資料夾時，清單會更新，但樹要等收合再展開
   才看到。連動需要把監控事件同時餵給 `stores/folders.ts` 的子項快取。

### Mermaid 圖表（2026-10-04 決議：先不做，交給程式碼編輯器）

Markdown 檢視器目前把 ` ```mermaid ` 區塊當一般程式碼區塊顯示原始碼。內嵌渲染已經評估過，
結論是**先不做**——要看圖就交給 VS Code 之類的程式碼工具：

- mermaid 12 用 Vite 8 打包（含一個 flowchart 範例）：**114 個 chunk、raw 4.86 MB、
  gzip 1.40 MB**；主 entry 幾乎不變（38 KB），成本全在 lazy chunk。
- Tauri 2 預設以 brotli 內嵌前端資產（`compression` 預設開啟，見 `tauri-utils/assets.rs`），
  換算單檔 exe 約 **+1.2～1.4 MB**（4.97 MB → 約 6.3 MB）。
- **不需要 markdown-it plugin**：自訂 fence 規則已經輸出 `class="language-mermaid"`，
  plugin 做的事就是「fence → 容器 → 呼叫 mermaid」，我們自己十幾行就能做；
  除非另外決定要換掉自帶渲染器（CommonMark 相容性），否則不該把兩件事綁在一起。
- 若日後要做，建議：lazy `import("mermaid")`、`securityLevel: "strict"`、
  `htmlLabels: false`、主題跟隨 `.dark`、失敗時保留原始碼（沿用「檢視器絕不空白」原則），
  並先驗證 Tauri 內嵌資產裡的 lazy chunk 在 portable exe 內載入正常。

### PDF 檢視器（2026-10-04 決議：先不做，交給系統預設程式）

檢視器目前不處理 `.pdf`（`fileKind.ts` 的 `document` 類），按「開啟」會交給系統預設程式。
用 **WebView2 內建 PDF viewer** 的作法已經評估過，結論是**先不做**：

- **關鍵事實**：wry 預設傳 `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`，
  其中 `msPdfOOUI` 就是 Edge／WebView2 的 PDF 檢視器 UI —— 所以 Tauri 應用預設看不到 PDF，
  不是 WebView2 不支援（本機 runtime 154.0.4258.53 內含 `mspdf.dll` 與 `PdfPreview`）。
  要開就得在 `tauri.conf.json` 的視窗設定加 `additionalBrowserArgs` 覆寫，而覆寫會蓋掉預設值，
  必須自己補回 `msWebOOUI,msSmartScreenProtection`（`tauri-utils` 的 `WindowConfig` 註解已明講）。
- **成本其實很低**：可完整重用檢視器管線（`read_image` 的 base64 分塊串流、Blob URL、
  `viewerKindOfPath` 的 kind 分派、自動重載、右鍵與 `Space` 入口），只要多一個 `pdf` kind 與
  一個 `<iframe :src="blobUrl">`；**零新增依賴、exe 不變大**，粗估含 spike 約半天。
- **唯一風險**：覆寫參數後，內建 viewer 在 `blob:` 的 iframe 內是否正常（工具列、翻頁、
  文字選取、右鍵）；要先 spike 實測。備案是另開獨立 `WebviewWindow`（top-level 一定可行）
  或 pdf.js（自製工具列、+約 1 MB gzip，成本數天）。
- **另一個取捨**：blob 路徑的記憶體約為檔案大小的 2.3 倍（base64＋bytes＋Blob）；
  要省記憶體得開 `assetProtocol` 放寬 WebView 的檔案讀取範圍，安全面變大，不建議。
