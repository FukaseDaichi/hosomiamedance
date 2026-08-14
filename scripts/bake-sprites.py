#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.9"
# dependencies = ["av", "pillow", "numpy"]
# ///
"""hosomi.mp4 から配信用スプライト public/assets/hosomi/*.webp を生成する。

1. 緑背景(グリーンバック)をソフトアルファでクロマキー抜き
2. 縁の半透明画素から背景色を逆算除去(unmix)して緑かぶりを消す
3. 8秒 x 24fps = 192 フレームから各モーション 16 枚を等間隔サンプリング
4. 透明部にエッジ色を 2px にじませ(alpha bleed)、残りを 0 で潰して圧縮を効かせる
5. 1280x720 でキーイングしてから 960x540 に縮小(縁のアンチエイリアスを稼ぐ)
6. WebP q90 で保存(PNG 比 1/4 のサイズで見分けがつかない。計約 3.7MB)

旧版は 256 色 GIF が入力だったためディザ均しと穴埋めをしていたが、mp4 は
連続階調なので不要になった。代わりに h264 の非可逆圧縮で縁がぼけるぶん、
二値ではなくソフトアルファで抜く。

使い方: uv run scripts/bake-sprites.py [hosomi.mp4] [public/assets/hosomi]
依存:   上の PEP 723 メタデータに宣言済み。uv が自動で解決する。
"""
import os
import sys

import av
import numpy as np
from PIL import Image

# 8秒の動画に 8 モーションが 1 秒ずつ並んでいる
ANIMS = ['IDLE', 'LEFT_STEP', 'RIGHT_STEP', 'JUMP', 'DOWN', 'SPECIAL_A', 'SPECIAL_B', 'SPECIAL_C']
FRAMES_PER_ANIM = 16
SRC_FPS = 24
OUT_SIZE = (960, 540)

# g - max(r,b) がこの範囲で alpha 1 -> 0 に遷移する。実測では前景 <= 10、
# 背景 >= 40 に分離しており、間に落ちるのは h264 で滲んだ縁の画素だけ。
DIFF_FG = 10
DIFF_BG = 40


def key_frame(rgb, bg_color):
    """緑背景をソフトアルファで抜き、縁の緑かぶりを除去した RGBA 配列を返す。"""
    arr = rgb.astype(np.float64)
    d = arr[..., 1] - np.maximum(arr[..., 0], arr[..., 2])
    alpha = np.clip((DIFF_BG - d) / (DIFF_BG - DIFF_FG), 0.0, 1.0)

    # 半透明画素は 前景色*a + 背景色*(1-a) の混合なので背景色を逆算で取り除く
    a3 = alpha[..., None]
    unmixed = np.where(a3 > 0, (arr - bg_color * (1 - a3)) / np.where(a3 > 0, a3, 1), arr)
    unmixed = np.clip(unmixed, 0, 255)

    return unmixed, alpha


def neighbors_sum(arr, mask):
    """3x3 近傍について (mask を掛けた arr の総和, mask の総和) を返す。"""
    h, w = mask.shape
    acc = np.zeros((h, w, arr.shape[2]), np.float64)
    cnt = np.zeros((h, w), np.float64)
    masked = arr * mask[..., None]
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            ys_dst = slice(max(0, -dy), h - max(0, dy))
            ys_src = slice(max(0, dy), h - max(0, -dy))
            xs_dst = slice(max(0, -dx), w - max(0, dx))
            xs_src = slice(max(0, dx), w - max(0, -dx))
            acc[ys_dst, xs_dst] += masked[ys_src, xs_src]
            cnt[ys_dst, xs_dst] += mask[ys_src, xs_src]
    return acc, cnt


def bleed(rgb, alpha):
    """透明部にエッジ色をにじませ、GPU のバイリニア補間で縁に背景色が滲むのを防ぐ。"""
    cur_rgb = rgb
    cur_mask = (alpha > 0).astype(np.float64)
    for _ in range(2):
        acc, cnt = neighbors_sum(cur_rgb, cur_mask)
        grow = (cnt > 0) & (cur_mask == 0)
        cur_rgb = np.where(grow[..., None], acc / np.where(cnt > 0, cnt, 1)[..., None], cur_rgb)
        cur_mask = np.where(grow, 1.0, cur_mask)
    # にじみが届かない遠方の透明部は 0 で潰す(一様な値の方が PNG が縮む)
    cur_rgb = np.where(((alpha == 0) & (cur_mask == 0))[..., None], 0.0, cur_rgb)
    return cur_rgb


def bake(rgb, bg_color):
    unmixed, alpha = key_frame(rgb, bg_color)
    out_rgb = bleed(unmixed, alpha)
    rgba = np.concatenate(
        [np.round(out_rgb).astype(np.uint8), np.round(alpha * 255).astype(np.uint8)[..., None]],
        axis=2,
    )
    return Image.fromarray(rgba).resize(OUT_SIZE, Image.LANCZOS)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'hosomi.mp4'
    dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join('public', 'assets', 'hosomi')
    os.makedirs(dst, exist_ok=True)

    container = av.open(src)
    frames = [f.to_ndarray(format='rgb24') for f in container.decode(video=0)]
    expected = len(ANIMS) * SRC_FPS
    if len(frames) != expected:
        raise SystemExit(f'{src}: expected {expected} frames, got {len(frames)}')

    # 背景色は四隅の平均から採る(unmix 用)
    corners = np.concatenate([frames[0][:8, :8], frames[0][:8, -8:], frames[0][-8:, :8], frames[0][-8:, -8:]])
    bg_color = corners.reshape(-1, 3).mean(axis=0)

    for a, anim in enumerate(ANIMS):
        for k in range(FRAMES_PER_ANIM):
            i = a * SRC_FPS + int(k * SRC_FPS / FRAMES_PER_ANIM)
            img = bake(frames[i], bg_color)
            img.save(os.path.join(dst, f'{anim}_{k:02d}.webp'), quality=90, method=6)

    print(f'wrote {len(ANIMS) * FRAMES_PER_ANIM} sprites to {dst}')


if __name__ == '__main__':
    main()
