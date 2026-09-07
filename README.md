# Gakumas Exam Simulator

学マスの共通 Exam 状態とコンテスト DFS を扱うシミュレーションエンジンです。

## 現在の実装

- 共通 Exam のパラメータ・カードプール・ターン状態
- コンテスト用 DFS
- 32-bit `XorShift32` と整数範囲変換
- シード付きカードシャッフル
- `FixedDeckOrder` による固定順
- `ParameterBuff` / `Review` / `LessonBuff` と additive fix / multiple
- `ReviewStatusEffect.SpendTurn`
- `ExamCardValueStatusEffect` の `SpendTurn` / `SpendCount` / `ClearTurnState`
- `PlayCardLimitPlayableValueAddStatusEffect` のターン内回数管理
- `AntiDebuffStatusEffect`、`PlayCountBuffStatusEffect`、`PlayableValueAddStatusEffect`、検索カード系 status の count 更新
- `TriggerEffectStatusEffect` の turn count / limit count / phase count
- `HandHold` 中の手札リセット
- 深いコピーと save / restore 時の乱数状態保持

未対応の分岐は代替ルールを適用せず `UnsupportedPath` で停止します。

## シードとカード順

通常の山札は、現在の32-bit乱数状態から範囲内整数を作ったあと乱数状態を更新し、山札末尾から先頭へ Fisher–Yates で並べ替えます。

同じカード入力と同じ seed を使うと、同じ山札順・同じドロー順になります。

`FixedDeckOrder > 0` のカードを含む山札では固定順を使用します。現在は同じ `FixedDeckOrder` を持つカードが複数ある入力を明示的に未対応としています。

## Web

カード順の確認ページ:

https://atuy1219.github.io/gakumas-sim/

Web版には3つの入力モードがあります。

- **メモリー選択**: Main / Sub のメモリーを2枚または3枚選び、開始時の seed からカード順を表示します。入力JSONには各メモリーの `userMemoryId` / `activeProduceCardIds` と、共通カードを順番どおり格納した `baseProduceCards` が必要です。
- **開始データ**: `CompetitionStartResponse` / `TourStartResponse` のJSONから `ExamContestSituation` 内の Player を列挙し、`Seed` と `ProduceCards` を自動で読み取ります。
- **手動入力**: seed とカードID一覧を直接指定します。

メモリー構成だけではカード順は一意になりません。カード順を確定するには開始時の seed が必要です。Web版は不足した入力を別ルールで補完せず、必要な値がない場合はエラーにします。

手動入力のカードは1行1枚です。固定順を指定する場合は次の形式を使います。

```text
card-a,1
card-b,2
card-c,3
```

固定順を使わない場合はカード ID だけで構いません。

```text
card-a
card-b
card-c
```

## テスト

Python:

```bash
python -m unittest -v
```

Web側の乱数・シャッフル:

```bash
node test_web.mjs
```

Python と JavaScript の双方に同じ固定ベクトルを置き、seed `0x12345678` の山札 `A..H` が `GFECBHDA` になることを確認しています。
