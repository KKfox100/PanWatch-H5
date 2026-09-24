"""生成 PWA 图标：莫兰迪渐变底 + 趋势折线。
4 倍超采样后降采样，得到平滑边缘。"""
from PIL import Image, ImageDraw

S = 4  # 超采样倍数


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make(size: int) -> Image.Image:
    n = size * S
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))

    # 对角渐变底：雾霾蓝 → 鼠尾草绿
    c0, c1 = (0x8C, 0xA3, 0xB4), (0x9C, 0xAF, 0x9C)
    grad = Image.new("RGBA", (n, n))
    px = grad.load()
    for y in range(n):
        for x in range(n):
            t = (x / n + y / n) / 2
            px[x, y] = lerp(c0, c1, t) + (255,)

    # 圆角遮罩
    mask = Image.new("L", (n, n), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * 0.22), fill=255)
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)
    cream = (0xF6, 0xF3, 0xEF, 255)

    # 折线坐标（按 512 基准等比缩放）
    def p(x, y):
        return (x / 512 * n, y / 512 * n)

    pts = [p(96, 336), p(176, 256), p(240, 304), p(320, 200), p(416, 152)]
    d.line(pts, fill=cream, width=int(26 / 512 * n), joint="curve")

    # 数据点
    for cx, cy, r in [(96, 336, 20), (240, 304, 20), (416, 152, 24)]:
        x, y = p(cx, cy)
        rr = r / 512 * n
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=cream)

    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    import pathlib
    out = pathlib.Path(__file__).parent.parent / "public"
    out.mkdir(parents=True, exist_ok=True)
    for s in (192, 512):
        make(s).save(out / f"icon-{s}.png", optimize=True)
        print(f"icon-{s}.png")
    # 顺带生成一个 apple-touch 尺寸
    make(180).save(out / "icon-180.png", optimize=True)
    print("icon-180.png")
