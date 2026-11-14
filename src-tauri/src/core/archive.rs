//! 壓縮檔檢視器：呼叫 7-Zip 的命令列版列出內容。
//!
//! 這裡**只讀**：`7z l -slt -ba` 的輸出解析成項目清單，前端負責篩選、排序與顯示；
//! 不解壓縮、不落地（單檔預覽不在這一版）。解析與行程控制都在這一層，命令層只轉交參數。
//!
//! 為什麼用 `7z.exe` 而不是 Rust 的壓縮函式庫：現有外部工具已經在整合 7-Zip，
//! 一種實作就能列 zip／7z／rar／tar／iso…；沒有安裝時回 `ProgramNotFound`，由前端說明。

use crate::core::{display_path, normalize};
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

/// 一次列舉最多回傳的項目數；與前端 `utils/archive.ts` 的 `MAX_ARCHIVE_ENTRIES` 同一個數字。
pub const MAX_ENTRIES: usize = 20_000;
/// 列舉的整體時限：慢速網路磁碟上的壓縮檔不能讓檢視器永遠停在「正在讀取…」。
const LIST_TIMEOUT: Duration = Duration::from_secs(30);
/// 錯誤訊息最多留這麼多字元（7-Zip 的 stderr 通常只有一兩行）。
const STDERR_LIMIT: usize = 8 * 1024;

/// 壓縮檔裡的一個項目。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
    /// 壓縮檔內的相對路徑（沿用 7-Zip 的 `\` 分隔）。
    pub path: String,
    pub size: u64,
    pub packed_size: u64,
    /// 7-Zip 印出的時間字串（已去掉小數秒）；解析不出來時保留原樣。
    pub modified: Option<String>,
    pub encrypted: bool,
    pub crc: Option<String>,
}

/// 一份壓縮檔的列舉結果。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveListing {
    pub path: String,
    pub name: String,
    /// 壓縮檔本身的大小（不是內容總和）。
    pub size: u64,
    pub entries: Vec<ArchiveEntry>,
    pub total_size: u64,
    pub total_packed_size: u64,
    /// 超過 [`MAX_ENTRIES`] 就停止讀取（並殺掉 7-Zip），只回前段。
    pub truncated: bool,
    /// 有任何項目標成 `Encrypted = +`（內容加密；檔頭加密會直接列不出來）。
    pub encrypted: bool,
}

/// 逐行累積 `7z l -slt -ba` 的輸出。
///
/// 7-Zip 用一個空白行分隔每一筆記錄，記錄裡是 `Key = Value`。這裡刻意做成
/// 「一行一行餵」而不是先收完整份字串：超大壓縮檔的輸出可以到幾十 MB，
/// 到上限就要能立刻停下來。
pub struct ListingParser {
    limit: usize,
    entries: Vec<ArchiveEntry>,
    fields: Vec<(String, String)>,
    truncated: bool,
}

impl ListingParser {
    pub fn new(limit: usize) -> Self {
        Self {
            limit,
            entries: Vec::new(),
            fields: Vec::new(),
            truncated: false,
        }
    }

    /// 餵一行；回傳 `false` 代表已經到上限、呼叫端應該停止讀取並結束 7-Zip。
    pub fn push(&mut self, line: &str) -> bool {
        if line.trim().is_empty() {
            self.flush();
            return true;
        }
        // 已經收滿，又看到下一筆的第一行：代表還有更多，標成截斷並收工。
        if self.entries.len() >= self.limit {
            self.truncated = true;
            return false;
        }
        if let Some((key, value)) = line.split_once(" = ") {
            self.fields.push((key.trim().to_string(), value.to_string()));
        }
        true
    }

    /// 串流結束（最後一筆沒有空行收尾時也要收）。
    pub fn finish(mut self) -> (Vec<ArchiveEntry>, bool) {
        self.flush();
        (self.entries, self.truncated)
    }

    fn flush(&mut self) {
        if self.fields.is_empty() {
            return;
        }
        let fields = std::mem::take(&mut self.fields);
        if self.entries.len() >= self.limit {
            return;
        }
        if let Some(entry) = entry_from_fields(&fields) {
            self.entries.push(entry);
        }
    }
}

fn entry_from_fields(fields: &[(String, String)]) -> Option<ArchiveEntry> {
    let get = |key: &str| {
        fields
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.trim())
    };

    let path = get("Path")?;
    if path.is_empty() {
        return None;
    }
    // 資料夾項目不列：前端由檔案路徑自己合成資料夾（zip 常常根本沒有資料夾項目）。
    if get("Folder") == Some("+") {
        return None;
    }

    Some(ArchiveEntry {
        path: path.to_string(),
        size: get("Size").and_then(|value| value.parse().ok()).unwrap_or(0),
        packed_size: get("Packed Size")
            .and_then(|value| value.parse().ok())
            .unwrap_or(0),
        modified: get("Modified")
            .filter(|value| !value.is_empty())
            .map(normalize_timestamp),
        encrypted: get("Encrypted") == Some("+"),
        crc: get("CRC").filter(|value| !value.is_empty()).map(str::to_string),
    })
}

/// `2026-10-13 18:02:12.0170922` → `2026-10-13 18:02:12`（只給人看，不做時區換算）。
fn normalize_timestamp(value: &str) -> String {
    match value.split_once('.') {
        Some((head, tail)) if head.len() >= 19 && tail.chars().all(|c| c.is_ascii_digit()) => {
            head.to_string()
        }
        _ => value.to_string(),
    }
}

/// 呼叫 `7z.exe` 列出一份壓縮檔的內容。
///
/// `configured` 是設定頁裡 7-Zip 工具的路徑（可能是 `7zG.exe`）：同目錄的 `7z.exe`
/// 優先，找不到才回到標準安裝位置的偵測。`password` 只給「檔頭加密」的壓縮檔用，
/// 只留在這次呼叫的記憶體裡。
pub fn list(
    path: &Path,
    configured: Option<&str>,
    password: Option<&str>,
) -> AppResult<ArchiveListing> {
    let resolved = normalize(path)?;
    let meta = fs::metadata(&resolved).map_err(|error| AppError::from_io(error, &resolved))?;
    if !meta.is_file() {
        return Err(AppError::NotAFile {
            path: display_path(&resolved),
        });
    }

    let exe = console_program(configured)?;
    let mut command = Command::new(&exe);
    command
        .arg("l")
        .arg("-slt")
        .arg("-ba")
        .arg("-sccUTF-8")
        .arg("-bd");
    if let Some(password) = password.map(str::trim).filter(|value| !value.is_empty()) {
        command.arg(format!("-p{password}"));
    }
    command.arg("--").arg(&resolved);
    command
        // 不給 stdin：需要密碼時 7-Zip 會直接失敗，不會卡在等輸入。
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // 不要閃出主控台視窗（與 `run_external` 的 CREATE_NO_WINDOW 同一個值）。
        command.creation_flags(0x0800_0000);
    }

    let mut child = command.spawn().map_err(|error| AppError::Io {
        message: format!("無法啟動 7-Zip（{}）：{error}", exe.display()),
    })?;

    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        return Err(AppError::Io {
            message: "讀不到 7-Zip 的輸出".to_string(),
        });
    };
    let Some(stderr) = child.stderr.take() else {
        let _ = child.kill();
        return Err(AppError::Io {
            message: "讀不到 7-Zip 的錯誤訊息".to_string(),
        });
    };

    // stdout 逐行送回來（含 EOF 的 `None`）：主執行緒才能套用整體時限。
    let (sender, receiver) = mpsc::channel::<Option<String>>();
    let stdout_reader = std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut buffer = Vec::new();
        loop {
            buffer.clear();
            match reader.read_until(b'\n', &mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let line = String::from_utf8_lossy(&buffer)
                        .trim_end_matches(['\r', '\n'])
                        .to_string();
                    if sender.send(Some(line)).is_err() {
                        return;
                    }
                }
            }
        }
        let _ = sender.send(None);
    });
    let stderr_reader = std::thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut text = String::new();
        let mut buffer = [0u8; 2048];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    if text.len() < STDERR_LIMIT {
                        text.push_str(&String::from_utf8_lossy(&buffer[..count]));
                    }
                }
            }
        }
        text
    });

    let deadline = Instant::now() + LIST_TIMEOUT;
    let mut parser = ListingParser::new(MAX_ENTRIES);
    let mut timed_out = false;
    let mut stopped_early = false;
    // 不是 `Key = Value` 的輸出（例如 `Enter password (will not be echoed):`）留一份：
    // 7-Zip 把「需要密碼」印在 **stdout**，只讀 stderr 會漏掉。
    let mut noise = String::new();

    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            timed_out = true;
            break;
        }
        match receiver.recv_timeout(remaining) {
            Ok(Some(line)) => {
                if !line.is_empty() && !line.contains(" = ") && noise.len() < STDERR_LIMIT {
                    noise.push_str(&line);
                    noise.push('\n');
                }
                if !parser.push(&line) {
                    stopped_early = true;
                    break;
                }
            }
            Ok(None) => break,
            Err(RecvTimeoutError::Timeout) => {
                timed_out = true;
                break;
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    if timed_out || stopped_early {
        let _ = child.kill();
    }
    let status = child.wait();
    let _ = stdout_reader.join();
    let errors = stderr_reader.join().unwrap_or_default();

    let (entries, truncated) = parser.finish();

    if timed_out {
        return Err(AppError::Io {
            message: format!(
                "列舉壓縮檔逾時（{} 秒）；如果是網路磁碟，請確認連線後再重新整理",
                LIST_TIMEOUT.as_secs()
            ),
        });
    }

    if !truncated {
        let code = status.map(|status| status.code().unwrap_or(-1)).unwrap_or(-1);
        if code != 0 && code != 1 {
            let combined = format!("{noise}\n{errors}");
            if looks_like_password(&combined) {
                return Err(AppError::PasswordRequired {
                    path: display_path(&resolved),
                });
            }
            return Err(AppError::Io {
                message: format!("7-Zip 無法開啟這個壓縮檔：{}", error_summary(&combined)),
            });
        }
    }

    let total_size = entries.iter().map(|entry| entry.size).sum();
    let total_packed_size = entries.iter().map(|entry| entry.packed_size).sum();
    let encrypted = entries.iter().any(|entry| entry.encrypted);

    Ok(ArchiveListing {
        path: display_path(&resolved),
        name: resolved
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| display_path(&resolved)),
        size: meta.len(),
        entries,
        total_size,
        total_packed_size,
        truncated,
        encrypted,
    })
}

/// 7-Zip 的錯誤訊息裡出現這些字就當成「需要密碼／密碼錯誤」。
fn looks_like_password(stderr: &str) -> bool {
    let lower = stderr.to_ascii_lowercase();
    lower.contains("password") || lower.contains("encrypted")
}

/// 取一行可以放進錯誤訊息的摘要（7-Zip 通常只印一兩行）。
fn error_summary(stderr: &str) -> String {
    stderr
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("沒有錯誤訊息")
        .to_string()
}

/// 找出命令列版 7-Zip：先看設定裡的位置（同目錄的 `7z.exe`），否則查標準安裝位置。
fn console_program(configured: Option<&str>) -> AppResult<PathBuf> {
    if let Some(value) = configured.map(str::trim).filter(|value| !value.is_empty()) {
        let path = PathBuf::from(value);
        if is_console(&path) {
            return Ok(path);
        }
        if let Some(directory) = path.parent() {
            let sibling = directory.join("7z.exe");
            if sibling.is_file() {
                return Ok(sibling);
            }
        }
    }
    crate::core::programs::find_7zip_console().ok_or_else(|| AppError::ProgramNotFound {
        program: "7-Zip 的命令列版（7z.exe）".to_string(),
    })
}

fn is_console(path: &Path) -> bool {
    path.is_file()
        && path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("7z.exe"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_millis();
        let root = std::env::temp_dir().join(format!("pufffile-archive-{name}-{stamp}"));
        fs::create_dir_all(&root).expect("create scratch");
        root
    }

    const LISTING: &str = "\
Path = docs/readme.md\r
Folder = -\r
Size = 1200\r
Packed Size = 400\r
Modified = 2026-10-13 18:02:12.0170922\r
Encrypted = -\r
CRC = 64A9948F\r
\r
Path = docs\r
Folder = +\r
Size = 0\r
Packed Size = 0\r
Modified = \r
Encrypted = -\r
CRC = \r
\r
Path = secret/notes.txt\r
Folder = -\r
Size = 42\r
Packed Size = 40\r
Modified = 2026-10-14 09:00:00\r
Encrypted = +\r
CRC = 12345678\r
\r
";

    fn parse(text: &str, limit: usize) -> (Vec<ArchiveEntry>, bool) {
        let mut parser = ListingParser::new(limit);
        for line in text.lines() {
            if !parser.push(line) {
                break;
            }
        }
        parser.finish()
    }

    #[test]
    fn parses_files_and_skips_folders() {
        let (entries, truncated) = parse(LISTING, 100);
        assert!(!truncated);
        assert_eq!(entries.len(), 2, "資料夾項目不列");
        assert_eq!(entries[0].path, "docs/readme.md");
        assert_eq!(entries[0].size, 1200);
        assert_eq!(entries[0].packed_size, 400);
        assert!(!entries[0].encrypted);
        assert_eq!(entries[0].crc.as_deref(), Some("64A9948F"));
        assert_eq!(entries[1].path, "secret/notes.txt");
        assert!(entries[1].encrypted);
    }

    #[test]
    fn trims_subsecond_fractions_but_keeps_plain_timestamps() {
        let (entries, _) = parse(LISTING, 100);
        assert_eq!(entries[0].modified.as_deref(), Some("2026-10-13 18:02:12"));
        assert_eq!(entries[1].modified.as_deref(), Some("2026-10-14 09:00:00"));
    }

    #[test]
    fn stops_at_the_limit_and_reports_truncation() {
        // 上限 1：第一筆收下，看到第二筆的第一行就停。
        let (entries, truncated) = parse(LISTING, 1);
        assert_eq!(entries.len(), 1);
        assert!(truncated);
    }

    #[test]
    fn missing_fields_default_to_zero() {
        let text = "Path = a.bin\nSize = \nPacked Size = \n\n";
        let (entries, _) = parse(text, 10);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].size, 0);
        assert_eq!(entries[0].packed_size, 0);
        assert!(entries[0].modified.is_none());
    }

    #[test]
    fn asks_for_a_password_on_encrypted_headers() {
        let Some(exe) = crate::core::programs::find_7zip_console() else {
            return;
        };
        let root = scratch("encrypted");
        let file = root.join("note.txt");
        fs::write(&file, "secret\n").expect("write");
        let archive = root.join("secret.7z");

        let created = Command::new(&exe)
            .args(["a", "-t7z", "-psecret", "-mhe=on", "-bso0", "-bsp0"])
            .arg(&archive)
            .arg(&file)
            .output()
            .expect("run 7z");
        assert!(created.status.success(), "建立加密壓縮檔失敗");

        // 沒有密碼：7-Zip 把「Enter password」印在 stdout，必須也看得到。
        match list(&archive, None, None) {
            Err(AppError::PasswordRequired { .. }) => {}
            other => panic!("應該回 passwordRequired，實際是 {other:?}"),
        }

        // 正確的密碼可以列出內容。
        let listing = list(&archive, None, Some("secret")).expect("list with password");
        assert_eq!(listing.entries.len(), 1);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn lists_a_real_archive_when_seven_zip_is_installed() {
        let Some(exe) = crate::core::programs::find_7zip_console() else {
            return;
        };
        let root = scratch("real");
        let file = root.join("note.txt");
        fs::write(&file, "hello archive\n").expect("write");
        let archive = root.join("sample.zip");

        let created = Command::new(&exe)
            .arg("a")
            .arg("-tzip")
            .arg("-bso0")
            .arg("-bsp0")
            .arg(&archive)
            .arg(&file)
            .output()
            .expect("run 7z");
        assert!(created.status.success(), "建立測試壓縮檔失敗");

        let listing = list(&archive, None, None).expect("list archive");
        assert_eq!(listing.entries.len(), 1);
        assert!(listing.entries[0].path.ends_with("note.txt"));
        assert_eq!(listing.entries[0].size, 14);
        assert!(!listing.truncated);
        assert!(!listing.encrypted);

        let _ = fs::remove_dir_all(&root);
    }
}
