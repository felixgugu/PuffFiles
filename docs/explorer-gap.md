# 與 Windows 檔案總管的差距清單與決策記錄

> 2026-11-01 建立。這份文件只記錄「**跟真正的檔案總管比，PuffFile 還做不到什麼**」，
> 以及每一項要補／不補的理由。行為與不變量本身寫在 `AGENTS.md`，設計取捨寫在
> `docs/redesign-plan.md`。
>
> 為什麼要寫下來：這些缺口大部分是**架構取捨**（自繪 UI、單視窗、只走檔案系統路徑），
> 不是 bug。沒有記錄的話，每次有人問「為什麼不能按右鍵屬性」就得重新評估一次。

---

## 0. 決策摘要

| # | 項目 | 決策 | 一句話理由 |
| --- | --- | --- | --- |
| 1 | 原生右鍵選單（`IContextMenu`） | **不做** | 選單會變成各軟體的外掛大雜燴，跟本專案「乾淨、可預期」的選單設計相反 |
| 2 | 拖曳到／從檔案總管（OLE 拖曳來源與放置目標） | **可考慮** | 與系統互通最直接有感，但成本高、邊界情況多 |
| 3 | 屬性對話框（shell 的 `properties` verb） | **已完成（2026-11-01）** | 成本最低、一次補齊屬性／權限／版本資訊等一堆缺口 |
| 4 | 真實 shell 圖示與縮圖（`IShellItemImageFactory`） | **可考慮** | 讓清單「看起來像檔案總管」的關鍵，但要處理快取與大目錄效能 |
| 5 | 接 Windows Search 索引／內容搜尋 | **不做** | 與產品定位不符：本專案解決的是「每天反覆進出同幾個資料夾」，不是全碟搜尋 |
| 6 | 小缺口（Shift+Delete、Ctrl+Z、批次改名、建立捷徑） | **可考慮** | 每一項都小，但要挑對日常真的有差的先做 |

---

## 1. 第 3 項（已完成 2026-11-01）：屬性對話框（`properties` verb）

### 這是什麼

Windows 的「內容」對話框**不是一個可以自己畫的 API**，而是 shell 的屬性表處理常式
（property sheet handler）。任何人只要把 `properties` 這個 verb 交給 shell，就會叫出
**跟檔案總管完全同一個**對話框，連第三方加的自訂頁籤（Git 狀態、雲端同步、防毒掃描）
都會出現。

### 實際做法（三種寫法都試過，只有一種能用）

原本評估寫的是「單選用 `ShellExecuteEx`、多選用 `IShellItemArray` ＋
`SHCreateDefaultContextMenu`」。實際在 Windows 11 24H2 上把三種都跑過一輪
（用看門狗讀出彈出視窗的標題與內容），結果：

| 寫法 | 實測結果 |
| --- | --- |
| `IContextMenu` ＋ `InvokeCommand("properties")` | 選單裡確實有「內容」項目，但 `GetCommandString` 不提供 canonical verb；EX 版本跳「Desktop 這個項目的內容無法使用」，ANSI 版本回 `S_OK` 卻什麼都不開 |
| `ShellExecuteEx` ＋ `SEE_MASK_INVOKEIDLIST` | 回 `TRUE`，但**什麼都不開**（連錯誤都沒有） |
| `SHMultiFileProperties` ＋ `SHCreateDataObject` | 回 `S_OK`，也是**什麼都不開**（空包彈） |
| **`SHObjectProperties(hwnd, SHOP_FILEPATH, 路徑)`** | **正常開出屬性表**（探測讀到「屬性」頁、修改日期、存取日期、確定／取消／套用） |

所以採用最後一種：

```rust
SHObjectProperties(hwnd, SHOP_FILEPATH, path, None)
```

為什麼這樣選：

- 文件化的 API、吃路徑字串（不必自己組 PIDL 或 `IDataObject`）、可以指定 owner，
  屬性表會 modal 在我們的視窗上。
- 不必去猜 `IContextMenu` 的命令 id —— 第三方擴充會改變選單順序，猜錯就是執行別的動作。
- **代價是隻能一次顯示一個對象**：這台機器上沒有可用的「合併多選屬性表」API
  （`SHMultiFileProperties` 是空包彈），所以多選時顯示右鍵那一項的內容。

### 補到哪些缺口（現在都做得到了）

- 大小、**大小佔用空間**（壓縮／叢集差異）
- 建立／修改／存取時間
- 屬性勾選：**唯讀、隱藏、封存**
- **安全性（ACL／權限）頁**
- **版本資訊、數位簽章**（執行檔、安裝檔）
- **共用／網路路徑**（Windows 的共用頁籤）
- 第三方 property sheet（OneDrive 的可用性、Git 狀態…）

### 落地位置與注意事項

- 後端：`src-tauri/src/core/properties.rs`（`show()`）、指令
  `commands::shell::show_properties`，登記在 `lib.rs` 的 `invoke_handler`。
- 一定要 `spawn_blocking`（走 `run_logged`）：指令會停在屬性視窗關閉為止。
- COM 走 STA（`CoInitializeEx(COINIT_APARTMENTTHREADED)`）；owner 取主視窗的 `hwnd()`，
  屬性表才會 modal 在正確的視窗上。
- 操作紀錄寫一行 `PROPERTIES`（`core/oplog.rs`），「按了沒反應」時查得到。
- 前端：右鍵選單最後一項「屬性」與 `Alt+Enter`，兩者共用 `usePathMenu.run("properties")`；
  **只傳右鍵的那一項**（`target.path`），瀏覽器 mock 只印 console。
- 驗證方式（可重跑）：暫時的測試會真的叫出屬性表，再由另一條執行緒用
  `GetWindowTextW` 讀出視窗標題／子控制項文字後送 `WM_CLOSE`；「Desktop ＋ 這個項目的
  內容無法使用」與「屬性、修改日期…」一眼就能分辨，這次就是靠它找出前三種寫法都是假成功。

---

## 2. 其餘候選項：需要什麼、成本多大

### 2. 拖曳到／從檔案總管（OLE）

- **拖出去**：需要 `IDataObject`（`CF_HDROP`）＋ `IDropSource` ＋ `DoDragDrop`，而且要有
  原生視窗控制代碼（`hwnd`）當拖曳來源；WebView2 自己不會提供。
- **拖進來**：要在視窗上註冊 `IDropTarget`（或用 WebView2 的 drop 事件，再由 Rust 解
  `CF_HDROP`），還要決定「放到資料夾列／空白處／左側樹」的命中語意 —— 前半段
  `utils/dragDrop.ts` 的 `planDrop()` 可以直接重用。
- 成本：**2～3 天**（拖出去 1 天、拖進來 1 天，剩下是邊界情況：權限、跨磁碟、取消、
  與現有 `IFileOperation` 的確認流程整合）。
- 目前狀態：`AGENTS.md` §3.9 已列為已知缺口（WebView 當不了 OLE 拖曳來源）。

### 4. 真實 shell 圖示與縮圖

- **只要圖示**：`SHGetFileInfo`（`SHGFI_ICON`／`SHGFI_SMALLICON`）或
  `IShellItemImageFactory::GetImage` 帶 `SIIGBF_ICONONLY`，取 HICON 轉 PNG。
- **要縮圖**：同一個介面帶 `SIIGBF_THUMBNAILONLY`，尺寸自己指定；影片、PDF、Office
  都能拿到系統縮圖（有的靠第三方 thumbnail provider）。
- 難處不在 API，而在**量**：每個項目一次 shell 呼叫＋解碼，大目錄要分批、可取消、
  要有記憶體快取（否則捲動時重算）；縮圖尺寸改變等於整批失效。
- 建議先做**圖示**（成本 1 天內，對「看起來像不像檔案總管」幫助最大），縮圖之後再說。
- 現況：`utils/fileKind.ts` 的 `iconFor()` 是分類圖示（資料夾／程式碼／圖片／壓縮檔…），
  exe 的實際圖示、`.docx` 的 Word 圖示都看不到。

### 6. 小缺口（各自獨立、可個別挑）

| 項目 | 內容 | 成本 |
| --- | --- | --- |
| Shift+Delete | 目前 `core/shell.rs` 一律帶 `FOF_ALLOWUNDO`（一定進回收桶）。改成刪除指令多一個 `permanent` 參數、不帶 `FOF_ALLOWUNDO`，前端按 Shift+Delete 時多跳一次確認 | 半天 |
| Ctrl+Z | 操作本身已登記進 Windows 的復原堆疊（要到檔案總管按 Ctrl+Z）。app 內要自己的復原，就等於要維護一份操作堆疊（改名／刪除／移動各需要不同的反向操作） | 1～2 天，且容易做成半套 |
| 批次改名 | 多選 → 樣板（`$name`、`$n`、`$ext`、取代、大小寫）→ 預覽 → 依序 `IFileOperation::RenameItem`；要處理同名衝突與中途失敗 | 1～2 天 |
| 建立捷徑 | `IShellLink` ＋ `IPersistFile`，檔名衝突沿用既有規則；比批次改名單純 | 半天 |
| 永久刪除的「跳過回收筒」提示 | 與 Shift+Delete 同一件事 | — |

---

## 3. 明確不做

### 1. 原生右鍵選單（`IContextMenu`）

- 選單會變成**各軟體外掛的大雜燴**：Git、SVN、雲端硬碟、壓縮軟體、防毒、PDF 工具…
  每一套都往同一個地方塞項目，順序與文案完全不受控制。本專案的選單是刻意設計的
  （依情境分流、外部工具自己管理），這一項與產品定位直接衝突。
- 連帶**不做**的還有：傳送到、釘選到快速存取、授予存取權、還原舊版。
  真的需要時，用「外部工具」或「在檔案總管中顯示」繞過去。
- 例外：**第 3 項的屬性對話框不算原生選單**，它只是借用同一個 shell 元件，
  不需要把整份 `IContextMenu` 攤在畫面上。

### 5. Windows Search 索引／內容搜尋

- 產品定位是「每天反覆進出同幾個資料夾」，不是全碟搜尋工具。
- 現有的**扁平化展示 ＋ 檔名過濾**已經能處理「這個資料夾底下有哪些檔案叫 xxx」
  （上限 5 萬筆、不自動更新），再用 Windows Search 索引只會帶來索引損毀、
  結果延遲、許可權等一連串支援問題。

---

## 4. 現況差距一覽（含程式碼位置）

| 面向 | 現況 | 位置 |
| --- | --- | --- |
| 右鍵選單 | 全部自繪；沒有 shell 擴充功能 | `src/main.ts`（攔掉原生 contextmenu）、`src/composables/usePathMenu.ts` |
| 屬性／權限／版本資訊 | **已補**：右鍵「屬性」／`Alt+Enter` 叫出 shell 的屬性表 | `src-tauri/src/core/properties.rs` |
| 拖曳 | 只能在自己兩個窗格與左側樹之間拖 | `composables/useFileDrag.ts`、`utils/dragDrop.ts` |
| 檢視模式 | 只有條列；圖示是分類圖示 | `components/files/FileTableRow.vue`、`utils/fileKind.ts` |
| 縮圖 / 預覽窗格 | 沒有縮圖（檢視器涵蓋 md／html／圖檔／pdf／docx／聲音／影片／壓縮檔清單／文字） | `composables/useViewer*`、`stores/viewer.ts` |
| 欄位 | 固定 7 種，可拖寬、不能自訂或換順序 | `stores/settings.ts` 的 `ALL_COLUMNS` |
| 分組／多欄排序／每資料夾檢視記憶 | 沒有 | — |
| 視窗 | 單一視窗、每分頁最多兩個窗格 | `src-tauri/src/lib.rs` |
| 資料夾上限 | 20,000 筆（超過截斷）；扁平化 50,000 | `src-tauri/src/core/dir.rs` 的 `MAX_ENTRIES`、`core/flat.rs` |
| 刪除 | 一律進回收桶（`FOF_ALLOWUNDO`），沒有永久刪除 | `src-tauri/src/core/shell.rs` |
| 復原 | app 內沒有 Ctrl+Z；要回檔案總管按 | 同上（操作已登記進 Windows 復原堆疊） |
| 提權 | 沒有；拒絕存取就是錯誤，不會「按繼續以取得權限」 | 尚無 |
| 批次改名 | 一次只能一個（F2 就地編輯） | `components/files/FileListView.vue` |
| 新增項目 | 只有資料夾與空白文字檔；不能建立捷徑 | `commands/fs.rs` |
| 資源回收筒／ISO／zip 當資料夾／VHD | 資源回收筒與 VHD 不支援；ISO／zip／7z…**有唯讀清單檢視器**（2026-11-14），但仍不能「當資料夾」瀏覽、拖曳進出或單檔預覽 | `core/archive.rs`、`viewer/ArchiveView.vue` |
| 網路 | 可手動輸入 UNC，但沒有網路探索／對應磁碟機 | `commands/system.rs` |
| 雲端（OneDrive） | 沒有同步狀態欄、不能「釋放空間」 | — |
| 磁碟機／快速存取 | 不在側欄（只用在啟動時的起始路徑） | `stores/system.ts`、`commands/system.rs` |
| 搜尋 | 只過濾已載入清單的檔名／相對路徑 | `stores/explorer.ts` 的 `searchText()` |
| 鍵盤 | 已有 `Alt+Enter`；沒有 type-ahead、`Alt+D／F4`、Ctrl+Shift+T | `composables/useKeyboardShortcuts.ts` |

### 已經做對、不必重做的部分

- 複製／搬移／刪除／改名走 `IFileOperation`：進度、同名衝突、取消、Ctrl+Z 登記
  都是 Windows 給的，比自製好。
- 檔案剪貼簿與檔案總管雙向互通（`CF_HDROP`，`core/shell.rs`）。
- 目錄監控（`ReadDirectoryChangesW`）做增量更新，只有溢位才整份重讀。
- 狀態列的選取數量與總大小（`components/layout/StatusBar.vue`）。

---

## 5. 建議順序

1. ~~**屬性對話框（第 3 項）**~~ —— **已完成 2026-11-01**（見 §1）。
2. **真實 shell 圖示（第 4 項的前半）** —— 一天內，視覺上最接近「檔案總管」。
3. **Shift+Delete 與建立捷徑（第 6 項的部分）** —— 各半天，都是小而明確的缺口。
4. **拖曳出去／拖曳進來（第 2 項）** —— 2～3 天，需要新的 OLE 層與邊界測試。
5. 批次改名、縮圖、Ctrl+Z（第 6／4 項的後半）—— 等前三項穩定後再評估。

> 動工前請一併更新 `AGENTS.md` 對應章節（§3.4 選單、§3.8 外部工具、§3.9 拖曳），
> 這份文件只負責「差距與決策」，不重複行為細節。
