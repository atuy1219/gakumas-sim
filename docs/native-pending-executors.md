# 未実装Executor 23種類のELF解析・実装トラッカー

対象：`gakumas_analysis(1).elf` Build ID `77fda4e2a21f23954e2349b83fc113ede408f70b`。

## 方針

- 登録済み **161クラス** のうち計算・コマンド動作が接続されたものは **138種類**、未実装は **23種類**。
- ここでのRVAは**シンボル特定済み**の意味であり、挙動を復元できたという意味ではない。
- 各クラスでELFのパラメータ順・呼出し先・戻り値・状態差分・発動予約・乱数消費を解読してから、既存JSの状態APIに実装する。
- テストは独立のELF定数ベクトル・効果ごとの境界ケース・該当する実機キャプチャとの差分で行う。既存36試合に登場しない効果の一致を主張しない。
- 暫定で既存効果へ無理に委譲したり、対象なしを成功扱いしたりしない。

## 残りの実装対象

| 未実装クラス | ELF RVA | 解析分類 |
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

## 次に解析すべき関数

1. **コマンド／発動予約**：`ChainEffect*`、`EffectTimerEndTurn`、`StatusEnchant*Add` — 通常の即時計算に置き換えられない。
2. **山札移動と乱数**：`CardShuffleDeckGrave` (`0x804BD24`) → `ExamCardMoveController.ShuffleDeckGrave @ 0x827E9CC`、`CardShuffleDeckLost` (`0x804BD4C`) → `ShuffleDeckLost @ 0x827F440`。委譲先の移動先・コマンドログ・乱数消費まで解析。
3. **ステータス効果の導入と期限**：`*Cancellable`、`StanceLock*`、`*Restriction`、`BuffConsumptionDown` — 加算するだけでなく、いつ消費・解除されるかを特定。
4. **検索枚数と計算精度**：`*PerSearchCount`、`LessonDepend*` — カード検索の対象範囲、`FloatFromPermil`、丸め・連続ヒットを確認。

更新時はこの一覧の未実装行を減らし、`docs/native-executor-coverage.md` と `tests/test_all_native_executors.mjs` の件数を合わせる。
