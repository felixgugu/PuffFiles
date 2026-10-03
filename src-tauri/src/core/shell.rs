//! Windows shell 整合：系統剪貼簿與檔案操作。
//!
//! 這裡刻意把「檔案怎麼搬」交給作業系統的 shell（`IFileOperation`），而不是自己寫
//! `copy` + `remove`：衝突對話框、進度、取消、資源回收筒、跨磁碟搬移、復原全部由
//! Windows 提供，也正是檔案總管自己在用的路徑。
//!
//! 剪貼簿使用傳統的 `CF_HDROP` 格式，這是檔案總管讀寫「檔案清單」的標準格式，
//! 所以兩個方向的複製貼上都能互通。

#[cfg(windows)]
use crate::error::AppError;
#[cfg(not(windows))]
use crate::error::{AppError, AppResult};
#[cfg(not(windows))]
use std::path::{Path, PathBuf};

/// 從系統剪貼簿讀到的檔案清單。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFiles {
    pub paths: Vec<String>,
    /// true 表示這批項目是「剪下」而不是「複製」。
    pub cut: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileOp {
    Copy,
    Move,
    Delete,
}

#[cfg(windows)]
fn io_error(message: impl Into<String>) -> AppError {
    AppError::Io {
        message: message.into(),
    }
}

#[cfg(not(windows))]
pub fn read_clipboard() -> AppResult<ClipboardFiles> {
    Err(AppError::Unsupported {
        feature: "系統剪貼簿（僅支援 Windows）".to_string(),
    })
}

#[cfg(not(windows))]
pub fn write_clipboard(_paths: &[PathBuf], _cut: bool) -> AppResult<()> {
    Err(AppError::Unsupported {
        feature: "系統剪貼簿（僅支援 Windows）".to_string(),
    })
}

#[cfg(not(windows))]
pub fn clear_clipboard() -> AppResult<()> {
    Err(AppError::Unsupported {
        feature: "系統剪貼簿（僅支援 Windows）".to_string(),
    })
}

#[cfg(not(windows))]
pub fn run(
    _items: &[PathBuf],
    _destination: Option<&Path>,
    _op: FileOp,
    _silent: bool,
) -> AppResult<bool> {
    Err(AppError::Unsupported {
        feature: "檔案操作（僅支援 Windows）".to_string(),
    })
}

#[cfg(windows)]
mod platform {
    use super::{io_error, ClipboardFiles, FileOp};
    use crate::error::{AppError, AppResult};
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::path::{Path, PathBuf};
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{HANDLE, HGLOBAL, POINT};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardData, OpenClipboard, RegisterClipboardFormatW,
        SetClipboardData,
    };
    use windows::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };
    use windows::Win32::Foundation::GlobalFree;
    use windows::Win32::System::Ole::{CF_HDROP, DROPEFFECT_COPY, DROPEFFECT_MOVE};
    use windows::Win32::UI::Shell::{
        DragQueryFileW, FileOperation, IFileOperation, IShellItem,
        SHCreateItemFromParsingName, DROPFILES, FOF_ALLOWUNDO, FOF_NOERRORUI, FOF_NOCONFIRMATION,
        FOF_SILENT, HDROP,
    };

    /// 配置中的全域記憶體；成功交給系統後要 `forget`，否則會被釋放兩次。
    struct OwnedGlobal(HGLOBAL);

    impl Drop for OwnedGlobal {
        fn drop(&mut self) {
            if !self.0 .0.is_null() {
                unsafe {
                    let _ = GlobalFree(Some(self.0));
                }
            }
        }
    }

    fn alloc_bytes(bytes: &[u8]) -> AppResult<OwnedGlobal> {
        unsafe {
            let handle = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1))
                .map_err(|error| io_error(format!("配置剪貼簿記憶體失敗：{error}")))?;
            let owned = OwnedGlobal(handle);
            let pointer = GlobalLock(owned.0);
            if pointer.is_null() {
                return Err(io_error("鎖定剪貼簿記憶體失敗"));
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), pointer as *mut u8, bytes.len());
            let _ = GlobalUnlock(owned.0);
            Ok(owned)
        }
    }

    /// 建立 `CF_HDROP` 需要的 `DROPFILES` 結構加上雙 null 結尾的寬字元路徑清單。
    fn dropfiles_handle(paths: &[PathBuf]) -> AppResult<OwnedGlobal> {
        let header = std::mem::size_of::<DROPFILES>();
        let mut units: Vec<u16> = Vec::new();
        for path in paths {
            units.extend(path.as_os_str().encode_wide());
            units.push(0);
        }
        units.push(0);

        let mut bytes = vec![0u8; header + units.len() * 2];
        let dropfiles = DROPFILES {
            pFiles: header as u32,
            pt: POINT { x: 0, y: 0 },
            fNC: false.into(),
            fWide: true.into(),
        };
        unsafe {
            std::ptr::write_unaligned(bytes.as_mut_ptr() as *mut DROPFILES, dropfiles);
            std::ptr::copy_nonoverlapping(
                units.as_ptr() as *const u8,
                bytes.as_mut_ptr().add(header),
                units.len() * 2,
            );
        }
        alloc_bytes(&bytes)
    }

    fn effect_handle(effect: u32) -> AppResult<OwnedGlobal> {
        alloc_bytes(&effect.to_ne_bytes())
    }

    /// 讀出「這是剪下還是複製」的標記；讀不到就當成複製。
    unsafe fn preferred_effect() -> Option<u32> {
        unsafe {
            let format = RegisterClipboardFormatW(w!("Preferred DropEffect"));
            if format == 0 {
                return None;
            }
            let handle = GetClipboardData(format).ok()?;
            let pointer = GlobalLock(HGLOBAL(handle.0));
            if pointer.is_null() {
                return None;
            }
            let value = std::ptr::read_unaligned(pointer as *const u32);
            let _ = GlobalUnlock(HGLOBAL(handle.0));
            Some(value)
        }
    }

    pub fn write_clipboard(paths: &[PathBuf], cut: bool) -> AppResult<()> {
        let hdrop = dropfiles_handle(paths)?;
        let effect = effect_handle(if cut {
            DROPEFFECT_MOVE.0
        } else {
            DROPEFFECT_COPY.0
        })?;

        unsafe {
            if OpenClipboard(None).is_err() {
                return Err(io_error("剪貼簿正被其他程式使用"));
            }

            let result = (|| -> AppResult<()> {
                let _ = EmptyClipboard();
                let format = RegisterClipboardFormatW(w!("Preferred DropEffect"));

                SetClipboardData(CF_HDROP.0 as u32, Some(HANDLE(hdrop.0 .0)))
                    .map_err(|error| io_error(format!("寫入剪貼簿失敗：{error}")))?;
                // 交給系統之後所有權就轉移了，不能再釋放。
                std::mem::forget(hdrop);

                if format != 0 {
                    SetClipboardData(format, Some(HANDLE(effect.0 .0)))
                        .map_err(|error| io_error(format!("寫入剪貼簿效果失敗：{error}")))?;
                    std::mem::forget(effect);
                }
                Ok(())
            })();

            let _ = CloseClipboard();
            result
        }
    }

    pub fn read_clipboard() -> AppResult<ClipboardFiles> {
        unsafe {
            if OpenClipboard(None).is_err() {
                return Err(io_error("剪貼簿正被其他程式使用"));
            }
            let result = read_locked();
            let _ = CloseClipboard();
            result
        }
    }

    /// 清空剪貼簿。搬移貼上之後要清掉，否則再貼一次會指向已經不存在的來源。
    pub fn clear_clipboard() -> AppResult<()> {
        unsafe {
            if OpenClipboard(None).is_err() {
                return Err(io_error("剪貼簿正被其他程式使用"));
            }
            let _ = EmptyClipboard();
            let _ = CloseClipboard();
        }
        Ok(())
    }

    unsafe fn read_locked() -> AppResult<ClipboardFiles> {
        unsafe {
            let mut paths = Vec::new();

            if let Ok(handle) = GetClipboardData(CF_HDROP.0 as u32) {
                let drop = HDROP(handle.0);
                let count = DragQueryFileW(drop, u32::MAX, None);
                for index in 0..count {
                    let length = DragQueryFileW(drop, index, None) as usize;
                    if length == 0 {
                        continue;
                    }
                    let mut buffer = vec![0u16; length + 1];
                    let written = DragQueryFileW(drop, index, Some(&mut buffer)) as usize;
                    if written > 0 {
                        paths.push(String::from_utf16_lossy(&buffer[..written]));
                    }
                }
            }

            let cut = preferred_effect()
                .map(|effect| effect & DROPEFFECT_MOVE.0 != 0)
                .unwrap_or(false);

            Ok(ClipboardFiles { paths, cut })
        }
    }

    /// 用 shell 執行檔案操作。回傳 false 代表使用者中途取消。
    pub fn run(
        items: &[PathBuf],
        destination: Option<&Path>,
        op: FileOp,
        silent: bool,
    ) -> AppResult<bool> {
        if items.is_empty() {
            return Ok(true);
        }
        if op != FileOp::Delete && destination.is_none() {
            return Err(io_error("複製或搬移需要目的資料夾"));
        }

        unsafe {
            // IFileOperation 需要在有 COM 的執行緒上建立；重複初始化是安全的。
            let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
            let result = perform(items, destination, op, silent);
            if initialized {
                CoUninitialize();
            }
            result
        }
    }

    unsafe fn perform(
        items: &[PathBuf],
        destination: Option<&Path>,
        op: FileOp,
        silent: bool,
    ) -> AppResult<bool> {
        unsafe {
            let operation: IFileOperation = CoCreateInstance(&FileOperation, None, CLSCTX_ALL)
                .map_err(|error| io_error(format!("建立檔案操作失敗：{error}")))?;

            let mut flags = FOF_ALLOWUNDO;
            if silent {
                flags |= FOF_SILENT | FOF_NOERRORUI | FOF_NOCONFIRMATION;
            }
            operation
                .SetOperationFlags(flags)
                .map_err(|error| io_error(format!("設定檔案操作參數失敗：{error}")))?;

            let target = match destination {
                Some(path) => Some(shell_item(path)?),
                None => None,
            };

            for item in items {
                let source = shell_item(item)?;
                match op {
                    FileOp::Copy => {
                        let folder = target.as_ref().expect("copy 需要目的資料夾");
                        operation.CopyItem(&source, folder, PCWSTR::null(), None)
                    }
                    FileOp::Move => {
                        let folder = target.as_ref().expect("move 需要目的資料夾");
                        operation.MoveItem(&source, folder, PCWSTR::null(), None)
                    }
                    FileOp::Delete => operation.DeleteItem(&source, None),
                }
                .map_err(|error| io_error(format!("排入檔案操作失敗：{error}")))?;
            }

            operation
                .PerformOperations()
                .map_err(|error| io_error(format!("執行檔案操作失敗：{error}")))?;

            let aborted = operation
                .GetAnyOperationsAborted()
                .map(|value| value.as_bool())
                .unwrap_or(false);
            Ok(!aborted)
        }
    }

    unsafe fn shell_item(path: &Path) -> AppResult<IShellItem> {
        unsafe {
            // `canonicalize` 會給出 `\\?\C:\...` 這種長路徑形式，但 shell 的命名空間
            // 不接受它（會回 0x80070057 參數錯誤），所以要先轉回一般路徑。
            let text = crate::core::dir::display_path(path);
            let wide: Vec<u16> = OsStr::new(&text).encode_wide().chain(Some(0)).collect();
            SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None).map_err(|error| AppError::Io {
                message: format!("無法解析路徑 {text}：{error}"),
            })
        }
    }

    #[allow(dead_code)]
    fn _keep_os_str_import(_: &OsStr) {}
}

#[cfg(windows)]
pub use platform::{clear_clipboard, read_clipboard, run, write_clipboard};

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_millis();
        let root = std::env::temp_dir().join(format!("pufffile-shell-{name}-{stamp}"));
        fs::create_dir_all(&root).expect("create scratch");
        root
    }

    fn write_file(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent");
        }
        fs::write(path, content).expect("write file");
    }

    #[test]
    fn copies_files_through_the_shell() {
        let root = scratch("copy");
        let source = root.join("source").join("hello.txt");
        write_file(&source, "hello");
        let destination = root.join("destination");
        fs::create_dir_all(&destination).expect("destination");

        let completed =
            run(std::slice::from_ref(&source), Some(&destination), FileOp::Copy, true).expect("copy");

        assert!(completed, "操作被回報為取消");
        assert_eq!(
            fs::read_to_string(destination.join("hello.txt")).expect("copied file"),
            "hello"
        );
        assert!(source.is_file(), "複製不應該移除來源");
    }

    #[test]
    fn moves_files_through_the_shell() {
        let root = scratch("move");
        let source = root.join("source").join("moved.txt");
        write_file(&source, "moved");
        let destination = root.join("destination");
        fs::create_dir_all(&destination).expect("destination");

        let completed =
            run(std::slice::from_ref(&source), Some(&destination), FileOp::Move, true).expect("move");

        assert!(completed, "操作被回報為取消");
        assert!(!source.exists(), "搬移後來源應該消失");
        assert_eq!(
            fs::read_to_string(destination.join("moved.txt")).expect("moved file"),
            "moved"
        );
    }

    /// 刪除走資源回收筒，所以只驗證來源已經不在（檔案本身是可回收的小暫存檔）。
    #[test]
    fn deletes_files_through_the_shell() {
        let root = scratch("delete");
        let victim = root.join("trash.txt");
        write_file(&victim, "bye");

        let completed = run(std::slice::from_ref(&victim), None, FileOp::Delete, true).expect("delete");

        assert!(completed, "操作被回報為取消");
        assert!(!victim.exists(), "刪除後檔案應該消失");
    }

    #[test]
    fn reports_missing_destination_folder() {
        let root = scratch("nosuch");
        let source = root.join("a.txt");
        write_file(&source, "a");
        let error = run(&[source], None, FileOp::Copy, true).expect_err("應該要失敗");
        assert!(matches!(error, AppError::Io { .. }));
    }

    /// 會動到使用者的剪貼簿，所以預設不跑；需要時用
    /// `cargo test -- --ignored clipboard_round_trip` 驗證。
    ///
    /// 內容刻意放自己的暫存檔而不是系統檔：萬一使用者在測試後真的貼上，
    /// 也只是搬動一個無關緊要的暫存檔，不會動到他的資料。
    #[test]
    #[ignore]
    fn clipboard_round_trip() {
        let root = scratch("clipboard");
        let file = root.join("pufffile-clipboard-test.txt");
        write_file(&file, "clipboard");
        let paths = vec![file.clone()];

        write_clipboard(&paths, true).expect("write");
        let read = read_clipboard().expect("read");
        assert!(read.cut, "應該讀到剪下標記");
        assert_eq!(read.paths.len(), 1);
        assert!(
            read.paths[0].to_lowercase().contains("pufffile-clipboard-test"),
            "讀到的路徑不正確：{}",
            read.paths[0]
        );

        // 收尾：改回「複製」語意，避免使用者之後貼上時把暫存檔搬走。
        write_clipboard(&paths, false).expect("cleanup write");
    }
}
