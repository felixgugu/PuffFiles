//! 找出電腦上已安裝的外部程式。
//!
//! 目前只有 7-Zip：安裝程式預設把它放在 Program Files 下的 `7-Zip`，所以查環境變數
//! 提供的標準位置就夠。**刻意不查登錄檔** —— 自訂安裝位置的使用者在設定頁直接填路徑
//! 就好，那條路徑也會被記住。

use std::path::PathBuf;

/// 7-Zip 的執行檔：優先 GUI 版（有進度、衝突與錯誤對話框），其次才是命令列版。
const SEVEN_ZIP_PROGRAMS: [&str; 2] = ["7zG.exe", "7z.exe"];

/// 找出本機安裝的 7-Zip；沒安裝（或不在標準位置）回 `None`。
pub fn find_7zip() -> Option<PathBuf> {
    for base in program_files_dirs() {
        for name in SEVEN_ZIP_PROGRAMS {
            let candidate = base.join("7-Zip").join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Program Files 系列目錄：去重、而且只留真的存在的。非 Windows 上自然會是空的。
fn program_files_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    for key in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
        let Some(value) = std::env::var_os(key) else {
            continue;
        };
        let path = PathBuf::from(value);
        if path.is_dir() && !dirs.contains(&path) {
            dirs.push(path);
        }
    }
    dirs
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 有沒有安裝 7-Zip 取決於機器，所以只驗證「回傳的東西真的存在、而且看起來對」。
    #[test]
    fn found_seven_zip_is_real() {
        let Some(path) = find_7zip() else {
            return;
        };
        assert!(path.is_file(), "{} 應該真的存在", path.display());
        let text = path.to_string_lossy().to_lowercase();
        assert!(text.contains("7-zip"), "路徑應該在 7-Zip 目錄下：{text}");
        assert!(
            text.ends_with("7zg.exe") || text.ends_with("7z.exe"),
            "應該是 7-Zip 的執行檔：{text}"
        );
    }

    #[test]
    fn program_files_dirs_are_existing_and_unique() {
        let dirs = program_files_dirs();
        for dir in &dirs {
            assert!(dir.is_dir(), "{} 應該存在", dir.display());
        }
        let mut sorted = dirs.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), dirs.len(), "不該有重複的目錄");
    }
}
