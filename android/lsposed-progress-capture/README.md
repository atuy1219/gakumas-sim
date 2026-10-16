# Gakumas Capture

Android LSPosed module for passive game replay capture.

## Use

1. Enable the module for 学園アイドルマスター in LSPosed.
2. Open the app, then select **リプレイ → 取得を開始**.
3. Fully restart the game and play an audition replay.
4. In **記録**, select **状態** then **保存**.

Other modes: **Hook** (exam events, RNG, card movement), **開始診断**, **自己テスト**, **無効**.

## Compatibility

Only the current ELF Build ID `5ac77881a1242477b5bf6bd928ce8c1765a55f2f` enables replay and Hook capture. Unknown builds fail closed.

Replay capture hooks `ExamReplayContext.GetExamData` and `GetPlayLog`. Exports `ranking_replay_capture.jsonl`, with action types/selection indexes and available seed, into JSON. It does **not** yet reconstruct the complete runtime state or verify ranking origin.

The app uses one Activity with three tabs: 記録 / 診断 / 設定. UI uses native Views with Material 3-inspired dynamic color.

Hook activation requires game restart and may cause crashes; on-device testing is required. Logs are written to the game's private `files/gakumas-sim` folder. Do not commit extracted proprietary game binaries.
