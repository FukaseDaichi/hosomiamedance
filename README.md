# ホソミアメダンス

あめのひは みずたまりで ダンス! ブラウザで遊べるリズムゲーム。

**遊ぶ → https://fukasedaichi.github.io/hosomiamedance/**

矢印キー(←↓↑→)でノーツを叩き、コンボを繋いでスペシャル演出を出す。曲は「ホソミアメダンス」1曲で、
EASY / NORMAL / HARD の3難易度。譜面は音源を解析して事前に焼いてある。効果音と雨音は WebAudio 合成。
背景は Three.js の 3D シーン。

## 開発

```bash
npm install
npm run dev
```

| コマンド               | 内容                                   |
| ---------------------- | -------------------------------------- |
| `npm run dev`          | 開発サーバー(HMR あり)                 |
| `npm run build`        | 型チェック(`tsc --noEmit`)+ 本番ビルド |
| `npm run preview`      | 本番ビルドをローカル配信               |
| `npm run bake-sprites` | `hosomi.gif` からスプライトを再生成    |
| `npm run bake-chart`   | `hosomiamedance.mp3` から譜面を再生成  |

`vite.config.ts` の `base` は GitHub Pages のプロジェクトページ用に `/hosomiamedance/` を指している。
そのため dev / preview でも `http://localhost:5173/hosomiamedance/` を開くこと。

## 構成

| ファイル                  | 役割                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/App.tsx`             | 画面遷移(ローディング→タイトル→曲セレクト→ゲーム→リザルト)、判定・スコア・コンボ、ノーツレーンの Canvas 描画 |
| `src/audio.ts`            | WebAudio で曲・雨音・効果音を生成。譜面もここから決定的に組み立てる                                          |
| `src/lyrics.ts`           | 歌詞と発声時刻(Whisper 実測)                                                                                 |
| `src/charts.json`         | `bake-chart.py` が焼いた譜面(EASY/NORMAL/HARD)。**生成物なので直接編集しない**                               |
| `src/rainStage.ts`        | Three.js の雨シーン。雨粒・水たまり・波紋・ハート・キャラのスプライトアニメーション                          |
| `src/styles.css`          | 全画面のスタイル                                                                                             |
| `scripts/bake-sprites.py` | GIF → 透過スプライト の変換パイプライン                                                                      |
| `scripts/bake-chart.py`   | 音源解析 → 譜面の生成パイプライン                                                                            |

## スプライトについて

`public/assets/hosomi/` の 128 枚(8 モーション × 16 コマ)は `hosomi.gif` から生成している。
`scripts/bake-sprites.py` が以下をビルド時に済ませることで、実行時のピクセル処理をなくし
転送量を 10MB → 5.5MB に抑えている。

1. グリーンバックをクロマキーで透過
2. 8 モーションへ分割・リネーム
3. 3x3 平均でディザノイズを均し、体内部の 1px 透明穴を埋める
4. 透明部にエッジ色を 2px にじませ、残りを 0 で潰して PNG 圧縮を効かせる

生成済みのスプライトはコミットしてあるので、通常の開発でこの手順は不要。

作り直す場合は入力の `hosomi.gif`(リポジトリには含めていない)を直下に置いたうえで、
[uv](https://docs.astral.sh/uv/) を入れて実行する。Pillow と numpy はスクリプト冒頭の
PEP 723 メタデータに宣言してあるので uv が自動で解決する。

```bash
npm run bake-sprites
```

## フォント

見出しに「いろは餅」(MODI工房)を使用している。数字・英字のグリフを持たないため、
`unicode-range` でかな・漢字・全角のみに適用し、それ以外は M PLUS Rounded 1c にフォールバックさせている。
