"""Generate package icons from code-native geometry; no browser or application execution."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
target = root / "icons"
target.mkdir(parents=True, exist_ok=True)
image = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((12, 12, 500, 500), radius=116, fill="#4f46e5")
points = [(120, 155), (256, 155), (392, 155), (392, 340), (256, 340), (120, 340)]
draw.line(points, fill="#c7d2fe", width=20, joint="curve")
for point, color in zip(points, ["#ffffff", "#a5f3fc", "#fde68a", "#fbcfe8", "#bbf7d0", "#ffffff"]):
    x, y = point
    draw.ellipse((x - 38, y - 38, x + 38, y + 38), fill=color)
for size in (16, 32, 48, 128):
    image.resize((size, size), Image.Resampling.LANCZOS).save(target / f"icon{size}.png")
print("Created four local extension PNG icons.")
