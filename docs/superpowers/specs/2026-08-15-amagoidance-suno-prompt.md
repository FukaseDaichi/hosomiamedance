# ホソミアマゴイダンス — Suno 生成プロンプト記録

2026-08-15。ゲーム 2 曲目として Suno で生成した。
音源は `public/assets/ホソミアマゴイダンス.mp3` に保存済み(実測 約 167 秒)。

## コンセプト

- 前作「アメダンス」(雨の中で踊る)の続編。**雨とのお別れ** — 雨があがって
  いくのが寂しくて、もう一度降ってと願う雨乞いのダンス。
- ウィスパーボイスの可愛い女の子。囁き × ダンサブルの「囁きドリームダンス」。
- 当初は幻想的スロー(100 BPM)で作ったが、音ゲーとして叩きづらかったため
  128 BPM の四つ打ちに方針転換した。

## Style(Suno Custom モードに渡したもの)

```
Japanese dream-pop dance track, ethereal whisper vocals, cute breathy young
female voice, intimate close-mic singing over a punchy four-on-the-floor beat
around 128 BPM, sparkling synth arpeggios, music box melody, soft piano,
gentle rain ambience, deep warm bass, dreamy but danceable, wistful and
magical, short song about 90 seconds
```

- 「90 秒」と指定しても実際は約 167 秒で生成された。Suno は長さ指定を
  ほぼ守らないので、次回も長さは実測前提で考えること。

## Lyrics(Suno に渡したひらがな原詞)

```
[Intro (rain fading, whisper)]
あめが… やんでいく…

[Verse 1]
くもの すきまに ひかり
まだ かえらないで
みずたまりに うつる そら
きえちゃう まえに

[Chorus]
つまさき とん と ならして
ふって ふって もういちど
くるり まわって おねがい
ホソミ アマゴイダンス

[Verse 2]
かさは もう いらないけど
にぎったまま はなせないの
ぬれた かみも すきだったよ
あめのおと こいしいよ

[Chorus]
そらに ゆびで かく うずまき
ふって ふって もういちど
くるり まわって おねがい
ららら アマゴイダンス

[Outro (whisper)]
あした また あえるよね
やくそくだよ… あめさん…
```

- **実際の歌唱は原詞から少し変わっている**(繰り返しの追加・語尾の変化など)。
  ゲームに組み込むときは前作と同様に Whisper large-v3 で実測タイムスタンプを
  取り、表示テキストは実際に歌われている内容に合わせて原詞を調整すること。

## ゲーム組み込み時の注意(未着手)

- 現状のゲームは 1 曲前提の作り(`src/audio.ts` の `SONG_URL`、`src/charts.json`、
  `src/lyrics.ts`)。2 曲対応には選曲まわりの設計が必要。
- BPM・拍位相は `scripts/bake-chart.py` 同様に実測して定数化する。
  Style 指定は 128 BPM だが、生成結果が正確に 128.000 とは限らない。
- ファイル名が日本語なので、URL の扱いを考えると組み込み時に ASCII 名
  (例: `hosomiamagoidance.mp3`)へのリネームを検討する。`public/` 配下は
  ハッシュが付かないため、以後差し替える場合は AGENTS.md の注意に従い
  ファイル名ごと変えること。
