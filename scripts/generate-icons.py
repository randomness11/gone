from pathlib import Path
from typing import Optional, Tuple

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "public" / "icons"
SIZES = (16, 32, 48, 128)
SCALE = 8


def rounded(draw: ImageDraw.ImageDraw, box: Tuple[int, int, int, int], radius: int, fill: str, outline: Optional[str] = None, width: int = 1) -> None:
    scaled = tuple(value * SCALE for value in box)
    draw.rounded_rectangle(scaled, radius=radius * SCALE, fill=fill, outline=outline, width=width * SCALE)


def build_icon(size: int) -> Image.Image:
    canvas = Image.new("RGBA", (128 * SCALE, 128 * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    rounded(draw, (6, 6, 122, 122), 28, "#8AB4F8")
    rounded(draw, (27, 29, 77, 67), 7, "#6694D6", "#D2E3FC", 3)
    rounded(draw, (38, 42, 88, 80), 7, "#8AB4F8", "#FFFFFF", 3)
    rounded(draw, (50, 55, 101, 94), 8, "#FFFFFF")

    return canvas.resize((size, size), Image.Resampling.LANCZOS)


ICON_DIR.mkdir(parents=True, exist_ok=True)
for icon_size in SIZES:
    build_icon(icon_size).save(ICON_DIR / f"icon-{icon_size}.png", optimize=True)
