//! 不依賴 Tauri IPC 的核心邏輯，可獨立測試。

pub mod dir;
pub mod oplog;
pub mod shell;
pub mod viewer;
pub mod watch;

pub use dir::{display_path, list_directory, list_subdirs, normalize};
