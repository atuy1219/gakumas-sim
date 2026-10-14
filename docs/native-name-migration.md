# IL2CPP 実機名称への移行（互換レイヤー）

対象: `gakumas_analysis(1).elf` / AArch64 / IL2CPP metadata v31  
Build ID: `77fda4e2a21f23954e2349b83fc113ede408f70b`

## 設計方針

シミュレーションの内部演算から実機クラス名・フィールド名を使用する。
一方、既存の `state.exam`、`state.hand` などは UI、キャプチャ比較、
JSON バックアップ、過去のテストから参照されるため互換性を維持する。

`web/native_exam_context.js` はコピーではなくアクセサによる **ライブビュー** を返す。
したがって、旧名で更新された値も実機名で即座に読め、実機名での代入も旧状態に反映される。
ビューは WeakMap にキャッシュされ、シミュレーターの状態オブジェクトや保存JSONには追加されない。

## 確認済みフィールド

| IL2CPP型 | 実機の名前 | 実機のオフセット | 現行シミュレーター |
|---|---|---:|---|
| ExamParameterModel | Seed | 0x10 | state.seed |
| ExamParameterModel | RandomState (get only) | 0x77C | state.randomState |
| ExamParameterModel | CurrentTurn | 0x144 | state.turn |
| ExamParameterModel | Stamina | 0x1CC | state.exam.stamina |
| ExamParameterModel | MaxStamina | 0x1E8 | state.exam.maxStamina |
| ExamParameterModel | JudgeParameter (get only) | 0x220 | state.exam.parameter |
| ExamParameterModel | Block | 0x248 | state.exam.block |
| ExamParameterModel | TurnCardPlayCount | 0x2D0 | state.exam.turnCardPlayCount |
| ExamParameterModel | ExamCardPlayCount | 0x2EC | state.exam.cardPlayCount |
| ExamEffectCalculateContext | HandList | 0x20 | state.hand |
| ExamEffectCalculateContext | DeckList | 0x28 | state.deck |
| ExamEffectCalculateContext | GraveList | 0x30 | state.discard |
| ExamEffectCalculateContext | LostList | 0x38 | state.lost |
| ExamEffectCalculateContext | HoldList | 0x40 | state.hold |
| ExamEffectCalculateContext | PlayingCard | 0x78 | state.playingCard |
| ExamEffectCalculateContext | RemainCanPlayCardCount | 0x90 | state.playsRemaining |

`ExamEffectCalculateContext.ExamParameter` は同一の
`ExamParameterModel` ビューを返す。`ExamParameterModel.StatusEffectCollection` は
`GetReview`、`GetAggressive`、`GetFullPowerPoint`、
`GetLessonBuff`、`GetParameterBuffTurn` の実機名を公開する。

## 修正済み経路

- ターン開始: CurrentTurn / TurnCardPlayCount / RemainCanPlayCardCount
- ドロー: HandList / DeckList
- カード使用: HandList / DeckList / GraveList / LostList / HoldList、体力・元気・カード使用数
- ターン終了: 手札リセット時の HandList / GraveList / LostList、終了時の JudgeParameter
- テスト: 旧名と実機名の双方向同期、使用回数、ドローと墓地、JSONに実機別名が漏れないこと

## 意図的に未移行

ELFに名称があってもシミュレーターの同名データと **意味が一致する保証がない** 項目
（例: IsTurnCardPlayEnd、実機の RemainTurn、Phase、効果コマンドスタック）は
推測で結び付けていない。RVAの一致は挙動の一致を保証しない。

この段階は名称とモデル境界の統一であり、すべてのExecutorの呼び出し順を
実機通りに変更するものではない。残るモジュールの移行もこの規則で段階的に行う。

## Executor と Python モデルの名称移行

- `web/native_effect_executor_registry.js`: 添付ELFから検証した **161種類** の具体的な `*EffectExecutor` クラス名を登録する。
  `ProduceExamEffectType_*` / 解析済みの `parsed.kind` を実機クラスへ解決し、曖昧・未確認の名前は `null` を返す。
  これは **実行順の再実装ではなくシンボル名対応表** である。
- `web/exam_effects.js`: 8種類の効果（Lesson / Block / Review / Aggressive / LessonBuff /
  ParameterBuff / Draw / ExtraTurn）を、実機名称を持つ独立した `ExecuteEffect` 実装へ分離。
  `applyParsedExamEffect()` の入口や効果計算の実行順・戻り値・丸め式は変えない。
- `exam_engine.py`: 8種類の処理を `LessonEffectExecutor` など個別クラスの `ExecuteEffect()`
  へ移設し、`ExamEffectResolver` はクラスを選択して実行するだけの役割に変更。
  `ExamParameterModel.JudgeParameter`、`CurrentTurn`、`StatusEffectCollection`、
  `ExamEffectCalculateContext.ExamParameter`、`HandList` などの **実機名ライブプロパティ** と、
  `ExamCardMoveController.DrawCard` / `ResetHand` などのメソッド別名を追加。
  既存のsnake_caseコンストラクタ・dataclassフィールドは残す。

### 未移行・フェーズ管理

名称統一はまだ全経路では完了していない。その他のMaster Effectの大きなswitch、
対応する各コマンドクラス、AI/保存/履歴インターフェース、Pythonの未実装メンバーは、
実機メタデータにあることだけを理由に架空の実装を追加しない。

**内部の呼び出し順序・コマンドスタックの制御・効果発動のタイミングは、本名称統一フェーズでは変更しない。**
名称移行が完了し、旧形式の互換性と既存回帰テストが確認できた後に、独立したPRで実機の処理順を照合する。

テストは `tests/test_native_python_names.py`、`tests/test_native_effect_executor_names.mjs`、
`tests/test_native_exam_context.mjs`。JS 2テストはCIのWeb testsに追加済み、Pythonテストは unittest discover で実行する。
