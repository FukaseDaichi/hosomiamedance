#!/usr/bin/env python3
"""hosomi.gif から配信用スプライト public/assets/hosomi/*.png を生成する。

1. 緑背景(グリーンバック)をクロマキーで透過
2. 8秒 = 16フレーム/秒 で 8 モーションに分割しリネーム
3. 3x3 平均でディザノイズを均し、体内部の 1px 透明穴を埋める
4. 透明部にエッジ色を 2px にじませ(alpha bleed)、残りを 0 で潰して PNG 圧縮を効かせる

3 は元々 rain-stage.js がロード時に毎回 JS で行っていた処理。ビルド時に焼き込むことで
実行時コスト(128枚 x 480x270 のピクセル走査)を無くし、同時に転送量を 10MB -> 5.5MB に削減する。

使い方: python3 scripts/bake-sprites.py [hosomi.gif] [public/assets/hosomi]
依存:   pip install pillow numpy
"""
import os
import sys

import numpy as np
from PIL import Image, ImageSequence

# 8秒のGIFに 8 モーションが 1 秒ずつ並んでいる
ANIMS = ['IDLE', 'LEFT_STEP', 'RIGHT_STEP', 'JUMP', 'DOWN', 'SPECIAL_A', 'SPECIAL_B', 'SPECIAL_C']
FRAMES_PER_ANIM = 16

# G が R,B より この値以上 大きい画素を背景とみなす。
# 元GIFのパレット上、背景の最小 diff は 23、前景の最大 diff は 10 と離れているので
# その間を取れば誤判定は起きない。
GREEN_THRESHOLD = 16


def chroma_key(frame):
    """緑背景を alpha=0 にした RGBA 配列を返す。"""
    arr = np.array(frame.convert('RGBA'))
    r = arr[..., 0].astype(np.int16)
    g = arr[..., 1].astype(np.int16)
    b = arr[..., 2].astype(np.int16)
    is_bg = (g - np.maximum(r, b)) >= GREEN_THRESHOLD
    arr[..., 3] = np.where(is_bg, 0, arr[..., 3])
    return arr


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


def bake(arr):
    """平滑化・穴埋め・alpha bleed を適用した RGBA 配列を返す。"""
    rgb = arr[..., :3].astype(np.float64)
    alpha = arr[..., 3]
    mask = (alpha > 0).astype(np.float64)

    acc, cnt = neighbors_sum(rgb, mask)
    avg = acc / np.where(cnt > 0, cnt, 1)[..., None]

    # 元が不透明、または不透明な近傍が 6 個以上(=体内部の穴)なら平均色で不透明化
    keep = (alpha > 0) | (cnt >= 6)
    out_rgb = np.where(keep[..., None], avg, rgb)
    out_a = np.where(keep, 255, 0).astype(np.uint8)

    # 透明部にエッジ色をにじませ、GPU のバイリニア補間で縁に背景色が滲むのを防ぐ
    cur_rgb = out_rgb
    cur_mask = (out_a > 0).astype(np.float64)
    for _ in range(2):
        acc2, cnt2 = neighbors_sum(cur_rgb, cur_mask)
        grow = (cnt2 > 0) & (cur_mask == 0)
        cur_rgb = np.where(grow[..., None], acc2 / np.where(cnt2 > 0, cnt2, 1)[..., None], cur_rgb)
        cur_mask = np.where(grow, 1.0, cur_mask)

    # にじみが届かない遠方の透明部は 0 で潰す(一様な値の方が PNG が縮む)
    cur_rgb = np.where(((out_a == 0) & (cur_mask == 0))[..., None], 0.0, cur_rgb)

    return np.concatenate([np.round(cur_rgb).astype(np.uint8), out_a[..., None]], axis=2)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'hosomi.gif'
    dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join('public', 'assets', 'hosomi')
    os.makedirs(dst, exist_ok=True)

    frames = [chroma_key(f) for f in ImageSequence.Iterator(Image.open(src))]
    expected = len(ANIMS) * FRAMES_PER_ANIM
    if len(frames) != expected:
        raise SystemExit(f'{src}: expected {expected} frames, got {len(frames)}')

    for i, arr in enumerate(frames):
        name = f'{ANIMS[i // FRAMES_PER_ANIM]}_{i % FRAMES_PER_ANIM:02d}.png'
        Image.fromarray(bake(arr)).save(os.path.join(dst, name), optimize=True)

    print(f'wrote {len(frames)} sprites to {dst}')


if __name__ == '__main__':
    main()
