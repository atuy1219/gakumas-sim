# Gakumas Exam Simulator

学マスの共通 Exam 状態、コンテスト DFS、カード順の再現を扱うシミュレーションエンジンです。

## 現在の実装

- 共通 Exam のパラメータ・カードプール・ターン状態
- コンテスト用 DFS
- 32-bit `XorShift32` と整数範囲変換
- seed付きカードシャッフル
- `FixedDeckOrder` による固定順
- `ParameterBuff` / `Review` / `LessonBuff` と additive fix / multiple
- `ReviewStatusEffect.SpendTurn`
- `ExamCardValueStatusEffect` の `SpendTurn` / `SpendCount` / `ClearTurnState`
- `PlayCardLimitPlayableValueAddStatusEffect` のターン内回数管理
- countを持つ各種 status
- `TriggerEffectStatusEffect` の turn count / limit count / phase count
- `HandHold` 中の手札リセット
- 深いコピーと save / restore 時の乱数状態保持

未対応の分岐は代替ルールを適用せず `UnsupportedPath` で停止します。

## Web

https://atuy1219.github.io/gakumas-sim/

### メモリー選択

所有メモリーを読み込み、Main / Sub を2枚または3枚選んでカード順を確認できます。

読み込み時は `UserMemoryList` の中から次の情報を使用します。

- `userMemoryId`
- `idolCardId`
- `power`
- `examBattleProduceCards`

コンテストで使用するカードはメモリーごとのチェック欄から選択します。入力データに `activeProduceCardIds` が含まれている場合は、その選択状態を初期値として使用します。

Mainメモリーの `idolCardId` に対応するコンテスト初期デッキが見つかった場合は、初期カードも自動で追加できます。追加カードはカード名検索から手動で指定することもできます。

カード順そのものを確定するには開始時の32-bit seedが必要です。

### 所有メモリーを端末から出力する

`tools/frida/export_memories.js` は読み込まれた `UserMemory` を1行1件で出力します。

```bash
frida -U -f com.bandainamcoent.idolmaster_gakuen \
  -l tools/frida/export_memories.js \
  -o memories.log
```

ゲームが起動して所有メモリーが読み込まれたあと、生成された `memories.log` をWeb版の「ゲームデータ / export.log を開く」から選択します。JSONを手作業で組み立てる必要はありません。

通常の `UserMemoryList` を含むJSONファイルを持っている場合は、そのファイルを直接選択しても読み込めます。

### 手動メモリー

メモリー一覧を持っていない場合でも、Web版からメモリーを追加できます。

- 表示名
- `IdolCardId`（任意）
- Power（任意）
- スキルカード
- 使用するカードのチェック

スキルカードはカード名または `p_card-...` IDで検索できます。登録したメモリーはブラウザのローカルストレージに保存されます。

### 開始データ

`CompetitionStartResponse` / `TourStartResponse` など、`ExamContestSituation` を含む開始データから Player を列挙し、`Seed` と `ProduceCards` を直接読み取れます。このモードでは開始時の実デッキをそのまま使います。

### 手動デッキ

seedとカードID一覧を直接指定する低レベル入力も残しています。

## シードとカード順

通常の山札は、現在の32-bit乱数状態から範囲内整数を作ったあと乱数状態を更新し、山札末尾から先頭へ Fisher–Yates で並べ替えます。

同じカード入力と同じ seed を使うと、同じ山札順・同じドロー順になります。

`FixedDeckOrder > 0` のカードを含む山札では固定順を使用します。現在は同じ `FixedDeckOrder` を持つカードが複数ある入力を明示的に未対応としています。

## テスト

Python:

```bash
python -m unittest -v
```

Web:

```bash
node test_web.mjs
```

Python と JavaScript の双方に同じ固定ベクトルを置き、seed `0x12345678` の山札 `A..H` が `GFECBHDA` になることを確認しています。
