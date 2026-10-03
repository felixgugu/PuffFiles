//! 系統環境相關指令（磁碟機、快速存取位置）。

use crate::model::{DriveInfo, DriveKind, QuickLocation};
use std::path::PathBuf;
use sysinfo::{DiskKind as SysDiskKind, Disks};

/// 列出本機所有磁碟機 / 裝載點。
#[tauri::command]
pub async fn list_drives() -> Vec<DriveInfo> {
    tauri::async_runtime::spawn_blocking(collect_drives)
        .await
        .unwrap_or_default()
}

/// 列出使用者常用的快速存取位置（僅回傳實際存在者）。
#[tauri::command]
pub fn quick_locations() -> Vec<QuickLocation> {
    let mut locations = Vec::new();

    push_location(&mut locations, "home", "本機", "home", dirs::home_dir());
    push_location(&mut locations, "desktop", "桌面", "desktop", dirs::desktop_dir());
    push_location(&mut locations, "documents", "文件", "documents", dirs::document_dir());
    push_location(&mut locations, "downloads", "下載", "downloads", dirs::download_dir());
    push_location(&mut locations, "pictures", "圖片", "pictures", dirs::picture_dir());
    push_location(&mut locations, "music", "音樂", "music", dirs::audio_dir());
    push_location(&mut locations, "videos", "影片", "videos", dirs::video_dir());

    locations
}

fn push_location(
    target: &mut Vec<QuickLocation>,
    id: &str,
    label: &str,
    kind: &str,
    path: Option<PathBuf>,
) {
    let Some(path) = path else { return };
    if !path.is_dir() {
        return;
    }

    target.push(QuickLocation {
        id: id.to_string(),
        label: label.to_string(),
        path: path.to_string_lossy().into_owned(),
        kind: kind.to_string(),
    });
}

fn collect_drives() -> Vec<DriveInfo> {
    let disks = Disks::new_with_refreshed_list();

    let mut drives: Vec<DriveInfo> = disks
        .list()
        .iter()
        .filter_map(|disk| {
            let mount_point: PathBuf = disk.mount_point().to_path_buf();
            let mount = mount_point.to_string_lossy().into_owned();
            if mount.is_empty() {
                return None;
            }

            // UNC 路徑（`\\server\share`）視為網路磁碟。
            let is_network = mount.starts_with("\\\\");
            let is_removable = disk.is_removable();
            let raw_label = disk.name().to_string_lossy().trim().to_string();
            Some(DriveInfo {
                name: mount.clone(),
                mount_point: mount,
                label: raw_label,
                kind: if is_network {
                    DriveKind::Network
                } else if is_removable {
                    DriveKind::Removable
                } else {
                    match disk.kind() {
                        SysDiskKind::SSD | SysDiskKind::HDD => DriveKind::Fixed,
                        _ => DriveKind::Unknown,
                    }
                },
                total_bytes: disk.total_space(),
                available_bytes: disk.available_space(),
                is_removable,
            })
        })
        .collect();

    drives.sort_by(|a, b| a.name.cmp(&b.name));
    drives
}
