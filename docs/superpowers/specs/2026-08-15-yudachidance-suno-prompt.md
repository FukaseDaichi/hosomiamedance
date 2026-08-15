# ホソミユウダチダンス — Suno 生成プロンプト記録

2026-08-15。ゲーム 4 曲目として Suno で生成した。
音源は `public/assets/ホソミユウダチダンス.mp3` に保存済み(実測 127.52 秒)。

## コンセプト

- シリーズ 4 曲目。**夕立** — 急に降り出した雨を軒下でやり過ごそうとして、
  我慢できずに土砂降りへ飛び出す。静(軒下)と動(土砂降り)の落差が主題。
- 既存曲との住み分け:アメダンス=雨の中で踊る、アマゴイ=やんでいく雨に願う、
  カミナリ=夜と雷。ユウダチは**夏の昼・突発・疾走**を担当する。
- ラップは中盤に置く(カミナリと同じ位置)が、テンションを「怖さ」ではなく
  「はしゃぎ」に振る。早口のオノマトペ連打。
- 声は元気なかわいい女の子。A メロだけ小さな声で囁き、サビで張る。
  静→動を音量ではなく声質で作ることで Suno の出力を安定させる狙い。

## テンポ

140 BPM 前後を指定。既存が 156 / 127.4 / 128.0 と 128 系に寄っていたため、
収録曲の幅を出す目的で少し速めにした。実測値は組み込み時に
`analyze-song.py` で取り直すこと(Style の指定どおりに出るとは限らない)。

## 構成(設計時の想定)

| セクション | 想定尺 | 狙い |
| --- | --- | --- |
| Intro | 約7秒 | セミ＋遠雷。「あ、きた」 |
| Verse | 約14秒 | 軒下。キック薄め、囁き気味 |
| Pre-Chorus | 約7秒 | ためて上がる |
| Chorus | 約14秒 | ドロップ＝飛び出す。ノーツ密度を最大にする区間 |
| Rap | 約14秒 | 早口オノマトペ連打 |
| Break | 約3秒 | 音が全部止まる。「せーの!」 |
| Chorus 2 | 約14秒 | 再爆発 |
| Outro | 約7秒 | 雨があがる→虹 |

想定 80 秒に対し実測 127.52 秒。各区間の実際の位置は `analyze-song.py` の
小節ごとの rms を見て決め直す。

## Style(Suno Custom モードに渡したもの)

```
Japanese kawaii future bass dance track, energetic cute young female pop vocals,
clear Japanese diction, quiet intimate verse with sparse beat, cicada and wind
chime ambience, explosive synth drop chorus with four-on-the-floor beat around
140 BPM, fast cute rap section in the middle, sudden full break before the last
chorus, sparkling supersaws, deep sub bass, summer sunshower, playful and joyful,
short song about 90 seconds
```

## Lyrics(Suno に渡したひらがな原詞)

```
[Intro (cicadas, distant thunder, small voice)]
あ、きた… ゆうだち

[Verse 1 (quiet, sparse)]
セミが きゅうに だまって
かぜが ひやっと した
アスファルト ぽつん ぽつん
においが たちのぼる

[Pre-Chorus (building up)]
のきしたで ひざ かかえて
みっつ かぞえたら
もう まてない

[Chorus (drop, full energy)]
とびだせ ばしゃん ユウダチダンス
かみも くつも びしょびしょ
ざあざあ もっと ふって
ホソミ ユウダチダンス

[Rap (fast, cute)]
ぽつ ぽつ ざあ ざあ ばしゃ ばしゃ どん
にゅうどうぐもが ふくらんで
ひさしの したは もう まんいん
すきま ぬけて さん に いち
かたっぽの くつ みずびたし
きにしない きにしない はしれ
かみなりは まだ とおいから
いまの うちに おどっちゃえ

[Break (all drums out)]
…いくよ
せーの!

[Chorus 2 (bigger)]
とびだせ ばしゃん ユウダチダンス
そらが まるごと シャワー
ざあざあ もっと ふって
ホソミ ユウダチダンス

[Outro (rain fading, warm)]
やんじゃった… でも
にじが でるまで おどろう
```

語彙は既存曲と被らせていない。「みずたまり ぱしゃん」はアメダンス、
「くるり まわって」はアマゴイの持ち物。ユウダチ固有はセミ・アスファルト・
入道雲・軒下・虹。

- **実際の歌唱は原詞から変わる**。過去 3 曲すべてで繰り返しの追加や語尾の変化が
  起きている(カミナリは「ごろごろ」が 2 回→3 回)。組み込み時は
  `docs/adding-a-song.md` の手順 3 に従い Whisper large-v3 で実測し、
  表示テキストを実際の歌唱に合わせて調整する。

## 尺指定について

Suno は長さ指定を守らない。これで 3 曲連続:

| 曲 | 指定 | 実測 |
| --- | --- | --- |
| アマゴイ | 90 秒 | 167 秒 |
| カミナリ | 90 秒 | 64.7 秒 |
| ユウダチ | 90 秒 | 127.5 秒 |

Style に秒数を書くのは方向づけ程度の効果しかない。尺は生成後に実測する前提で
設計し、`bake-chart.py` の `targets` は実測尺に比例させる。

## 組み込み時の注意

- ファイル名が日本語なので、`docs/adding-a-song.md` の手順 1 に従い
  `hosomiyudachidance.mp3` へリネームしてから作業する。
- `src/songs.ts` の `SongId` に `yudachi` を足す。desc は選曲画面の一行紹介。
- 譜面は録音(chart-feel スキルの「ふめんを つくる」)か `bake-chart.py` か、
  どちらかのフローを通す。既存 3 曲はすべて `source: recorded`。
