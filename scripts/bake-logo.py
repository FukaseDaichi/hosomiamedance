#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.9"
# dependencies = ["pillow"]
# ///
"""logo-src.png から配信用のロゴ資産を生成する。

1. public/assets/logo.webp  タイトル・ローディング用。幅 1280 に縮小して透過のまま
2. public/assets/ogp.png    SNS カード用。1200x630 の背景色にロゴを中央配置
3. public/favicon-32.png    タブ用。「ホ」を切り出してピンクの角丸に載せる
4. public/favicon-180.png   iOS のホーム画面用。同じ絵の大きい版

原本は透過 PNG(1672x940)なので背景を抜く処理は要らない。市松模様が焼き込まれた
版を掴まされたときは、原本を出し直すほうが速い(縁の光彩が背景に溶けていて、
アルファを推定すると拡大時に粗が出る)。

使い方: uv run scripts/bake-logo.py [logo-src.png]
依存:   上の PEP 723 メタデータに宣言済み。uv が自動で解決する。
"""
import os
import sys

from PIL import Image, ImageDraw

# 画面の地の色(src/styles.css の body と揃える)。OGP は透過を持てないので敷く
BG = (0x2A, 0x23, 0x47)

# タイトルの最大幅 620px を 2 倍の画面密度で出しても足りる寸法。
# 原本の 1672px をそのまま配るより軽い
LOGO_W = 1280

OGP_SIZE = (1200, 630)
# OGP 内でロゴが占める幅の比率。左右に余白を残さないと SNS 側のトリミングで切れる
OGP_FILL = 0.86

# 「ホ」の切り出し範囲(原本の座標)。隣の「ソ」を拾わない位置に取ってある。
# ロゴを描き直したらここも取り直すこと
HO_BOX = (517, 106, 757, 346)
# 角丸の下地。「ホ」はクリーム寄りの淡色なので、白いタブバーだと輪郭が溶ける
PLATE = (0xF5, 0xB8, 0xD4)
PLATE_FILL = 0.84  # 下地に対して「ホ」が占める比率


def bake_logo(src: Image.Image, path: str) -> None:
    """タイトル・ローディング用。透過のまま幅を落とす。

    原本は上下に透明の余白を持つ。そのまま配ると <img> の箱にその余白ぶんの
    高さが入り、タイトル画面でサブコピーがホソミに重なる。ここで詰めておく"""
    logo = src.crop(src.getbbox())
    h = round(logo.height * LOGO_W / logo.width)
    out = logo.resize((LOGO_W, h), Image.LANCZOS)
    out.save(path, "WEBP", quality=92, method=6)
    report(path, out.size)


def bake_ogp(src: Image.Image, path: str) -> None:
    """SNS カード用。透明の余白を詰めてから背景色の上に中央配置する"""
    logo = src.crop(src.getbbox())
    w = round(OGP_SIZE[0] * OGP_FILL)
    h = round(logo.height * w / logo.width)
    if h > OGP_SIZE[1] * OGP_FILL:  # 縦が先に詰まるなら高さで合わせる
        h = round(OGP_SIZE[1] * OGP_FILL)
        w = round(logo.width * h / logo.height)
    logo = logo.resize((w, h), Image.LANCZOS)

    out = Image.new("RGB", OGP_SIZE, BG)
    out.paste(logo, ((OGP_SIZE[0] - w) // 2, (OGP_SIZE[1] - h) // 2), logo)
    out.save(path, "PNG")
    report(path, out.size)


def bake_favicon(src: Image.Image, size: int, path: str) -> None:
    """タブ用。「ホ」を角丸のピンクに載せる"""
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    # rounded_rectangle はアンチエイリアスしないので 4 倍で描いて縮小する
    ss = 4
    plate = Image.new("RGBA", (size * ss, size * ss), (0, 0, 0, 0))
    ImageDraw.Draw(plate).rounded_rectangle(
        (0, 0, size * ss - 1, size * ss - 1), radius=round(size * ss * 0.24), fill=(*PLATE, 255)
    )
    out.alpha_composite(plate.resize((size, size), Image.LANCZOS))

    ho = src.crop(HO_BOX)
    ho = ho.crop(ho.getbbox())  # 切り出し枠の余白ぶん位置がずれるので詰める
    inner = round(size * PLATE_FILL)
    scale = inner / max(ho.width, ho.height)
    ho = ho.resize((max(1, round(ho.width * scale)), max(1, round(ho.height * scale))), Image.LANCZOS)
    out.alpha_composite(ho, ((size - ho.width) // 2, (size - ho.height) // 2))

    out.save(path, "PNG")
    report(path, out.size)


def report(path: str, size) -> None:
    kb = os.path.getsize(path) / 1024
    rel = os.path.relpath(path, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    print(f"  {rel:28s} {size[0]:5d}x{size[1]:<5d} {kb:8.1f} KB")


def main() -> None:
    src_path = sys.argv[1] if len(sys.argv) > 1 else "logo-src.png"
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    src_path = src_path if os.path.isabs(src_path) else os.path.join(root, src_path)

    src = Image.open(src_path).convert("RGBA")
    print(f"{os.path.relpath(src_path, root)}  {src.width}x{src.height}")

    assets = os.path.join(root, "public", "assets")
    public = os.path.join(root, "public")
    os.makedirs(assets, exist_ok=True)

    bake_logo(src, os.path.join(assets, "logo.webp"))
    bake_ogp(src, os.path.join(assets, "ogp.png"))
    bake_favicon(src, 32, os.path.join(public, "favicon-32.png"))
    bake_favicon(src, 180, os.path.join(public, "favicon-180.png"))


if __name__ == "__main__":
    main()
