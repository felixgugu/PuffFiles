//! 目錄樹狀檢視：以深度優先順序輸出資料夾與選擇性的檔案。
//!
//! 走訪與扁平化列舉一樣不進入 reparse point。輸出同時產生 Unicode 與純 ASCII
//! 兩種樹枝，前端切換樣式時可以直接換字串，不必重新掃描磁碟。

use crate::core::dir::{build_entry, display_path, normalize};
use crate::error::{AppError, AppResult};
use crate::model::{DirectoryTreeResult, FileEntry};
use std::fmt::Write;
use std::fs;
use std::path::{Path, PathBuf};

/// 一次樹狀輸出最多包含的節點數（不含根目錄那一行）。
pub const MAX_NODES: usize = 20_000;
/// 單一資料夾最多掃描的原始項目數；避免一個超大平面資料夾先吃掉大量記憶體。
const MAX_SCAN_ENTRIES_PER_DIR: usize = MAX_NODES;

/// 待輸出的節點；保留兩個前綴，切換字元樣式時不用重新走訪。
struct PendingNode {
    path: PathBuf,
    name: String,
    is_dir: bool,
    descend: bool,
    unicode_prefix: String,
    ascii_prefix: String,
    last: bool,
}

struct Children {
    nodes: Vec<PendingNode>,
    truncated: bool,
}

struct TreeBuilder {
    unicode: String,
    ascii: String,
    directories: usize,
    files: usize,
    nodes: usize,
    limit: usize,
    truncated: bool,
    skipped: usize,
}

impl TreeBuilder {
    fn new(root: &str, limit: usize) -> Self {
        let mut unicode = String::new();
        let mut ascii = String::new();
        let _ = writeln!(unicode, "{root}");
        let _ = writeln!(ascii, "{root}");
        Self {
            unicode,
            ascii,
            directories: 0,
            files: 0,
            nodes: 0,
            limit,
            truncated: false,
            skipped: 0,
        }
    }

    /// 輸出一列；已達上限時回傳 false，讓呼叫端停止整棵樹的走訪。
    fn emit(&mut self, node: &PendingNode) -> bool {
        if self.nodes >= self.limit {
            self.truncated = true;
            return false;
        }

        let (unicode_connector, ascii_connector) = if node.last {
            ("└─ ", "\\--- ")
        } else {
            ("├─ ", "+--- ")
        };
        let _ = writeln!(
            self.unicode,
            "{}{unicode_connector}{}",
            node.unicode_prefix, node.name
        );
        let _ = writeln!(
            self.ascii,
            "{}{ascii_connector}{}",
            node.ascii_prefix, node.name
        );

        self.nodes += 1;
        if node.is_dir {
            self.directories += 1;
        } else {
            self.files += 1;
        }
        true
    }
}

/// 讀取資料夾樹，預設只包含資料夾；隱藏項目只在指定時納入。
pub fn read_tree(
    root: &Path,
    include_files: bool,
    include_hidden: bool,
) -> AppResult<DirectoryTreeResult> {
    read_tree_with_limit(root, include_files, include_hidden, MAX_NODES)
}

fn read_tree_with_limit(
    root: &Path,
    include_files: bool,
    include_hidden: bool,
    limit: usize,
) -> AppResult<DirectoryTreeResult> {
    let resolved = normalize(root)?;
    let meta = fs::metadata(&resolved).map_err(|error| AppError::from_io(error, &resolved))?;
    if !meta.is_dir() {
        return Err(AppError::NotADirectory {
            path: display_path(&resolved),
        });
    }

    let path = display_path(&resolved);
    let name = resolved
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.clone());
    let mut builder = TreeBuilder::new(&path, limit);
    let root_children = read_children(&resolved, "", "", include_files, include_hidden)
        .map_err(|error| AppError::from_io(error, &resolved))?;
    builder.truncated |= root_children.truncated;
    let mut stack = root_children.nodes.into_iter().rev().collect::<Vec<_>>();

    while let Some(node) = stack.pop() {
        if !builder.emit(&node) {
            break;
        }
        if !node.descend {
            continue;
        }

        let unicode_child_prefix = format!(
            "{}{}",
            node.unicode_prefix,
            if node.last { "   " } else { "│  " }
        );
        let ascii_child_prefix = format!(
            "{}{}",
            node.ascii_prefix,
            if node.last { "    " } else { "|   " }
        );
        let children = match read_children(
            &node.path,
            &unicode_child_prefix,
            &ascii_child_prefix,
            include_files,
            include_hidden,
        ) {
            Ok(children) => children,
            Err(_) => {
                builder.skipped += 1;
                continue;
            }
        };
        builder.truncated |= children.truncated;
        stack.extend(children.nodes.into_iter().rev());
    }

    Ok(DirectoryTreeResult {
        path,
        name,
        unicode_text: builder.unicode.trim_end_matches('\n').to_string(),
        ascii_text: builder.ascii.trim_end_matches('\n').to_string(),
        directories: builder.directories,
        files: builder.files,
        truncated: builder.truncated,
        skipped: builder.skipped,
    })
}

fn read_children(
    directory: &Path,
    unicode_prefix: &str,
    ascii_prefix: &str,
    include_files: bool,
    include_hidden: bool,
) -> std::io::Result<Children> {
    let read = fs::read_dir(directory)?;
    let mut entries: Vec<(PathBuf, FileEntry, bool)> = Vec::new();
    let mut scanned = 0;
    let mut truncated = false;

    for item in read {
        if scanned >= MAX_SCAN_ENTRIES_PER_DIR {
            truncated = true;
            break;
        }
        scanned += 1;
        let Ok(item) = item else {
            continue;
        };
        let path = item.path();
        let Ok(entry) = build_entry(&path) else {
            continue;
        };
        if !include_hidden && entry.is_hidden {
            continue;
        }
        if !entry.is_dir && !include_files {
            continue;
        }
        let reparse = entry.is_dir && is_reparse_point(&path);
        entries.push((path, entry, reparse));
    }

    entries.sort_by(|left, right| {
        right
            .1
            .is_dir
            .cmp(&left.1.is_dir)
            .then_with(|| left.1.name.to_lowercase().cmp(&right.1.name.to_lowercase()))
    });

    let last_index = entries.len().saturating_sub(1);
    Ok(Children {
        nodes: entries
            .into_iter()
            .enumerate()
            .map(|(index, (path, entry, reparse))| PendingNode {
                path,
                name: entry.name.clone(),
                is_dir: entry.is_dir,
                descend: entry.is_dir && !reparse,
                unicode_prefix: unicode_prefix.to_string(),
                ascii_prefix: ascii_prefix.to_string(),
                last: index == last_index,
            })
            .collect(),
        truncated,
    })
}

/// 符號連結、junction、掛載點都不要再往裡走，否則可能形成無窮迴圈。
#[cfg(windows)]
fn is_reparse_point(path: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;
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

    struct Scratch {
        root: PathBuf,
    }

    impl Scratch {
        fn new(name: &str) -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos();
            let root = std::env::temp_dir().join(format!("pufffile-tree-{name}-{stamp}"));
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

    #[test]
    fn directories_only_uses_unicode_and_ascii_connectors() {
        let scratch = Scratch::new("dirs");
        scratch.dir("alpha/beta");
        scratch.dir("zeta");
        scratch.file("alpha/note.txt");
        scratch.file("readme.txt");

        let tree = read_tree(&scratch.root, false, false).expect("tree");
        let root = display_path(&normalize(&scratch.root).expect("normalize"));

        assert_eq!(
            tree.unicode_text,
            format!("{root}\n├─ alpha\n│  └─ beta\n└─ zeta")
        );
        assert_eq!(
            tree.ascii_text,
            format!("{root}\n+--- alpha\n|   \\--- beta\n\\--- zeta")
        );
        assert_eq!(tree.directories, 3);
        assert_eq!(tree.files, 0);
        assert!(!tree.truncated);
    }

    #[test]
    fn include_files_sorts_directories_first_then_names() {
        let scratch = Scratch::new("files");
        scratch.dir("alpha");
        scratch.file("alpha/z.txt");
        scratch.file("alpha/a.txt");
        scratch.file("root.txt");

        let tree = read_tree(&scratch.root, true, false).expect("tree");
        let root = display_path(&normalize(&scratch.root).expect("normalize"));

        assert_eq!(
            tree.unicode_text,
            format!("{root}\n├─ alpha\n│  ├─ a.txt\n│  └─ z.txt\n└─ root.txt")
        );
        assert_eq!(tree.directories, 1);
        assert_eq!(tree.files, 3);
    }

    #[test]
    fn hidden_entries_are_excluded_or_included_explicitly() {
        let scratch = Scratch::new("hidden");
        scratch.dir(".secret");
        scratch.file(".env");
        scratch.file("visible.txt");

        let hidden = read_tree(&scratch.root, true, false).expect("hidden tree");
        assert!(!hidden.unicode_text.contains(".secret"));
        assert!(!hidden.unicode_text.contains(".env"));
        assert!(hidden.unicode_text.contains("visible.txt"));

        let included = read_tree(&scratch.root, true, true).expect("included tree");
        assert!(included.unicode_text.contains(".secret"));
        assert!(included.unicode_text.contains(".env"));
    }

    #[test]
    fn stops_at_the_requested_node_limit() {
        let scratch = Scratch::new("limit");
        scratch.dir("alpha");
        scratch.dir("beta");

        let tree = read_tree_with_limit(&scratch.root, false, false, 1).expect("tree");
        assert!(tree.truncated);
        assert_eq!(tree.directories, 1);
        assert_eq!(tree.unicode_text.lines().count(), 2);
    }
}
