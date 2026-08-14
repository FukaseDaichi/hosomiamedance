# AGENTS.md

雨の中でキャラが踊るリズムゲーム。Vite + React + TypeScript + Three.js の SPA を
GitHub Pages に静的配信している。サーバーサイドは無い。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバー |
| `npm run build` | `tsc --noEmit` + 本番ビルド。CI と同じ |
| `npm run preview` | 本番ビルドをローカル配信 |
| `npm run bake-sprites` | `hosomi.mp4` からスプライトを再生成 |
| `npm run bake-chart` | `hosomiamedance.mp3` から譜面 `src/charts.json` を再生成 |

変更を出す前に `npm run build` を通すこと。型エラーはここでしか出ない。

## 構成

| パス | 役割 |
| --- | --- |
| `src/App.tsx` | 画面遷移、判定・スコア・コンボ、ノーツレーンの Canvas 描画 |
| `src/audio.ts` | mp3 の再生、雨音・効果音の合成、難易度定義 |
| `src/lyrics.ts` | 歌詞と発声時刻 |
| `src/charts.json` | 焼いた譜面。**生成物なので直接編集しない** |
| `src/rainStage.ts` | Three.js の雨シーンとスプライトアニメーション |
| `src/styles.css` | 全画面のスタイル |
| `public/assets/hosomi/` | スプライト 128 枚(WebP)。**生成物なので直接編集しない** |
| `scripts/bake-sprites.py` | mp4 → 透過スプライトの変換パイプライン |
| `scripts/bake-chart.py` | 音源解析 → 譜面の生成パイプライン |
| `hosomi.mp4` | スプライトの原本(グリーンバック動画)。リポジトリにコミット済み |

## 踏みやすい落とし穴

- **base パスは `/hosomiamedance/`**（GitHub Pages のプロジェクトページ用）。dev / preview でも
  `http://localhost:5173/hosomiamedance/` を開く。`/` だけだと 404 になる。
- **`public/` のアセット URL には `import.meta.env.BASE_URL` を前置する**。
  `/assets/...` と絶対パスで書くと本番だけ 404 になる。
- **`<StrictMode>` は意図的に付けていない**（`src/main.tsx`）。開発時の二重マウントで
  WebGL コンテキストと AudioContext が二重に生成されるため。追加しない。
- `bake-sprites` の入力はリポジトリ直下の `hosomi.mp4`（コミット済み）。通常の開発では
  走らせる必要はない。WebP エンコード(method=6)のため全 128 枚で数分かかる。
- 見出しの「いろは餅」フォントは数字・英字のグリフを持たないため、`unicode-range` で
  かな・漢字・全角のみに適用している。数字が別フォントで出るのは仕様。
- **曲の BPM・拍位相・小節線は実測済みの定数**（`scripts/bake-chart.py` の `BPM` / `BEAT0` / `BAR0`）。
  BPM 156.000、1小節目 0.6138 秒、全 90 小節。曲を差し替えない限り再測定しない。
  譜面が音とずれたときに真っ先に疑うのはここではなく、`startSong` の助走と `time()` の基準。
- **音源を差し替えるときはファイル名も変える。** `public/assets/hosomiamedance.mp3` は
  `public/` 配下なのでビルド後もファイル名のまま配信され、ハッシュが付かない。一方
  `src/charts.json` はハッシュ付き JS にバンドルされる。譜面は音源の実測時刻に強く
  依存する設計なので、同名で差し替えるとキャッシュが切れるまで「新しい譜面 × 古い
  音源」で再生されてしまう。差し替え時は `src/audio.ts` の `SONG_URL` ごとファイル名を
  変え、`scripts/bake-chart.py` の `SRC` も追従させること。

## 規約

- **Python は uv を使う。** `uv run script.py` / `uv add`。`pip` や `python3` の直叩きはしない。
  スクリプトの依存は PEP 723 のインラインメタデータ（`# /// script`）に書き、
  `uv run` が解決できる状態を保つ。
- コメントは日本語。周囲のコードの密度に合わせる。
- ゲームロジック（判定・スコア・描画）は挙動が繊細なので、リファクタ時は
  ブラウザで実際に遊んで確認する。型が通るだけでは不十分。
- 譜面の診断・改善は chart-feel スキル（`.claude/skills/chart-feel/`）を使う。
  安全網は `bake-chart.py` の自動検査（生成の意図どおりかしか見ていない）、
  改善の最終判定はプレイ確認。譜面 JSON を直接編集しない。
