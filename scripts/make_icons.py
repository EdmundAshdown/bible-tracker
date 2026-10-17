"""Generate PWA icons for Bible Tracker (dark tile, gold ring, cross)."""
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(HERE, "icons")
os.makedirs(ICONS, exist_ok=True)

BG = (23, 29, 43, 255)       # #171d2b
BG_SOLID = (14, 17, 23, 255)  # #0e1117
GOLD = (240, 182, 76, 255)
WHITE = (238, 242, 248, 255)


def draw_art(d, s):
    """Ring + cross centered on an s x s canvas. Art stays in central 80%."""
    m = s * 0.16
    ring_w = max(2, int(s * 0.055))
    d.ellipse([m, m, s - m, s - m], outline=GOLD, width=ring_w)
    # Cross: vertical + horizontal rounded bars
    bw = s * 0.085
    vh = s * 0.40
    cx = s / 2
    d.rounded_rectangle([cx - bw / 2, s / 2 - vh / 2, cx + bw / 2, s / 2 + vh / 2],
                        radius=int(bw / 2), fill=WHITE)
    hw = s * 0.28
    d.rounded_rectangle([cx - hw / 2, s / 2 - bw / 2 - s * 0.03,
                         cx + hw / 2, s / 2 + bw / 2 - s * 0.03],
                        radius=int(bw / 2), fill=WHITE)


def rounded_base(s, radius_frac=0.22):
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s, s], radius=int(s * radius_frac), fill=BG,
                        outline=(53, 65, 90, 255), width=max(1, s // 128))
    draw_art(ImageDraw.Draw(img), s)
    return img


def solid_base(s):
    img = Image.new("RGBA", (s, s), BG_SOLID)
    draw_art(ImageDraw.Draw(img), s)
    return img


rounded_base(512).save(os.path.join(ICONS, "icon-512.png"))
rounded_base(192).save(os.path.join(ICONS, "icon-192.png"))
solid_base(512).save(os.path.join(ICONS, "icon-maskable-512.png"))
solid_base(180).save(os.path.join(ICONS, "apple-touch-icon.png"))
rounded_base(64).resize((32, 32), Image.LANCZOS).save(os.path.join(HERE, "favicon.ico"))
print("icons written to", ICONS)
