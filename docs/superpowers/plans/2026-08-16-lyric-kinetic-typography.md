# 歌詞キネティック・タイポグラフィ強化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プレイ中の歌詞を、ビート同期で弾み・行ごとに配置が変わり・カタカナ語が強調される MV 風表示にする。

**Architecture:** DOM + CSS アニメーション拡張。`lyrics.ts` にカタカナ分割の純関数を追加し、`App.tsx` が行ごとの決定的乱数レイアウトを CSS 変数(`--lx` `--rot` `--beat` `--i` 等)で流し込み、`styles.css` の keyframes が動きを担う。Canvas/Three.js は使わない。

**Tech Stack:** React 18 (class component)、素の CSS keyframes、TypeScript。テストフレームワークは無し(規約どおり `npm run build` + ブラウザ実プレイで確認)。

**Spec:** `docs/superpowers/specs/2026-08-16-lyric-kinetic-typography-design.md`

## Global Constraints

- `npm run build`(= `tsc --noEmit` + vite build)を通してからコミットする。
- ノーツレーン(右 30px + 幅 340px = 右 440px 帯)には歌詞を重ねない。キャラ・判定テキストとの重なりは許容(ユーザー了承済み)。
- 行レイアウトは曲 ID + 行番号から決定的に決める(同じ曲は毎回同じ演出)。
- 既存の `lyricIdx` / `lyricOut` / `lyricOutKey` の state 構造は変えない。
- コメントは日本語。`<StrictMode>` は追加しない。
- 見出しフォント(いろは餅)はかな+全角記号のみ。歌詞はひらがな/カタカナなので問題ないが、CSS で font-family を変えない。

---

### Task 1: カタカナ分割の純関数 `splitLyricSegments`

**Files:**
- Modify: `src/lyrics.ts`(先頭の型定義エリアに追加)

**Interfaces:**
- Produces: `interface LyricSegment { text: string; kw: boolean }` と
  `function splitLyricSegments(text: string): LyricSegment[]`(ともに export)。
  カタカナ連続(長音「ー」含む)は 1 セグメント(kw=true)、それ以外は
  **1文字ずつ**のセグメント(kw=false)になる。Task 2 がこの名前で import する。

- [ ] **Step 1: 実装を書く**

`src/lyrics.ts` の `LyricLine` 定義の直後に追加:

```ts
/** 歌詞行の表示セグメント。kw=true はカタカナ語(強調対象) */
export interface LyricSegment {
  text: string
  kw: boolean
}

// カタカナ連続(長音・中点含む)。強調とビート揺れの単位になる
const KATAKANA_RUN = /[ァ-ヶー・]+/g

/**
 * 行テキストをセグメントに分割する。
 * カタカナ語はまとまりで 1 セグメント、それ以外は 1 文字ずつにして
 * 文字ごとに揺れの位相をずらせるようにする。
 */
export function splitLyricSegments(text: string): LyricSegment[] {
  const out: LyricSegment[] = []
  let last = 0
  for (const m of text.matchAll(KATAKANA_RUN)) {
    const at = m.index ?? 0 // lib のバージョンにより index が optional
    for (const ch of text.slice(last, at)) out.push({ text: ch, kw: false })
    out.push({ text: m[0], kw: true })
    last = at + m[0].length
  }
  for (const ch of text.slice(last)) out.push({ text: ch, kw: false })
  return out
}
```

- [ ] **Step 2: 動作を確認する(一時スクリプト)**

セッションの scratchpad ディレクトリに `check-split.ts` を作る:

```ts
import { splitLyricSegments } from '/Users/fukasedaichi/git/hosomiamedance/src/lyrics'

const eq = (a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error('FAIL', a, b)
    process.exit(1)
  }
}

// カタカナ語はまとまり、ひらがなは1文字ずつ
eq(splitLyricSegments('つまさきで アメダンス'), [
  { text: 'つ', kw: false },
  { text: 'ま', kw: false },
  { text: 'さ', kw: false },
  { text: 'き', kw: false },
  { text: 'で', kw: false },
  { text: ' ', kw: false },
  { text: 'アメダンス', kw: true },
])
// 長音を含むカタカナ語 / 行頭のカタカナ
eq(splitLyricSegments('ステップ ふめば'), [
  { text: 'ステップ', kw: true },
  { text: ' ', kw: false },
  { text: 'ふ', kw: false },
  { text: 'め', kw: false },
  { text: 'ば', kw: false },
])
// カタカナ無し
eq(splitLyricSegments('あめ'), [
  { text: 'あ', kw: false },
  { text: 'め', kw: false },
])
console.log('OK')
```

Run: `npx tsx <scratchpad>/check-split.ts`
Expected: `OK`

- [ ] **Step 3: ビルドを通す**

Run: `npm run build`
Expected: 型エラーなしで完走

- [ ] **Step 4: Commit**

```bash
git add src/lyrics.ts
git commit -m "feat: 歌詞行をカタカナ語と1文字に分割する splitLyricSegments を追加"
```

---

### Task 2: 行ごとレイアウト + セグメント描画 + CSS アニメーション

**Files:**
- Modify: `src/App.tsx`(歌詞の JSX は 673〜682 行付近、`lineAt` の import は 4 行目)
- Modify: `src/styles.css`(`@keyframes lyricIn` / `lyricOut` は 93〜113 行付近、`.lyric` / `.lyric--out` は 325〜344 行付近)

**Interfaces:**
- Consumes: Task 1 の `splitLyricSegments` / `LyricSegment`。
- Produces: なし(画面表示のみ)。

- [ ] **Step 1: App.tsx にレイアウト関数を追加**

`src/App.tsx` のトップレベル(コンポーネント定義の外、import の後)に追加:

```ts
// ---- 歌詞のキネティック・タイポグラフィ ----
// 行ごとの位置・角度・サイズを曲IDと行番号から決定的に決める。
// 乱数を使わないので、同じ曲は毎回同じ演出になる。

function hash32(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function lyricStyle(songId: string, idx: number): CSSProperties {
  const h = hash32(`${songId}:${idx}`)
  const r = (n: number) => ((h >>> n) & 0xff) / 255 // 0..1 を8bitずつ取り出す
  const lx = r(0) * 0.45 // 横位置。レーンを除いた幅に対する割合
  return {
    // レーン(右440px) + 左余白34px を除いた幅の中に置く
    left: `calc(34px + (100% - 474px) * ${lx.toFixed(3)})`,
    maxWidth: `calc((100% - 474px) * ${(1 - lx).toFixed(3)})`,
    bottom: `${(6 + r(8) * 56).toFixed(1)}%`,
    fontSize: `${Math.round(28 + r(16) * 24)}px`,
    ['--rot' as string]: `${((r(24) - 0.5) * 14).toFixed(1)}deg`,
  }
}

/** 歌詞1行をセグメントの span 列にする。空白は揺らさずそのまま出す */
function renderLyricLine(text: string): ReactNode[] {
  return splitLyricSegments(text).map((seg, i) =>
    seg.text.trim() === '' ? (
      <span key={i}>{seg.text}</span>
    ) : (
      <span
        key={i}
        className={seg.kw ? 'lyric-seg lyric-kw' : 'lyric-seg'}
        style={{ ['--i' as string]: i }}
      >
        {seg.text}
      </span>
    )
  )
}
```

import に追記(既存行を修正):

```ts
import { Component, createRef, lazy, Suspense, type CSSProperties, type ReactNode } from 'react'
import { lineAt, splitLyricSegments } from './lyrics'
```

- [ ] **Step 2: 歌詞の JSX を差し替え、--beat を設定**

`App.tsx` 673〜682 行付近の歌詞ブロックを差し替え:

```tsx
{s.lyricOut >= 0 && (
  <div
    key={`out-${s.lyricOutKey}`}
    className="lyric lyric--out"
    style={lyricStyle(song.id, s.lyricOut)}
  >
    {renderLyricLine(song.lyrics[s.lyricOut].text)}
  </div>
)}
{s.lyricIdx >= 0 && (
  <div key={s.lyricIdx} className="lyric" style={lyricStyle(song.id, s.lyricIdx)}>
    {renderLyricLine(song.lyrics[s.lyricIdx].text)}
  </div>
)}
```

`phase === 'game'` の `<div className="screen">`(645 行付近)に拍の長さを渡す:

```tsx
<div className="screen" style={{ ['--beat' as string]: `${(60 / song.bpm).toFixed(4)}s` }}>
```

- [ ] **Step 3: styles.css を書き換える**

`@keyframes lyricIn` / `lyricOut`(93〜113 行付近)を差し替え:

```css
/* 回転角(--rot)は行ごとに App が決める。keyframes 側でも同じ角度を保つ */
@keyframes lyricIn {
  from {
    opacity: 0;
    transform: rotate(var(--rot, 0deg)) scale(0.6);
  }
  to {
    opacity: 1;
    transform: rotate(var(--rot, 0deg)) scale(1);
  }
}

@keyframes lyricOut {
  from {
    opacity: 1;
    transform: rotate(var(--rot, 0deg)) scale(1);
  }
  to {
    opacity: 0;
    transform: rotate(var(--rot, 0deg)) scale(0.7);
  }
}

/* ビートに合わせた上下の弾み。--amp が振幅(px)、--i で位相をずらす */
@keyframes lyricBob {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(calc(var(--amp, 3) * -1px));
  }
}
```

`.lyric` / `.lyric--out`(325〜344 行付近)を差し替え。位置・サイズは
インラインスタイルに移ったので CSS からは消す:

```css
.lyric {
  position: absolute;
  /* left / bottom / max-width / font-size は行ごとに App.tsx が決める */
  line-height: 1.25;
  white-space: pre-wrap; /* セグメント間の空白を潰さない */
  color: #ffeccb;
  text-shadow:
    0 3px 0 rgba(90, 40, 80, 0.5),
    0 0 24px rgba(255, 200, 230, 0.35);
  /* 末尾の >1 な制御点でオーバーシュート(ぽよん)させる */
  animation: lyricIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

/* 前の行。自分の座標のまま縮んで消える */
.lyric--out {
  animation: lyricOut 0.25s ease-in both;
}

/* 揺れの単位。1文字またはカタカナ語1つ */
.lyric-seg {
  display: inline-block;
  animation: lyricBob var(--beat, 0.5s) ease-in-out
    calc(var(--i, 0) * var(--beat, 0.5s) / -8) infinite;
}

/* カタカナ語の強調。大きく・ピンクに・よく弾む */
.lyric-kw {
  --amp: 6;
  font-size: 1.4em;
  color: #ffb7d9;
  text-shadow:
    0 3px 0 rgba(120, 30, 80, 0.55),
    0 0 28px rgba(255, 140, 200, 0.6);
}
```

- [ ] **Step 4: ビルドを通す**

Run: `npm run build`
Expected: 型エラーなしで完走

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/styles.css
git commit -m "feat: 歌詞をビート同期・行ごと配置・カタカナ強調のキネティック表示にする"
```

---

### Task 3: ブラウザでの実プレイ確認と調整

**Files:**
- Modify(必要なら): `src/App.tsx` のレイアウト定数、`src/styles.css` の振幅・色

**Interfaces:**
- Consumes: Task 2 の表示一式。

- [ ] **Step 1: dev サーバーで確認する**

`.claude/launch.json` の dev 設定(無ければ `npm run dev` / port 5173 で作る)で
preview を開き、`http://localhost:5173/hosomiamedance/` に移動(base パス必須)。
曲を開始してプレイ画面に入る。

- [ ] **Step 2: チェックリストを目視で確認する**

- 歌詞が行ごとに違う位置・角度・サイズで出る(同じ曲を2回入って同一なことも確認)
- カタカナ語(アメダンス・リズム等)が大きくピンクで表示される
- 揺れが曲の拍と合って見える(BPM の違う2曲で確認)
- ノーツレーン(右側)に歌詞がかかっていない
- 前の行が自分の位置で消え、新しい行が別の位置でポップインする
- コンソールにエラーが出ていない(read_console_messages)

- [ ] **Step 3: 気になった点を調整する**

読みにくい・うるさい等があれば `lyricStyle` の範囲定数(横 0.45、縦 6+56%、
サイズ 28+24px、回転 ±7°)や `--amp` を調整し、Step 2 を再確認。

- [ ] **Step 4: スクリーンショットを撮って共有する**

computer(screenshot) でプレイ中の歌詞が写った画面を撮り、ユーザーに提示する。

- [ ] **Step 5: 最終ビルドと(調整があれば)コミット**

Run: `npm run build`
Expected: 完走

```bash
git add src/App.tsx src/styles.css
git commit -m "tweak: 歌詞キネティック表示の調整"
```

(調整が無ければコミット不要)
