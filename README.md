# Gakumas Exam Simulator

学マスの共通 Exam 状態、コンテスト DFS、カード順とseedの再現を扱うシミュレーションエンジンです。

## Web

https://atuy1219.github.io/gakumas-sim/

Web版はメモリー管理、カード・Pアイテム図鑑、試験（オーディション）、コンテスト、アイドルへの道シミュで構成しています。

### 1. メモリー管理

所有メモリーをまとめて管理・編集します。

- `UserMemoryList` JSON の読み込み
- メモリーの検索
- メモリーの手動追加・編集・削除
- 表示名 / UserMemoryId / IdolCardId / CharacterId / PlanType
- Power / Grade / Vocal / Dance / Visual / Stamina
- スキルカード、UpgradeCount、FixedDeckOrder
- PアイテムID
- カードのカスタマイズ情報を保持

読み込んだメモリーはブラウザのlocalStorageに保存します。選択したローカルファイルをWebサーバーへ送信する処理はありません。

### 2. コンテストシミュ

Main / Sub のメモリーを2枚または3枚選択し、使用するカードを指定します。Mainの `IdolCardId` に対応するコンテスト初期デッキがあれば自動追加できます。

試行回数は100 / 1,000 / 10,000 / 100,000回から選択できます。コンテストではseedの手入力を要求せず、シミュレーション用の32-bit seed系列を自動生成します。

現在のWeb版で複数回実行するのはカード分布のMonte Carloです。1枚目の出現率と実行例を表示します。

最終スコアについては、カード効果・ステージ条件・ターン進行を厳密に接続できた組み合わせだけを計算対象にする方針です。未接続の状態では推定値を表示せず、現在は `未計算` と表示します。

PアイテムIDは選択メモリーから取得・表示しますが、効果はまだシミュレーションへ適用しません。応援・トラブルも同様に後続対応です。

### 3. アイドルへの道シミュ

メモリー2〜4枚を選択すると、MainのPアイドルの `examEffectType` に対応する現在のドル道仕様の基本カード2枚を自動追加します。seedを指定して毎ターン3枚を引き、使用カードまたはスキップを選びながらカード循環を確認できます。`PlayMovePositionType=Lost` の1回のみカードは、使用した場合だけ除外します。

#### プレイしながらseedを探す

プレイ中に確認したドロー順から32-bit seed候補を探索できます。

1. Webで実際のメモリーと採用カードを設定
2. 実機で同じ編成を使用
3. 新しく山札から手札へ来たカードだけを、同時に来たまとまりごとに記録
4. 仕切り直しや追加ドローでは、新しく来たカードを別のドローとして記録
5. 眠気などの生成カードは入力せず、元のデッキ枚数分まで入力したら「seed候補を探索」を実行

最初のデッキ1巡分から32-bit空間を絞ります。同時に表示されたカード内の位置は順不同として照合します。途中でカードを使用しても、山札由来の新規ドローだけを漏れなく記録すれば探索できます。山札そのものを再シャッフルする効果を使った場合は、新しい試行で記録し直してください。

Pアイテムとアイドルへの道固有の応援・トラブルは現在表示・保持段階で、効果適用は後続対応です。

## 所有メモリーの入力方法

Web上でメモリーを手動登録できます。

すでに `UserMemoryList` を含むJSONがある場合は、そのファイルを直接読み込めます。

## シードとカード順

通常の山札では32-bit乱数状態を使い、山札末尾から先頭へFisher–Yatesで並べ替えます。

同じカード入力と同じseedなら、同じ山札順になります。

`FixedDeckOrder > 0` を含む山札では固定順を使用します。同じ `FixedDeckOrder` を持つカードが複数ある入力は現在明示的に未対応です。

## 共通Examエンジン

現在のPython実装には以下を含みます。

- 共通Examのパラメータ・カードプール・ターン状態
- コンテスト用DFS
- 32-bit `XorShift32`
- seed付きカードシャッフル
- `FixedDeckOrder`
- `ParameterBuff` / `Review` / `LessonBuff` とadditive fix / multiple
- `ReviewStatusEffect.SpendTurn`
- `ExamCardValueStatusEffect`
- `PlayCardLimitPlayableValueAddStatusEffect`
- countを持つ各種status
- `TriggerEffectStatusEffect` のturn / limit / phase count
- `HandHold` 中の手札リセット
- deep copy / save / restore時の乱数状態保持
- Lesson / Block / staminaなど、実装済みの効果計算

未対応の分岐は代替ルールで補わず `UnsupportedPath` で停止します。

## テスト

```bash
python -m unittest -v
node test_web.mjs
node test_v3.mjs
```

seed `0x12345678` の山札 `A..H` が `GFECBHDA` になる固定ベクトルをPython / JavaScriptで確認しています。`test_v3.mjs` では観測順からのseed条件復元、重複カード、Monte Carlo集計も検査します。
