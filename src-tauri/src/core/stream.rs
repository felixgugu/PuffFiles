//! 自訂協定 `stream` 的純邏輯：HTTP Range 解析與 MIME 對應。
//!
//! 這一層刻意不碰 Tauri：命令層只負責查 token、開檔與把位元組寫進回應，Range 的邊界
//! 條件（開頭省略、結尾省略、越界、不合法、多區段）都集中在這裡，可以獨立測試。

use std::path::Path;

/// 一個已解析的位元組區段；`end` 含在內（HTTP 的語意）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ByteRange {
    pub start: u64,
    pub end: u64,
}

/// `Range` 標頭的解析結果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RangeOutcome {
    /// 沒有 `Range`、或不合法 —— 依 RFC 7233 不合法一律忽略，回整份。
    Whole,
    /// 只服務這一段（回 206）。
    Partial(ByteRange),
    /// 區段完全在檔案之外（回 416）。
    Unsatisfiable,
}

/// 解析 `Range` 標頭。
///
/// 只支援單一區段，多區段時取第一段 —— `multipart/byteranges` 得把每一段都讀進記憶體，
/// 就失去「只讀被請求的那一段」的意義，而 Chromium 的 PDF viewer 每次只問一段。
pub fn parse_range(header: Option<&str>, total: u64) -> RangeOutcome {
    let Some(header) = header.map(str::trim).filter(|value| !value.is_empty()) else {
        return RangeOutcome::Whole;
    };
    let Some((unit, specs)) = header.split_once('=') else {
        return RangeOutcome::Whole;
    };
    if !unit.trim().eq_ignore_ascii_case("bytes") {
        return RangeOutcome::Whole;
    }
    let Some(spec) = specs.split(',').next().map(str::trim) else {
        return RangeOutcome::Whole;
    };
    let Some((start_text, end_text)) = spec.split_once('-') else {
        return RangeOutcome::Whole;
    };
    let (start_text, end_text) = (start_text.trim(), end_text.trim());

    // 空檔案沒有任一個位元組可以回。
    if total == 0 {
        return RangeOutcome::Unsatisfiable;
    }

    let (start, end) = if start_text.is_empty() {
        // `bytes=-N`：最後 N 個位元組。N 大於檔案就等於整份。
        let Ok(suffix) = end_text.parse::<u64>() else {
            return RangeOutcome::Whole;
        };
        if suffix == 0 {
            return RangeOutcome::Unsatisfiable;
        }
        (total.saturating_sub(suffix), total - 1)
    } else {
        let Ok(start) = start_text.parse::<u64>() else {
            return RangeOutcome::Whole;
        };
        if start >= total {
            return RangeOutcome::Unsatisfiable;
        }
        let end = if end_text.is_empty() {
            total - 1
        } else {
            let Ok(end) = end_text.parse::<u64>() else {
                return RangeOutcome::Whole;
            };
            // 結尾超過檔案就夾到最後一個位元組（RFC 允許）。
            end.min(total - 1)
        };
        if end < start {
            return RangeOutcome::Whole;
        }
        (start, end)
    };

    RangeOutcome::Partial(ByteRange { start, end })
}

/// 依副檔名給 `Content-Type`。目前只有 PDF 會走這條協定。
pub fn mime_for(path: &Path) -> &'static str {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    match extension.as_deref() {
        Some("pdf") => "application/pdf",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOTAL: u64 = 1000;

    fn partial(start: u64, end: u64) -> RangeOutcome {
        RangeOutcome::Partial(ByteRange { start, end })
    }

    #[test]
    fn missing_or_foreign_header_means_whole_file() {
        assert_eq!(parse_range(None, TOTAL), RangeOutcome::Whole);
        assert_eq!(parse_range(Some(""), TOTAL), RangeOutcome::Whole);
        assert_eq!(parse_range(Some("   "), TOTAL), RangeOutcome::Whole);
        assert_eq!(parse_range(Some("items=0-9"), TOTAL), RangeOutcome::Whole);
        assert_eq!(parse_range(Some("0-9"), TOTAL), RangeOutcome::Whole);
    }

    #[test]
    fn parses_closed_open_and_suffix_forms() {
        assert_eq!(parse_range(Some("bytes=0-99"), TOTAL), partial(0, 99));
        assert_eq!(parse_range(Some("bytes=900-"), TOTAL), partial(900, 999));
        assert_eq!(parse_range(Some("bytes=-100"), TOTAL), partial(900, 999));
        assert_eq!(parse_range(Some("bytes=0-"), TOTAL), partial(0, 999));
        // 大小寫與空白都容錯。
        assert_eq!(parse_range(Some(" Bytes = 10 - 20 "), TOTAL), partial(10, 20));
    }

    #[test]
    fn clamps_end_and_oversized_suffix() {
        assert_eq!(parse_range(Some("bytes=0-5000"), TOTAL), partial(0, 999));
        assert_eq!(parse_range(Some("bytes=-5000"), TOTAL), partial(0, 999));
    }

    #[test]
    fn reports_unsatisfiable_ranges() {
        assert_eq!(parse_range(Some("bytes=1000-"), TOTAL), RangeOutcome::Unsatisfiable);
        assert_eq!(parse_range(Some("bytes=1000-1200"), TOTAL), RangeOutcome::Unsatisfiable);
        assert_eq!(parse_range(Some("bytes=-0"), TOTAL), RangeOutcome::Unsatisfiable);
        assert_eq!(parse_range(Some("bytes=0-0"), 0), RangeOutcome::Unsatisfiable);
    }

    #[test]
    fn ignores_broken_specs() {
        assert_eq!(parse_range(Some("bytes=abc-def"), TOTAL), RangeOutcome::Whole);
        assert_eq!(parse_range(Some("bytes=5-2"), TOTAL), RangeOutcome::Whole);
        assert_eq!(parse_range(Some("bytes=nonsense"), TOTAL), RangeOutcome::Whole);
    }

    #[test]
    fn takes_the_first_range_of_a_multi_range_request() {
        assert_eq!(parse_range(Some("bytes=0-99, 200-299"), TOTAL), partial(0, 99));
    }

    #[test]
    fn maps_mime_by_extension() {
        assert_eq!(mime_for(Path::new("C:\\a\\報告.PDF")), "application/pdf");
        assert_eq!(mime_for(Path::new("a.pdf")), "application/pdf");
        assert_eq!(mime_for(Path::new("a.txt")), "application/octet-stream");
        assert_eq!(mime_for(Path::new("a")), "application/octet-stream");
    }
}
