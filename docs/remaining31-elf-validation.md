# 未対応31種類のELF解析・JS実装：現時点の検証記録

対象 ELF Build ID `77fda4e2a21f23954e2349b83fc113ede408f70b`。

## 実装済み（6種類 / 31種類）

| Executor | ELF RVA | JSで再現した処理 |
| --- | --- | --- |
| `ReviewAdditiveFixEffectExecutor` | `0x805f874` | `TryAddReviewAdditiveFixStatus(Value1,Value2)` と期限付き固定加算 |
| `ParameterBuffAdditiveFixEffectExecutor` | `0x805d7b8` | `TryAddParameterBuffAdditiveFixStatus(Value1,Value2)` と期限付き固定加算 |
| `FullPowerPointAdditiveFixEffectExecutor` | `0x8051df0` | `TryAddFullPowerPointAdditiveFixStatus(Value1,Value2)` と期限付き固定加算 |
| `ParameterBuffPerSearchCountEffectExecutor` | `0x805e688` | `Value1+ceil(FloatFromPermil(Value2)×検索枚数)`、好調付与 |
| `LessonDependEnthusiasticGetSumEffectExecutor` | `0x8058d88` | `EnthusiasticGetSumCount` (offset `0x3d0`) を参照し、`Count`回のスコア計算 |
| `StaminaReduceChangeEffectExecutor` | `0x8064178` | `Value1/Turn` に基づく体力減少変更状態を期限付きで保持し、既存ダメージ計算へ接続 |

Executor総数161、JSの実装に接続されたクラス136、未対応25。追加テストは `tests/test_elf_fixed_additive_executors.mjs`、`tests/test_elf_parameter_buff_per_search.mjs`、`tests/test_elf_enthusiastic_gain_sum.mjs`、`tests/test_elf_stamina_reduce_change.mjs`。CI成功。

## 原本36試合・380ターンの回帰

PR #100の最新JS実装（StaminaReduceChange追加後）で、キャプチャ（16）〜（19）、同じ固定マスター `vertesan/gakumasu-diff@1f07db111068a65defc13bd44e3e8957ca4baca4` とカスタマイズ補完を使用してローカル再実行した。

| Capture | 試合数 | ターン数 | 比較器status | 以前のPR #99の比較JSONとSHA-256一致 |
| --- | ---: | ---: | --- | --- |
| 16 | 9 | 95 | `partial-match` | `d25d787824a23e8c...` |
| 17 | 9 | 95 | `partial-match` | `2c24353a217cf60d...` |
| 18 | 9 | 95 | `partial-match` | `be5b767c7331546...` |
| 19 | 9 | 95 | `partial-match` | `306d244eb02da6d...` |

**4ファイルすべて完全同一のバイト列**で、元から検出差異が0だった36試合の結果を維持。新効果を含む実機キャプチャが必ずしも存在するわけではなく、これにより新効果の完全一致を証明したわけではない。

## 未実装25種類と分析上の注意

`docs/native-pending-executors.md` に関数RVA・分類を記録している。未実装とした理由は主に以下。

- `TryReduceReview / TryReduceAggressive / TryReduceParameterBuff / TryReduceLessonBuff` は各 `Consume*` と**別経路**。ELF上で属性別の取り消し可能性チェックが先行しており、無条件減算に置き換えられない。
- `CardShuffleDeckGrave/Lost` は `ExamCardMoveController.ShuffleDeckGrave/Lost` を直接呼び、委譲先には非同期経路がある。単純に山札配列を乱数シャッフルするだけでは乱数・カード移動通知が一致すると言えない。
- `ChainEffect*` は `CreatePlayEffectCommand` の**コマンド生成**が関係する。即時に子効果を実行すると予約・入れ子の順序が変わる可能性がある。
- `ClearDebuff` の呼出し先は `ExamStatusEffectCollection.RemoveStatusEffect`（`0x80694f8`）。すべてのデバフを一括削除すると決めつけない。
- `LessonChangeSpecifyLessThan/MoreThan` は実機で値・ターンのほか参照オブジェクトを渡すため、単純な閾値の上書きだけで再現できない。
- `StatusEnchantCountAdd/TurnAdd` は識別子付きの登録済みStatusEnchantに作用する。指定対象・更新通知の再現が未完。

推測による「未対応0」の数合わせは実施していない。追加ELF解析と独立した実機トレースが必要な残りの処理は未対応のまま維持する。
