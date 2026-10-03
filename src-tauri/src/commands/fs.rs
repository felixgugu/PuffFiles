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

/// 以外部程式開啟路徑。
///
/// `program` 為 `powershell` / `cmd` / `notepadpp` / `vscode`；
/// `executable` 讓使用者在設定中指定自訂執行檔（例如不在 PATH 的 Notepad++）。
#[tauri::command]
pub async fn open_with(path: String, program: String, executable: Option<String>) -> AppResult<()> {
    run_blocking(move || launch(&path, &program, executable.as_deref())).await
}

/// 終端機類要開新主控台；編輯器類若只是轉呼叫 `code.cmd` 則不需要視窗。
const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(windows)]
fn launch(path: &str, program: &str, executable: Option<&str>) -> AppResult<()> {
    use std::os::windows::process::CommandExt;

    let raw = existing_path(path)?;
    let meta = std::fs::metadata(&raw).map_err(|e| AppError::from_io(e, &raw))?;

    // 終端機永遠開在「資料夾」；若目標是檔案，就開在它所屬的資料夾。
    let directory = if meta.is_dir() {
        raw.clone()
    } else {
        raw.parent().map(Path::to_path_buf).unwrap_or_else(|| raw.clone())
    };
    let dir_text = core::dir::display_path(&directory);
    let file_text = core::dir::display_path(&raw);

    match program {
        "powershell" | "terminal" => {
            let exe = resolve_program("powershell.exe", None)?;
            let mut command = std::process::Command::new(exe);
            command.creation_flags(CREATE_NEW_CONSOLE);
            command.raw_arg("-NoExit");
            command.raw_arg("-Command");
            command.raw_arg(format!(
                "Set-Location -LiteralPath '{}'",
                dir_text.replace('\'', "''")
            ));
            spawn(command, "powershell.exe")
        }
        "cmd" => {
            let exe = resolve_program("cmd.exe", None)?;
            let mut command = std::process::Command::new(exe);
            command.creation_flags(CREATE_NEW_CONSOLE);
            command.raw_arg("/K");
            command.raw_arg(format!("cd /d \"{}\"", dir_text.replace('"', "")));
            spawn(command, "cmd.exe")
        }
        "notepadpp" => open_editor("notepad++", executable, &file_text),
        "vscode" => open_editor("code", executable, &file_text),
        other => Err(AppError::Unsupported {
            feature: format!("外部程式 {other}"),
        }),
    }
}

#[cfg(not(windows))]
fn launch(_path: &str, program: &str, _executable: Option<&str>) -> AppResult<()> {
    Err(AppError::Unsupported {
        feature: format!("外部程式 {program}（僅支援 Windows）"),
    })
}

/// 開啟編輯器；`.cmd` / `.bat` 需要透過 cmd.exe 才能被 CreateProcess 執行。
#[cfg(windows)]
fn open_editor(program: &str, executable: Option<&str>, target: &str) -> AppResult<()> {
    use std::os::windows::process::CommandExt;

    let exe = resolve_program(program, executable)?;
    let is_script = matches!(
        exe.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref(),
        Some("cmd") | Some("bat")
    );

    let mut command = if is_script {
        let mut command = std::process::Command::new("cmd.exe");
        command.creation_flags(CREATE_NO_WINDOW);
        command.raw_arg("/C");
        command.raw_arg(format!("\"{}\" \"{}\"", exe.to_string_lossy(), target));
        command
    } else {
        let mut command = std::process::Command::new(&exe);
        command.arg(target);
        command
    };
    command.creation_flags(CREATE_NO_WINDOW);
    spawn(command, program)
}

/// 找出要執行的程式：使用者指定路徑優先，其次在 PATH（含 PATHEXT）中尋找。
#[cfg(windows)]
fn resolve_program(default_name: &str, executable: Option<&str>) -> AppResult<PathBuf> {
    if let Some(custom) = executable.map(str::trim).filter(|value| !value.is_empty()) {
        let candidate = PathBuf::from(custom);
        if candidate.is_file() {
            return Ok(candidate);
        }
        if let Some(found) = search_path(custom) {
            return Ok(found);
        }
        return Err(AppError::ProgramNotFound {
            program: custom.to_string(),
        });
    }

    search_path(default_name).ok_or_else(|| AppError::ProgramNotFound {
        program: default_name.to_string(),
    })
}

#[cfg(windows)]
fn search_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let extensions = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
    let has_extension = Path::new(name).extension().is_some();

    for directory in std::env::split_paths(&path) {
        if directory.as_os_str().is_empty() {
            continue;
        }
        let direct = directory.join(name);
        if direct.is_file() {
            return Some(direct);
        }
        if has_extension {
            continue;
        }
        for extension in extensions.split(';').filter(|value| !value.is_empty()) {
            let candidate = directory.join(format!("{name}{}", extension.to_ascii_lowercase()));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    None
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
async fn run_blocking<T, F>(job: F) -> AppResult<T>
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
