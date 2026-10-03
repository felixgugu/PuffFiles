"""從 `src-tauri/icons/icon-source.png` 產生應用程式圖示。

整隻奔跑的老虎縮到 16/24/32/48 會糊成一團，所以這幾個尺寸改用「大頭」版本：
只取頭部、把細節壓成大色塊，並在輪廓外補一圈深藍外框，讓小圖還看得出是貓科動物。
64 以上仍沿用完整插畫。

用法（在專案根目錄）：

    python tools/make-icons.py
    python tools/make-icons.py --preview icons-preview.png

輸出：`src-tauri/icons/icon.ico`（混合尺寸）與 `src-tauri/icons/32x32.png`。
若之後重新跑了 `tauri icon`，再執行本腳本把這兩個檔案換回來。

注意：`tauri-build` 沒有把圖示檔列入 `rerun-if-changed`，所以開發中改完圖示要讓
`tauri.conf.json` 的 mtime 變一下（例如 `touch src-tauri/tauri.conf.json`）才會重新
嵌入執行檔；否則 `tauri dev` 只會重跑舊的 binary。正式建置沒有這個問題。
"""

from __future__ import annotations

import argparse
import struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ICON_DIR = Path(__file__).resolve().parent.parent / "src-tauri" / "icons"
SOURCE = ICON_DIR / "icon-source.png"
ICO = ICON_DIR / "icon.ico"
PNG32 = ICON_DIR / "32x32.png"

#: 頭部在原始插畫中的位置，取到耳朵尖端與下巴，切掉身體。
FACE_BOX = (815, 183, 1200, 568)
#: 小尺寸用「大頭」，大尺寸用完整插畫。
SMALL_SIZES = (16, 24, 32, 48)
DETAIL_SIZES = (64, 256)

#: 小圖調校參數：8 色足以留下橘、奶油白、深藍與眼睛，5 的窗可吃掉毛流細線。
SMALL_COLORS = 8
SMALL_WINDOW = 5
#: 先放大四倍再化簡，最後才縮回去，邊緣才不會出現鋸齒。
SUPERSAMPLE = 4
#: 邊界留白：小圖要盡量把頭塞滿，只留一點呼吸空間。
SMALL_PADDING = 0.02
OUTLINE = np.array([16, 26, 66], dtype=np.uint8)


def _mode_filter(index_map: np.ndarray, window: int) -> np.ndarray:
    """色塊化簡：每個像素取窗內的眾數，細線會被兩側的大色塊吃掉。"""
    pad = window // 2
    height, width = index_map.shape
    neighbourhood = np.stack(
        [
            np.roll(np.roll(index_map, dy, axis=0), dx, axis=1)
            for dy in range(-pad, pad + 1)
            for dx in range(-pad, pad + 1)
        ]
    )
    result = np.zeros((height, width), dtype=index_map.dtype)
    best = np.full((height, width), -1, dtype=np.int32)
    for value in range(int(index_map.max()) + 1):
        count = (neighbourhood == value).sum(axis=0)
        wins = count > best
        result[wins] = value
        best[wins] = count[wins]
    return result


def _dilate(mask: np.ndarray, radius: int = 1) -> np.ndarray:
    grown = mask.copy()
    for _ in range(radius):
        grown = (
            grown
            | np.roll(grown, 1, axis=0)
            | np.roll(grown, -1, axis=0)
            | np.roll(grown, 1, axis=1)
            | np.roll(grown, -1, axis=1)
        )
    return grown


def _fit(image: Image.Image, size: int, padding: float) -> Image.Image:
    """等比縮放並置中到正方形畫布，透明處保持透明。"""
    inner = size * (1 - 2 * padding)
    scale = min(inner / image.width, inner / image.height)
    scaled = image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.LANCZOS,
    )
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(scaled, ((size - scaled.width) // 2, (size - scaled.height) // 2), scaled)
    return canvas


def simplified_face(source: Image.Image, size: int) -> Image.Image:
    """回傳簡化後的頭部圖示（透明背景）。"""
    work = size * SUPERSAMPLE
    pixels = np.array(_fit(source.crop(FACE_BOX), work, SMALL_PADDING))
    opaque = pixels[..., 3] > 128

    quantized = Image.fromarray(pixels[..., :3], "RGB").quantize(
        colors=SMALL_COLORS, method=Image.MEDIANCUT, dither=Image.Dither.NONE
    )
    palette = np.array(quantized.getpalette()[: SMALL_COLORS * 3]).reshape(-1, 3)
    indices = np.where(opaque, np.array(quantized).astype(np.int64), -1)
    indices = _mode_filter(indices, SMALL_WINDOW)
    alpha = _mode_filter(np.where(opaque, 1, 0).astype(np.int16), SMALL_WINDOW)

    flat = np.dstack(
        [
            palette[np.clip(indices, 0, len(palette) - 1)],
            np.where(alpha > 0, 255, 0).astype(np.uint8),
        ]
    )
    small = np.array(
        Image.fromarray(flat.astype(np.uint8), "RGBA").resize((size, size), Image.LANCZOS)
    )

    # 縮到這麼小之後，插畫原本的深藍外框會消失，補一圈才不會變成橘色一團。
    mask = small[..., 3] > 100
    ring = _dilate(mask) & ~mask
    small[ring] = np.concatenate([OUTLINE, [255]])
    return Image.fromarray(small, "RGBA")


def png_bytes(image: Image.Image) -> bytes:
    from io import BytesIO

    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def write_ico(entries: dict[int, Image.Image], path: Path) -> None:
    """寫出 ICO。每個尺寸都是 PNG 壓縮的條目（Vista 以後都支援）。"""
    sizes = sorted(entries)
    header = struct.pack("<HHH", 0, 1, len(sizes))
    offset = len(header) + 16 * len(sizes)
    directory = b""
    payload = b""
    for size in sizes:
        data = png_bytes(entries[size])
        directory += struct.pack(
            "<BBBBHHII",
            0 if size >= 256 else size,
            0 if size >= 256 else size,
            0,
            0,
            1,
            32,
            len(data),
            offset,
        )
        payload += data
        offset += len(data)
    path.write_bytes(header + directory + payload)


def build_preview(entries: dict[int, Image.Image], output: Path) -> None:
    """並排預覽：每個尺寸放大到 128px，深色與淺色底各一列。"""
    sizes = sorted(entries)
    cell, gap, scale = 128, 12, 4
    width = gap + len(sizes) * (cell + gap)
    sheet = Image.new("RGBA", (width, gap + 2 * (cell + 32 + gap)), (24, 24, 28, 255))
    draw = ImageDraw.Draw(sheet)
    for row, background in enumerate(((24, 24, 28, 255), (244, 244, 247, 255))):
        top = gap + row * (cell + 32 + gap)
        draw.rectangle([0, top, width, top + cell + 26], fill=background)
        for index, size in enumerate(sizes):
            left = gap + index * (cell + gap)
            sheet.alpha_composite(entries[size].resize((cell, cell), Image.NEAREST), (left, top + 22))
            draw.text((left, top + 6), f"{size}px", fill=(90, 200, 255, 255))
    sheet.save(output)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preview", type=Path, help="輸出並排預覽 PNG")
    args = parser.parse_args()

    source = Image.open(SOURCE).convert("RGBA")
    entries = {size: simplified_face(source, size) for size in SMALL_SIZES}
    for size in DETAIL_SIZES:
        entries[size] = _fit(source, size, 0.0)

    write_ico(entries, ICO)
    entries[32].save(PNG32)
    if args.preview:
        build_preview(entries, args.preview)
    print(f"寫入 {ICO.relative_to(ICO.parent.parent.parent)} 與 {PNG32.name}")


if __name__ == "__main__":
    main()
