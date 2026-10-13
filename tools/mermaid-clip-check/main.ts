/**
 * Mermaid 圖表裁切問題的實驗場（暫時的開發工具，驗完就刪）。
 *
 * 目的：把測試文件裡所有 ```mermaid 區塊（加上幾個沒被涵蓋的圖表型別）用**與
 * `useMarkdownMermaid` 完全相同的設定**渲染出來，然後量每一張圖的內容 bbox 與
 * mermaid 給的 viewBox 差多少 —— SVG 根元素預設 `overflow: hidden`，內容一旦跑出
 * viewBox 就是肉眼看到的「被裁掉」。
 */
import "@/assets/styles/main.css";
import mermaid from "mermaid";
import { diagramContentBounds, fitDiagramToContent, mermaidConfig } from "@/utils/mermaid";

/** 檢視器用的是同一份設定（`utils/mermaid.ts`），所以這裡量到的就是實際出貨的圖。 */
mermaid.initialize(mermaidConfig(false));

const view = document.getElementById("view") as HTMLElement;
const report = document.getElementById("report") as HTMLElement;
const lines: string[] = [];

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

type Case = { name: string; source: string };

/** 從一份 Markdown 抽出所有 mermaid 圍籬。 */
function extract(markdown: string, prefix: string): Case[] {
  const cases: Case[] = [];
  const pattern = /^```mermaid\r?\n([\s\S]*?)^```/gm;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(markdown)) !== null) {
    index += 1;
    const source = match[1];
    const first = source.trim().split(/\r?\n/, 1)[0]?.trim() ?? "?";
    cases.push({ name: `${prefix}#${index} ${first}`, source });
  }
  return cases;
}

/** 測試文件沒涵蓋到的圖表型別，以及最容易把內容頂出框的排版。 */
const EXTRA: Case[] = [
  { name: "extra kanban", source: `kanban\n  todo[待辦]\n    task1[修正下緣被裁切]\n    task2[量 bbox 與 viewBox]\n  doing[進行中]\n    task3[寫實驗場]` },
  { name: "extra radar", source: `radar-beta\n  axis a["甲"]\n  axis b["乙"]\n  axis c["丙"]\n  curve one["一"]{1, 2, 3}` },
  { name: "extra packet", source: `packet-beta\n  0-15: "來源連接埠"\n  16-31: "目的連接埠"\n  32-63: "序號"` },
  { name: "extra requirement", source: `requirementDiagram\n  requirement test {\n    id: 1\n    text: "量測下緣"\n    risk: low\n    verifymethod: test\n  }\n  element impl {\n    type: simulation\n  }\n  impl - satisfies -> test` },
  { name: "extra long-word", source: `flowchart TD\n  A[abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz] --> B[短]` },
  { name: "extra many-lines", source: `flowchart TD\n  A["第一行<br/>第二行<br/>第三行<br/>第四行<br/>第五行"] --> B["結束"]` },
  { name: "extra note", source: `flowchart LR\n  A-->B\n  Note over A,B: 這是一段比較長的備註文字，用來撐高節點\n  B-->C` },
  { name: "extra subgraph-title", source: `flowchart TB\n  subgraph 群組標題["一個很長的群組標題文字用來撐開寬度"]\n    A --> B\n  end` },
  { name: "extra sequence-note", source: `sequenceDiagram\n  participant A as 甲\n  participant B as 乙\n  Note over A,B: 這是一段很長的備註<br/>換行後仍然很長很長很長\n  A->>B: 訊息\n  B-->>A: 回覆` },
  { name: "extra xychart-long-x", source: `xychart-beta\n  title "每月下載次數"\n  x-axis ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"]\n  y-axis "次數" 0 --> 500\n  bar [120, 200, 150, 80, 70, 110, 130, 400, 220, 180, 90, 260]` },
  { name: "extra xychart-legend", source: `xychart-beta\n  x-axis ["A", "B", "C", "D"]\n  y-axis "值" 0 --> 100\n  line [10, 40, 70, 100]\n  line [100, 70, 40, 10]` },
  { name: "extra sankey-long", source: `sankey-beta\n"來源資料夾裡一個很長的檔名.txt","目標 A",120\n"來源資料夾裡一個很長的檔名.txt","目標 B 也很長的名字",80\n"另一個很長的來源名稱.png","目標 A",40` },
  { name: "extra quadrant-long", source: `quadrantChart\n  title 一個比較長的標題文字\n  x-axis 低影響 --> 高影響\n  y-axis 低急迫 --> 高急迫\n  quadrant-1 立刻做\n  quadrant-2 排進度\n  quadrant-3 有空再看\n  quadrant-4 交給別人\n  "重構 mermaid 圖表尺寸問題": [0.7, 0.8]\n  "寫測試文件": [0.3, 0.5]` },
  { name: "extra pie-long", source: `pie showData title 檔案類型分布的統計結果（含副檔名計數）\n  "Markdown 文件" : 42\n  "TypeScript 程式碼" : 31\n  "Vue 單檔元件" : 18\n  "其他" : 9` },
  { name: "extra timeline-many", source: `timeline\n  title 專案里程碑\n  section 一\n    2026-01 : 開工\n    2026-02 : 第一版\n  section 二\n    2026-03 : 修正裁切\n    2026-04 : 上線\n  section 三\n    2026-05 : 收尾` },
  { name: "extra gantt-many", source: `gantt\n  title 排程\n  dateFormat YYYY-MM-DD\n  section 前端\n    檢視器 :a1, 2026-01-01, 30d\n    書籤目錄 :a2, after a1, 20d\n  section 後端\n    目錄監控 :b1, 2026-01-10, 40d\n    檔案操作 :b2, after b1, 25d\n  section 收尾\n    打包 :c1, after b2, 10d` },
  { name: "extra flowchart-deep", source: `flowchart TD\n  A[開始] --> B{判斷}\n  B -->|是| C[處理]\n  B -->|否| D[結束]\n  C --> E[再處理]\n  E --> F[收尾]\n  F --> D` },
  { name: "extra quadrant-long-axis", source: `quadrantChart\n  x-axis "左邊這個軸的說明文字很長很長很長" --> "右邊這個軸的說明文字也很長很長很長"\n  y-axis 低 --> 高\n  quadrant-1 A\n  quadrant-2 B\n  quadrant-3 C\n  quadrant-4 D\n  "項目": [0.5, 0.5]` },
  { name: "extra xychart-long-axis-title", source: `xychart-beta\n  title "年度統計資料"\n  x-axis "月份（一到十二月）" ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"]\n  y-axis "下載次數（千次）" 0 --> 500\n  bar [120, 200, 150, 80, 70, 110, 130, 400, 220, 180, 90, 260]` },
  { name: "extra sankey-simple", source: `sankey-beta\nsource,target,value\nA,B,100\nA,C,60\nB,D,80\nC,D,40\nD,E,120` },
  { name: "extra treemap", source: `treemap-beta\n"檔案類型"\n  "Markdown": 42\n  "TypeScript": 31\n  "Vue": 18\n  "Rust": 12` },
  { name: "extra treeView", source: `treeView-beta\n  "src"\n    "components"\n      "viewer"\n    "stores"\n    "utils"` },
  { name: "extra venn", source: `venn-beta\n  title 重疊\n  sets ["前端", "後端"]\n  text "前端" 300, 300, 220\n  text "後端" 500, 300, 220\n  union ["前端","後端"] 900` },
  { name: "extra ishikawa", source: `ishikawa-beta\n  裁切\n    上緣\n    下緣\n    右緣\n    左緣` },
  { name: "extra gantt-compact", source: `gantt\n  displayMode compact\n  dateFormat YYYY-MM-DD\n  section 前端\n    檢視器 : 2026-01-01, 30d\n    書籤 : 2026-02-01, 20d\n  section 後端\n    監控 : 2026-01-10, 40d` },
  { name: "extra journey-long", source: `journey\n  title 使用者的一天\n  section 早上\n    起床: 5: 我\n    吃早餐: 3: 我\n  section 下午\n    寫程式: 4: 我, 同事\n    修 bug: 1: 我` },
  { name: "extra packet-long", source: `packet-beta\n  0-7: "版本"\n  8-15: "旗標"\n  16-31: "負載長度（單位：位元組）"\n  32-63: "序號（遞增）"` },
  { name: "extra usecase", source: `usecase-beta\n  actor 使用者\n  actor 系統管理員\n  usecase 開啟檔案\n  usecase 檢視 Markdown\n  usecase 匯出圖片\n  使用者 --> 開啟檔案\n 使用者 --> 檢視 Markdown\n  系統管理員 --> 匯出圖片` },
  { name: "extra wardley", source: `wardley-beta\n  title 價值鏈\n  anchor 使用者 [0.9, 0.9]\n  component 檢視器 [0.7, 0.6]\n  component 後端 [0.3, 0.5]\n  使用者 -> 檢視器\n  檢視器 -> 後端` },
  // 下面這些是「高度由 mermaid 自己算」的型別，用長中文標籤與大量內容往下堆。
  { name: "stress kanban-many", source: `kanban\n  todo[待辦事項]\n    a[修正 Mermaid 圖表下緣被裁切的問題]\n    b[量測 viewBox 與實際內容的差距]\n    c[確認官方 viewer 沒有這個問題]\n    d[把量測腳本留在 tools 底下]\n    e[補上規劃文件的量測記錄]\n  doing[進行中]\n    f[寫實驗場]\n` },
  { name: "stress kanban-long", source: `kanban\n  todo[待辦]\n    a[這是一張卡片標題很長很長很長很長很長很長很長很長很長很長很長很長很長很長]\n  doing[進行中]\n    b[短]\n` },
  { name: "stress treemap-long", source: `treemap-beta\n"檔案類型分布統計"\n  "Markdown 文件（含 README 與說明）": 42\n  "TypeScript 程式碼": 31\n  "Vue 單檔元件": 18\n  "Rust 後端": 12\n  "設定檔": 7` },
  { name: "stress gantt-long", source: `gantt\n  title 排程\n  dateFormat YYYY-MM-DD\n  section 前端\n    修正 Mermaid 圖表下緣被裁切的問題 :a1, 2026-01-01, 30d\n    量測 viewBox 與實際內容的差距 :a2, after a1, 20d\n  section 後端\n    目錄監控 :b1, 2026-01-10, 40d\n` },
  { name: "stress xychart-legend", source: `xychart-beta\n  title "下緣測試"\n  x-axis ["一", "二", "三", "四"]\n  y-axis "次數" 0 --> 100\n  line [10, 40, 70, 100]\n  bar [100, 70, 40, 10]\n  line [50, 50, 50, 50]\n  bar [20, 30, 40, 50]\n` },
  { name: "stress pie-long-legend", source: `pie showData\n  title 檔案類型分布\n  "Markdown 文件" : 42\n  "TypeScript 程式碼" : 31\n  "Vue 單檔元件" : 18\n  "Rust 後端" : 12\n  "設定檔" : 7\n  "圖片" : 5\n  "其他" : 3\n` },
  { name: "stress timeline-long", source: `timeline\n  title 專案里程碑\n  section 第一階段\n    2026-01 : 修正 Mermaid 圖表下緣被裁切的問題\n    2026-02 : 量測 viewBox 與實際內容的差距\n  section 第二階段\n    2026-03 : 寫實驗場\n    2026-04 : 補文件\n` },
  { name: "stress quadrant-long", source: `quadrantChart\n  title 下緣測試\n  x-axis 影響很小 --> 影響很大\n  y-axis 急迫性低 --> 急迫性高\n  quadrant-1 立刻處理\n  quadrant-2 排進度\n  quadrant-3 有空再看\n  quadrant-4 交給別人\n  "修正 Mermaid 圖表下緣被裁切的問題": [0.7, 0.8]\n  "量測 viewBox 與實際內容的差距": [0.3, 0.5]\n` },
  { name: "stress journey-long", source: `journey\n  title 使用者的一天\n  section 早上\n    起床並打開 PuffFile 檢視昨天寫的筆記: 5: 我\n    吃早餐: 3: 我\n  section 下午\n    修正 Mermaid 圖表下緣被裁切的問題: 4: 我, 同事\n    量測 viewBox 與實際內容的差距: 1: 我\n` },
  { name: "stress mindmap-long", source: `mindmap\n  root((PuffFile))\n    檢視器\n      Markdown\n        Mermaid 圖表\n          下緣被裁切\n        DOCX\n      PDF\n    檔案操作\n      複製\n      搬移\n` },
  { name: "stress gitgraph-long", source: `gitGraph\n  commit id:"修正 Mermaid 圖表下緣被裁切的問題"\n  branch fix/clip\n  commit id:"量測 viewBox"\n  commit id:"寫實驗場"\n  checkout main\n  merge fix/clip\n` },
  { name: "stress sequence-long", source: `sequenceDiagram\n  participant A as 使用者介面\n  participant B as 前端 store\n  participant C as Rust 後端\n  A->>B: 這是一則很長的訊息，用來撐開序列圖的寬度，看看右緣會不會被裁切\n  B->>C: 這也是一則很長的訊息，用來撐開序列圖的寬度\n  C-->>B: 回覆\n  B-->>A: 回覆\n` },
  { name: "stress class-long", source: `classDiagram\n  class 檢視器 {\n    +MarkdownView markdown\n    +DocxView docx\n    +修正在Mermaid圖表下緣被裁切的問題()\n  }\n  class Rust後端 {\n    +read_viewer_file()\n  }\n  檢視器 --> Rust後端 : 讀取內容\n` },
  { name: "stress er-long", source: `erDiagram\n  使用者 ||--o{ 檔案 : 開啟\n  檔案 {\n    string 完整的檔案路徑\n    int 檔案大小_位元組\n  }\n` },
  { name: "stress state-long", source: `stateDiagram-v2\n  [*] --> 待機\n  待機 --> 讀取中 : 使用者開啟檔案\n  讀取中 --> 完成 : 串流結束\n  完成 --> [*]\n` },
  { name: "stress block-long", source: `block-beta\n  columns 3\n  A["修正 Mermaid 下緣"] B["量測 viewBox"] C["寫實驗場"]\n  D["補文件"]:3\n` },
  { name: "stress architecture-long", source: `architecture-beta\n  group 前端(cloud)[前端]\n    service vue(server)[Vue 3.5] in 前端\n    service vite(server)[Vite 8] in 前端\n  group 後端(database)[Rust 後端]\n    service dir(disk)[目錄列舉] in 後端\n  vue:R -- L:vite\n  vite:R -- L:dir\n` },
  // htmlLabels：我們的全域設定是 false，但圖表自己可以用 %%{init}%% 把它打開 ——
  // 打開之後標籤就是 foreignObject 裡的 HTML，高度由 line-height 決定。
  { name: "htmlLabels flowchart", source: `%%{init: {"flowchart": {"htmlLabels": true}}}%%\nflowchart TD\n  A[第一行<br/>第二行<br/>第三行] --> B[結束]\n  A --> C["這是一段比較長的標籤文字，應該會自動換行成很多行，用來檢查 box 夠不夠高"]` },
  { name: "htmlLabels class", source: `%%{init: {"class": {"htmlLabels": true}}}%%\nclassDiagram\n  class 檢視器 {\n    +MarkdownView markdown\n    +修正在Mermaid圖表下緣被裁切的問題()\n    +另一個很長很長很長的方法名稱()\n  }\n  class Rust後端 {\n    +read_viewer_file()\n  }\n  檢視器 --> Rust後端 : 讀取內容\n` },
  { name: "htmlLabels state", source: `%%{init: {"state": {"htmlLabels": true}}}%%\nstateDiagram-v2\n  [*] --> 待機\n  待機 --> 讀取中 : 使用者開啟檔案\n  讀取中 --> 完成 : 串流結束\n  完成 --> [*]\n` },
  { name: "htmlLabels er", source: `%%{init: {"er": {"htmlLabels": true}}}%%\nerDiagram\n  使用者 ||--o{ 檔案 : 開啟\n  檔案 {\n    string 完整的檔案路徑\n    int 檔案大小_位元組\n  }\n` },
  { name: "htmlLabels mindmap", source: `%%{init: {"mindmap": {"htmlLabels": true}}}%%\nmindmap\n  root((PuffFile))\n    Mermaid 圖表\n      下緣被裁切\n` },
  // ELK 佈局：mermaid 最大的一塊 lazy chunk（elk 約 1.5 MB）就是為了它，也是社群回報
  // 「圖表被裁掉」最多的佈局引擎。
  { name: "elk flowchart TD", source: `%%{init: {"layout": "elk"}}%%\nflowchart TD\n  A[開始] --> B[載入設定]\n  B --> C[列舉目錄]\n  C --> D{有圖表嗎？}\n  D -->|有| E[渲染成內嵌 SVG]\n  D -->|沒有| F[顯示原始碼]\n  E --> G[完成]\n  F --> G` },
  { name: "elk flowchart nested", source: `%%{init: {"layout": "elk"}}%%\nflowchart TB\n  subgraph 前端["前端"]\n    Markdown[MardownView]\n    Mermaid[useMarkdownMermaid]\n  end\n  subgraph 後端["後端"]\n    Viewer[commands/viewer.rs]\n  end\n  Markdown --> Mermaid\n  Mermaid --> Viewer\n  Viewer --> 資料庫[(SQLite)]` },
  { name: "elk flowchart-easy", source: `%%{init: {"layout": "elk"}}%%\nflowchart LR\n  A[一個很長的節點名稱用來測試寬度] --> B[短]\n  B --> C[另一個也很長的節點名稱]\n  C --> D{判斷}\n  D --> E[結果一]\n  D --> F[結果二]` },
  // 使用者自己的文件（G:\PuffSQL\docs\FEATURE_RECOMMENDATIONS.md）裡那張路線圖。
  { name: "puffsql roadmap", source: `flowchart LR\n  subgraph Completed["🎉 Completed (已交付落地)"]\n    direction TB\n    C1["🤖 AI 智能助理 (cURL Engine)"]\n    C2["🔴 連線環境色與安全防護 (Safe Guard)"]\n    C3["🌐 互動式 ER 關聯圖 (AntV X6)"]\n    C4["📁 本機 SQL 檔案監控區"]\n    C5["🎨 PrimeVue 4 雙模式主題系統"]\n    C6["📄 資料庫結構 CSV 匯出"]\n    C7["🩺 AI 錯誤診斷與計畫/IO調校"]\n  end\n  subgraph Phase2["Phase 1 (v0.3.0) - 核心外銷與編輯補完"]\n    direction TB\n    P1A["💾 實體檔案串流匯出 (Excel/CSV/SQL)"]\n    P1B["✏️ TableDataViewer 行內編輯與新增列"]\n    P1C["🔐 連線檔 AES-256 加密匯出入"]\n  end\n  subgraph Phase3["Phase 2 (v0.4.0) - 結構進階與資料比對"]\n    direction TB\n    P2A["🧱 結構進階檢視 (索引/外鍵/約束)"]\n    P2B["🔍 雙結果集資料比對 (Result Diff)"]\n    P2C["🔗 外鍵快速預覽與跳轉 (FK Jump)"]\n  end\n  subgraph Phase4["Phase 3 (v0.5.0+) - 巨量分頁與即時監控"]\n    direction TB\n    P3A["⚡ 伺服器端動態分頁 (OFFSET-FETCH)"]\n    P3B["📊 即時活動與阻塞監控儀表板"]\n  end\n  Completed --> Phase2 --> Phase3 --> Phase4` },
  // 最小對照組：只有 emoji 的差別。
  { name: "emoji one-line", source: `flowchart TB\n  A["🎉 有 emoji 的節點"] --> B["沒有 emoji 的節點"]` },
  { name: "emoji bottom", source: `flowchart LR\n  A["上面"] --> B["下面"]\n  B --> C["🎉 最下面這一行有 emoji"]` },
  // 折磨組：把「高度由 mermaid 自己算」的型別灌到滿，專門找下緣溢出。
  { name: "torture pie-15", source: `pie showData\n  title 檔案類型分布統計（含副檔名與數量）\n  "Markdown 文件與說明" : 42\n  "TypeScript 程式碼" : 31\n  "Vue 單檔元件" : 18\n  "Rust 後端模組" : 12\n  "設定檔與環境變數" : 9\n  "圖片與圖示" : 7\n  "測試檔" : 6\n  "文件與報告" : 5\n  "資料檔" : 4\n  "腳本" : 3\n  "樣式表" : 3\n  "字型" : 2\n  "備份" : 2\n  "暫存" : 1\n  "其他" : 1\n` },
  { name: "torture quadrant-very-long", source: `quadrantChart\n  title 這一張圖表的標題也很長很長很長\n  x-axis "影響範圍很小很小很小很小很小很小" --> "影響範圍很大很大很大很大很大很大"\n  y-axis "急迫性很低很低很低很低很低" --> "急迫性很高很高很高很高很高"\n  quadrant-1 "立刻安排時間處理"\n  quadrant-2 "排進下一輪的工作項目"\n  quadrant-3 "有空的時候再看就好"\n  quadrant-4 "交給其他人負責"\n  "項目一": [0.7, 0.8]\n  "項目二": [0.3, 0.5]\n  "項目三": [0.5, 0.2]\n` },
  { name: "torture radar-8", source: `radar-beta\n  title 八個維度\n  axis a["介面美觀度"]\n  axis b["操作流暢度"]\n  axis c["功能完整度"]\n  axis d["效能表現"]\n  axis e["記憶體用量"]\n  axis f["穩定性"]\n  axis g["可維護性"]\n  axis h["測試覆蓋率"]\n  curve now["現在"]{80, 90, 70, 60, 50, 85, 75, 40}\n  curve next["下一版"]{90, 95, 85, 75, 65, 90, 85, 60}\n` },
  { name: "torture kanban-10", source: `kanban\n  todo[待辦]\n    a[第一張卡片：修正 Mermaid 圖表下緣被裁切的問題]\n    b[第二張卡片：量測 viewBox]\n    c[第三張卡片]\n    d[第四張卡片]\n    e[第五張卡片]\n    f[第六張卡片]\n    g[第七張卡片]\n    h[第八張卡片]\n    i[第九張卡片]\n    j[第十張卡片]\n` },
  { name: "torture timeline-5", source: `timeline\n  title 專案里程碑與後續規劃\n  section 第一階段：基礎建設\n    2026-01 : 建立專案骨架與開發環境\n    2026-02 : 完成核心目錄列舉\n  section 第二階段：檢視器\n    2026-03 : Markdown 檢視器上線\n    2026-04 : Mermaid 圖表自動渲染\n  section 第三階段：檔案操作\n    2026-05 : 剪貼簿與檔案操作\n    2026-06 : 目錄監控\n  section 第四階段：收尾\n    2026-07 : 打包單檔免安裝版\n    2026-08 : 文件與規劃紀錄\n` },
  { name: "torture gantt-12", source: `gantt\n  title 專案排程\n  dateFormat YYYY-MM-DD\n  section 前端\n    檢視器骨架 :a1, 2026-01-01, 10d\n    Markdown 支援 :a2, after a1, 12d\n    Mermaid 圖表 :a3, after a2, 8d\n    DOCX 檢視器 :a4, after a3, 6d\n  section 後端\n    目錄列舉 :b1, 2026-01-05, 14d\n    檔案操作 :b2, after b1, 10d\n    目錄監控 :b3, after b2, 9d\n    自訂協定 :b4, after b3, 7d\n  section 收尾\n    打包 :c1, after a4, 5d\n    文件 :c2, after c1, 4d\n    測試 :c3, after c2, 6d\n    上線 :c4, after c3, 2d\n` },
  { name: "torture treemap-deep", source: `treemap-beta\n"專案"\n  "前端"\n    "components"\n    "composables"\n    "stores"\n  "後端"\n    "commands"\n    "core"\n  "文件"\n    "規劃紀錄與量測筆記"\n` },
];

async function loadCases(extra: string[] = []): Promise<Case[]> {
  const files = ["01-basic.md", "02-intermediate.md", "03-advanced.md"];
  const cases: Case[] = [];
  for (const file of files) {
    const response = await fetch(`/docs/mermaid_test/${file}`);
    cases.push(...extract(await response.text(), file));
  }
  // `?extra=/docs/你的檔案.md`：量自己的文件（路徑相對於 dev server 的根目錄）。
  for (const url of extra) {
    const response = await fetch(url);
    cases.push(...extract(await response.text(), url.split("/").pop() ?? url));
  }
  return [...cases, ...EXTRA];
}

/** 圖表內容相對 mermaid 原始 viewBox 超出多少；正數＝會被 `overflow: hidden` 裁掉。 */
function contentOverflow(
  svg: SVGSVGElement,
): { left: number; top: number; right: number; bottom: number } | null {
  const box = svg.viewBox.baseVal;
  const content = diagramContentBounds(svg);
  if (!content) {
    return null;
  }
  return {
    left: round(box.x - content.x),
    top: round(box.y - content.y),
    right: round(content.x + content.width - (box.x + box.width)),
    bottom: round(content.y + content.height - (box.y + box.height)),
  };
}

function describe(overflow: { left: number; top: number; right: number; bottom: number } | null) {
  if (!overflow) {
    return "量不到內容";
  }
  const worst = Math.max(overflow.left, overflow.top, overflow.right, overflow.bottom);
  if (worst <= 0.5) {
    return "內容都在框內";
  }
  return `超出 left ${overflow.left} top ${overflow.top} right ${overflow.right} bottom ${overflow.bottom}`;
}

/**
 * 把圖表畫到 canvas 上，掃描 **viewBox 邊界以外的實際著色像素**。
 *
 * 這是「肉眼看到的裁切」最直接的量法：SVG 根元素預設 `overflow: hidden`，畫在
 * viewBox 外面的東西會被切掉。作法是把同一張圖的 viewBox 往外擴 40px 再畫一次 ——
 * 擴出去以後還看得到的墨跡，就是原本會消失的部分。
 *
 * `appCss = true` 時額外注入 `svg { font-size: 12px }`，模擬檢視器的
 * `.md-mermaid-view svg { font-size: 12px !important }`；`false` 則是官方 viewer
 * 會看到的樣子（mermaid 自己的 `font-size: 12` 沒有單位、不生效，文字用瀏覽器預設）。
 */
async function inkOverflow(
  svg: SVGSVGElement,
  appCss: boolean,
): Promise<{ top: number; bottom: number; left: number; right: number }> {
  const pad = 40;
  const box = svg.viewBox.baseVal;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute(
    "viewBox",
    `${box.x - pad} ${box.y - pad} ${box.width + pad * 2} ${box.height + pad * 2}`,
  );
  const scale = Math.min(1, 2000 / Math.max(box.width + pad * 2, box.height + pad * 2));
  const width = Math.max(1, Math.ceil((box.width + pad * 2) * scale));
  const height = Math.max(1, Math.ceil((box.height + pad * 2) * scale));
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.style.removeProperty("max-width");
  // gantt 的「今天」標記線是 mermaid 畫在圖表區間外的裝飾，`fitDiagramToContent()` 刻意
  // 不把它算進內容（官方 viewer 也裁掉它），驗證時一起拿掉才不會誤報殘留。
  for (const today of Array.from(clone.querySelectorAll(".today"))) {
    today.remove();
  }
  if (appCss) {
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = "svg { font-size: 12px; }";
    clone.append(style);
  }

  const image = new Image();
  const markup = new XMLSerializer().serializeToString(clone);
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("無法把 SVG 畫進 canvas"));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("沒有 canvas context");
  }
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;

  const inner = {
    x0: Math.floor(pad * scale),
    y0: Math.floor(pad * scale),
    x1: Math.ceil((pad + box.width) * scale),
    y1: Math.ceil((pad + box.height) * scale),
  };
  const result = { top: 0, bottom: 0, left: 0, right: 0 };
  for (let y = 0; y < height; y += 1) {
    const insideRow = y >= inner.y0 && y < inner.y1;
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] === 0) {
        continue;
      }
      if (insideRow && x >= inner.x0 && x < inner.x1) {
        x = inner.x1 - 1;
        continue;
      }
      if (x < inner.x0) {
        result.left = Math.max(result.left, (inner.x0 - x) / scale);
      } else if (x >= inner.x1) {
        result.right = Math.max(result.right, (x + 1 - inner.x1) / scale);
      }
      if (y < inner.y0) {
        result.top = Math.max(result.top, (inner.y0 - y) / scale);
      } else if (y >= inner.y1) {
        result.bottom = Math.max(result.bottom, (y + 1 - inner.y1) / scale);
      }
    }
  }
  return result;
}

async function run() {
  const params = new URLSearchParams(location.search);
  const extra = (params.get("extra") ?? "").split(",").filter(Boolean);
  const shot = params.get("case");
  if (shot) {
    const pane = document.getElementById("pane");
    const width = params.get("pane");
    if (pane && width) {
      pane.style.width = `${width}px`;
    }
    const cases = await loadCases(extra);
    const item = cases.find((entry) => entry.name.startsWith(shot));
    if (item) {
      const id = "clip-check-shot";
      const { svg } = await mermaid.render(id, item.source);
      view.innerHTML = svg;
      const element = view.querySelector<SVGSVGElement>("svg");
      if (element) {
        fitDiagramToContent(element);
      }
      document.getElementById("d" + id)?.remove();
      document.title = item.name;
      report.textContent = item.name;
      const box = view.getBoundingClientRect();
      report.textContent = `${item.name} :: offset=${view.offsetHeight} client=${view.clientHeight} scrollbar=${view.offsetHeight - view.clientHeight} viewScroll=${view.scrollWidth}x${view.scrollHeight} svgBottom=${Math.round(view.querySelector("svg")!.getBoundingClientRect().bottom - box.top)} client=${view.clientHeight}`;
    }
    return;
  }

  const cases = await loadCases(extra);
  let index = 0;
  let before = 0;
  let after = 0;
  for (const item of cases) {
    index += 1;
    const id = `clip-check-${index}`;
    try {
      const { svg } = await mermaid.render(id, item.source);
      view.innerHTML = svg;
      const element = view.querySelector<SVGSVGElement>("svg");
      if (!element) {
        lines.push(`${item.name} :: 沒有產生 SVG`);
        continue;
      }
      // 修正前：內容有多少落在 mermaid 的 viewBox 之外（＝原本會被裁掉的部分）。
      const overflow = contentOverflow(element);
      const original = element.getAttribute("viewBox") ?? "?";
      const worst = overflow
        ? Math.max(overflow.left, overflow.top, overflow.right, overflow.bottom)
        : 0;
      // 修正：實際出貨的 `fitDiagramToContent()`。
      const nodes = element.querySelectorAll("*").length;
      const started = performance.now();
      fitDiagramToContent(element);
      const elapsed = Math.round((performance.now() - started) * 10) / 10;
      const ink = await inkOverflow(element, true);
      const residual = Math.max(ink.bottom, ink.right, ink.top, ink.left);
      if (worst > 0.5) {
        before += 1;
      }
      if (residual > 0.5) {
        after += 1;
      }
      lines.push(
        `${residual > 0.5 ? "殘留 " : worst > 0.5 ? "修正 " : "ok   "}${item.name} :: ${describe(overflow)} :: vb ${original} → ${element.getAttribute("viewBox")} :: 修正後墨跡溢出=bottom ${round(ink.bottom)} right ${round(ink.right)} top ${round(ink.top)} left ${round(ink.left)} :: 元素 ${nodes} 量測 ${elapsed}ms`,
      );
    } catch (error) {
      lines.push(`失敗 ${item.name} :: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      document.getElementById(`d${id}`)?.remove();
    }
  }

  lines.unshift(
    `總共 ${cases.length} 張；修正前有 ${before} 張內容落在 viewBox 外，修正後仍有墨跡溢出的 ${after} 張`,
  );
  report.textContent = lines.join("\n");
}

void run();
