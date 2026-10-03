//! 前後端共用的資料模型（序列化為 camelCase 以貼近前端慣例）。

use serde::{Deserialize, Serialize};

/// 串流列舉資料夾時的進度事件。
///
/// 透過 Tauri 2 的 [`tauri::ipc::Channel`] 逐批送到前端，讓超大資料夾也能
/// 邊讀邊顯示，而不是等整個目錄掃完才更新畫面。
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DirEvent {
    /// 開始列舉：先讓 UI 切換路徑與標題。
    Start {
        path: String,
        name: String,
        parent: Option<String>,
    },
    /// 一批已排序的項目。
    Batch { entries: Vec<FileEntry> },
    /// 列舉結束。
    Done { total: usize, truncated: bool },
}

/// 目錄中的單一項目。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub is_hidden: bool,
    /// 唯讀屬性（Windows 的 FILE_ATTRIBUTE_READONLY）。
    pub is_readonly: bool,
    /// 資料夾一律為 0。
    pub size: u64,
    /// Unix epoch 毫秒；無法取得時為 `None`。
    pub modified_ms: Option<u64>,
    /// 建立時間；Unix epoch 毫秒，無法取得時為 `None`。
    pub created_ms: Option<u64>,
    pub extension: Option<String>,
}

/// 一次目錄列舉的結果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirListing {
    pub path: String,
    pub name: String,
    pub parent: Option<String>,
    pub entries: Vec<FileEntry>,
    /// 項目數超過上限而被截斷。
    pub truncated: bool,
}

/// 磁碟種類。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DriveKind {
    Fixed,
    Removable,
    Network,
    Unknown,
}

/// 磁碟機 / 裝載點資訊。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    /// 顯示名稱，例如 `C:\`。
    pub name: String,
    pub mount_point: String,
    pub label: String,
    pub kind: DriveKind,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub is_removable: bool,
}

/// 側邊欄的快速存取位置。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickLocation {
    pub id: String,
    pub label: String,
    pub path: String,
    /// `home` / `desktop` / `documents` / `downloads` / `pictures` / `music` / `videos`
    pub kind: String,
}
