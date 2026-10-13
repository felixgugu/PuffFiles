# Mermaid 圖表裁切量測工具

Markdown 檢視器的 Mermaid 圖表偶爾會被裁掉一角（右緣、下緣）：mermaid 給的 viewBox
**不保證蓋住畫出來的東西**（詳見 `src/utils/mermaid.ts` 的說明），落在 viewBox 外面的
內容會被 SVG 根元素預設的 `overflow: hidden` 切掉。這支工具把一批圖表用**與檢視器完全
相同的設定與 CSS** 渲染出來，然後：

1. 用 `diagramContentBounds()`（實際出貨的邏輯）量內容有沒有落在 mermaid 的 viewBox
   之外 —— 落在外面就是會被裁掉的部分。
2. 呼叫 `fitDiagramToContent()` 修正，再把圖畫進 canvas 掃描邊界外的著色像素，確認
   修正之後真的沒有東西被切掉。

## 跑法

```powershell
npm run dev      # 另一邊開著 dev server（localhost:1420）
node tools/mermaid-clip-check/run.mjs
```

輸出一行一張圖：`修正前內容超出多少`、`viewBox 前後`、`修正後邊界外的墨跡`、
`元素數與量測時間`。要量自己的文件（路徑相對 dev server 的根目錄）：

```powershell
node tools/mermaid-clip-check/run.mjs "http://localhost:1420/tools/mermaid-clip-check/index.html?extra=/docs/你的檔案.md"
```

要親眼看某一張圖：加 `?case=<圖表名稱前綴>&pane=<窗格寬度>` 就只渲染那一張，
第二個參數給 png 路徑即可截圖（`run.mjs [url] [screenshot.png]`）。

## 縮放與拖曳平移的互動驗收

```powershell
node tools/mermaid-clip-check/pan-check.mjs [screenshot.png]
```

用 CDP 打開 dev 版的應用程式，自己開 `readme.md`（假檔案系統裡那張流程圖）、按 `Space`
進檢視器，然後依序驗：控制項順序與顯示規則、每次點擊跳一級、兩端停用、`width/height`
與 viewBox 的倍率關係、拖曳平移（水平捲圖表區、垂直捲窗格、不選取文字）、
`Ctrl+滾輪` 的游標錨點、切換原始碼與切換主題後倍率／捲動位置的還原。

dev server 不在 1420 時用環境變數指定：`$env:PUFF_DEV_URL="http://localhost:1432/"`。

## 圖表來源

- `docs/mermaid_test/*.md`：專案自己的測試文件（基本／進階圖表）。
- `main.ts` 的 `EXTRA`：測試文件沒涵蓋的型別（kanban／radar／packet／treemap／
  ishikawa／ELK 佈局…）與壓力測試（長中文標籤、emoji、大量節點、gantt 的 today 線）。

這支工具只給開發時量測用，不是應用程式的一部分（`tsconfig.json` 只收 `src/**`，
`vite build` 也不會打包它）。
