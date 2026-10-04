//! 檔案系統相關指令。

use crate::core;
use crate::error::{AppError, AppResult};
use crate::model::DirEvent;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::ipc::Channel;

/// 每批回傳的項目數：夠大能攤平 IPC 成本，夠小能讓 UI 保持流暢。
const STREAM_BATCH_SIZE: usize = 256;

/// 列出資料夾內容，並透過 Channel 分批串流回前端。
#[tauri::command]
pub async fn list_dir_stream(path: String, on_event: Channel<DirEvent>) -> AppResult<()> {
    let listing = run_blocking(move || core::list_directory(Path::new(&path))).await?;

    send(
        &on_event,
        DirEvent::Start {
            path: listing.path.clone(),
            name: listing.name.clone(),
            parent: listing.parent.clone(),
        },
    )?;

    let total = listing.entries.len();
    for chunk in listing.entries.chunks(STREAM_BATCH_SIZE) {
        send(
            &on_event,
            DirEvent::Batch {
                entries: chunk.to_vec(),
            },
        )?;
        // 讓出執行權，避免大量批次把非同步執行器佔滿。
        tokio::time::sleep(Duration::ZERO).await;
    }

    send(
        &on_event,
        DirEvent::Done {
            total,
            truncated: listing.truncated,
        },
    )
}

fn send(channel: &Channel<DirEvent>, event: DirEvent) -> AppResult<()> {
    channel.send(event).map_err(|e| AppError::Io {
        message: format!("串流通道中斷：{e}"),
    })
}

/// 以系統預設程式開啟檔案或資料夾。
#[tauri::command]
pub async fn open_path(path: String) -> AppResult<()> {
    let target = existing_path(&path)?;
    tauri_plugin_opener::open_path(&target, None::<&str>)
        .map_err(|e| AppError::Io { message: e.to_string() })
}

/// 在 Windows 檔案總管中選取該項目。
#[tauri::command]
pub async fn reveal_path(path: String) -> AppResult<()> {
    let target = existing_path(&path)?;
    tauri_plugin_opener::reveal_item_in_dir(&target)
        .map_err(|e| AppError::Io { message: e.to_string() })
}

/// 只列出子資料夾，供側邊欄樹狀展開使用。
#[tauri::command]
pub async fn list_subdirs(path: String) -> AppResult<Vec<crate::model::FileEntry>> {
    run_blocking(move || core::list_subdirs(Path::new(&path))).await
}

/// 在指定父層底下建立新資料夾，回傳新資料夾路徑。
#[tauri::command]
pub async fn create_folder(parent: String, name: String) -> AppResult<String> {
    run_blocking(move || {
        let name = validated_name(&name)?;
        let parent = core::normalize(Path::new(&parent))?;
        let target = parent.join(name);
        std::fs::create_dir(&target).map_err(|e| AppError::from_io(e, &target))?;
        // 回傳一般路徑：前端要拿它比對清單項目、交給 shell，verbatim 前綴會壞事。
        Ok(core::display_path(&target))
    })
    .await
}

/// 建立空檔案。用 `create_new` 所以同名會直接失敗，不會覆蓋既有檔案。
#[tauri::command]
pub async fn create_file(parent: String, name: String) -> AppResult<String> {
    run_blocking(move || {
        let name = validated_name(&name)?;
        let parent = core::normalize(Path::new(&parent))?;
        let target = parent.join(name);
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|e| AppError::from_io(e, &target))?;
        Ok(core::display_path(&target))
    })
    .await
}

/// 執行使用者設定的外部工具。
///
/// 引數與工作目錄都由前端依樣板展開（例如 `$fullFolderPath`），
/// 這裡只負責把程式找出來、把引號處理正確、用正確的主控台模式啟動。
#[tauri::command]
pub async fn run_external(
    program: String,
    args: Vec<String>,
    working_dir: Option<String>,
    new_console: bool,
) -> AppResult<()> {
    run_blocking(move || {
        let command = build_command(&program, &args, working_dir.as_deref(), new_console)?;
        spawn(command, &program)
    })
    .await
}

/// 終端機類要開新主控台；編輯器類若只是轉呼叫 `code.cmd` 則不需要視窗。
const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 組出一個「還沒啟動」的行程，方便測試直接檢查命令列。
#[cfg(windows)]
fn build_command(
    program: &str,
    args: &[String],
    working_dir: Option<&str>,
    new_console: bool,
) -> AppResult<std::process::Command> {
    use std::os::windows::process::CommandExt;

    let program = program.trim();
    if program.is_empty() {
        return Err(AppError::ProgramNotFound {
            program: "（未指定執行檔）".to_string(),
        });
    }

    let exe = resolve_program(program)?;
    let is_script = matches!(
        exe.extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("cmd") | Some("bat")
    );

    let mut command = if is_script {
        // `.cmd` / `.bat` 不是執行檔映像，CreateProcess 不能直接跑，必須交給 cmd.exe。
        let mut line = quote_arg(&exe.to_string_lossy());
        for arg in args {
            line.push(' ');
            line.push_str(&quote_arg(arg));
        }
        let mut command = std::process::Command::new("cmd.exe");
        command.raw_arg("/C");
        // cmd 的規則：/C 後面的命令列以引號開頭時會吃掉頭尾引號，所以要再包一層。
        command.raw_arg(format!("\"{line}\""));
        command
    } else {
        let mut command = std::process::Command::new(&exe);
        command.args(args);
        command
    };

    if let Some(directory) = working_dir.map(str::trim).filter(|value| !value.is_empty()) {
        let path = PathBuf::from(directory);
        if !path.is_dir() {
            return Err(AppError::NotADirectory {
                path: directory.to_string(),
            });
        }
        command.current_dir(path);
    }

    command.creation_flags(if new_console {
        CREATE_NEW_CONSOLE
    } else {
        CREATE_NO_WINDOW
    });

    Ok(command)
}

#[cfg(not(windows))]
fn build_command(
    _program: &str,
    _args: &[String],
    _working_dir: Option<&str>,
    _new_console: bool,
) -> AppResult<std::process::Command> {
    Err(AppError::Unsupported {
        feature: "外部工具（僅支援 Windows）".to_string(),
    })
}

/// Windows 命令列的引號規則（與 MSVCRT 一致）：反斜線要依後方是否為引號加倍。
#[cfg(windows)]
fn quote_arg(arg: &str) -> String {
    if !arg.is_empty() && !arg.contains([' ', '\t', '"']) {
        return arg.to_string();
    }

    let mut out = String::from("\"");
    let mut backslashes = 0usize;

    for character in arg.chars() {
        match character {
            '\\' => backslashes += 1,
            '"' => {
                out.push_str(&"\\".repeat(backslashes * 2 + 1));
                out.push('"');
                backslashes = 0;
            }
            _ => {
                out.push_str(&"\\".repeat(backslashes));
                out.push(character);
                backslashes = 0;
            }
        }
    }

    out.push_str(&"\\".repeat(backslashes * 2));
    out.push('"');
    out
}

/// 找出要執行的程式：可以是完整路徑，也可以是 PATH（含 PATHEXT）中的名稱。
#[cfg(windows)]
fn resolve_program(program: &str) -> AppResult<PathBuf> {
    let candidate = PathBuf::from(program);
    if candidate.is_file() {
        return Ok(candidate);
    }
    search_path(program).ok_or_else(|| AppError::ProgramNotFound {
        program: program.to_string(),
    })
}

#[cfg(windows)]
fn search_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let extensions = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
    search_path_in(&path, &extensions, name)
}

/// 依 Windows 的習慣找執行檔。
///
/// 關鍵在於**先試 PATHEXT 的每一種副檔名，最後才看沒有副檔名的檔案**：
/// VS Code 的 `bin` 目錄同時放了 `code`（給 Git Bash 用的 shell 腳本）與 `code.cmd`，
/// 先挑到沒有副檔名的那個會讓 CreateProcess 直接回「不是有效的 Win32 應用程式」。
#[cfg(windows)]
fn search_path_in(path: &std::ffi::OsStr, extensions: &str, name: &str) -> Option<PathBuf> {
    let has_extension = Path::new(name).extension().is_some();
    let directories: Vec<PathBuf> = std::env::split_paths(path)
        .filter(|directory| !directory.as_os_str().is_empty())
        .collect();

    if has_extension {
        return directories
            .into_iter()
            .map(|directory| directory.join(name))
            .find(|candidate| candidate.is_file());
    }

    for extension in extensions.split(';').filter(|value| !value.is_empty()) {
        let suffix = extension.to_ascii_lowercase();
        for directory in &directories {
            let candidate = directory.join(format!("{name}{suffix}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    // 保底：有些工具真的沒有副檔名。
    directories
        .into_iter()
        .map(|directory| directory.join(name))
        .find(|candidate| candidate.is_file())
}

#[cfg(windows)]
fn spawn(mut command: std::process::Command, program: &str) -> AppResult<()> {
    command.spawn().map(|_| ()).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => AppError::ProgramNotFound {
            program: program.to_string(),
        },
        std::io::ErrorKind::PermissionDenied => AppError::Io {
            message: format!("沒有權限執行 {program}"),
        },
        _ => AppError::Io {
            message: format!("無法啟動 {program}：{e}"),
        },
    })
}

/// 阻斷式 I/O 一律丟到背景執行緒，避免卡住 WebView 主執行緒。
pub(crate) async fn run_blocking<T, F>(job: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|e| AppError::Io {
            message: format!("背景工作失敗：{e}"),
        })?
}

fn existing_path(path: &str) -> AppResult<PathBuf> {
    core::normalize(Path::new(path))
}

/// Windows 保留的裝置名稱，用這些名字建立檔案會失敗且訊息很難懂。
const RESERVED_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// 名稱驗證：不能空白、不能含路徑分隔或非法字元、不能以句點或空白結尾，
/// 也不能是 Windows 保留名稱。
fn validated_name(name: &str) -> AppResult<String> {
    let trimmed = name.trim();
    let invalid = |reason: &str| AppError::InvalidName {
        reason: reason.to_string(),
    };

    if trimmed.is_empty() {
        return Err(invalid("名稱不能是空的"));
    }
    if trimmed == "." || trimmed == ".." {
        return Err(invalid("名稱不能是 . 或 .."));
    }
    if trimmed.contains(['/', '\\']) || trimmed.contains('\0') {
        return Err(invalid("名稱不能包含路徑分隔符號"));
    }
    if trimmed.contains(['<', '>', ':', '"', '|', '?', '*']) {
        return Err(invalid("名稱不能包含 < > : \" | ? * 等字元"));
    }
    // 名稱已經 trim 過，所以只需要擋句點結尾（Windows 會把它吃掉）。
    if trimmed.ends_with('.') {
        return Err(invalid("名稱不能以句點結尾"));
    }

    let stem = trimmed
        .split('.')
        .next()
        .unwrap_or(trimmed)
        .to_ascii_uppercase();
    if RESERVED_NAMES.contains(&stem.as_str()) {
        return Err(invalid("這是 Windows 保留的裝置名稱"));
    }

    Ok(trimmed.to_string())
}
#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn accepts_normal_names() {
        assert_eq!(validated_name("  報告 ").unwrap(), "報告");
        assert_eq!(validated_name("notes.txt").unwrap(), "notes.txt");
        assert_eq!(validated_name("archive.tar.gz").unwrap(), "archive.tar.gz");
    }

    #[test]
    fn rejects_invalid_names() {
        assert!(validated_name("").is_err());
        assert!(validated_name("..").is_err());
        assert!(validated_name("a/b").is_err());
        assert!(validated_name(r"a\b").is_err());
        assert!(validated_name("a:b").is_err());
        assert!(validated_name("trailing.").is_err());
        assert_eq!(validated_name("trailing ").unwrap(), "trailing");
        assert!(validated_name("CON").is_err());
        assert!(validated_name("com1.txt").is_err());
        assert!(validated_name("LPT9.log").is_err());
    }

    /// 走完整指令路徑：真的建立資料夾與空檔案，並確認同名不會覆蓋。
    #[test]
    fn creates_folders_and_files() {
        let root = std::env::temp_dir().join(format!(
            "pufffile-create-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_millis()
        ));
        std::fs::create_dir_all(&root).expect("create scratch");
        let parent = root.to_string_lossy().into_owned();

        let folder =
            tauri::async_runtime::block_on(create_folder(parent.clone(), "新資料夾".into()))
                .expect("create folder");
        assert!(Path::new(&folder).is_dir());
        // 前端要拿這個路徑比對清單項目，verbatim 前綴會讓比對失敗。
        assert!(!folder.starts_with(r"\\?\"), "verbatim 前綴外洩：{folder}");

        let file = tauri::async_runtime::block_on(create_file(parent.clone(), "notes.txt".into()))
            .expect("create file");
        assert!(Path::new(&file).is_file());
        assert!(!file.starts_with(r"\\?\"), "verbatim 前綴外洩：{file}");
        assert_eq!(std::fs::metadata(&file).expect("metadata").len(), 0);

        // 同名要回 AlreadyExists，而不是默默覆蓋既有檔案。
        let again = tauri::async_runtime::block_on(create_file(parent, "notes.txt".into()));
        assert!(
            matches!(again, Err(AppError::AlreadyExists { .. })),
            "got {again:?}"
        );
    }

    #[test]
    fn quotes_arguments_like_the_c_runtime() {
        assert_eq!(quote_arg("plain"), "plain");
        assert_eq!(quote_arg("has space"), "\"has space\"");
        assert_eq!(quote_arg(""), "\"\"");
        assert_eq!(quote_arg("say \"hi\""), "\"say \\\"hi\\\"\"");
        // 結尾的反斜線要加倍，否則會把收尾的引號逃逸掉。
        assert_eq!(quote_arg("C:\\a path\\"), "\"C:\\a path\\\\\"");
        assert_eq!(quote_arg("C:\\plain\\"), "C:\\plain\\");
    }

    /// VS Code 的 bin 目錄同時有 `code` 與 `code.cmd`；必須挑到後者。
    #[test]
    fn prefers_pathext_over_extensionless_files() {
        let root = std::env::temp_dir().join("pufffile-path-test");
        let bash_like = root.join("bash-like");
        let windows_like = root.join("windows-like");
        std::fs::create_dir_all(&bash_like).expect("bash-like dir");
        std::fs::create_dir_all(&windows_like).expect("windows-like dir");
        std::fs::write(bash_like.join("mycode"), "#!/bin/sh\n").expect("bare file");
        std::fs::write(windows_like.join("mycode.cmd"), "@echo off\r\n").expect("cmd file");

        let path = std::env::join_paths([bash_like.clone(), windows_like.clone()]).expect("join path");
        let found = search_path_in(&path, ".COM;.EXE;.BAT;.CMD", "mycode");

        assert_eq!(found, Some(windows_like.join("mycode.cmd")));
    }

    /// 真的產生一個 .cmd 並執行，確認引號處理沒有把帶空白的參數吃掉。
    #[test]
    fn runs_batch_script_with_quoted_arguments() {
        let dir = std::env::temp_dir().join("pufffile-quote-test");
        std::fs::create_dir_all(&dir).expect("temp dir");
        let script = dir.join("write-arg.cmd");
        // 用 %~1（去掉引號）比較，驗證帶空白的路徑是「一個」引數完整送達。
        std::fs::write(&script, "@echo off\r\n> \"%~dp0out.txt\" echo %~1\r\n").expect("write script");
        let out = dir.join("out.txt");
        let _ = std::fs::remove_file(&out);

        let project = dir.join("a path");
        std::fs::create_dir_all(&project).expect("project dir");
        let argument = project.join("file.txt").to_string_lossy().into_owned();

        let mut command = build_command(
            &script.to_string_lossy(),
            std::slice::from_ref(&argument),
            Some(&dir.to_string_lossy()),
            false,
        )
        .expect("build command");
        command.spawn().expect("spawn script").wait().expect("wait script");

        for _ in 0..50 {
            if out.is_file() {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }

        let written = std::fs::read_to_string(&out).unwrap_or_default();
        assert_eq!(written.trim(), argument, "引數被引號規則吃掉了");
    }
}
