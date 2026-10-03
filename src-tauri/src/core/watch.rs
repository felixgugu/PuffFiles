//! 目錄變更監控。
//!
//! 用 Windows 原生的 `ReadDirectoryChangesW`：開一個目錄控制代碼、用重疊式 I/O
//! 等通知，核心把「哪個檔名、發生什麼事」放進緩衝區。這是檔案總管與所有 watcher
//! 函式庫在 Windows 上用的同一條路。
//!
//! 兩個一定要處理的情況：
//! - **緩衝區溢位**：短時間大量變更時系統會回 `ERROR_NOTIFY_ENUM_DIR`，代表中間
//!   漏掉了，只能請前端整份重讀（`Rescan`）。
//! - **改名**：Windows 會送「舊名」「新名」兩筆，而且可能被緩衝區切開，所以直接
//!   當成「移除 + 新增」處理，不硬配對。

use crate::model::FileEntry;
use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WatchKind {
    Added,
    Removed,
    Modified,
    /// 遺漏了中間的變更，請整份重讀。
    Rescan,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchEvent {
    pub kind: WatchKind,
    pub path: String,
    /// 新增與內容變更會附帶完整項目，前端不必再問一次後端。
    pub entry: Option<FileEntry>,
}

pub type Emit = Box<dyn Fn(WatchEvent) + Send + 'static>;

#[cfg(not(windows))]
pub fn start(_id: String, _path: std::path::PathBuf, _emit: Emit) -> crate::error::AppResult<()> {
    Err(crate::error::AppError::Unsupported {
        feature: "目錄變更監控（僅支援 Windows）".to_string(),
    })
}

#[cfg(not(windows))]
pub fn stop(_id: &str) {}

#[cfg(windows)]
mod platform {
    use super::{Emit, WatchEvent, WatchKind};
    use crate::core::dir::{build_entry, display_path};
    use crate::error::{AppError, AppResult};
    use std::collections::HashMap;
    use std::os::windows::ffi::OsStrExt;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex, OnceLock};
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, ReadDirectoryChangesW, FILE_ACTION_ADDED, FILE_ACTION_MODIFIED,
        FILE_ACTION_REMOVED, FILE_ACTION_RENAMED_NEW_NAME, FILE_ACTION_RENAMED_OLD_NAME,
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OVERLAPPED, FILE_LIST_DIRECTORY,
        FILE_NOTIFY_CHANGE_ATTRIBUTES, FILE_NOTIFY_CHANGE_CREATION, FILE_NOTIFY_CHANGE_DIR_NAME,
        FILE_NOTIFY_CHANGE_FILE_NAME, FILE_NOTIFY_CHANGE_LAST_WRITE, FILE_NOTIFY_CHANGE_SIZE,
        FILE_NOTIFY_INFORMATION, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
        OPEN_EXISTING,
    };
    use windows::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};
    use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

    /// 64 KB：夠吸收一般操作，又不會每個窗格吃掉太多核心記憶體。
    const BUFFER_BYTES: usize = 64 * 1024;
    /// 等待通知的切片長度，只是為了能週期性檢查停止旗標。
    const WAIT_SLICE_MS: u32 = 250;

    /// 控制代碼只在建立它的執行緒使用，但需要跨執行緒搬移，所以要手動標記。
    struct SendHandle(HANDLE);
    unsafe impl Send for SendHandle {}

    pub struct Watcher {
        stop: Arc<AtomicBool>,
        thread: Option<std::thread::JoinHandle<()>>,
    }

    impl Watcher {
        fn stop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }

    impl Drop for Watcher {
        fn drop(&mut self) {
            self.stop();
        }
    }

    static WATCHERS: OnceLock<Mutex<HashMap<String, Watcher>>> = OnceLock::new();

    fn registry() -> &'static Mutex<HashMap<String, Watcher>> {
        WATCHERS.get_or_init(|| Mutex::new(HashMap::new()))
    }

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    unsafe fn open_directory(path: &Path) -> AppResult<HANDLE> {
        unsafe {
            let name = wide(path);
            CreateFileW(
                PCWSTR(name.as_ptr()),
                FILE_LIST_DIRECTORY.0,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                None,
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OVERLAPPED,
                None,
            )
            .map_err(|error| AppError::Io {
                message: format!("無法監控 {}：{error}", path.to_string_lossy()),
            })
        }
    }

    /// 開始監控；同一個 `id` 會先停掉舊的。
    pub fn start(id: String, path: PathBuf, emit: Emit) -> AppResult<()> {
        stop(&id);

        let handle = SendHandle(unsafe { open_directory(&path)? });
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);

        let thread = std::thread::Builder::new()
            .name("pufffile-watch".to_string())
            .spawn(move || {
                run(handle, &path, &thread_stop, emit);
            })
            .map_err(|error| AppError::Io {
                message: format!("無法建立監控執行緒：{error}"),
            })?;

        registry().lock().unwrap().insert(
            id,
            Watcher {
                stop,
                thread: Some(thread),
            },
        );
        Ok(())
    }

    pub fn stop(id: &str) {
        if let Some(mut watcher) = registry().lock().unwrap().remove(id) {
            watcher.stop();
        }
    }

    fn describe(path: &Path, kind: WatchKind) -> WatchEvent {
        // 新增與變更順便把完整項目讀出來，前端就不用再呼叫一次後端。
        let entry = if matches!(kind, WatchKind::Removed | WatchKind::Rescan) {
            None
        } else {
            build_entry(path).ok()
        };

        match entry {
            Some(entry) => WatchEvent {
                kind,
                path: display_path(path),
                entry: Some(entry),
            },
            // 檔案在通知送達前就消失了 → 當成移除，前端才不會留著幽靈項目。
            None if matches!(kind, WatchKind::Added | WatchKind::Modified) => WatchEvent {
                kind: WatchKind::Removed,
                path: display_path(path),
                entry: None,
            },
            None => WatchEvent {
                kind,
                path: display_path(path),
                entry: None,
            },
        }
    }

    fn run(handle: SendHandle, path: &Path, stop: &AtomicBool, emit: Emit) {
        let directory = handle.0;
        let event = unsafe { CreateEventW(None, true, false, PCWSTR::null()) };
        let Ok(event) = event else {
            unsafe { let _ = CloseHandle(directory); }
            return;
        };

        // 對齊到 4 bytes，FILE_NOTIFY_INFORMATION 需要對齊。
        let mut buffer = vec![0u32; BUFFER_BYTES / 4];
        let filter = FILE_NOTIFY_CHANGE_FILE_NAME
            | FILE_NOTIFY_CHANGE_DIR_NAME
            | FILE_NOTIFY_CHANGE_ATTRIBUTES
            | FILE_NOTIFY_CHANGE_SIZE
            | FILE_NOTIFY_CHANGE_LAST_WRITE
            | FILE_NOTIFY_CHANGE_CREATION;

        while !stop.load(Ordering::SeqCst) {
            let mut overlapped = OVERLAPPED {
                hEvent: event,
                ..Default::default()
            };
            let mut bytes = 0u32;

            let issued = unsafe {
                ReadDirectoryChangesW(
                    directory,
                    buffer.as_mut_ptr() as *mut core::ffi::c_void,
                    buffer.len() as u32 * 4,
                    false,
                    filter,
                    Some(&mut bytes),
                    Some(&mut overlapped),
                    None,
                )
            };
            if issued.is_err() {
                emit(describe(path, WatchKind::Rescan));
                break;
            }

            // 等通知；超時只是回去檢查停止旗標，不會重新發出讀取。
            let mut completed = false;
            loop {
                match unsafe { WaitForSingleObject(event, WAIT_SLICE_MS) } {
                    WAIT_OBJECT_0 => {
                        completed = true;
                        break;
                    }
                    WAIT_TIMEOUT => {
                        if stop.load(Ordering::SeqCst) {
                            break;
                        }
                    }
                    _ => break,
                }
            }

            if !completed {
                unsafe { let _ = CancelIoEx(directory, Some(&overlapped)); }
                break;
            }

            match unsafe { GetOverlappedResult(directory, &overlapped, &mut bytes, false) } {
                Ok(()) => emit_buffer(&buffer, bytes, path, &emit),
                // 溢位：中間的變更漏掉了，請前端整份重讀。
                Err(_) => emit(describe(path, WatchKind::Rescan)),
            }
        }

        unsafe {
            let _ = CloseHandle(directory);
            let _ = CloseHandle(event);
        }
    }

    fn emit_buffer(buffer: &[u32], bytes: u32, base: &Path, emit: &Emit) {
        let start = buffer.as_ptr() as *const u8;
        let mut offset = 0usize;

        while offset + std::mem::size_of::<FILE_NOTIFY_INFORMATION>() <= bytes as usize {
            let info = unsafe { &*(start.add(offset) as *const FILE_NOTIFY_INFORMATION) };
            let name_length = info.FileNameLength as usize / 2;
            let name = String::from_utf16_lossy(unsafe {
                std::slice::from_raw_parts(info.FileName.as_ptr(), name_length)
            });

            let kind = match info.Action {
                FILE_ACTION_ADDED | FILE_ACTION_RENAMED_NEW_NAME => WatchKind::Added,
                FILE_ACTION_REMOVED | FILE_ACTION_RENAMED_OLD_NAME => WatchKind::Removed,
                FILE_ACTION_MODIFIED => WatchKind::Modified,
                _ => {
                    // 其他動作（例如安全性變更）不影響清單。
                    let next = info.NextEntryOffset as usize;
                    if next == 0 {
                        break;
                    }
                    offset += next;
                    continue;
                }
            };

            emit(describe(&base.join(&name), kind));

            let next = info.NextEntryOffset as usize;
            if next == 0 {
                break;
            }
            offset += next;
        }

    }
}

#[cfg(windows)]
pub use platform::{start, stop};

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::mpsc::{channel, Receiver};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    fn scratch(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_millis();
        let root = std::env::temp_dir().join(format!("pufffile-watch-{name}-{stamp}"));
        std::fs::create_dir_all(&root).expect("create scratch");
        root
    }

    /// 在時限內等一個符合條件的通知；其他雜訊事件會被忽略。
    fn wait_for(rx: &Receiver<WatchEvent>, matches: impl Fn(&WatchEvent) -> bool) -> Option<WatchEvent> {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(250)) {
                Ok(event) => {
                    if matches(&event) {
                        return Some(event);
                    }
                }
                Err(_) => continue,
            }
        }
        None
    }

    #[test]
    fn reports_created_and_deleted_files() {
        let root = scratch("basic");
        let (tx, rx) = channel();
        start(
            "basic".to_string(),
            root.clone(),
            Box::new(move |event| {
                let _ = tx.send(event);
            }),
        )
        .expect("start watch");

        // 讓監控執行緒有時間掛上讀取。
        std::thread::sleep(Duration::from_millis(300));

        let file = root.join("hello.txt");
        std::fs::write(&file, "hello").expect("write file");

        let added = wait_for(&rx, |event| {
            matches!(event.kind, WatchKind::Added)
                && event.path.to_lowercase().ends_with("hello.txt")
        })
        .expect("應該收到新增通知");
        assert_eq!(
            added.entry.as_ref().map(|entry| entry.size),
            Some(5),
            "新增通知應該附帶完整項目"
        );

        std::fs::remove_file(&file).expect("remove file");
        let removed = wait_for(&rx, |event| {
            matches!(event.kind, WatchKind::Removed)
                && event.path.to_lowercase().ends_with("hello.txt")
        })
        .expect("應該收到移除通知");
        assert!(removed.entry.is_none());

        stop("basic");
    }

    #[test]
    fn starting_the_same_id_twice_replaces_the_watcher() {
        let root = scratch("replace");
        let (first_tx, first_rx) = channel();
        start(
            "replace".to_string(),
            root.clone(),
            Box::new(move |event| {
                let _ = first_tx.send(event);
            }),
        )
        .expect("first watch");

        let (second_tx, second_rx) = channel();
        start(
            "replace".to_string(),
            root.clone(),
            Box::new(move |event| {
                let _ = second_tx.send(event);
            }),
        )
        .expect("second watch");

        std::thread::sleep(Duration::from_millis(300));
        std::fs::write(root.join("after.txt"), "x").expect("write file");

        assert!(
            wait_for(&second_rx, |event| matches!(event.kind, WatchKind::Added)).is_some(),
            "新的監控應該收到通知"
        );
        assert!(
            first_rx.try_recv().is_err(),
            "舊的監控應該已經停止"
        );

        stop("replace");
    }
}
