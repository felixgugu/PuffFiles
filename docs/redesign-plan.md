# PuffFile 規劃與決策紀錄

> 產品定位：「無需完全取代檔案總管，而是用來快速使用工作上常常要使用的資料夾。」
> 依 Apple Design（WWDC *Designing Fluid Interfaces*／*The Details of UI Typography*／
> *Principles of Great Design*）規劃。
>
> 這份文件只記**決策與理由**以及**還沒做的事**。程式碼結構、模組職責與資料流以
> `AGENTS.md` 為準，這裡不重複。最後更新：2026-10-09。

---

## 1. 產品定位

- **Purpose（設計八原則之 1）＝ 決定「不做什麼」。** 明確不做：萬用搜尋、圖示（格網）模式、
  完整磁碟樹瀏覽、檔案編輯 —— 每一個砍掉的東西，都在替「三秒內回到我的工作資料夾」讓路。
- **例外：檔案操作交給 shell。** 剪下／複製／貼上／刪除走 Windows `IFileOperation`
  （衝突、進度、取消、資源回收筒全部由系統提供），剪貼簿讀寫 `CF_HDROP` 與
  `CFSTR_PREFERREDDROPEFFECT`，與檔案總管雙向互通。分割時的「送到另一窗格」只在右鍵選單
  手動執行，不綁快速鍵、不佔路徑列。
- **檢視器是窗格的一種內容模式**（2026-10-04 追加）：關掉就回檔案清單，不改變
  「不做檔案編輯／不做萬用搜尋」的立場。

三個核心物件：

| 物件 | 定義 | 為什麼需要 |
| --- | --- | --- |
| 我的資料夾 | 使用者自己加入的資料夾根清單，可各自展開樹狀 | 「我常去的資料夾」的具體化身 |
| 分頁（Tab） | 一次瀏覽工作階段，內含 1～2 個窗格 | 不同工作（例如後端／前端）互不干擾 |
| 窗格（Pane） | 一個「資料夾樹 + 檔案清單」的瀏覽單元 | 讓左右／上下對照兩個資料夾 |

**焦點模型（Wayfinding）**：任何時候只有一個**焦點窗格**（外框一道極細 accent 光邊，
狀態列標示位置）。鍵盤永遠作用於焦點窗格 —— **同時看兩個資料夾，但只操作一個。**

---

## 2. 已定案的決策

| 日期 | 題目 | 決定 |
| --- | --- | --- |
| 10-02 | 加入資料夾 | 原生資料夾選擇器（`tauri-plugin-dialog`） |
| 10-02 | Linux 路徑 | 純路徑、去掉 `/mnt/c`（UNC → `//server/share/...`） |
| 10-02 | 終端機 | 不內嵌；做成可自訂的**外部工具**清單（`run_external`，執行檔可換成 `pwsh.exe`） |
| 10-02 | 瀏覽紀錄 | 全域共用、上限 100、正規化路徑去重、MRU |
| 10-02 | 窗格上限 | 每個分頁固定 2 個 |
| 10-02 | 外觀 | **不透明視窗 + 分層純色材質**（理由見下） |
| 10-05 | 重新命名 | 只在**檔案清單**就地編輯（F2／Shift+右鍵）；後端 `IFileOperation::RenameItem`，同名衝突與復原交給 Windows |
| 10-05 | 擴充選單 | 剪下／複製／貼上／刪除／重新命名移到 **Shift+右鍵**，一般選單明顯變短；左側樹維持完整選單 |
| 10-08 | 同一層貼上 | 自己算 `主檔名 - 複製.副檔名`（再一次 `- 複製 (2)`）交給 `CopyItem` 的新名字；貼完把 `CopyOutcome.renamed` 那一列直接帶進就地編輯（剛好一個才做） |
| 10-08 | 刪除落點 | 刪前記下被刪項中**最上面**一項的可見索引，重讀後把選取放回同位（由後面那一列遞補；清單變空則不選） |
| 10-08 | 同步瀏覽／目錄比對 | 兩顆切換鈕預設關、狀態記住、未分割停用；同步**只鏡射相對移動**，比對**只比目前資料夾、不遞迴**（大小＋2 秒寬容的修改時間） |
| 10-08 | 7-Zip | 兩個內建外部工具、`7zG.exe`、只查標準安裝位置、只填空白執行檔、`single: true` |
| 10-08 | 檢視器換行 | 文字一律先把 `\r\n` 與孤立 `\r` 收成 `\n`（hljs 會把 `<span>` 插在 `\r`／`\n` 之間，被拆開的 CRLF 會讓畫面每行多一個空白行） |
| 10-08 | 空白鍵的檢視器位置 | 固定右／下窗格（`viewerSpaceRightOrBottom`，預設開）；右鍵選單不受影響 |
| 10-08 | 浮動面板 | 沒有 hover／鍵盤焦點時幾乎隱形（`--panel-idle-opacity`，預設 0.2），模糊一併關掉 |

**外觀決策的理由**：`transparent: true` 會讓 WebView2 走額外的合成路徑，且大面積
`backdrop-filter` 在捲動時每一格都要重算。改成不透明視窗 + 分層純色 + 亮邊與陰影，
視覺上仍保有「材質有厚度」的階層感，卻完全沒有額外的每格成本。日後若要真正的 Mica，
只需在 `lib.rs` 的 `setup` 呼叫 `set_effects` 並把材質權杖改回半透明，其餘版面與動態都不必動。

---

## 3. 功能現況

> 行為與不變量的細節寫在 `AGENTS.md`；這裡只列輪廓。

- **視窗／分頁／版面**：無邊框自繪標題列。`Ctrl+N` 新分頁、`Ctrl+Tab` 循環、`Ctrl+1..9`
  跳頁、中鍵關閉；關掉最後一個分頁＝開一個新分頁（不關視窗）。`Ctrl+\`／`Ctrl+Shift+\`
  分割、`Ctrl+Shift+W` 關窗格、`F6` 循環焦點、雙擊分隔線回中；交換窗格在路徑列的版面膠囊；
  工作階段可還原（設定）。
- **我的資料夾樹**：只列資料夾；第一層可混搭虛擬目錄（群組）與真實資料夾，最多兩層；
  別名（顯示格式字串，預設 `$aliasName-$RealFolderName`）只影響左側顯示與排序；拖曳只在
  同一個容器內排序；工具列六顆：新增／移除（可復原）／別名／排序
  （`Intl.Collator("zh-Hant", { numeric: true })`）／定位／收合全部；`list_subdirs` 懶載入；
  唯一會自動展開的是「定位」。磁碟機清單已從側欄移除，改用原生選擇器或 `Ctrl+L` 輸入路徑。
- **檔案清單**：只有條列模式（明確不做格網）；虛擬捲動（必要工程，後端上限 20,000 筆）；
  欄寬拖曳與雙擊自動調整；監控 `ReadDirectoryChangesW` 做**增量**更新、通知溢位才整份重讀
  （設定可關）；按下即選取、Ctrl／Shift／空白處拖曳框選。
- **右鍵選單**：依情境分流（空白處／單一資料夾／單一檔案／多選），只出現對當下這組對象
  成立的動作；外部工具再依 targets／副檔名／`enabled`／`single`／`autoDetect` 篩選。
- **檢視器**：Markdown／HTML（靜態預覽）／WebView2 能畫的圖檔／純文字與程式碼；搜尋面板、
  目錄索引、Mermaid 自動渲染、圖片前後導覽；唯讀、外部變更自動重載、不設檔案大小上限。
- **設定**：整頁模式（蓋掉路徑列與工作區、保留標題列）；分類為外觀、字型、動態、瀏覽、
  檢視器、我的資料夾、外部工具（清單 → 獨立編輯頁，草稿 + 明確儲存 + 離開守衛）、工作階段、
  關於（含快速鍵一覽）。
- **資料位置**：設定與紀錄（WebView2 localStorage）收在 `%LOCALAPPDATA%\PuffFile`，不跟
  執行檔走（`EBWebView` 是完整 Chromium profile，放 exe 旁會多出上百個檔案）；只有操作紀錄
  跟著執行檔（`<exe>\logs`，不可寫時退回 `%LOCALAPPDATA%\PuffFile\logs`）。
  位置只有一個來源 `core::paths`。

---

## 4. 動態系統、無障礙與字體排印

**原則**：可被使用者抓住的東西一律用 spring，不用 CSS transition／keyframes
（它們無法被中途抓取與反轉）；靜態的 hover／focus 才留 CSS。為維持「極致輕量」，
**不引入 Motion 等函式庫**，自建 `utils/spring.ts`（rAF + 臨界阻尼近似）與
`composables/useDragGesture.ts`。

| 互動 | damping | response | 備註 |
| --- | --- | --- | --- |
| 樹節點展開／收合 | 1.0 | 0.28 | 以 `grid-template-rows` 驅動，可中途反轉 |
| 窗格分割／收合 | 1.0 | 0.32 | 新窗格由邊緣長出；動畫結束才銷毀窗格 |
| 分頁切換 | 1.0 | 0.25 | 只動 transform／opacity |
| 分割線放開吸附 | 1.0 | 0.40 | 帶入釋放速度 |
| 甩動收合樹／窗格 | 0.85 | 0.30 | 只有帶動量才允許回彈 |
| 右鍵選單材質化 | 1.0 | 0.25 | scale 0.96→1 ＋ opacity ＋ blur 半徑一起動 |
| 設定頁進出 | 1.0 | 0.30 | 浮在工作區之上，淡入 + 微縮放，原點錨定右上齒輪 |
| 通知 Toast | 1.0 | 0.30 | |

其他規則：按鈕在 `pointerdown` 就給按壓回饋（`scale(0.97)`，不等 `click`）；
拖曳全程 1:1 跟手、放手把指標速度（px/s）交給 spring；越界以橡皮筋漸進抵抗；
空間一致性（選單從指標長出、關分頁時鄰頁往缺口滑）；只動 `transform`／`opacity`；
桌面端不濫用音效，只有「錯誤」與「移除可復原」等關鍵時刻才給回饋。

**偏好**：`prefers-reduced-motion` → 位移改成 200ms 交叉淡入、取消回彈；
`prefers-reduced-transparency` → 材質轉不透明、關閉 blur；`prefers-contrast: more` →
近不透明底 + 明確邊框。設定頁另有「動態效果」三態覆寫。

**對比（2026-10-05 調整）**：淺色佈景的三級文字灰都調深，確保在最淺的灰底
（`surface-muted`／`rail`／`canvas-dim`）上仍達 WCAG AA 的 4.5:1 —— `ink` 12+、
`ink-muted` 6.8、`ink-faint` 4.6；`accent` 當文字 ≥4.5:1、白字疊 accent ≥5.3:1、
`danger` ≥4.6:1。深色權杖不動；未使用窗格的 `ink-fainter` 維持刻意降階（約 3:1）。

**字體排印**：沿用系統字（`Segoe UI Variable`）；字距隨尺寸（標題 -0.01～-0.02em、內文 0、
10～11px 小字 +0.01em）；行高（大標題 1.1、清單列固定、狀態列 1.4）；間距用 `rem`
以尊重系統文字縮放。

---

## 5. 資料與介面

持久化（localStorage；`services/storage.ts` 是唯一存取點，store 負責呼叫）：

| Key | 內容 |
| --- | --- |
| `pufffile:folders` | `{ roots, expanded, expandedGroups }` |
| `pufffile:history` | `{ items: [{ path, name, at }] }`（≤ 100、去重、MRU） |
| `pufffile:session` | `{ tabs, activeTabId, layout, sizes }`（依設定決定是否還原） |
| `pufffile:settings` | 主題、字型、欄位、排序、外部工具、動態效果… |

**分層**：`commands/` 只做參數驗證與呼叫 `core/`；與 WebView 無關的邏輯（目錄列舉、
目錄監控、檢視器、shell、操作紀錄、路徑、外部程式偵測）都在 `core/`，可獨立測試。
前端所有 IPC 一律經 `services/api.ts`，沒有 Tauri 執行環境時自動降級為 Mock
（`npm run dev` 就是靠這一層跑起來的）。

---

## 6. 邊界條件與風險

1. **無邊框視窗**：縮放熱區、圓角、陰影需實測；必要時退回「無邊框但不透明 + CSS 材質」。
2. **Snap Layouts**：自繪標題列不會有 Win11 原生版面配置彈出，需 P/Invoke hit-test（選配）。
3. **超長路徑**：`\\?\` 前綴已在 `core::display_path` 處理；複製 Linux 路徑要另外處理 UNC。
4. **兩窗格同時串流**：驗證大量項目時兩個 `spawn_blocking` 不互相餓死。
5. **20,000 筆清單**：沒有虛擬化一定卡 —— 列為必要工程，不是加分項。
6. **右鍵選單與原生選單衝突**：`main.ts` 用全域 `contextmenu` 攔截（capture 階段
   `preventDefault`、不 `stopPropagation`）關掉 WebView2 的原生選單，自繪選單不受影響；
   `input`／`textarea`／`contenteditable` 例外，保留系統的剪下／複製／貼上選單。
   （Tauri 2.11 尚未暴露 `AreDefaultContextMenusEnabled`，故採前端攔截。）

---

## 7. 待辦與未完成

**還沒做**

- 分頁拖曳排序是「即時換位」，沒有跟著指標位移的浮動效果。
- 樹節點展開目前是瞬間出現，尚未加上淡入。
- Mica 未採用（見 §2 外觀決策）；要做只需 `set_effects` ＋ 半透明權杖。
- Mermaid：**待桌面驗證** portable exe 內的 lazy chunk 是否正常載入；若失敗改成靜態 import。
- HTML 靜態預覽：**待桌面驗證** `srcdoc` + `sandbox="allow-same-origin"` 下父層取得
  `contentDocument`、框內載入 blob URL、框內 keydown 轉送（Esc／F5／F6）；備案是改用
  Shadow DOM 渲染、資源全部內嵌 `data:` URI。
- 公開授權宣告：`highlight.js` 是 BSD-3-Clause、內嵌的 Vue 文法 CC0-1.0；日後若要公開發佈，
  需在「關於」或隨附檔案補上版權聲明。

**目錄監控的後續（2026-10-03 決議：先記下來，暫不做）**

1. **網路磁碟的輪詢備援**：不支援 `ReadDirectoryChangesW` 的位置目前放棄自動更新，清單仍可
   手動重新整理；要做就是加低頻輪詢，並在「事件／輪詢」之間切換。
2. **左側樹的節點監控**：現在是「收合即丟棄子項快取、展開時重讀」；要即時反映外部新增的
   資料夾，需對展開中的節點掛監控 —— 成本是每個節點一個控制代碼，得先決定上限
   （例如只監控可見範圍）。
3. **樹與清單的自動更新連動**：外部新增資料夾時清單會更新，樹要收合再展開才看到；連動需要
   把監控事件同時餵給 `stores/folders.ts` 的子項快取。

**已評估、決定先不做（保留理由，避免重做白工）**

- **PDF 檢視器（2026-10-04）**：WebView2 其實支援（本機 runtime 內含 `mspdf.dll`），
  但 wry 預設傳 `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection` ——
  `msPdfOOUI` 正是 PDF 檢視器 UI。要開得在 `tauri.conf.json` 加 `additionalBrowserArgs`
  覆寫，並自己補回其餘兩個（覆寫會蓋掉預設值）。成本其實很低：可完整重用檢視器管線
  （base64 分塊串流、Blob URL、kind 分派、自動重載、右鍵與 `Space` 入口），只要多一個
  `pdf` kind 與一個 `<iframe :src="blobUrl">`，零新增依賴、exe 不變大；唯一風險是內建 viewer
  在 `blob:` 的 iframe 內是否正常（工具列、翻頁、文字選取、右鍵），要先 spike。
  另一個取捨：blob 路徑的記憶體約為檔案大小的 2.3 倍。
- **內嵌終端機（2026-10-09 評估）**：`xterm.js` ＋ 用專案現有的 `windows` crate 直接呼叫
  ConPTY（`CreatePseudoConsole`／`CreatePipe`／`STARTUPINFOEXW` ＋
  `PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE` ＋ Job Object），**不用 `portable-pty`**
  （會引進第二套 Win32 綁定 `winapi 0.3` + `shared_library`，把 ConPTY 旗標寫死，
  且載入失敗是 panic）。形式是窗格內容模式（與檢視器同層），cmd／pwsh 每次開啟時選、
  記住上次，cwd ＝ 該窗格目前路徑。決議：**先不做**。
- **Markdown 標題錨點**：`#anchor` 連結只呈現文字，不產生錨點。
- 影音、Office，以及不支援的圖片格式（heic／tif／psd）一律交給系統預設程式。
  Markdown 也不執行原始 HTML。

**Mermaid 圖表尺寸（2026-10-09 修正）**

- SVG 的 viewBox **一律保持 mermaid 原樣，不可歸零**。mermaid 產生的是
  `(bbox.x - p) (bbox.y - p) (bbox.width + 2p) (bbox.height + 2p)`，內容在四邊各留
  `padding`；改寫成 `0 0 w h` 會把可見視窗往右下推，內容 inset 大於 `2p` 時就切掉右緣與
  下緣（SVG 根元素預設 `overflow: hidden`，所以症狀是裁切而不是溢出）。
- `flowchart.diagramPadding` 因此改用 mermaid 的預設值 `8`；留白交給
  `.md-mermaid-view` 自己的內距，不需要在圖裡再留一次。

**量測記錄（日後重評時不必重測）**

- **語法高亮**：`highlight.js` 的 `lib/common` ＋ 38 種精選語言＝541.6 KB min／gzip 188 KB／
  brotli 169 KB（全量 193 種＝1.2 MB min／gzip 404 KB，是其 9 倍，故不採用）；portable exe
  由 4.99 MB 增至約 5.07 MB。
- **Mermaid**：官方 mermaid 12 的 lazy chunk raw 4.86 MB／gzip 1.40 MB（最大單塊 `elk`
  約 1.5 MB）；Tauri brotli 內嵌後單檔 exe 約 +1.2～1.4 MB。
