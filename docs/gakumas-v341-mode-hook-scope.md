# Gakumas 3.4.1: audited user-mode hook scope

Static reverse engineering of user-supplied Gakumas APK bundle base.apk:
embedded encrypted metadata SHA-256 aaff4137984cbfbc58aeabe48c0d3abf4d586923c2355e43c5908dd890ca29dc matches the previously deobfuscated 31-series IL2CPP metadata exactly. ARM64 BL callsite xrefs below were read from the separately provided ELF with Build ID 77fda4e2a21f23954e2349b83fc113ede408f70b. The 7z arm64 split .so itself has not yet been independently hash-matched to that file; all addresses remain exact-build-only.

The requested capture scope is **only**:
- **Audition**, including top-ranked player's recommended replays. The normal on-screen transition is `AuditionBattleStartScreenPresenter.MoveExamBattleAsync` 0x071B5E78; recommended ranking selection `ProducerRankingRecommendReplayScreenPresenter.OnReplayClicked` 0x06BBCA50 makes a direct BL at 0x06BBCBAC to `ExamReplayUtility.StartAuditionReplayFromProduceHistoryAsync` 0x08135128. Produce-history replay also calls the same method from 0x06ACA264. Later `ExamParameterModel.get_ExamType` (Audition=1) and `get_IsReplay` are required for live validation.
- **Contest**, including its own rehearsal. Relevant `ContestProgressData.get_IsRehearsal` 0x06CE44A0, `get_IsHistory` 0x06CEB3C8, `get_PlayType` 0x06CEB3C0, `IsReplay` 0x06CEC2D0, start 0x06CEC3CC, end 0x06CEC3D8. `ContestUtility.CalculateContestResultLogListAsync` generated MoveNext BL at 0x07F0BEEC targets `ContestUtility.ExecuteContestExamBattleAsync` 0x07F09074; the per-player generated runner BL at 0x07F0B14C targets `ExamBattleAutoPlaySimulator.ExecuteAsync` 0x07EFCB6C. `ContestUtility` is also reused by **Angya**, so it cannot alone identify a Contest event. `TourExamUtility.StartExamRehearsalAsync` is **not** evidence of Contest rehearsal; `CompetitionRehearsal*` is another mode.
- **Tower / Dol-do**: `TowerBattleConfirmScreenPresenter.BattleStartAsync` 0x06EAF768 generated MoveNext directly calls `TowerUtility.StartTowerExamAsync` 0x06EF94D8 (BL 0x06EB258C); `ExamTransitionParam.CreateTowerTransitionParam` 0x081B2980 calls `ExamData.CreateTowerExamData` 0x08087E50. Runtime ExamType=5 confirms Tower.

## Why old unconditional StartExam capture is incorrect

`ExamSequence.StartExam` token 0x060050A9, RVA 0x080A5354 is called directly by `ExamScreenPresenter.GetCardForecast` (BL 0x0813D470), `IsGimmickTriggerForecastValid` (0x0813DE28), `ExamFixedActionSequenceSimulator` generated state-machine (0x0811E840), and `ExamPlayLogSimulator` generated state-machine (0x0813211C), plus normal UI initialization. It is **not an exclusive new user battle** event. It can create false sessions and collide with the previous single global g_exam_parameter state under simultaneous participants/forecast calculations. This is a proven scope bug; its causal role in the SIGSEGV is NOT established.

## New scoped observation experiment (native hookmask 128)

For pinned Build ID only, a separate `ExamSequence.SetUpExam` wrapper (token 0x060050A4, RVA 0x080A1E90, managed signature: instance void with one managed argument) invokes the original without inspecting managed objects. A caller return-RVA whitelist only records:
- 0x07EFD3B4 => per-participant contest-auto calculation
- 0x08132110 => replay play-log processing
- Eleven audited caller returns from `ExamScreenPresenter.InitializeAsync` => interactive exam screen candidates.

The fixed-action simulator return 0x0811E834 is deliberately excluded. No new session, random/card memory read, replay assumption, or score parity is inferred by this probe. Unknown caller addresses are excluded; a maximum 128 trace events are written to `exam_entry_probes.jsonl`. Hook-install status goes to `exam_entry_probe_status.json`. The reporter exports both under an explicit opt-in mask 128, while keeping native hooks **disabled by default** (mask 0). Legacy mask 1..127 is diagnostic only and marked unsafe due to the proven StartExam scope bug and prior SIGSEGV.

This experiment does not finish all requested functional work: correct real-mode classification, per-ExamSequence keyed sessions, effect/RNG/score capture, and successful injection/stability still require game-process testing. Async UniTask-returning methods must not be detoured using guessed void function signatures; ARM64 hidden return-pointer ABIs must be established before hooking them.
