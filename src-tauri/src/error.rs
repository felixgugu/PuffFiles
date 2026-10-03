//! 全應用統一的錯誤型別。
//!
//! 後端所有可能失敗的 IPC 指令一律回傳 [`AppError`]，前端透過
//! `services/errors.ts` 的 `normalizeBackendError` 轉譯為一致的錯誤訊息。

use serde::{Serialize, Serializer};
use std::io;
use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("找不到路徑：{path}")]
    NotFound { path: String },

    #[error("沒有存取權限：{path}")]
    PermissionDenied { path: String },

    #[error("這個路徑不是資料夾：{path}")]
    NotADirectory { path: String },

    #[error("路徑格式不正確：{path}")]
    InvalidPath { path: String },

    #[error("名稱不合法：{reason}")]
    InvalidName { reason: String },

    #[error("已經有同名項目：{path}")]
    AlreadyExists { path: String },

    #[error("這個功能尚未支援：{feature}")]
    Unsupported { feature: String },

    #[error("找不到外部程式：{program}")]
    ProgramNotFound { program: String },

    #[error("系統回報錯誤：{message}")]
    Io { message: String },
}

impl AppError {
    /// 由 [`io::Error`] 與發生錯誤的路徑推導出語意化的錯誤種類。
    pub fn from_io(error: io::Error, path: impl AsRef<Path>) -> Self {
        let path = path.as_ref().to_string_lossy().into_owned();
        match error.kind() {
            io::ErrorKind::NotFound => Self::NotFound { path },
            io::ErrorKind::PermissionDenied => Self::PermissionDenied { path },
            io::ErrorKind::AlreadyExists => Self::AlreadyExists { path },
            _ => Self::Io {
                message: format!("{path}：{error}"),
            },
        }
    }

    pub fn invalid_path(path: impl AsRef<Path>) -> Self {
        Self::InvalidPath {
            path: path.as_ref().to_string_lossy().into_owned(),
        }
    }
}

/// 序列化給前端的錯誤酬載。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppErrorPayload<'a> {
    kind: &'a str,
    message: String,
    path: Option<&'a str>,
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let (kind, path) = match self {
            Self::NotFound { path } => ("notFound", Some(path.as_str())),
            Self::PermissionDenied { path } => ("permissionDenied", Some(path.as_str())),
            Self::NotADirectory { path } => ("notADirectory", Some(path.as_str())),
            Self::InvalidPath { path } => ("invalidPath", Some(path.as_str())),
            Self::AlreadyExists { path } => ("alreadyExists", Some(path.as_str())),
            Self::InvalidName { .. } => ("invalidName", None),
            Self::Unsupported { .. } => ("unsupported", None),
            Self::ProgramNotFound { .. } => ("programNotFound", None),
            Self::Io { .. } => ("io", None),
        };

        AppErrorPayload {
            kind,
            message: self.to_string(),
            path,
        }
        .serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;
