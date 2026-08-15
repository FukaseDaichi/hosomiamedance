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
| `npm run bake-chart` | 収録曲の mp3 から譜面 `src/charts.json` を再生成。曲 ID を渡すとその曲だけ |

変更を出す前に `npm run build` を通すこと。型エラーはここでしか出ない。

曲を1曲足すまでの手順は [docs/adding-a-song.md](docs/adding-a-song.md) にまとめてある。
計測用の `scripts/analyze-song.py` / `separate-vocals.py` / `transcribe-lyrics.py` は
そのときだけ使う。

## 構成

| パス | 役割 |
| --- | --- |
| `src/App.tsx` | 画面遷移、判定・スコア・コンボ、ノーツレーンの Canvas 描画 |
| `src/songs.ts` | 収録曲の定義(タイトル・URL・BPM・歌詞・譜面の取り出し) |
| `src/audio.ts` | mp3 の再生、雨音・効果音の合成、難易度定義 |
| `src/lyrics.ts` | 曲ごとの歌詞と発声時刻 |
| `src/charts.json` | 焼いた/録音由来の譜面。`source` が出自。**直接編集しない**(baked は bake-chart.py、recorded は chart-feel の録音→譜面フローで書く) |
| `src/RecordMode.tsx` | 譜面録音モード(dev限定)。本番バンドルには入らない |
| `src/recording.ts` | 録音の型と保存(POST /__rec) |
| `recordings/` | 録音の生データ。譜面の出自として git 管理する |
| `src/rainStage.ts` | Three.js の雨シーンとスプライトアニメーション |
| `src/styles.css` | 全画面のスタイル |
| `public/assets/hosomi/` | スプライト 128 枚(WebP)。**生成物なので直接編集しない** |
| `scripts/bake-sprites.py` | mp4 → 透過スプライトの変換パイプライン |
| `scripts/bake-chart.py` | 音源解析 → 譜面の生成パイプライン。曲ごとの実測定数もここ |
| `scripts/analyze-song.py` | 新曲の BPM・拍位相・曲構成を測る(曲追加時だけ) |
| `scripts/separate-vocals.py` | 歌声だけを抜いた wav を作る(歌詞の時刻取り用) |
| `scripts/transcribe-lyrics.py` | Whisper で歌詞の実測タイムスタンプを出す |
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
- **曲の BPM・拍位相・小節線は実測済みの定数**（`scripts/bake-chart.py` の `SONGS`）。
  曲を差し替えない限り再測定しない。譜面が音とずれたときに真っ先に疑うのはここではなく、
  `startSong` の助走と `time()` の基準。
- **音源を差し替えるときはファイル名も変える。** `public/assets/*.mp3` は
  `public/` 配下なのでビルド後もファイル名のまま配信され、ハッシュが付かない。一方
  `src/charts.json` はハッシュ付き JS にバンドルされる。譜面は音源の実測時刻に強く
  依存する設計なので、同名で差し替えるとキャッシュが切れるまで「新しい譜面 × 古い
  音源」で再生されてしまう。差し替え時は `src/songs.ts` の `file` ごとファイル名を
  変え、`scripts/bake-chart.py` の `src` も追従させること。
- **録音由来(source=recorded)の譜面は bake-chart.py の全曲生成でスキップされる**。
  自動生成に戻すときは曲IDを明示指定する(`uv run scripts/bake-chart.py amagoi`)。

## 規約

- **Python は uv を使う。** `uv run script.py` / `uv add`。`pip` や `python3` の直叩きはしない。
  スクリプトの依存は PEP 723 のインラインメタデータ（`# /// script`）に書き、
  `uv run` が解決できる状態を保つ。
- コメントは日本語。周囲のコードの密度に合わせる。
- ゲームロジック（判定・スコア・描画）は挙動が繊細なので、リファクタ時は
  ブラウザで実際に遊んで確認する。型が通るだけでは不十分。
- 譜面の診断・改善は chart-feel スキル(`.claude/skills/chart-feel/`)を使う。
  録音(dev限定の「譜面をつくる」)から譜面を作る手順も同スキルにある。
  安全網は `bake-chart.py` の自動検査(recorded の曲は健全性チェックのみ)、
  改善の最終判定はプレイ確認。譜面 JSON は必ずどちらかのフローを通して書く
