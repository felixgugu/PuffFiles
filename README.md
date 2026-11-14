# PuffFile

**Windows 的極簡檔案總管：把每天會用到的資料夾放在手邊，少走回頭路。**

PuffFile 不是要取代檔案總管，而是解決「每天反覆進出同幾個資料夾」的損耗：
左側常駐工作資料夾、分頁與分割讓兩個位置並排，檢視器讓你不離開視窗就能看內容。

## 功能介紹

- **我的資料夾**：左側只放工作用的資料夾，可用虛擬目錄分組、拖曳排序、展開子資料夾；
  點一下就開在固定的窗格。
- **分頁與分割**：每個分頁可左右或上下分割；兩邊各自瀏覽，能把項目複製／搬移到另一邊，
  也能同步瀏覽與目錄比對。
- **檔案操作與系統一致**：剪下／複製／貼上／刪除／重新命名／屬性都交給 Windows，
  剪貼簿與檔案總管互通，支援資源回收筒與復原。
- **自訂右鍵選單**：外部工具可依檔案／資料夾與副檔名出現，支援群組與變數；
  內建 PowerShell、VS Code、Notepad++、7-Zip 範例。
- **檢視器（不離開視窗）**：Markdown（目錄索引、搜尋、Mermaid）、HTML 靜態預覽、圖片、
  PDF、DOCX、純文字與程式碼高亮、ASCII 目錄樹、壓縮檔內容清單（唯讀）、聲音與影片。
- **尋找與篩選**：搜尋目前資料夾（或含子資料夾）；種類快速篩選（文件、圖片、影片…），
  可在設定頁自訂群組與順序。
- **大量檔案也順**：虛擬滾動、目錄即時更新（外部變更自動反映）、扁平化列出子資料夾的所有檔案。
- **其他**：瀏覽紀錄、工作階段還原、拖曳移動、可自訂主題／字型／動態效果。

## 下載

到 [Releases](https://github.com/felixgugu/PuffFiles/releases) 下載 `PuffFile.exe`：

- 單一檔案、免安裝、不需要管理員權限。
- Windows 10／11；需要系統的 WebView2 Runtime（Windows 11 內建，Windows 10 多半已隨 Edge 安裝）。
- 設定存在 `%LOCALAPPDATA%\PuffFile`，操作紀錄在執行檔旁的 `logs\`。

## 技術框架

- **桌面**：Tauri 2（Rust 核心 + WebView2）
- **前端**：Vue 3.5、TypeScript、Vite 8、Tailwind CSS 4、Pinia 4
- **後端**：Rust（Tokio、thiserror、sysinfo、windows-rs）
- **平台整合**：Windows Shell（檔案操作、剪貼簿）、ReadDirectoryChangesW、7-Zip（壓縮檔清單）

## 開發

需要 Node `^20.19.0 || >=22.12.0` 與 Rust stable（edition 2024）。

```bash
npm install
npm run tauri dev     # 桌面版
npm run dev           # 只跑前端（Mock 資料）
npm run typecheck
```

打包單檔免安裝版（產出 `dist-portable\PuffFile.exe` 與 `.7z`）：

```powershell
.\build-portable.ps1
```

更多設計與取捨：[docs/redesign-plan.md](docs/redesign-plan.md)
