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

#### スコアとメモリー生成コスト

- 試験・オーディション画面ではカード効果適用後の獲得パラメータをスコアとして逐次計算し、任意の目標スコアに対する達成・残量を表示します。開始時体力も編成プリセットに保存します。
- メモリー編集では `ProduceCard.evaluation` を生成対象カードの基礎コストとして表示します。無印と強化後は別の値です。
- カスタマイズの生成コスト加算は `ProduceCardCustomizeRarityEvaluation` に従います。現在は N / R / SR / SSR のすべてが1段階につき12です。
- 選べる内容と上限はカードごとの `produceCardCustomizeIds` / `maxCustomizeCount`、各段階の効果と必要Pポイントは `ProduceCardCustomize` / `ProduceCardGrowEffect` から判定します。
- カード使用時の体力消費、特別指導で消費するPポイント、メモリー生成時のカード評価値は別の値として扱います。

公式ヘルプ上、メモリーのスキルカードはプロデュース終了時の所持カードから抽選され、強化・カスタム状態はメモリー抽選ロジックで決まります。また、カスタマイズには強化済みカードが必要で、初期所持カード・トラブルカード・一部の固有カードは対象外です。抽選確率そのものは公開された定数だけでは一意に再現できないため、本ツールでは未確認の確率を推定せず、候補適否と生成コストの確定可能な内訳を表示します。

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
3. 手札へ出たカードを、見えた順に記録
4. 最初のデッキ枚数分まで入力したら「seed候補を探索」を実行

最初のデッキ1巡分からFisher–Yatesの交換列を復元して32-bit空間を絞ります。観測したカードの順番はそのまま使用し、同じ手札に表示されたカードも順不同には扱いません。同一カードが複数ある場合の初期シャッフル割当も列挙します。

Pアイテムの試験中効果は `ProduceItemEffect` → `ProduceExamStatusEnchant` →
`ProduceExamTrigger` → `ProduceExamEffect` を解決し、カードと同じNative Effect
Schedulerで処理します。試験外の `ProduceEffect` は試験ランタイムでは発動しません。

## 所有メモリーの入力方法

Web上でメモリーを手動登録できます。

すでに `UserMemoryList` を含むJSONがある場合は、そのファイルを直接読み込めます。

## シードとカード順

通常の山札では32-bit乱数状態を使い、山札末尾から先頭へFisher–Yatesで並べ替えます。

同じカード入力と同じseedなら、同じ山札順になります。

### 開幕手札（IL2CPP実装準拠）

解析用ELFで `ExamCardMoveController.SetInitialCard`（`0x8239520`）と
`ExamCardPoolModel.Shuffle`（`0x803F7C4`）を追跡した結果、`IsInitial`
カードはシャッフル対象から除外されません。

1. まず **IsInitialを含むDeck全体** をseedでシャッフルする
2. `SetInitialCard` がDeck末尾から先頭へ走査し、`IsInitial` をHandへ移す
3. 開幕ドロー枚数に不足する分だけ通常の `DrawCard` でDeck先頭から補充する
4. `SetInitialCard` 自体はPRNGを進めない

したがって、開幕固定カードが1枚あるN枚デッキでも初回シャッフルは
`N-1` 回乱数を消費します。以前の「IsInitialを除いたカードだけをシャッフルして
先頭へ挿入する」モデルは使用しません。

seed逆算では、画面上の開幕順からは `IsInitial` が元のシャッフル済みDeckの
どの位置に存在したか見えないため、その隠れ位置を列挙してFisher–Yates条件へ
戻します。同じ先頭乱数区間を共有する候補はWorker側でまとめて走査します。

墓地からDeckへ戻る通常の再循環では、現在のPRNG stateを引き継いでGraveを
シャッフルしてからDeckへ移します。カード使用済みなら使用カードが先にGraveへ入り、
ターン終了時は残りHandをindex順に処理します。通常カードはその順序を保ってGraveへ、
`IsEndTurnLost` のカードはLostへ分離されるため、再シャッフル対象には入りません。

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
python3 -m unittest discover -s tests -p 'test_*.py'
node --test tests/*.mjs
```

現行マスタ一式に対する試験効果・Pアイテムの網羅確認は、YAMLを置いた
ディレクトリを指定して実行できます。

```bash
node tools/audit_exam_effect_coverage.mjs /path/to/master-data
```

seed `0x12345678` の山札 `A..H` が `GFECBHDA` になる固定ベクトルをPython / JavaScriptで確認しています。`test_v3.mjs` では観測順からのseed条件復元、重複カード、Monte Carlo集計も検査します。
