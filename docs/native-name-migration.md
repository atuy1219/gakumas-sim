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
