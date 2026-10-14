# 未実装Executor 6種類のELF解析・実装トラッカー

対象：`gakumas_analysis(1).elf` Build ID `77fda4e2a21f23954e2349b83fc113ede408f70b`。

## 方針

- 登録済み **161クラス** のうち計算・コマンド動作が接続されたものは **155種類**、未実装は **6種類**。
- ここでのRVAは**シンボル特定済み**の意味であり、挙動を復元できたという意味ではない。
- 各クラスでELFのパラメータ順・呼出し先・戻り値・状態差分・発動予約・乱数消費を解読してから、既存JSの状態APIに実装する。
- テストは独立のELF定数ベクトル・効果ごとの境界ケース・該当する実機キャプチャとの差分で行う。既存36試合に登場しない効果の一致を主張しない。
- 暫定で既存効果へ無理に委譲したり、対象なしを成功扱いしたりしない。

## 残りの実装対象

| 未実装クラス | ELF RVA | 解析分類 |
| --- | --- | --- |
| `ChainEffectExecutor` | `0x804BE8C` | 予約コマンド／継続効果 |
| `ChainEffectPerPassedTurnEffectExecutor` | `0x804C044` | 予約コマンド／継続効果 |
| `ChainEffectPerRemainTurnEffectExecutor` | `0x804C208` | 予約コマンド／継続効果 |
| `ExamPlayCardLimitPlayableValueAddEffectExecutor` | `0x804F82C` | 個別解析 |
| `MoveGrowEffectEffectExecutor` | `0x805C358` | カード移動／山札 |
| `SearchPlayCardBuffConsumptionChangeEffectExecutor` | `0x80624B4` | 検索／対象枚数 |

## 残る委譲先と確認事項

- `ChainEffect*`: `ExamPlayCommand.CreatePlayEffectCommand @0x809AF80` を反復予約する。基本形はValue1回、経過形はCurrentTurn、残り形はRemainTurn回。子コマンドが兄弟・結果トリガーに対していつ実行されるか、複製されたTriggerContextをJSへ移す必要がある。
- `ExamPlayCardLimitPlayableValueAdd`: `TryAddPlayCardLimitPlayableValueAddStatus @0x807E028` と `UsePlayCardLimitPlayableValueAdd @0x807E360`。検索・カテゴリ・回数制限の組を保持し、実カードの可使用回数判定に接続する。
- `SearchPlayCardBuffConsumptionChange`: `TryAddSearchPlayCardBuffConsumptionChangeStatus @0x80718A8` と `UseSearchPlayCardBuffConsumptionChange @0x8071BA8`。カード対象検索とバフ消費値の変更・消費回数の境界を確認する。
- `MoveGrowEffect`: 対象2組の成長状態の移動範囲・複製/除去・カードの更新通知を確認する。

更新時は対応表・未対応リスト・`tests/test_all_native_executors.mjs`の件数を一致させる。
