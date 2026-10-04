/**
 * 快速鍵一覽（設定頁「關於」用）。
 *
 * 這裡是**呈現用的資料**，實際行為的來源是 `composables/useKeyboardShortcuts.ts`
 * 與各元件的區域處理（右鍵選單、路徑列編輯、對話框）。
 * 新增或修改快速鍵時，兩邊都要一起更新，否則設定頁會寫著不存在的鍵。
 */

export interface ShortcutRow {
  /** 一個以上的按鍵組合；同一列有多組時，畫面以「/」分隔（例如上一個／下一個分頁）。 */
  keys: string[];
  label: string;
}

export interface ShortcutGroup {
  title: string;
  /** 這一組的適用範圍或補充說明（選填）。 */
  note?: string;
  items: ShortcutRow[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "分頁與版面",
    items: [
      { keys: ["Ctrl+N"], label: "開新分頁" },
      { keys: ["Ctrl+W"], label: "關閉分頁" },
      { keys: ["Ctrl+Shift+W"], label: "關閉窗格（窗格剩一個時等於關閉分頁）" },
      { keys: ["Ctrl+Tab", "Ctrl+Shift+Tab"], label: "下一個／上一個分頁" },
      { keys: ["Ctrl+1…8"], label: "切換到第 1～8 個分頁" },
      { keys: ["Ctrl+9"], label: "切換到最後一個分頁" },
      { keys: ["Ctrl+\\"], label: "左右分割" },
      { keys: ["Ctrl+Shift+\\"], label: "上下分割" },
      { keys: ["F6"], label: "在窗格之間切換焦點（單一窗格時切換左側資料夾樹）" },
    ],
  },
  {
    title: "導覽",
    items: [
      { keys: ["Enter"], label: "開啟資料夾；檔案以系統預設程式開啟" },
      { keys: ["Backspace", "Alt+↑"], label: "上一層" },
      { keys: ["Alt+←", "Alt+→"], label: "上一頁／下一頁" },
      { keys: ["F5"], label: "重新整理清單與資料夾樹" },
      { keys: ["Ctrl+F"], label: "搜尋目前資料夾" },
      { keys: ["Ctrl+L"], label: "輸入路徑" },
    ],
  },
  {
    title: "檢視器",
    note: "焦點在檢視器窗格時，Esc 與 F5 作用於檢視器本身；清單類快速鍵會停用，文字才能正常選取複製。",
    items: [
      { keys: ["Space"], label: "把焦點列的檔案開到檢視器窗格（焦點留在清單）" },
      { keys: ["Esc"], label: "關閉檢視器" },
      { keys: ["F5"], label: "重新載入檢視器內容" },
    ],
  },
  {
    title: "選取",
    items: [
      { keys: ["↑", "↓"], label: "移動焦點列" },
      { keys: ["Home", "End"], label: "移到第一項／最後一項" },
      { keys: ["Ctrl+A"], label: "全選" },
      { keys: ["Esc"], label: "取消選取（有浮層時先關閉浮層）" },
    ],
  },
  {
    title: "剪貼簿與檔案",
    note: "實作交給 Windows shell，行為與檔案總管一致（衝突、進度、取消、資源回收筒）。",
    items: [
      { keys: ["Ctrl+C"], label: "複製" },
      { keys: ["Ctrl+X"], label: "剪下" },
      { keys: ["Ctrl+V"], label: "貼上" },
      { keys: ["Del"], label: "刪除" },
      { keys: ["Ctrl+Shift+C"], label: "複製到另一個窗格（需分割）" },
      { keys: ["Ctrl+Shift+M"], label: "移動到另一個窗格（需分割）" },
      { keys: ["Ctrl+Shift+N"], label: "建立新資料夾" },
    ],
  },
  {
    title: "對話框與浮層",
    items: [
      { keys: ["Enter"], label: "確認（確認對話框、輸入框、路徑列編輯）" },
      { keys: ["Esc"], label: "取消或關閉（對話框、右鍵選單、瀏覽紀錄、設定頁、路徑列編輯）" },
    ],
  },
];
