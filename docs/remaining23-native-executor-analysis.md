# ELF由来の未対応23 Executor：実装判断と検証可能性（2026-10-14）

> **更新（2026-10-14）:** この文書は「未対応23種類」時点の解析スナップショットです。PR #100に `HandHoldEffectExecutor` と `GetCardUpgradeEffectExecutor` を追加し、現在の実装登録数は **140/161**、未対応は **21種類** です。最新の対象は [native-pending-executors.md](native-pending-executors.md) を参照してください。下表に残る2行は履歴であり、現在の未実装数を表しません。新規の独立実機トレースは未取得のため、効果追加による完全一致は未検証です。

対象：ELF Build ID `77fda4e2a21f23954e2349b83fc113ede408f70b`、固定マスター `vertesan/gakumasu-diff@1f07db111068a65defc13bd44e3e8957ca4baca4`。

## 既存の回帰検証

- #97・#98・#99は順に `main` へマージ済み。#100が唯一の未マージ実装PR。
- #100で加えた `BlockAddDownRestriction` / `StaminaRecoverAdd` は独立テストを追加。既存Node.jsテスト43本はローカルで全通過。
- 補正付き36試合／380ターンについて、変更後の4つの比較JSONのSHA-256は既存の固定ベースラインと完全一致：
  - キャプチャ16：`d25d787824a23e8ca0e9`…
  - キャプチャ17：`2c24353a217cf60ddb78`…
  - キャプチャ18：`be5b767c733154605ece`…
  - キャプチャ19：`306d244eb02da6dbc8f6`…
- **注意**：固定マスターデータ中には下記23種類の `ProduceExamEffectType_...` に直接対応する効果レコードが0件。この36試合からこれら23種類の動作一致を確認することはできない。新効果の実機トレース、またはELFの委譲先のデータフロー復元が必要。
- 36試合はすべて比較器では `partial-match` 判定。状態全フィールド一致の証明ではない。

## 未実装23種類

| Executor | RVA | 要確認の実機動作 |
| --- | --- | --- |
| `AggressiveReduceCancellableEffectExecutor` | `0x8047228` | ステータス・寿命 |
| `CardShuffleDeckGraveEffectExecutor` | `0x804BD24` | カード移動／山札 |
| `CardShuffleDeckLostEffectExecutor` | `0x804BD4C` | カード移動／山札 |
| `ChainEffectExecutor` | `0x804BE8C` | 予約コマンド／継続効果 |
| `ChainEffectPerPassedTurnEffectExecutor` | `0x804C044` | 予約コマンド／継続効果 |
| `ChainEffectPerRemainTurnEffectExecutor` | `0x804C208` | 予約コマンド／継続効果 |
| `ClearDebuffEffectExecutor` | `0x804C314` | 個別解析 |
| `EffectTimerEndTurnEffectExecutor` | `0x804E150` | 予約コマンド／継続効果 |
| `ExamPlayCardLimitPlayableValueAddEffectExecutor` | `0x804F82C` | 個別解析 |
| `FullPowerPointReduceCancellableEffectExecutor` | `0x8052B00` | ステータス・寿命 |
| `GetCardUpgradeEffectExecutor` | `0x805320C` | ステータス・寿命 |
| `GrowEffectLessonAddAdditiveEffectExecutor` | `0x8054660` | ステータス・寿命 |
| `HandHoldEffectExecutor` | `0x8054E9C` | ステータス・寿命 |
| `LessonBuffReduceCancellableEffectExecutor` | `0x80572D8` | ステータス・寿命 |
| `LessonChangeSpecifyLessThanEffectExecutor` | `0x80578B0` | ステータス・寿命 |
| `LessonChangeSpecifyMoreThanEffectExecutor` | `0x8057C30` | ステータス・寿命 |
| `MoveGrowEffectEffectExecutor` | `0x805C358` | カード移動／山札 |
| `ParameterBuffReduceCancellableEffectExecutor` | `0x805EB48` | ステータス・寿命 |
| `ReviewReduceCancellableEffectExecutor` | `0x806162C` | ステータス・寿命 |
| `SearchPlayCardBuffConsumptionChangeEffectExecutor` | `0x80624B4` | 検索／対象枚数 |
| `StatusEnchantCountAddEffectExecutor` | `0x806559C` | 予約コマンド／継続効果 |
| `StatusEnchantTurnAddEffectExecutor` | `0x8066480` | 予約コマンド／継続効果 |
| `UpliftingEffectExecutor` | `0x8066F8C` | ステータス・寿命 |

## 再現性を落とさないための調査方針

- `TryReduce*`：`IsStatusEffectRestricted`に相当するキャンセル防止・状態の `UID`・`Turn`・属性を特定する。既存の数値を単純減算するだけでは`TryReduceReview/Aggressive/ParameterBuff/LessonBuff`の再現にならない。
- `CardShuffleDeckGrave/Lost`：`ExamCardMoveController.ShuffleDeckGrave@0x827E9CC`と`ShuffleDeckLost@0x827F440`、その非同期`MoveNext`を含めて、山札・捨札・除外への移動と乱数消費を追う。
- `ChainEffect*`・`EffectTimerEndTurn`：`CreatePlayEffectCommand`・`TriggerEffectStatusEffect`の登録順と`SpendCount`を検証し、即時評価への誤置換を避ける。
- `StatusEnchantCountAdd/TurnAdd`：対象のEnchant UID・カウント/ターンの期限・ステータス差分ログを再現する。
- `MoveGrowEffect`・`GetCardUpgrade`：元カード・対象カード・成長効果の所有関係、`ExamCardData.ReduceGrowEffect/AddGrowEffect`、既存の手札満杯・山札固定順との相互作用を追う。
- `LessonChangeSpecifyLessThan/MoreThan`：数値だけでなく参照条件、作用先の1ヒット値、float32丸めを解析する。
- 未対応は正しくエラー／診断イベントを記録し、実装済みカウントを増やさない。型名・関数RVAの確認は**機能実装の完了を意味しない**。

別のPRは作成せず、後続の実装・実機照合も#100へ集約する。
