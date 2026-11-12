//! 檔案／資料夾的「內容」對話框（Windows shell 的屬性表）。
//!
//! 這裡刻意**不自己畫表單**：屬性表是 shell 的元件（property sheet handler），借用它
//! 才能拿到跟檔案總管完全一致的內容 —— 大小佔用空間、修改／存取時間、唯讀／隱藏／
//! 封存屬性、安全性（ACL）、版本資訊、數位簽章、共用，以及第三方掛進去的頁籤。
//!
//! 用的是 `SHObjectProperties`（`SHOP_FILEPATH`）：文件化、吃路徑字串、可以指定
//! owner，屬性表會 modal 在我們的視窗上。
//!
//! **為什麼不用其他寫法**（2026-11-01 在 Windows 11 24H2 實測）：
//! - `IContextMenu` 的 `properties` verb：選單裡確實有「內容」項目，但
//!   `GetCommandString` 不提供 canonical verb，`InvokeCommand` 用字串 `"properties"`
//!   會跳「這個項目的內容無法使用」（EX 版本）或什麼都不做（ANSI 版本）。
//! - `ShellExecuteEx` ＋ `SEE_MASK_INVOKEIDLIST`：回 `TRUE`，但**什麼都不開**。
//! - `SHMultiFileProperties` ＋ `SHCreateDataObject`：回 `S_OK`，也是**什麼都不開**
//!   （這台機器上等同空包彈）。因此多選目前只顯示右鍵那一項的內容，不是合併的屬性表。
//!
//! `SHObjectProperties` 是 modal，會阻塞呼叫它的執行緒直到使用者關掉，所以一定得在
//! `spawn_blocking` 裡呼叫（見 `commands/shell.rs` 的 `run_logged`）。

use std::path::PathBuf;

#[cfg(not(windows))]
use crate::error::{AppError, AppResult};

/// 開啟指定項目的「內容」對話框；`owner` 是視窗控制代碼（`None` 代表沒有父視窗）。
///
/// 只處理第一個路徑：shell 沒有穩定可用的「合併多選屬性表」API（見檔頭說明），
/// 前端因此只傳右鍵的那一項。
#[cfg(not(windows))]
pub fn show(_paths: &[PathBuf], _owner: Option<isize>) -> AppResult<()> {
    Err(AppError::Unsupported {
        feature: "內容對話框（僅支援 Windows）".to_string(),
    })
}

#[cfg(windows)]
pub fn show(paths: &[PathBuf], owner: Option<isize>) -> crate::error::AppResult<()> {
    platform::show(paths, owner)
}

#[cfg(windows)]
mod platform {
    use crate::error::{AppError, AppResult};
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::path::{Path, PathBuf};
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{SHObjectProperties, SHOP_FILEPATH};

    pub fn show(paths: &[PathBuf], owner: Option<isize>) -> AppResult<()> {
        let Some(path) = paths.first() else {
            return Ok(());
        };
        let hwnd = match owner {
            Some(raw) if raw != 0 => Some(HWND(raw as *mut c_void)),
            _ => None,
        };
        let wide = to_wide(path);

        unsafe {
            // 屬性表是 shell UI，需要 STA。初始化失敗也可能只是這條執行緒已經被別人
            // 初始化成別的模型 —— 照樣可以繼續，只是最後不要 CoUninitialize。
            let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
            let opened =
                SHObjectProperties(hwnd, SHOP_FILEPATH, PCWSTR(wide.as_ptr()), None::<&PCWSTR>);
            if initialized {
                CoUninitialize();
            }
            if opened.as_bool() {
                Ok(())
            } else {
                Err(failure(path))
            }
        }
    }

    fn failure(path: &Path) -> AppError {
        AppError::Io {
            message: format!(
                "{}：{}",
                path.to_string_lossy(),
                std::io::Error::last_os_error()
            ),
        }
    }

    fn to_wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(Some(0)).collect()
    }
}
