# Gakumas Exam Simulator

学マスの共通 Exam 状態、コンテスト DFS、カード順とseedの再現を扱うシミュレーションエンジンです。

## Web

https://atuy1219.github.io/gakumas-sim/

Web版は次の3タブで構成しています。

### 1. メモリー管理

所有メモリーをまとめて管理・編集します。

- `memories.log` / `UserMemoryList` JSON の読み込み
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

メモリー2枚または3枚と初期/共通カードを指定し、seedからカード順を再現できます。

アイドルへの道の初期デッキは自動推測せず、対象の初期デッキIDを入力するか、カードを手動追加します。

#### 実機の順番からseedを探す

Fridaを使わず、実機で確認したシャッフル後の山札全順序から32-bit seed候補を探索できます。

1. Webで実際のメモリーと採用カードを設定
2. 実機で同じ編成を使用
3. 山札の順番を上から最後まで記録
4. 「seed候補を探索」を実行

Fisher–Yatesの交換列を観測順から復元し、最初の交換条件で32-bit空間を区間に絞ったうえで、Web Workerで候補を検査します。同一カードが複数ある場合はカード個体の割り当ても列挙します。候補割当が64通りを超える場合は、完全な探索結果と誤認しないよう停止します。

デッキ全順序が必要です。観測情報が不足する場合や同一カードを区別できない場合は、seedが複数候補になることがあります。

Pアイテムとアイドルへの道固有の応援・トラブルは現在表示・保持段階で、効果適用は後続対応です。

## 所有メモリーの入力方法

Web上で手動入力できるため、Fridaは必須ではありません。

すでに `UserMemoryList` を含むJSONがある場合は、そのファイルを直接読み込めます。

端末から一覧をまとめて取得したい場合のみ、補助スクリプト `tools/frida/export_memories.js` を使用できます。

Androidでspawnを使わずattachする例:

```bash
frida -U -N com.bandainamcoent.idolmaster_gakuen \
  -l tools/frida/export_memories.js \
  -o memories.log
```

`[memory-export] ready:` が表示された後にメモリー一覧が読み込まれる画面まで進み、取得後に `Ctrl+C` で終了します。生成された `memories.log` はWeb版でそのまま読み込めます。

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
