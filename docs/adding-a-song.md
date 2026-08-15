# 曲を追加する手順

Suno で作った mp3 を 1 本もらってから、ゲームで遊べる状態にするまでの手順。
ホソミアマゴイダンス(2026-08-15)を足したときの流れをそのまま runbook にした。

計測系のスクリプトは曲を足すときだけ走らせる。通常の開発では不要。

## 0. 前提

- Python は `uv run` で走らせる(AGENTS.md の規約)。依存は各スクリプトの
  PEP 723 インラインメタデータに書いてあるので、事前の `uv add` は要らない。
- 歌詞の時刻取りに Whisper large-v3(faster-whisper)と demucs を使う。
  初回はモデルのダウンロードで数 GB 落ちてくる。
- ffmpeg は要らない。音源の読み込みは全部 librosa(audioread/soundfile)経由。

## 1. mp3 を置く

`public/assets/` に **ASCII のファイル名で** 置く。日本語名のままだと URL の
エンコードで面倒が起きる。

```bash
mv ~/Downloads/ホソミアマゴイダンス.mp3 public/assets/hosomiamagoidance.mp3
```

既存曲を差し替えるのではなく新しい曲として足すぶんには、ファイル名の衝突さえ
避ければよい。**差し替える**場合は AGENTS.md の注意(ファイル名ごと変える)に従う。

## 2. BPM・拍位相・曲構成を測る

```bash
uv run scripts/analyze-song.py public/assets/hosomiamagoidance.mp3
```

出るもの:

- **実測 BPM** と **1拍目(BEAT0)** — 拍のグリッド探索の結果
- **上位候補** — 1位が2位を大きく引き離していれば信用してよい。僅差なら
  拍が曖昧なので、値をそのまま定数にせず聴いて確かめる
- **小節頭のオフセットと BAR0** — 4拍のうち低域(キック)が最も強い拍を1拍目とみなす
- **小節ごとの rms / kick / onset** — `sections` の区間と密度倍率を決める材料

読み方の例(アマゴイダンス):小節0-5 は rms 0.14 前後で静か、小節8で 0.60 に
跳ねて、小節64-71 で 0.19 まで落ちる。この落差がそのまま区間の切れ目になる。
ノーツを置くのをやめる `last_bar` は、rms が 0.07 まで落ちるフェード直前にする。

探索域は既定で 95-185 BPM。真の拍がここに無い曲は `--bpm LO-HI` で窓ごと動かす
(下の落とし穴「4/3 倍のテンポ」を参照)。

```bash
uv run scripts/analyze-song.py public/assets/hosomiyudachidance.mp3 --bpm 70-135
```

## 3. 歌詞の時刻を取る

歌声が伴奏に埋もれている曲(ウィスパーボイスなど)は、素の mp3 を Whisper に
通しても幻覚しか返らない。**先にボーカルを分離する。**

```bash
uv run scripts/separate-vocals.py public/assets/hosomiamagoidance.mp3
uv run scripts/transcribe-lyrics.py public/assets/hosomiamagoidance.vocals.wav 原詞.txt
```

第2引数の原詞(ひらがなベタ書きで可)は `initial_prompt` として渡され、表記と
語彙を寄せる。これが有るのと無いのとで認識率がはっきり変わる。

得られた単語タイムスタンプから各行の開始秒を拾って `src/lyrics.ts` に書く。
**表示テキストは認識結果ではなく Suno に渡した原詞のひらがな表記を使う**
(ゲーム内の表記をひらがなで統一するため)。時刻だけ実測値を借りる。

### 分離ボーカルに楽器が漏れる

demucs の vocals ステムには、シンセパッドやオルゴールが混ざることがある。
「歌っていないのに音量がある区間」を歌唱と誤認しないよう、疑わしい区間の
**基本周波数の動き**を見て判別する:

```bash
uv run --with librosa --with numpy python -c "
import librosa, numpy as np, warnings; warnings.filterwarnings('ignore')
y, sr = librosa.load('public/assets/hosomiamagoidance.vocals.wav', sr=22050, mono=True)
f0, _, _ = librosa.pyin(y[int(121*sr):int(136*sr)], fmin=100, fmax=800, sr=sr)
ok = ~np.isnan(f0); d = np.abs(np.diff(1200*np.log2(f0[ok])))
print('音高変化の中央値', np.median(d), 'cent')
"
```

人の歌は伸ばしていてもフレーム間で **10 セント前後ゆれる**。
**0.0 セント**(全く動かない)なら合成音、つまり楽器の漏れ。
アマゴイダンスはこれで「121-158秒は歌ではない」と判別できた。

## 4. 譜面の定数を書く

`scripts/bake-chart.py` の `SONGS` に `Song(...)` を1つ足す。

- `bpm` / `beat0` / `bar0` / `last_bar` は手順2の実測値
- `song_end` は結果画面に行く秒。フェードを聴かせつつ無音で待たせない位置
- `sections` は手順2の rms を見て区間と密度倍率を決める。境界は曲構成なので、
  譜面が気に入らないからといって動かさない
- `targets` は **1秒あたりのノーツ数を既存曲と揃えて** 決める。基準は
  easy 1.204 / normal 2.107 / hard 3.461 notes/sec。指の忙しさは拍ではなく
  実時間で決まるので、BPM ではなく秒で揃える
- `call_times` / `call_lanes` は「ひだり みぎ うえ した」のように方向を指示する
  歌詞がある曲だけ。無ければ空でよい

## 5. 譜面を焼く

```bash
uv run scripts/bake-chart.py amagoi
```

曲 ID を省くと全曲を焼き直す。検査に1つでも落ちると `src/charts.json` は
更新されない。**検査の閾値を緩めて通すのは禁止**。落ちたら生成側のつまみを直す
(`.claude/skills/chart-feel/SKILL.md` の手順に従う)。

## 6. TypeScript 側に足す

| ファイル | 足すもの |
| --- | --- |
| `src/lyrics.ts` | 歌詞配列を1つ export する |
| `src/songs.ts` | `SongId` に ID を足し、`META` に1エントリ足す |

BPM と `songEnd` は `charts.json` から読むので `songs.ts` には書かない。
値の出どころを二重に持たないため。

## 7. 確認する

```bash
npm run build
```

型エラーはここでしか出ない。そのあと必ずブラウザで遊んで確かめる。

```bash
npm run dev
```

開くのは `http://localhost:5173/hosomiamedance/`(`/` だけだと 404)。
譜面が音と合っているか、歌詞が声と合っているかは**遊ばないと分からない**。
自動検査が保証するのは「壊れていないこと」だけ。

## 踏みやすい落とし穴

- **BPM が半分・倍で出る。** 「拍の位置の平均オンセット強度」は拍が疎なほど
  高く出るので、半テンポを候補に入れると必ずそちらが勝つ。`analyze-song.py` は
  探索域を 95-185 BPM に絞ってこれを避けている。
- **4/3 倍のテンポが1位で出る。** 真の拍が探索域(既定 95-185)の外にあると、
  半・倍だけでなく **4/3 倍**が1位を取ることがある。ユウダチダンスは真の 85 BPM が
  窓の外にあり、113.335(= 85 × 4/3)が出た。見分け方は **16分グリッドの位相別に
  「音がある率」を出す**こと。正しいテンポなら4位相とも揃う(カミナリ
  0.99/0.86/0.98/0.84)が、4/3 倍だと 0.92/0.71/0.71/0.89 とガタガタになる。
  疑ったらキックのピーク間隔を直接測る(ユウダチは 0.353 秒でほぼ一定 = 8分)。
  `--bpm 70-135` のように窓を動かして測り直すと 84.988 が1位になった。
  この非整数倍の候補は `--bpm` を明示したときだけ探索する(既定で入れると、
  疎なグリッドほど平均オンセット強度が高く出るぶん不当に勝つため)。
- **最適値が探索窓の縁に張り付く。** 出た BPM が窓の端(±5)に近いときは、
  真の最適が窓の外にある。アマゴイダンスは窓 ±1.5 だと 127.388(上端 127.548)
  に張り付き、広げたら 127.384 が突出したピークだと分かった。
- **Whisper は非音声に定型句を貼る。** 「作詞・作曲・編曲 初音ミク」
  「ご視聴ありがとうございました」が出たら、そこは歌っていないか、
  歌声が埋もれている。`condition_on_previous_text=False` にしないと、
  一度出た幻覚が全編に伝播する。
- **librosa 1.0 の lazy loader。** `librosa.feature.rhythm.tempo` は属性経由だと
  解決できない。`from librosa.feature.rhythm import tempo` と直接引く。
- **demucs は ffprobe を要求する。** 同梱の `AudioFile` を使わず、librosa で
  読んだ配列を渡せば ffmpeg 無しで動く。
- **Suno は曲の長さ指定を守らない。** どちらにもブレる。90 秒と書いてアマゴイは
  167 秒、カミナリは 64.7 秒、ユウダチは 127.5 秒で出てきた。尺は生成後に実測する
  前提で考える。`targets` は尺に比例させるので、短い曲は既存曲の値をそのまま
  持ってこない。
- **Suno は BPM 指定も守らない。** ユウダチは Style に 140 BPM と書いて実測 85 BPM
  だった。指定値を `bake-chart.py` の定数に書き写さない。必ず測った値を使う。
