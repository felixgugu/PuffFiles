# Mermaid 測試 3：複雜與邊角案例

巢狀群組、樣式、實驗性圖表，以及**故意寫壞**的圖。

第 9 節是 mermaid 較新的圖表型別，如果渲染失敗先不用懷疑 PuffFile —— 失敗時檢視器
應該保留原始碼並顯示原因（這正是第 10.1 節要驗證的行為）。

## 1. 大型流程圖：巢狀群組＋樣式

```mermaid
flowchart TD
    classDef ui fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#1e3a8a
    classDef store fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#78350f
    classDef core fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#14532d
    subgraph App["PuffFile"]
        direction TB
        subgraph Views["components/"]
            Chrome[WindowChrome]
            Toolbar[TabToolbar]
            FolderTree[FolderTreePanel]
            FileList[FileListView]
            ViewerPane[ViewerPane]
        end
        subgraph Store["stores/"]
            Tabs[tabs]
            Explorer[explorer]
            Folders[folders]
            ViewerStore[viewer]
        end
        subgraph Backend["src-tauri/"]
            Cmd[commands/]
            Core[core/]
            Watch[core/watch.rs]
        end
    end
    Api[services/api.ts]
    Chrome --> Tabs
    Toolbar --> Explorer
    FolderTree --> Folders
    FileList --> Explorer
    ViewerPane --> ViewerStore
    Explorer --> Api
    Folders --> Api
    ViewerStore --> Api
    Api --> Cmd
    Cmd --> Core
    Core --> Watch
    Watch -->|事件| Explorer
    class Chrome,Toolbar,FolderTree,FileList,ViewerPane ui
    class Tabs,Explorer,Folders,ViewerStore store
    class Cmd,Core,Watch core
    linkStyle 0 stroke:#dc2626,stroke-width:3px
```

## 2. 心智圖

```mermaid
mindmap
  root((PuffFile))
    分頁
      左右分割
      上下分割
      交換窗格
    檢視器
      Markdown
        目錄索引
      Mermaid
      圖片
      純文字
    我的資料夾
      虛擬目錄
      別名
    外部工具
      7-Zip
      VS Code
```

## 3. 時間軸

```mermaid
timeline
    title 功能演進
    2026-10-02 : 版面重構 : 分頁與分割
    2026-10-04 : 檢視器
    2026-10-07 : Mermaid 圖表 : 圖片導覽
    2026-10-08 : 同步瀏覽 : 目錄比對 : 7-Zip 整合
    2026-10-09 : 規劃文件整理
```

## 4. 象限圖

```mermaid
quadrantChart
    title 功能的成本與價值
    x-axis 低成本 --> 高成本
    y-axis 低價值 --> 高價值
    quadrant-1 優先做
    quadrant-2 值得投資
    quadrant-3 先不做
    quadrant-4 重新評估
    內嵌終端機: [0.80, 0.60]
    Mermaid 圖表: [0.30, 0.75]
    PDF 檢視器: [0.20, 0.40]
    語法高亮: [0.35, 0.70]
```

## 5. XY 圖

```mermaid
xychart-beta
    title "每週下載次數（示意）"
    x-axis ["第一週", "第二週", "第三週", "第四週", "第五週"]
    y-axis "千次" 0 --> 50
    bar [12, 28, 33, 41, 47]
    line [12, 28, 33, 41, 47]
```

## 6. 桑基圖

> mermaid 的 sankey 剖析器只吃 ASCII —— 中文（就算加引號）會被判成語法錯誤，
> 所以這一張刻意用英文標籤。

```mermaid
sankey-beta

Files,Viewer,120
Files,List,340
Viewer,Markdown,60
Viewer,Image,45
Viewer,Text,15
```

## 7. 區塊圖

```mermaid
block-beta
    columns 3
    Chrome["標題列"] WindowControls["視窗控制"]
    FolderTree["資料夾樹"] PaneOne["窗格 1"] PaneTwo["窗格 2"]
    Status["狀態列"]
```

## 8. C4 情境圖

```mermaid
C4Context
    title 系統情境圖
    Person(user, "使用者", "瀏覽工作資料夾")
    System(app, "PuffFile", "工作資料夾的快速通道")
    System_Ext(shell, "Windows Shell", "IFileOperation／剪貼簿")
    Rel(user, app, "使用")
    Rel(app, shell, "呼叫")
```

## 9. 架構圖（實驗性）

```mermaid
architecture-beta
    group app(cloud)[PuffFile]
    service web(server)[WebView2 前端] in app
    service core(database)[Rust core] in app
    web:R -- L:core
```

## 10. 邊角案例

### 10.1 故意寫壞的圖

下面這張的 `{` 沒有收尾。**預期：保留原始碼並顯示失敗原因，不是一片空白。**

```mermaid
flowchart TD
    A[開始] --> B{還沒關閉的判斷
    B --> C[結束]
```

### 10.2 很長的節點文字

測試沒有 `htmlLabels` 時，過長的節點文字會不會把版面撐壞或溢出圖表邊界。

```mermaid
flowchart LR
    A["這是一段刻意寫得很長的節點文字，用來測試 mermaid 在沒有 htmlLabels 的情況下，會把版面撐到多寬、會不會溢出圖表邊界，以及自動換行的行為"] --> B[短]
```

### 10.3 圖放在清單項目裡

縮排的圍籬區塊不保證會被解析成圖表；若這裡只顯示原始碼，屬於已知範圍。

- 清單裡的圖：

  ```mermaid
  flowchart LR
    X[清單裡的圖] --> Y[結束]
  ```

### 10.4 連續多張圖

確認同一份文件裡多張圖各自獨立渲染、互不影響，切換其中一張的「圖表／原始碼」
不會動到其他張。

```mermaid
flowchart LR
    A1[第一張] --> A2[結束]
```

```mermaid
flowchart LR
    B1[第二張] --> B2[結束]
```

```mermaid
flowchart LR
    C1[第三張] --> C2[結束]
```
