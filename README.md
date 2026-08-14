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
| `npm run bake-sprites` | `hosomi.mp4` からスプライトを再生成    |
| `npm run bake-chart`   | `hosomiamedance.mp3` から譜面を再生成  |

`vite.config.ts` の `base` は GitHub Pages のプロジェクトページ用に `/hosomiamedance/` を指している。
そのため dev / preview でも `http://localhost:5173/hosomiamedance/` を開くこと。

## 構成

| ファイル                  | 役割                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/App.tsx`             | 画面遷移(ローディング→タイトル→曲セレクト→ゲーム→リザルト)、判定・スコア・コンボ、ノーツレーンの Canvas 描画 |
| `src/audio.ts`            | mp3 の再生、雨音・効果音の合成、難易度定義                                                                   |
| `src/lyrics.ts`           | 歌詞と発声時刻(Whisper 実測)                                                                                 |
| `src/charts.json`         | `bake-chart.py` が焼いた譜面(EASY/NORMAL/HARD)。**生成物なので直接編集しない**                               |
| `src/rainStage.ts`        | Three.js の雨シーン。雨粒・水たまり・波紋・ハート・キャラのスプライトアニメーション                          |
| `src/styles.css`          | 全画面のスタイル                                                                                             |
| `scripts/bake-sprites.py` | mp4 → 透過スプライトの変換パイプライン                                                                       |
| `scripts/bake-chart.py`   | 音源解析 → 譜面の生成パイプライン                                                                            |

## スプライトについて

`public/assets/hosomi/` の 128 枚(8 モーション × 16 コマ)は `hosomi.mp4` から生成している。
`scripts/bake-sprites.py` が以下をビルド時に済ませることで、実行時のピクセル処理をなくし
WebP 保存で PNG 比 1/4 のサイズ(計約 3.5MB)に抑えている。

1. グリーンバックをソフトアルファでクロマキー抜き
2. 縁の半透明画素から背景色を逆算除去して緑かぶりを消す
3. 192 フレーム(8秒 x 24fps)から各モーション 16 枚を等間隔サンプリング
4. 透明部にエッジ色を 2px にじませ、残りを 0 で潰して圧縮を効かせる

生成済みのスプライトはコミットしてあるので、通常の開発でこの手順は不要。

作り直す場合は [uv](https://docs.astral.sh/uv/) を入れて実行する。入力の `hosomi.mp4` は
リポジトリ直下にコミット済みなので別途用意する必要はない。av・Pillow・numpy はスクリプト冒頭の
PEP 723 メタデータに宣言してあるので uv が自動で解決する。

```bash
npm run bake-sprites
```

## フォント

見出しに「いろは餅」(MODI工房)を使用している。数字・英字のグリフを持たないため、
`unicode-range` でかな・漢字・全角のみに適用し、それ以外は M PLUS Rounded 1c にフォールバックさせている。
