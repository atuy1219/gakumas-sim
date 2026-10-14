# Native Executor実装状況

対象：`gakumas_analysis(1).elf` Build ID `77fda4e2a21f23954e2349b83fc113ede408f70b`。

登録161クラスのすべてにMasterまたはParsedの実行経路が接続済み。Master経路128、Parsed経路41（重複・非Nativeアダプタを除いて161種類）。明示的未接続Executorは0種類。

## 今回接続した最後の6種類

| クラス | ELF RVA | 動作 |
| --- | --- | --- |
| `ChainEffectExecutor` | `0x804BE8C` | Value1回の子コマンドを先頭挿入 |
| `ChainEffectPerPassedTurnEffectExecutor` | `0x804C044` | CurrentTurn回の先頭挿入 |
| `ChainEffectPerRemainTurnEffectExecutor` | `0x804C208` | RemainTurn回の先頭挿入 |
| `ExamPlayCardLimitPlayableValueAddEffectExecutor` | `0x804F82C` | 検索対象カードの完了後に1回を返す。全体回数／ターン内上限を独立管理 |
| `MoveGrowEffectEffectExecutor` | `0x805C358` | Search1が移動先、Search2が移動元。元の成長量から加算と減少を別々に丸める |
| `SearchPlayCardBuffConsumptionChangeEffectExecutor` | `0x80624B4` | 最短有限期限の該当状態1個を選び、バフコスト置換と回数消費 |

解析・テスト根拠：`docs/final-six-elf-validation.md`。

## 残る検証範囲

実装接続数が161/161でも、実機との全条件一致が確認できたわけではない。既存fixtureとELF由来の境界シナリオで回帰検証済み。新しい実機キャプチャや、未キャプチャ効果の全条件パリティは別途検証が必要。キャプチャ(16)〜(19)の36試合・380ターンを再実行済み。既存カスタム補完ありでは検出差異0、補完なしでは6試合に差異。PR #99の同条件再実行と4比較JSONすべてバイト単位で一致。詳細は `docs/pr100-capture36-recomparison.md`。

対応表・未対応リスト・`tests/test_all_native_executors.mjs`で件数と実体を一致させる。
