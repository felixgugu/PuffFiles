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
| 10-09 | 圖片與 PDF 的內容來源 | 一律走自訂協定 `stream`：`<img>`／WebView2 內建 PDF viewer 直接讀（支援 Range），不再用 base64／Blob。圖片因此拿掉整份 base64 編碼、逐批 IPC 與 JS 解碼（見 §7 量測） |
| 10-09 | DOCX 檢視器 | 用 `docx-preview` 0.4.1（lazy chunk）把 `.docx／.docm` 排成 DOM，位元組同樣走 `stream` 協定由 `fetch` 取回；**頁面固定白紙**、窗格較窄時自動等比縮小；`renderAltChunks: false`（不執行文件裡的程式碼）；**上限 50 MB**（整份解壓與排版都在主執行緒） |

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
- **檢視器**：Markdown／HTML（靜態預覽）／WebView2 能畫的圖檔／PDF（自訂協定 `stream`
  串流，交給 WebView2 內建 viewer）／DOCX（`docx-preview` 排版，位元組同樣走 `stream`）／
  純文字與程式碼；搜尋面板、目錄索引、Mermaid 自動渲染、圖片前後導覽；唯讀、外部變更
  自動重載。圖片、PDF 與文字不設大小上限（可串流或逐批讀取）；DOCX 得整份解壓，上限 50 MB。
  **目錄索引面板由 Markdown 與 DOCX 共用**（DOCX 沒有內建大綱，目錄由使用者選取文字自己
  累積成「書籤目錄」，純文字／程式碼同理；見下方的設計紀錄）。
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

**DOCX 書籤走 IndexedDB**（`services/bookmarks.ts`，資料庫 `pufffile`／store
`docx-bookmarks`，主鍵是 `utils/path.ts` 的 `normalizeKey()`）：內容是「一份文件 → 一筆
書籤清單」，會隨看過的文件一直長，與上面幾個 key 搶同一個 localStorage 配額並不合理
（寫不進去時 `writeJson` 只能無聲放棄）。它仍然落在同一個 WebView2 profile
（`%LOCALAPPDATA%\PuffFile`），所以「應用資料只有一個位置」的規則沒有被打破。
啟動時整批讀進 `stores/bookmarks.ts`，之後的查詢與更新都是同步的。

**分層**：`commands/` 只做參數驗證與呼叫 `core/`；與 WebView 無關的邏輯（目錄列舉、
目錄監控、檢視器、shell、操作紀錄、路徑、外部程式偵測）都在 `core/`，可獨立測試。
前端所有 IPC 一律經 `services/api.ts`，沒有 Tauri 執行環境時自動降級為 Mock
（`npm run dev` 就是靠這一層跑起來的）。
PDF 另外有一條不經 IPC 的路：`stream` 自訂協定（`commands/stream.rs` 的 token 註冊表 ＋
`core/stream.rs` 的 Range／MIME 純邏輯），frontend 只把 URL 交給 iframe。

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
7. **DOCX 的 zip 炸彈**：`docx-preview` 會把整份文件解壓進記憶體，而 50 MB 的上限只看
   **壓縮後**的大小 —— 極小的檔案理論上可以解壓成遠大於上限的內容。只會開使用者自己挑的
   檔案，先不處理；真要防得自己列出 ZIP 目錄的未壓縮大小（JSZip 沒有公開這個介面）。

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
- PDF 大檔（> 50 MB）捲動時的記憶體峰值還沒實測；`Range` 是否確實被轉送到處理器也只
  能用 DevTools 看一次狀態碼確認。

**目錄監控的後續（2026-10-03 決議：先記下來，暫不做）**

1. **網路磁碟的輪詢備援**：不支援 `ReadDirectoryChangesW` 的位置目前放棄自動更新，清單仍可
   手動重新整理；要做就是加低頻輪詢，並在「事件／輪詢」之間切換。
2. **左側樹的節點監控**：現在是「收合即丟棄子項快取、展開時重讀」；要即時反映外部新增的
   資料夾，需對展開中的節點掛監控 —— 成本是每個節點一個控制代碼，得先決定上限
   （例如只監控可見範圍）。
3. **樹與清單的自動更新連動**：外部新增資料夾時清單會更新，樹要收合再展開才看到；連動需要
   把監控事件同時餵給 `stores/folders.ts` 的子項快取。

**已評估、決定先不做（保留理由，避免重做白工）**

- **內嵌終端機（2026-10-09 評估）**：`xterm.js` ＋ 用專案現有的 `windows` crate 直接呼叫
  ConPTY（`CreatePseudoConsole`／`CreatePipe`／`STARTUPINFOEXW` ＋
  `PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE` ＋ Job Object），**不用 `portable-pty`**
  （會引進第二套 Win32 綁定 `winapi 0.3` + `shared_library`，把 ConPTY 旗標寫死，
  且載入失敗是 panic）。形式是窗格內容模式（與檢視器同層），cmd／pwsh 每次開啟時選、
  記住上次，cwd ＝ 該窗格目前路徑。決議：**先不做**。
- **Markdown 標題錨點**：`#anchor` 連結只呈現文字，不產生錨點。
- 影音、舊版與其他文書／試算表格式（`.doc`／`.odt`／`.rtf`／`.xls`／`.ppt`…），以及
  不支援的圖片格式（heic／tif／psd）一律交給系統預設程式。Markdown 也不執行原始 HTML。

**書籤目錄：DOCX 與純文字（2026-10-09 新增）**

- **問題**：`docx-preview` 不產生大綱，Word 文件裡的標題在 DOM 裡只是「有樣式的 `<p>`」；
  文件內的書籤連結同樣沒有 id（`renderHyperlink` 只還原 `href`，`#anchor` 跳不到東西）。
  純文字／程式碼更是沒有任何結構。也就是說，長文件與長日誌在檢視器裡沒有導覽手段。
- **做法**：目錄由使用者自己累積 —— 選取文字 → 加入書籤 → 面板（與 Markdown 的目錄索引
  同一個元件）就是這份文件的目錄。位置不是記節點（每次渲染都是新的 DOM），而是記
  「文字 ＋ 它附近的線索」：DOCX 記區塊索引／區塊指紋／位移，純文字記整份文字的位移／
  行號／行指紋（`utils/docxBookmark.ts`、`utils/textBookmark.ts`，共用部分在
  `utils/bookmarkAnchor.ts`）。兩種錨點是判別聯合，種類不符就當成失效。
- **為什麼不用「Word 的大綱階級」自動生成目錄**：`docx-preview` 會把 `w:outlineLvl`
  落在 `p` 的樣式上，但要還原成正確的層級與標題文字得自己讀 `styles.xml` 的樣式鏈，
  而且**不是每份文件的標題都用了正確的樣式**（手動放大字級的一堆）。使用者自己指認
  哪一段重要，比猜文件結構準確，也適用於沒有大綱概念的合約、公文與表格。
- **錨點對不回來時的行為**：依序退到「指紋 → 開頭 20 字 → 選取的文字」，都失敗就在面板上
  淡化並標「找不到位置」。刻意**不做**「索引還在就跳過去」這種硬猜 —— 指到錯的段落比說
  「找不到」更難察覺。退到後兩條時只跳區塊不標示文字（因為那段文字已經不在了）。
- **純文字為什麼只做到 4 MB**：對位要在整份文字上做比對、也要走 DOM 文字節點才能建
  `Range`，沿用搜尋的 `MAX_SEARCH_TEXT`（4 MB）比另訂一個數字誠實；超過就整組停用，
  開關的提示會說明原因。HTML 不支援（預覽與原始碼兩種模式共用一份清單會讓人困惑），
  Markdown 不支援（已經有自動抽取的目錄）。
- **落地**：IndexedDB（理由見 §5 的說明）。寫入前複製成純資料是必要的：Pinia 的響應式代理
  無法結構化複製，直接 `put` 會讓「第一筆成功、之後每一筆失敗」而畫面上完全看不出來
  （開發時就是被這一條咬到才補上）。
- **刪除不跳確認對話框**：單筆書籤的價值很小、重建成本也低（重新選取一次就好），改成
  通知上的「復原」，5 秒內都能挽回。破壞性操作該確認，但確認的成本要對得上代價。
- **面板配色跟隨內容（同日修正）**：DOCX 的頁面固定白紙，深色主題的深色面板疊上去時，
  面板自己的淺色文字會落在白紙上 —— idle（不透明度 0.2）時幾乎完全看不見。做法是
  `main.css` 的 `@utility panel-light`：在面板子樹上把權杖換成淺色那一組（與
  `pane-inactive` 同一套手法，不改個別樣式）。HTML 預覽的 iframe 是頁面自己的顏色，
  所以另外用 `utils/html.ts` 的 `isLightDocument()` 依頁面實際底色選面板；`transparent`
  或解析不出來的顏色當成白底（檔案檢視器裡最常見的情況，誤判只影響面板對比）。
- **兩個浮動面板互相遮擋（同日修正，回報的「z-index 問題」）**：使用者回報「滑鼠移到某個
  書籤時面板變透明、點不到，docx 的文字像在面板之上」。**重現成功**（真的 Chrome ＋ 真的
  `DocxView` ＋ 真的 `docx-preview` 排版）：搜尋面板開啟時會讓開目錄索引，但那段位移是
  **掛載時量一次**就固定了；之後書籤變多讓目錄面板長高，兩個面板就重疊，而搜尋面板在 DOM
  後面（同 z-index）所以畫在上面 —— 被蓋住的書籤列 hover 不到（面板掉回 idle 的 0.2
  半透明，看起來就是「文件在面板上」）也點不到。
  修法：面板把自己的 `rect` 寫進模組層級的 `panelRects`（鍵 `<paneId>:<panel>`），要避讓的
  那一個讀它重算；`PanelBounds` 多了 `top`，讓被讓開的那一個把「對方下緣」當成可用範圍的
  上緣（少了它 `clampPanel` 會把面板夾回原位）。順手把所有檢視器內文加上 `isolate`，
  讓文件帶進來的 z-index 不可能蓋到面板。
  一開始的假設（是 `zoom` 或 `docx-preview` 的 `article { z-index: 1 }` 造成堆疊錯亂）
  在 DPR 1／1.25／1.5、zoom 0.5／0.78／1、深色主題、長文件與含圖片的文件上都試不出來，
  真正的觸發條件是「兩個面板同時開著」。
- **移除檢視器內文的原生右鍵選單**：`data-native-menu` 原本同時代表「保留原生選單」與
  「文字可選取」。現在內文改用 `select-text`、不再保留原生選單，複製走 `Ctrl+C`；
  `main.ts` 的例外只剩輸入框。取捨是刻意的：整個 App 只有檢視器內文會冒出瀏覽器選單，
  而它提供的也只有「複製／全選」兩項，鍵盤本來就有。
- **驗證方式**：錨點計算與 store／IndexedDB 都用臨時的瀏覽器 harness 跑過（真的 Chrome、
  docx-preview 形狀的假 DOM 與假的長文字，共 50 項斷言：跨文字節點的位移、重排後重新對位、
  插入段落／增刪行、改寫段落、路徑大小寫、重新命名搬移、刪除復原、壞資料容忍、兩種錨點
  互不干擾），面板與跳轉則用真的應用程式在瀏覽器模式驗證（Markdown 目錄索引、DOCX 與
  純文字書籤面板各一輪，含深色主題下的淺色面板）。harness 不留在專案裡（沒有測試框架，
  留下的話只會變成沒人跑的檔案）。
- **待桌面驗證**：DOCX 檢視器本身在瀏覽器預覽模式不存在（位元組走 `stream` 自訂協定），
  所以「真的開一份 .docx ＋ 選取 ＋ 跳轉」只能在 portable exe 裡走一次；要留意的是
  `docx-preview` 實際產生的 DOM 與假 DOM 的差異（例如文件用了頁面欄位或註腳），
  以及 `.docx-wrapper` 的 `zoom` 與跳轉捲動的搭配（捲動是平移，兩者獨立，理論上不互相影響）。

**檢視器標頭：捲動鈕與動作膠囊（2026-10-09）**

- **需求**：標頭加「移動」用的小功能（跳到最上面／最下面、PageUp／PageDown），並用膠囊
  區分不同種類的動作。
- **四顆膠囊**：捲動｜檢視器功能｜檔案動作｜窗格。用既有的膠囊樣式（`rounded-lg
  bg-surface-muted p-0.5`、24px 按鈕、14px 圖示），所以標頭原本 28px 的按鈕一起改成 24px
  —— 24px 仍是可點擊下限，也與路徑列一致；不這樣做會出現「同一條標頭兩種尺寸」。
- **只給有捲動容器的檢視器**：Markdown／DOCX／純文字與程式碼／HTML 兩種模式。圖片沒有捲動
  容器（只有 fit 與實際大小切換），PDF 是 WebView2 內建的 viewer（在自己的一份文件裡），
  兩者都不顯示那一組按鈕 —— 顯示不能用的按鈕只是在解釋「為什麼沒反應」。
- **容器怎麼拿到**：標頭與內容沒有共同父元件可以傳 ref，所以在模組層級的 `Map<PaneId,
  Element>` 註冊（`useViewerScroll` 與 `HtmlView`），而不是讓標頭 `querySelector` 硬找。
  逐頁位移取可視高度的 0.9（與瀏覽器一頁的視覺行數一致）。
- **兩端的鈕會停用**：容器回報 `atTop`／`atBottom` 兩個**布林值**（不是原始量測值）——
  相同的值不觸發更新，捲動過程中只有跨越端點時標頭才重繪，不必每一幀跟著捲動重畫。
- **窄窗格**：窗格最窄是工作區的 20%（`MIN_RATIO`），所以依序收起次要膠囊（先捲動、再
  檔案動作），搜尋／目錄／關閉永遠保留。寬度用常數估算（`utils/viewerHeader.ts`）而不是量
  DOM：按鈕與間距都是固定 px、只有檔名會壓縮，估算與實際一致。實測門檻（檢視器膠囊 3 顆）
  ＝431px／321px，與估算一致。
- **驗證**：真的應用程式（CDP 驅動）驗過四顆膠囊的標籤與順序、兩端的停用狀態、逐頁位移
  662px（＝0.9×735）、`PageUp`／`PageDown`／`Home`／`End` 與按鈕等效且 `preventDefault`、
  三種視窗寬度下的收起順序（364px 收起捲動、274px 再收起檔案、放大後回來）、圖片與沒有
  檢視器的檔案不顯示捲動鈕，以及 HTML 預覽捲的是 iframe 自己的文件（不同的註冊路徑）。
  PDF 只能在桌面版確認（瀏覽器預覽模式沒有 PDF 檢視器）。

**Mermaid 圖表尺寸（2026-10-09 修正）**

- SVG 的 viewBox **一律保持 mermaid 原樣，不可歸零**。mermaid 產生的是
  `(bbox.x - p) (bbox.y - p) (bbox.width + 2p) (bbox.height + 2p)`，內容在四邊各留
  `padding`；改寫成 `0 0 w h` 會把可見視窗往右下推，內容 inset 大於 `2p` 時就切掉右緣與
  下緣（SVG 根元素預設 `overflow: hidden`，所以症狀是裁切而不是溢出）。
- `flowchart.diagramPadding` 因此改用 mermaid 的預設值 `8`；留白交給
  `.md-mermaid-view` 自己的內距，不需要在圖裡再留一次。

**量測記錄（日後重評時不必重測）**

- **DOCX（2026-10-09）**：`docx-preview` 0.4.1 ＋它的相依 `jszip` 合起來是**一個** lazy
  chunk（`dist/assets/docx-preview-*.js`，171.4 KB／gzip 49.1 KB），只有真的開 DOCX
  才會下載與解析。
- **圖片走 base64 的成本（2026-10-09 實測，40 MB 的圖）**：Rust 手寫的 `encode_base64`
  要 **477 ms（debug）／42 ms（release）**，而且它是先把整份編完才開始送；JS 端的
  `join`＋`atob`＋逐位元組迴圈合計約 80 ms（每 MB 約 2 ms，不是瓶頸）。所以改用
  `stream` 協定省下的是 Rust 端編碼、逐批 IPC 與 JS 端那些暫存字串。
- **語法高亮**：`highlight.js` 的 `lib/common` ＋ 38 種精選語言＝541.6 KB min／gzip 188 KB／
  brotli 169 KB（全量 193 種＝1.2 MB min／gzip 404 KB，是其 9 倍，故不採用）；portable exe
  由 4.99 MB 增至約 5.07 MB。
- **Mermaid**：官方 mermaid 12 的 lazy chunk raw 4.86 MB／gzip 1.40 MB（最大單塊 `elk`
  約 1.5 MB）；Tauri brotli 內嵌後單檔 exe 約 +1.2～1.4 MB。
