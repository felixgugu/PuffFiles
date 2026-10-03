//! 目錄列舉與項目建構。

use crate::error::{AppError, AppResult};
use crate::model::{DirListing, FileEntry};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// 單一目錄最多回傳的項目數，避免超大資料夾卡住 UI。
pub const MAX_ENTRIES: usize = 20_000;

const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
const FILE_ATTRIBUTE_READONLY: u32 = 0x1;

/// 由檔案系統的 metadata 建立一筆 [`FileEntry`]。
pub fn build_entry(path: &Path) -> AppResult<FileEntry> {
    let link_meta = fs::symlink_metadata(path).map_err(|e| AppError::from_io(e, path))?;
    let is_symlink = link_meta.file_type().is_symlink();

    // 符號連結／捷徑要跟隨到目標才能判斷是否為資料夾；目標失效時退回連結本身。
    let meta = fs::metadata(path).unwrap_or(link_meta);
    let is_dir = meta.is_dir();
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());

    Ok(FileEntry {
        is_hidden: is_hidden(&name, &meta),
        is_readonly: is_readonly(&meta),
        name,
        path: display_path(path),
        is_dir,
        is_symlink,
        size: if is_dir { 0 } else { meta.len() },
        modified_ms: modified_ms(&meta),
        created_ms: created_ms(&meta),
        extension: extension_of(path).filter(|_| !is_dir),
    })
}

/// 只列出子資料夾（不含檔案），供側邊欄樹狀懶載入使用。
///
/// 與 [`list_directory`] 分開的理由：樹狀展開時我們只在意「可以往哪裡去」，
/// 跳過檔案能讓大目錄的展開速度快上一個量級。
pub fn list_subdirs(path: &Path) -> AppResult<Vec<FileEntry>> {
    let resolved = normalize(path)?;
    let meta = fs::metadata(&resolved).map_err(|e| AppError::from_io(e, &resolved))?;
    if !meta.is_dir() {
        return Err(AppError::NotADirectory {
            path: resolved.to_string_lossy().into_owned(),
        });
    }

    let read = fs::read_dir(&resolved).map_err(|e| AppError::from_io(e, &resolved))?;

    let mut entries = Vec::new();
    for item in read {
        let Ok(item) = item else { continue };
        if entries.len() >= MAX_ENTRIES {
            break;
        }
        if let Ok(entry) = build_entry(&item.path())
            && entry.is_dir
        {
            entries.push(entry);
        }
    }

    sort_entries(&mut entries);
    Ok(entries)
}

/// 列出資料夾內容，項目已排序（資料夾優先、再依名稱）。
pub fn list_directory(path: &Path) -> AppResult<DirListing> {
    let resolved = normalize(path)?;
    let meta = fs::metadata(&resolved).map_err(|e| AppError::from_io(e, &resolved))?;
    if !meta.is_dir() {
        return Err(AppError::NotADirectory {
            path: resolved.to_string_lossy().into_owned(),
        });
    }

    let read = fs::read_dir(&resolved).map_err(|e| AppError::from_io(e, &resolved))?;

    let mut entries = Vec::new();
    let mut truncated = false;
    for item in read {
        let Ok(item) = item else { continue };
        if entries.len() >= MAX_ENTRIES {
            truncated = true;
            break;
        }
        // 個別項目讀取失敗（競態、權限）時跳過，不讓整個資料夾開不起來。
        if let Ok(entry) = build_entry(&item.path()) {
            entries.push(entry);
        }
    }

    sort_entries(&mut entries);

    Ok(DirListing {
        name: resolved
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| display_path(&resolved)),
        parent: resolved.parent().map(display_path),
        path: display_path(&resolved),
        entries,
        truncated,
    })
}

/// 預設排序：資料夾優先，其次以不分大小寫的名稱排序。
pub fn sort_entries(entries: &mut [FileEntry]) {
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

/// 展開為絕對路徑（`..`、`.` 與相對路徑都一併處理）。
pub fn normalize(path: &Path) -> AppResult<PathBuf> {
    if path.as_os_str().is_empty() {
        return Err(AppError::invalid_path(path));
    }
    fs::canonicalize(path).map_err(|e| AppError::from_io(e, path))
}

/// 移除 Windows 的 verbatim 前綴。
///
/// `fs::canonicalize` 會回傳 `\\?\C:\...` / `\\?\UNC\server\share` 這種形式，
/// 直接顯示在 UI 上既難看也無法直接被使用者複製使用，因此統一轉回一般路徑。
pub fn display_path(path: &Path) -> String {
    let text = path.to_string_lossy();

    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return rest.to_string();
    }

    text.into_owned()
}

fn modified_ms(meta: &fs::Metadata) -> Option<u64> {
    meta.modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

fn created_ms(meta: &fs::Metadata) -> Option<u64> {
    meta.created()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

fn extension_of(path: &Path) -> Option<String> {
    path.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .filter(|e| !e.is_empty())
}

#[cfg(windows)]
fn is_hidden(_name: &str, meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    meta.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0
}

#[cfg(not(windows))]
fn is_hidden(name: &str, _meta: &fs::Metadata) -> bool {
    name.starts_with('.')
}

#[cfg(windows)]
fn is_readonly(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    meta.file_attributes() & FILE_ATTRIBUTE_READONLY != 0
}

#[cfg(unix)]
fn is_readonly(meta: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    meta.permissions().mode() & 0o200 == 0
}

#[cfg(not(any(windows, unix)))]
fn is_readonly(_meta: &fs::Metadata) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, is_dir: bool) -> FileEntry {
        FileEntry {
            name: name.to_string(),
            path: name.to_string(),
            is_dir,
            is_symlink: false,
            is_hidden: false,
            is_readonly: false,
            size: 0,
            modified_ms: None,
            created_ms: None,
            extension: None,
        }
    }

    #[test]
    fn sort_entries_puts_directories_first_then_case_insensitive_names() {
        let mut entries = vec![
            entry("zebra.txt", false),
            entry("Alpha", true),
            entry("apple.txt", false),
            entry("beta", true),
        ];

        sort_entries(&mut entries);

        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["Alpha", "beta", "apple.txt", "zebra.txt"]);
    }

    #[test]
    fn extension_is_lowercased_and_missing_for_directories() {
        assert_eq!(extension_of(Path::new("C:\\a\\Report.PDF")).as_deref(), Some("pdf"));
        assert_eq!(extension_of(Path::new("C:\\a\\no-ext")).as_deref(), None);
    }

    #[test]
    fn normalize_rejects_empty_path() {
        assert!(matches!(
            normalize(Path::new("")),
            Err(AppError::InvalidPath { .. })
        ));
    }

    #[test]
    fn display_path_strips_verbatim_prefix() {
        assert_eq!(display_path(Path::new(r"\\?\C:\Users\felix")), r"C:\Users\felix");
        assert_eq!(display_path(Path::new(r"\\?\C:\")), r"C:\");
        assert_eq!(
            display_path(Path::new(r"\\?\UNC\server\share\file.txt")),
            r"\\server\share\file.txt"
        );
        assert_eq!(display_path(Path::new(r"C:\plain")), r"C:\plain");
    }

    #[test]
    fn build_entry_reads_a_real_directory() {
        let entry = build_entry(&std::env::temp_dir()).expect("temp dir should be readable");
        assert!(entry.is_dir);
        assert_eq!(entry.size, 0);
    }
}
