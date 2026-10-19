//! 扁平化列舉：把一個資料夾底下（含所有子資料夾）的檔案攤平成一份清單。
//!
//! 與 [`crate::core::dir::list_directory`] 的差別是「只回檔案、先淺後深」：先送出這一層的
//! 檔案（依名稱），再依名稱排隊進入子資料夾，所以輸出的順序＝**越淺的越前面，同一層依
//! 相對路徑排序**。前端的排序（`utils/flatView.ts`）刻意重現同一個順序，兩邊必須一致。
//!
//! 走訪不進入 reparse point（符號連結／junction／掛載點）：`C:\Users\<user>` 底下就有
//! 指向自己的 junction，跟進去會變成無窮迴圈；因為只列檔案，這種資料夾本身也不會出現在
//! 結果裡。

use crate::core::dir::{build_entry, display_path, normalize};
use crate::error::{AppError, AppResult};
use crate::model::FileEntry;
use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};

/// 一次扁平化列舉最多輸出的檔案數。
///
/// 上限存在的原因是「整個專案含 node_modules」這種目錄沒有天然終點；超過就停下來並在
/// 前端提示。前端顯示的提示文字用同一個數字（`utils/flatView.ts` 的 `FLAT_VIEW_LIMIT`）。
pub const MAX_FILES: usize = 50_000;

/// 每批回報的檔案數，與單層列舉一致。
pub const BATCH_SIZE: usize = 256;

/// 正規化後的根目錄，連同串流事件需要的資訊。
pub struct FlatRoot {
    /// 已正規化的實際路徑（用來走訪）。
    pub path: PathBuf,
    /// 給前端顯示的根目錄路徑（已去掉 verbatim 前綴）。
    pub display: String,
    /// 根目錄的名稱（標題列用）。
    pub name: String,
    /// 根目錄的上層（上一層鈕用）。
    pub parent: Option<String>,
}

/// 扁平化列舉的結果統計。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct FlatOutcome {
    /// 實際送出的檔案數。
    pub total: usize,
    /// 達到 [`MAX_FILES`] 而提前結束。
    pub truncated: bool,
    /// 讀不到而略過的資料夾數（權限、競態）。
    pub skipped: usize,
    /// 被中止（呼叫端取消或通道中斷），沒有走完。
    pub stopped: bool,
}

/// 檢查根目錄能不能走訪，並整理出串流事件要的欄位。
pub fn resolve_root(root: &Path) -> AppResult<FlatRoot> {
    let resolved = normalize(root)?;
    let meta = fs::metadata(&resolved).map_err(|error| AppError::from_io(error, &resolved))?;
    if !meta.is_dir() {
        return Err(AppError::NotADirectory {
            path: display_path(&resolved),
        });
    }

    Ok(FlatRoot {
        name: resolved
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| display_path(&resolved)),
        parent: resolved.parent().map(display_path),
        display: display_path(&resolved),
        path: resolved,
    })
}

/// 走訪 `root` 底下的所有檔案，分批交給 `emit`。
///
/// `emit` 回傳 `false` 代表不用再送（通道中斷），`cancel` 回傳 `true` 代表請求已被取消；
/// 兩者都會讓走訪停下來，並把 `FlatOutcome::stopped` 設為 true。
pub fn walk_files(
    root: &FlatRoot,
    include_hidden_dirs: bool,
    cancel: &dyn Fn() -> bool,
    emit: &mut dyn FnMut(Vec<FileEntry>) -> bool,
) -> FlatOutcome {
    walk_with_limit(root, MAX_FILES, include_hidden_dirs, cancel, emit)
}

/// [`walk_files`] 的實作；`limit` 拉出來只是為了讓測試用小上限驗證同一段邏輯。
fn walk_with_limit(
    root: &FlatRoot,
    limit: usize,
    include_hidden_dirs: bool,
    cancel: &dyn Fn() -> bool,
    emit: &mut dyn FnMut(Vec<FileEntry>) -> bool,
) -> FlatOutcome {
    let mut outcome = FlatOutcome::default();
    let mut buffer: Vec<FileEntry> = Vec::with_capacity(BATCH_SIZE);
    let mut queue: VecDeque<PathBuf> = VecDeque::new();
    queue.push_back(root.path.clone());

    'walk: while let Some(directory) = queue.pop_front() {
        if cancel() {
            outcome.stopped = true;
            break;
        }

        let Ok(read) = fs::read_dir(&directory) else {
            // 個別資料夾讀不到（權限、競態）只略過，清單其餘部分照樣出來。
            // 根目錄本身讀不到會在上面的 `resolve_root` 就失敗。
            outcome.skipped += 1;
            continue;
        };

        let mut files: Vec<FileEntry> = Vec::new();
        let mut subdirs: Vec<PathBuf> = Vec::new();
        for item in read {
            let Ok(item) = item else { continue };
            let path = item.path();
            // 個別項目讀取失敗（競態、權限）時跳過，不讓整份清單失敗。
            let Ok(entry) = build_entry(&path) else { continue };
            if entry.is_dir {
                if (include_hidden_dirs || !entry.is_hidden) && !is_reparse_point(&path) {
                    subdirs.push(path);
                }
                continue;
            }
            files.push(entry);
        }

        files.sort_by_key(|entry| entry.name.to_lowercase());
        for entry in files {
            outcome.total += 1;
            buffer.push(entry);

            if buffer.len() >= BATCH_SIZE && !emit(std::mem::take(&mut buffer)) {
                outcome.stopped = true;
                break 'walk;
            }
            if outcome.total >= limit {
                outcome.truncated = true;
                break 'walk;
            }
        }

        if cancel() {
            outcome.stopped = true;
            break;
        }

        // 這一層的檔案都送完才排入子資料夾：輸出順序才會是「先淺後深」。
        subdirs.sort_by_key(|path| name_key(path));
        queue.extend(subdirs);
    }

    if !buffer.is_empty() && !outcome.stopped {
        emit(buffer);
    }
    outcome
}

/// 子資料夾的排序鍵：不分大小寫的名稱，與單層列舉的 `sort_entries` 一致。
fn name_key(path: &Path) -> String {
    path
        .file_name()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// 這個路徑是不是 reparse point（符號連結、junction、掛載點）。
///
/// 判斷失敗時回 `true`：讀不到屬性的資料夾進去了也讀不到內容，保守起見當成不該進入。
#[cfg(windows)]
fn is_reparse_point(path: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    /// Windows 的 `FILE_ATTRIBUTE_REPARSE_POINT`。
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

    fs::symlink_metadata(path)
        .map(|meta| meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0)
        .unwrap_or(true)
}

#[cfg(not(windows))]
fn is_reparse_point(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// 一個測試專用的暫存資料夾；每個測試各自一間，避免互相踩到。
    struct Scratch {
        root: PathBuf,
    }

    impl Scratch {
        fn new(name: &str) -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos();
            let root = std::env::temp_dir().join(format!("pufffile-flat-{name}-{stamp}"));
            fs::create_dir_all(&root).expect("create scratch");
            Self { root }
        }

        fn dir(&self, path: &str) -> PathBuf {
            let target = self.root.join(path);
            fs::create_dir_all(&target).expect("create dir");
            target
        }

        fn file(&self, path: &str) {
            let target = self.root.join(path);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).expect("create parent");
            }
            fs::write(target, b"x").expect("create file");
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    /// 收集一次走訪的結果（檔名＋相對於根目錄的路徑）。
    fn walk(root: &FlatRoot, include_hidden_dirs: bool) -> (Vec<String>, FlatOutcome) {
        let mut names = Vec::new();
        let outcome = walk_files(root, include_hidden_dirs, &|| false, &mut |batch| {
            names.extend(batch.into_iter().map(|entry| entry.name));
            true
        });
        (names, outcome)
    }

    #[test]
    fn lists_only_files_shallowest_first() {
        let scratch = Scratch::new("order");
        scratch.file("b.txt");
        scratch.file("a.txt");
        scratch.file("sub/z.txt");
        scratch.file("sub/deep/y.txt");
        scratch.file("other/w.txt");

        let root = resolve_root(&scratch.root).expect("resolve root");
        let (names, outcome) = walk(&root, true);

        // 根目錄的檔案先出來（依名稱），再依資料夾名稱進入子資料夾。
        assert_eq!(names, ["a.txt", "b.txt", "w.txt", "z.txt", "y.txt"]);
        assert_eq!(outcome.total, 5);
        assert!(!outcome.truncated);
        assert_eq!(outcome.skipped, 0);
        assert!(!outcome.stopped);
    }

    #[test]
    fn reports_display_paths_without_verbatim_prefix() {
        let scratch = Scratch::new("paths");
        scratch.file("sub/a.txt");

        let root = resolve_root(&scratch.root).expect("resolve root");
        assert!(!root.display.starts_with(r"\\?\"), "verbatim 前綴外洩：{}", root.display);

        let mut paths = Vec::new();
        walk_files(&root, true, &|| false, &mut |batch| {
            paths.extend(batch.into_iter().map(|entry| entry.path));
            true
        });
        assert_eq!(paths.len(), 1);
        assert!(!paths[0].starts_with(r"\\?\"), "verbatim 前綴外洩：{}", paths[0]);
        assert!(paths[0].ends_with(r"sub\a.txt"));
    }

    #[test]
    fn stops_at_the_file_limit() {
        let scratch = Scratch::new("limit");
        for index in 0..5 {
            scratch.file(&format!("f{index}.txt"));
        }

        let root = resolve_root(&scratch.root).expect("resolve root");
        let mut names = Vec::new();
        // 真正跑一次「5 萬筆」太慢，用小上限驗證同一段邏輯。
        let outcome = walk_with_limit(&root, 3, true, &|| false, &mut |batch| {
            names.extend(batch.into_iter().map(|entry| entry.name));
            true
        });

        assert_eq!(outcome.total, 3);
        assert!(outcome.truncated, "超過上限要回報截斷");
        assert_eq!(names, ["f0.txt", "f1.txt", "f2.txt"]);
        assert!(!outcome.stopped);
    }

    #[test]
    fn stops_when_the_consumer_goes_away() {
        let scratch = Scratch::new("stop");
        for index in 0..(BATCH_SIZE + 5) {
            scratch.file(&format!("f{index:04}.txt"));
        }

        let root = resolve_root(&scratch.root).expect("resolve root");
        let outcome = walk_files(&root, true, &|| false, &mut |_batch| false);

        assert!(outcome.stopped, "通道中斷應該讓走訪停下來");
        assert!(outcome.total <= BATCH_SIZE);
    }

    #[test]
    fn stops_when_the_request_is_cancelled() {
        let scratch = Scratch::new("cancel");
        scratch.file("a.txt");
        scratch.file("sub/b.txt");

        let root = resolve_root(&scratch.root).expect("resolve root");
        let mut seen = Vec::new();
        let outcome = walk_files(&root, true, &|| true, &mut |batch| {
            seen.extend(batch.into_iter().map(|entry| entry.name));
            true
        });

        assert!(outcome.stopped);
        assert!(seen.is_empty(), "取消之後不該再送任何批次");
    }

    #[test]
    fn skips_hidden_directories_unless_asked() {
        let scratch = Scratch::new("hidden");
        scratch.dir(".git");
        scratch.file(".git/config");
        scratch.file("visible.txt");
        if !hide(&scratch.root.join(".git")) {
            // 非 Windows 或是設定屬性失敗時，改用點開頭的慣例（`core::dir` 的判斷一致）。
            return;
        }

        let root = resolve_root(&scratch.root).expect("resolve root");

        let (names, _) = walk(&root, false);
        assert_eq!(names, ["visible.txt"]);

        let (names, _) = walk(&root, true);
        assert_eq!(names, ["visible.txt", "config"]);
    }

    /// 把資料夾標成「隱藏」；Windows 以外沒有這個概念，回 `false`。
    #[cfg(windows)]
    fn hide(path: &Path) -> bool {
        use std::process::Command;
        Command::new("attrib")
            .arg("+h")
            .arg(path)
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    #[cfg(not(windows))]
    fn hide(_path: &Path) -> bool {
        false
    }

    /// junction 指向自己所在的目錄：沒有擋掉 reparse point 的話這裡會永遠走不完。
    #[cfg(windows)]
    #[test]
    fn does_not_follow_directory_junctions() {
        use std::process::Command;

        let scratch = Scratch::new("junction");
        scratch.file("a.txt");
        scratch.dir("sub");
        scratch.file("sub/b.txt");

        let link = scratch.root.join("loop");
        let created = Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&scratch.root)
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        if !created {
            eprintln!("建立 junction 失敗，跳過這條測試");
            return;
        }

        let root = resolve_root(&scratch.root).expect("resolve root");
        let (names, outcome) = walk(&root, true);

        assert_eq!(names, ["a.txt", "b.txt"]);
        assert_eq!(outcome.total, 2);
        assert!(!outcome.truncated);
    }
}
