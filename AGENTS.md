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

変更を出す前に `npm run build` を通すこと。型エラーはここでしか出ない。

## 構成

| パス | 役割 |
| --- | --- |
| `src/App.tsx` | 画面遷移、判定・スコア・コンボ、ノーツレーンの Canvas 描画 |
| `src/audio.ts` | WebAudio による曲・雨音・効果音の合成。譜面もここで生成 |
| `src/rainStage.ts` | Three.js の雨シーンとスプライトアニメーション |
| `src/styles.css` | 全画面のスタイル |
| `public/assets/hosomi/` | スプライト 128 枚(WebP)。**生成物なので直接編集しない** |
| `scripts/bake-sprites.py` | mp4 → 透過スプライトの変換パイプライン |
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

## 規約

- **Python は uv を使う。** `uv run script.py` / `uv add`。`pip` や `python3` の直叩きはしない。
  スクリプトの依存は PEP 723 のインラインメタデータ（`# /// script`）に書き、
  `uv run` が解決できる状態を保つ。
- コメントは日本語。周囲のコードの密度に合わせる。
- ゲームロジック（判定・スコア・描画）は挙動が繊細なので、リファクタ時は
  ブラウザで実際に遊んで確認する。型が通るだけでは不十分。
