# PR #99：実機キャプチャ36試合の回帰検証（2026-10-14）

検証コミット：`e4c545a98353d66406dbf616828b6ce947361ec5`（PR #99）。

- キャプチャ（16）〜（19）計36試合・380ターン、ユーザー確認済みカスタマイズ補完を付与。
- 固定マスターデータ：`vertesan/gakumasu-diff@1f07db111068a65defc13bd44e3e8957ca4baca4`。
- 再実行：`node tools/compare_contest_capture.mjs capture.json result.json catalog.json --observed-customs-provisional --customization-overrides user_confirmed_customization_supplement.json`。
- 4個の比較JSONは、前回PR #96で検証済みの同条件のJSONと**バイト単位で一致**。

| Capture | 試合数 | ターン | ステップ | 比較器検出差異なし | 出力SHA-256冒頭 |
|---|---:|---:|---:|---:|---|
| 16 | 9 | 95 | 53 | 9 | `d25d787824a2` |
| 17 | 9 | 95 | 55 | 9 | `2c24353a217c` |
| 18 | 9 | 95 | 54 | 9 | `be5b767c7331` |
| 19 | 9 | 95 | 54 | 9 | `306d244eb02d` |
| **合計** | **36** | **380** | **216** | **36** | |

**厳密な限界**：比較器の判定は全て`partial-match`。未取得のカードカスタマイズ・全内部状態・カード選択自体の独立検証の不足と、暫定公開マスターのバージョン一致未確認は継続する。今回追加した15個のExecutorが実機キャプチャ内のすべてのケースで使われているわけでもない。差異0は既存36試合の回帰がなかったことを示すもので、未知の31効果の完全実装を示さない。
