# Work引き継ぎ — 学園アイドルマスター3.4.1 / Native Capture / 2026-10-11

> **最新確認版: v1.5.5 / versionCode 28。Root参照・モジュール自己テスト・SetUpExamの9回実行をユーザー実機記録で確認。** §11/§12が以下の旧版動作説明より優先。Native自己テストはユーザー実機記録で成功を確認。SetUpExamの動的呼出は確認済み。モード別分類・乱数/カード/効果/スコア取得の実測確認は未完了。PRはDraftを維持する。

> この資料は、新しいChatGPT Workセッションが過去のチャットを参照できなくても継続できるように作成したもの。事実（static verified / on-device observed）、仮説、未検証を区別する。APKのビルド成功を実機機能の完成と混同しないこと。

## 0. リポジトリと現在の状態

- リポジトリ: https://github.com/atuy1219/gakumas-sim
- 作業ブランチ: feature/auto-native-diagnostic
- Draft PR: https://github.com/atuy1219/gakumas-sim/pull/90 （未マージ、実機未検証）
- 最終配布バージョン: Gakumas Progress Capture **v1.5.1**（Android Manifest versionCode 24）
- CI成功確認: run IDs 38104323203 (CI)、38104323209 (Build LSPosed diagnostic APK)、38104323219 (Build LSPosed progress capture APK)。いずれも成功。これらは自動テスト・ビルドであり実機テストではない。
- GitHub Actionsの実機用成果物: https://github.com/atuy1219/gakumas-sim/actions/runs/38104323209 （artifact名: gakumas-progress-capture-v1.5.1）。既存のChatGPT会話には対応するZIP/APKも添付済み。
- CIビルドは毎回新しいdebug署名鍵を生成するため、APK更新時にアンインストールを要することがあり、その場合LSPosedスコープ設定を再確認する。

## 1. ユーザーが最終的に求める機能（厳密な対象範囲）

実機と学マスシミュレータの動作・計算差を比較するため、ゲーム内の次の経路を自動で記録する。
1. オーディション（通常プレイ、および「上位陣のリプレイ／おすすめリプレイ」を含む）
2. コンテスト（通常対戦、リハーサルを含む。プレイヤーごとの並行・逐次計算に注意）
3. ドル道（Tower）

記録対象: 開始・終了の正確な区切り、モード、乱数系列と状態、カードの手札・山札・墓地・使用、Pアイテム、ターン、効果・スコアと実機/シミュレータとの差分。ユーザーは可能な限り端末だけで記録・JSON出力を望む（ADB操作は最小限）。

対象外と区別が必要: プレイ画面のカード予測、ギミック検証、固定行動シミュレーション、Tourリハーサル、Competitionリハーサル、Angyaなど他モードを本試験・コンテストと誤認しないこと。

## 2. ユーザー提供のゲームAPKと静的解析（確認済み）

- ユーザー提供: com.bandainamcoent.idolmaster_gakuen-3Wb8ddngkQFc84BXt4nkvg==.7z（元の会話添付。新しいWorkセッションから見えない場合は再添付してもらう）
- 7z内のbase.apkに含まれる難読化global-metadata.datは以前提供されたファイルのSHA-256と一致。
  - 暗号化前のファイルのSHA-256: aaff4137984cbfbc58aeabe48c0d3abf4d586923c2355e43c5908dd890ca29dc
  - 復号済みglobal-metadata.dat SHA-256: 4370094ac9c8949eeb8a2b57c17424fe85d0e7a29ab2de0a71510b2458740a38
  - IL2CPP metadata version 31、128バイト周期のXOR難読化。復号スクリプト: tools/decrypt_gakumas_metadata.py
- ARM64 libil2cpp.so Build ID: 77fda4e2a21f23954e2349b83fc113ede408f70b。
  - ELFの以前の提供ファイルは解析済み。ただし、7z内のsplit APKが持つARM64ライブラリとの**ハッシュ一致は未完了**。同じBuild IDの検証を各フックに必須とする。
- 検証済みのコード位置、トークン、クラス、BL direct caller xrefは以下のリポジトリファイルにまとめた。
  - docs/gakumas-v341-mode-hook-scope.md
  - tools/gakumas_v341_user_mode_entrypoints.json
  - tools/gakumas_v341_lifecycle_rvas.json
  - docs/gakumas-v3.4.1-lifecycle-analysis.md
  - tools/inspect_gakumas_metadata.py

### 既存フックの設計ミス（静的解析で確認）

ExamSequence.StartExam（token 0x060050A9 / RVA 0x080A5354）は実際の試験開始だけでなく、ExamScreenPresenter.GetCardForecast、IsGimmickTriggerForecastValid、ExamFixedActionSequenceSimulator、ExamPlayLogSimulatorなどからも呼び出される。したがって「StartExam呼出し＝ユーザーが新試験を開始」は**誤り**。従来の単一グローバルg_exam_parameterによる状態管理は、予測やコンテスト複数参加者の混線も起こしうる。これがv1.4.0 SIGSEGVを直接引き起こしたかどうかは未確定。

### モード別の有力経路（静的解析で確定した参照、動的実行は未検証）

- 通常オーディション: AuditionBattleStartScreenPresenter.MoveExamBattleAsync / RVA 0x071B5E78。ExamType=Audition(1)。
- 上位陣リプレイ: ProducerRankingRecommendReplayScreenPresenter.OnReplayClicked / RVA 0x06BBCA50 の直接BL→ExamReplayUtility.StartAuditionReplayFromProduceHistoryAsync / RVA 0x08135128。通常オーディションと区別するにはIsReplay・リプレイの選択元が必要。
- コンテスト: ContestUtility.ExecuteContestExamBattleAsync / RVA 0x07F09074 → ExamBattleAutoPlaySimulator.ExecuteAsync / RVA 0x07EFCB6C。ContestProgressData.StartExamBattle / RVA 0x06CEC3CC、EndExamBattle / RVA 0x06CEC3D8、get_IsRehearsal / RVA 0x06CE44A0、get_IsHistory / 0x06CEB3C8、get_PlayType / 0x06CEB3C0。ExamType=Contest(2)。ContestUtilityはAngyaからも利用されるため、名前だけで識別しない。
- ドル道: TowerBattleConfirmScreenPresenter.BattleStartAsync / RVA 0x06EAF768 → TowerUtility.StartTowerExamAsync / RVA 0x06EF94D8。ExamData.CreateTowerExamData / RVA 0x08087E50。ExamType=Tower(5)。
- ExamSequence.SetUpExam / token 0x060050A4 / RVA 0x080A1E90 はモード間で共有される。呼び出し元RVAによって一部が識別可能。返り先0x07EFD3B4はコンテスト自動計算、0x08132110はプレイログのリプレイ、0x0811E834は内部固定行動シミュレータ（除外）。オーディション通常の実機UI初期化候補も複数。これだけでは最終モード確定を保証しない。
- UniTaskなどを返す非同期メソッドは、ネイティブABI（隠れた戻り値ポインタ等）が十分に特定できるまで、void署名と決めつけて直接detourしない。

## 3. 既報クラッシュと原因分析（注意）

- v1.4.0を入れ、コンテスト挑戦→実際の計算中にゲームがクラッシュ。
- tombstone: 2026-10-11 02:39:46 JST、ゲームPID 5806、IL2CPP Threadpool、SIGSEGV / SEGV_MAPERR、fault addr 0x203d2132。
- libil2cpp.so + 0x06397D8C、ldrb w8,[x23,#0x132]、x23=0x203D2000 という不正ポインタ参照。スタックにはExamSequence.StartExamの下流経路がある。
- **静的に見つかった設計ミスは重大だが、このtombstoneから犯人フックを特定したわけではない**。フックトランポリン/ABI、状態変数汚染、別LSPosedモジュール、ゲーム側処理も検証対象。
- v1.4.1ではマスク127（全部を要求）でクラッシュしないが、全診断ファイル未生成だった。マスク指定＝設置成功ではなく、この時点でフック有効だったとは言えない。

## 4. 最新の実機証拠（2026-10-11 11:06 JSTの診断スクリーンショット）

ユーザーが提示したv1.5.0の学マス実機診断画面の具体値:
- Root UID: 0（KernelSU経由のroot取得成功）
- ゲームPID: 7508
- 設定済みフックマスク: 128
- ゲーム内Nativeライブラリ: no （/proc/PID/mapsで見つからないとの表示）
- IL2CPPライブラリ: yes
- 保存先ディレクトリ: exists
- **保存先所有者: 0:0 755** （root:root、学マスUIDは書き込み不可）
- 9種類の対象ファイルすべて未生成。bootstrap_status.json、capture_status.json、exam_entry_probe_status.jsonなども存在しない。
- しかしゲームPID 7508と一致するGakumasCaptureログには「native-library-loaded」がある。つまりJavaのSystem.loadLibraryが成功したという情報があり、nativeLibraryMapped=noと矛盾。**「LSPosed未注入」と断定しないこと**。JNI_OnLoad、native_init callback、実際の/proc/maps判定、ロードされたプロセスとライブラリ経路を追加検証。
- 主要な具体的原因: Rootでmkdirして生成した診断ディレクトリ0:0 755は学マスアプリの書き込みを拒否。さらにroot所有の0600 native_hookmask.txtなら、画面で128と見えても学マスNative側はファイルを読めず、内部設定0で起動した可能性がある。

### v1.5.1の修正（コード反映済み、GitHub Actions通過、実機動作は未確認）

- 診断アプリに「診断ファイル保存先の権限を修復」ボタンと確認画面を追加。
- game/filesのUID/GIDをstatで取得し、**診断専用ディレクトリ** game/files/gakumas-sim に限定してchown、chmod 0700、maskファイルは0600、restorecon。基本的なsymlink防御とUID>=10000検証あり。ゲームセーブ領域全体をchownしない。
- **修復時、設定マスクを0に戻す**。理由: それまで読めなかった128が修復によって突然有効になり、新規クラッシュを誘発するのを防ぐ。実験を有効化する場合は後から明示的に128を選ぶ。
- JNI_OnLoad / JNI_OnUnload / native_init entered, accepted, rejected のlogcatタグGakumasCaptureの診断を追加。ファイルが生成できない状態でも進捗が分かるはず。
- 本家ログフックは原則変更せず、最新の静的解析に基づく限定SetUpExam呼び出し元プローブは**マスク128の明示的選択のみ**。0は安全モード。旧1〜127は範囲が広く非推奨。
- Java実装: android/lsposed-progress-capture/src/main/java/dev/atuy1219/gakumas/progresscapture/{ModuleEntry.java,DiagnosticActivity.java}
- Native実装: android/lsposed-progress-capture/src/main/cpp/progress_capture.cpp
- ビルド: android/lsposed-progress-capture/build-apk.sh
- 最新APKはGitHub Actionsのv1.5.1 artifactを参照する。**自動ビルド成功だけで実機正常動作とは言わない**。

## 5. Workへの次の具体的タスクと完了条件（優先順位順）

1. **ロード／権限障害の解消を先に完結する。** v1.5.1で修復ボタンを使用し、学マスを完全終了→起動。ゲームUIDでディレクトリが所有されるか確認。Nativeフック無効のmask0でbootstrap_status.jsonとcapture_status.jsonの生成を確認。もし未生成ならGakumasCaptureログのJNI_OnLoad/native_init各段階、プロセス名・PID、/proc/maps、SELinux AVC denialを調査。ルート・モジュール読み込み・Xposed native-init callbackのどこが故障しているか特定して実際に直す。ユーザーへデバッグのための具体的で短い依頼を出す。
2. **静的分析の完全性検証。** 7z中のsplit APK内 libil2cpp.so と従来解析SOのハッシュ／Build ID一致を実施。IL2CPP v31 metadata table、Assembly-CSharp.dllのcodegen pointers/relocations、Arm64 BL xrefsを独立に再照合。非同期関数のABI、IL2CPP instance/static methodの実際の引数・リターンの扱い、method infoのパラメータを確定。オフライン解析結果と自動検証スクリプトをリポジトリに保存。
3. **フック位置を根本的に設計し直す。** StartExam単体は使用せず、UI/モード固有の入口＋受信データの実際のExamType/IsReplay/IsRehearsalで三種類を厳密に分類。ログを各ExamSequenceインスタンス、Contest参加者、リプレイ、試行ごとに分離し、内部forecastを明示的に除外。試験を変化させないread-only instrumentationで、複数同時呼出しと異常終了に対応。コンテストリハーサルをTour/Competitionと混同しない。
4. **最小介入の実機検証。** mask0で起動安定を確認→明示的にmask128のSetUpExam呼出元観測を少数実行し、生成されたentry_probe_status.jsonとentry_probes.jsonlが期待するRVA/モードに一致するか検証。不明callerは無理に分類しない。フックが原因のSIGSEGV再発ならtombstoneとモジュールログから具体的にABI/トランポリンを修復。
5. **目的のログ取得へ拡張。** モード確定後、RNG、カード移動、効果、Pアイテム、ターン、得点の実際の遷移を観測し、シミュレータのJSONと時系列比較。ステージ・デッキ・パラメータ・seedの特定と1ステップ差分報告が必要。単なる入口検知ではユーザー要件未達。
6. **完成判定。** オーディション通常・上位陣リプレイ・コンテスト通常・コンテストリハーサル・ドル道の各経路で、誤検知なし、正しい開始・終了、ログ取得、安定稼働、再現可能な比較出力を実機で確認。各ケースの根拠を残し、GitHub CI/NDKとAPKの署名を安定化。要件達成までPRはdraftのまま。

## 6. Workの進行上の注意

- WorkではGitHubコネクタから直接 feature/auto-native-diagnostic ブランチとDraft PR #90を読み、変更は原則そのブランチにコミット。PRのmainブランチへのマージはユーザー承認後。
- Workがこの会話の添付ファイルを参照できない場合、ユーザーに元のAPK .7z とlibil2cpp.soを再添付するよう依頼。**他のAPKバージョンに旧RVAを流用しない。**
- ユーザーはKernelSU Next、NeoZygisk、LSPosed利用のAndroid16 / OnePlus 13端末でテストしている。必要以上のadb手順を要求せず、アプリ内診断を優先。
- 二次配布を避けるため、ユーザーがアップロードした元ゲームAPK、ELF、復号済みmetadataの巨大バイナリを公開GitHubにコミットしない。コード・ハッシュ・検証スクリプト・手元の解析結果に限定。
- 不確実なことは「検証済み」「推測」「未検証」を明示し、途中で終了する場合はどこまで作業したか・次に必要な検証をユーザーへ伝える。無言で完了を宣言しない。

## 7. Workへの最初の指示

この文書とDraft PR #90から作業を再開し、まず現行v1.5.1の保存先権限修復・Native初期化の確実性を監査して、実機でログが記録できる状態へ進める。次に添付の学マス3.4.1 APKに基づき、オーディション（ランキングリプレイを含む）・コンテスト（リハーサルを含む）・ドル道の各フック入口、ABI、モード分類と終了条件を正しく確立する。必要に応じてGitHubに修正をコミット、CIを実行、APKを作成する。プレイ中クラッシュや誤検知の可能性を軽視せず、ユーザーによるオンデバイス確認が必要な作業は明確に区切る。完成の基準は実機で三系統すべてのイベント／乱数／カード／スコアの忠実な取得と比較ができること。

## 8. Work再開後のチェックポイント: v1.5.2

### 修正と未完了の区別
- Nativeの書込失敗をpath/errno付きでlogcatに残す。JNI_OnLoadから独立にnative_bootstrap_status.jsonを出力し、native_initの不実行と保存先エラーを分離。JavaからJNI handshakeも行いbootstrapに実際の状態を保存する。
- Javaの固定1秒待ちを、対象パッケージのonPackageLoaded後のロードに置換。Native登録リストの配置は現行Vectorのソースで対応を確認できたため、その配置を原因と断定しない。
- 修復は固定診断ファイルと.tmpに限定。dangling symlink/hard linkを変更前に拒否。安全設定0への切替をディレクトリ所有者の変更より先に実行。Androidユーザーは診断アプリのUIDから決定。
- Native設定は0/128/256/384のみ受理する。旧1〜127、負数、不完全な数値等は0へfail closed。旧詳細キャプチャ・StartExam経路は到達不能にした。古い成果を稼働中の機能と誤認しない。
- マスク256はモジュール自身の純粋関数のみをフックする自己テスト。backupと置換関数の結果・呼出回数を検証しnative_self_test.jsonへstarted/passed/failedを保存。ゲーム関数の取得成功は意味しない。
- マスク128は既存の限定SetUpExamプローブ。実際の呼出数、保存成功数、PID/TID/sequence識別子を追加。モードを確定するmanagedメモリはまだ読まない。
- UIは現在のゲームPIDと一致する初期化・自己テストを表示する。古いPIDの結果を現行成功としない。PID再利用に対する開始時刻照合は未実装。
- ローカルビルドではignored .build/内の署名鍵を再利用する。新しいCI runner同士の署名の固定化は未達。
- GitHub更新前のローカル検証: Python 50テスト、tests/test_*.mjs全件、web JS構文、Native C++の-Wall/-Wextra/-Werror構文確認、実NDK r27c/SDK35/JDK17でAPKビルドとv2/v3署名検証を通過。Native/JNI公開シンボルも確認。これはAndroid実機・SELinux・LSPosed/Dobby実行の検証ではない。

### 静的に再検証済み
- 元7z/base.apk/ARM64 split APK/単体ELF/global-metadata.datを参照できた。APK内ELFと単体ELFはbyte-identical。
- ELF SHA-256: `90a0b71d96691e41641690e57983d600c3ef1301b971d114d6a1658591e9ea17`。Build ID、暗号化前後metadataのhashも§2と一致。
- **復号スクリプトは一致する実データで失敗していた。** 文字列テーブルに非UTF-8名 `80 A0`（table-relative 2922970）があり、テーブル全体をUTF-8とする検証を修正。metadata inspectorにも空method/parameter rangeのUINT32_MAX sentinel対応を追加。実ファイルで実行を確認。
- `tools/verify_gakumas_v341.py`でモード関連16メソッド、6モード入口BL、14 SetUpExam caller return、既存lifecycle mapを再照合。MetadataRegistration RVA `0x0e6ccd68`、registered types=145406、type definitions=45151を確認。
- SetUpExamはinstance/void/ExamData参照1引数。GetRandomIntの戻り値とmin/maxはint32。ExamParameterModel.get_IsReplayはbool、get_ExamTypeはExamType enum。getter本体は難読化値のhelperを呼ぶため、単純なfield loadと取り違えない。各native ABI全体の動的な妥当性は未検証。
- 非同期入口や汎用カードフックのgeneric value-type/隠れた戻り値/スタック引数は確定しきっていない。推測した署名でdetourしない。

### 次の実機確認（必要な入力）
1. v1.5.2を適用し、修復ボタン→完全終了・起動→mask0でbootstrap_status/capture_status/native_bootstrap_statusの生成を確認する。
2. mask256を明示選択し完全再起動。Native自己テストの結果と「LSPosed初期化ログ」を含む診断JSONをユーザーから取得する。この環境には端末接続がない。
3. 成功が実測された後、mask128を少数実行しcallsObserved/entry eventsを確認。その証拠を基に、モード固有UI＋ExamDataの種別/Replay、ContestProgressDataのRehearsal/Historyを厳密に結ぶ。
4. 詳細実装ではsequence/parameter/参加者/試行別に状態を分離し、予測と固定シミュレーションを除外。乱数・カード・効果・Pアイテム・得点の取得と比較は未完了。三系統の完成報告・PRマージは不可。

ユーザー追加方針: ローカルのコードチェック・テスト・APKビルドをGitHub更新より先に完了し、CIを試行錯誤の代用にしない。公開コミットはコード・必要な回帰テスト・再現スクリプト・要点の資料に絞る。元バイナリと巨大な途中ダンプはコミットしない。


## 9. v1.5.2実機報告への対応: v1.5.3

ユーザーからRoot UID 0、gamePid 24540、IL2CPP mapped=yes、moduleLibraryMapped=no、targetDataDir/captureDirectory=missing、hookMask=0、全対象ファイルMISSINGという一覧と「ファイル一覧の検査に失敗しました」を受領した。

### 確認できた不具合と修正
- 一覧シェルの末尾は候補パスに対する `[ -d "$d" ] && echo ...`。候補が見えない場合の最終終了コード1をrunRootが例外に変えていた。Root UID 0の成功出力が例外メッセージへ丸ごと入る原因をローカルで再現した。候補の欠落を正常分岐にし、root UIDとscanCompleteを明示検証する。
- 未参照パスを未生成と断定せずinaccessibleとして保存。設定ファイルの読取失敗を0と表示せずunreadable-or-missingとする。実機報告のhookMask=0は旧UIの代替値の可能性があり、実設定0の証拠ではない。起動中ゲームのUID/user、期待パス、lsの実エラーと所有者/SELinux context、Root/game/initのmount namespace、SELinux modeを保存する。
- 同一Androidユーザーのみ、Rootから通常filesが見えず `/proc/PID/root/data/user/USER/GAME/files` が見える場合は固定診断ファイルを読み取る。書込修復・mask変更には使用しない。ゲームが別userなら設定変更を拒否する。
- 一覧検査自体が失敗しても、以前の成功レポートを破棄しerrorレポートをエクスポートできる。初期化ログ取得ボタンではGakumasCaptureと固定診断名に一致するAVCだけを件数制限して採取する。AVC無しはSELinux拒否無しの証明ではない。
- ホストで本番Javaから生成したシェルを実行。候補なし・全ファイルなしで終了0、同一userの読取fallback、別userを選ばないこと、存在するファイルのstat、非root拒否、CRLF/pipe解析、固定パス以外の読取先拒否を検証した。chown/SELinux/Android UIの実動作をホストテストと混同しない。

### 次に必要な実機証拠
- この表示だけでは実際のファイル未生成、注入失敗、mount namespaceによる不可視、別Androidユーザー、SELinux拒否のどれかは確定できない。moduleLibraryMapped=noもAPK内ロードを否定できない。Nativeフック成功の実測証拠は依然ない。
- v1.5.3でmask0のまま学マスを起動し「LSPosed初期化ログを取得」→診断JSONを書き出す。preflightの具体値とJNI_OnLoad/native_init/Javaロードログを照合してから修復方法を決める。通常パスが不可視のままchmod/chownを広げない。
- Native自己テスト256、SetUpExam128、詳細モード分類と乱数・カード・効果・スコア取得は依然実機未確認。§8の静的照合結果を保持し、PRはDraftを維持する。

今回の公開前ローカル検証: Python 57テスト（一覧シェル実行とパス検証を含む）、SDK35/NDK r27c/JDK17でAPKビルド、v2/v3署名確認。前回配布v1.5.2と同じローカル署名鍵を使用。コード修正は検証完了後の1コミットにまとめた。公開後CIでもAPKビルドは成功したが、upload-artifactの旧v1.5.2ファイル指定が残っており保存ステップのみ失敗した。この見落としを補足修正し、2つのAPK workflowをバージョン非依存のglob指定に変更。既に完成したローカルAPKとsha256が各指定に一つずつ一致することを確認してから反映した。CIの手動再実行は行わない。Nativeコードとモード別フックの追加はこの更新では行っていない。


## 10. Termuxとの保存先可視性の差とコピー操作: v1.5.4

### 実機で新たに確認できたこと
- 12:09の診断スクショ: Root UID 0、gamePid 10441、gameUid 10537/user0、診断user0。Root namespace `mnt:[4026535922]`、ゲーム `mnt:[4026535892]`。通常パスと/proc/PID/root経路はNo such file、対象データも見えない。
- 一方、ユーザーのTermux `su -c ls -l /data/user/0/com.bandainamcoent.idolmaster_gakuen/files/gakumas-sim/` ではbootstrap_status(660 B)、capture_status(438 B)、native_bootstrap_status(464 B)が12:08更新で存在し、所有者はu0_a537（ゲームUIDと一致）。「ファイルが全て未生成」という仮説はこの証拠で棄却する。
- Native自己テストファイルとmaskファイルはこの一覧に見えない。古いlifecycle/runtime inventoryは02:39、カード/seed等は9月のmtime。これらを現在PIDの稼働証拠にしない。新しい初期化JSONの内容・PID照合はまだ取得できていない。

### 修正
- KernelSU Nextの一次ソースをローカルで照合: commit `cd4a6b468653fb9640caaf203c05e07609ba5da1`、[userspace/ksud/src/su.rs](https://github.com/KernelSU-Next/KernelSU-Next/blob/cd4a6b468653fb9640caaf203c05e07609ba5da1/userspace/ksud/src/su.rs)。`-M/--mount-master` はPID1のmount namespaceへの切替を要求する。実装は切替のエラーを無視するため、フラグ指定だけで実際の切替成功を保証しない。
- `su --help` が正常終了し、-M/--mount-master対応を広告する場合のみ `su -M -c` を使用。未対応なら通常suを使用し、その選択を診断に記録する。scan/read/logcat/config/repairは同じ選択に固定。失敗した書込を別namespaceで自動再試行しない。Root/init/gameのnamespace IDも表示・保存する。
- コピー操作を2つ追加: 「診断表示をコピー」は現在表示のテキスト、「初期化JSONをコピー」はpreflight・取得状態・bootstrap/capture/native bootstrap/self-test・初期化ログだけ。巨大なinventory/カード/traceはクリップボード用JSONから除外し、完全版は従来のファイル書き出しを保持する。コピー失敗は明示する。
- Nativeコード/マスク・ゲームフックは変更しない。SELinuxはEnforcingのまま。対象の所有者/リンク検証とユーザー一致ガードも保持する。

### 検証と次の入力
- 公開前にPython 60テスト、実SDK35/NDK r27c/JDK17でローカルAPKビルドと署名検証。su選択のキャッシュ、scan/read/config共通フラグ、未対応help、失敗したglobalコマンドの非再試行、実ProcessBuilderへの引数と出力をホストで検証。
- ホストのsuは模擬実装でありAndroidのsetns/KernelSU/Clipboard UIの実動作検証ではない。Termuxと診断アプリの差にnamespaceが関与する有力証拠はあるが、原因の具体的mountと修正の実機成功は未確定。
- v1.5.4で設定を変更せず、初期化ログ取得→「初期化JSONをコピー」をユーザーから受け取る。まず現在PIDのJNIロードとNative API登録を照合し、それから256自己テストへ進む。乱数・カード・効果・得点の各モード実機取得は未完了、PRはDraft維持。


## 11. v1.5.4の実機成功（ユーザー12:24報告）

- su -M -c、Root/init namespaceとも `mnt:[4026533108]`。保存先がexistsとなり、所有者10537:10537、mode700、SELinux Enforcingで初期化ファイルを取得できた。参照障害の解消を実機で確認した。
- Native記録PID11340/UID10537/observedAtUnixMs1791688963233。JNI loaded=true、Native API accepted=true、effectiveHookMask=256/read。SOの実際のdladdr経路はbase.apk!/lib/arm64-v8a/libgakumas_progress_capture.so。mapsにSO名が見えないだけで未注入と断定してはいけない根拠を実機で得た。
- self-test: installed/backupAvailable=true、replacementCalls=1、baseline=46、original=46、detoured=47、status=passed、scope=module-local-pure-function。**モジュール内の本物のNative detourとbackupの実行成功を確認した。ゲーム関数のフック成功ではない。**
- 診断時はgamePid=none。PID11340の記録は最後に観測した実行証拠であり、現在の稼働を証明しない。PIDが未検出の理由（手動終了、OS終了、クラッシュ、検出失敗等）は情報不足で未確定。
- captureのactual Build IDは77fda4e2a21f23954e2349b83fc113ede408f70b。expectedのc94...は旧カード用であり表示が誤解を招く。128のSetUpExamは別の77...照合を既に使っていた。
- StartExam/Dispose/SetExamEndComplete installed、inventory109等の画面表示は旧ファイルに由来し、今回のmask256では稼働しない。古い資料を現行成功にしてしまう診断表示を修正する必要がある。

## 12. v1.5.5の変更とローカル検証（§13で実機確認へ更新）

ユーザー最新方針: 「成功したやつ以外はgithubに上げる必要はない」。今後、実機で未確認のコード/APK・試行ダンプをGitHubに上げない。ローカルAPKで確認し、確認できた変更だけ公開する。v1.5.5は§13の成功記録を受領したため確認済み範囲としてGitHubへ反映する。次の新しいゲームフックはローカル検証APKに留める。

- ゲームPID未検出でも、Native初期化と自己テストをlast-runとして保持する。currentProcess=falseは維持し、自己テストのpid/uid/scope/backup/置換回数と数値を再検証する。偽のpassed、別PIDの結果を採用しない。
- PIDの無い旧lifecycle、inventory、カード、traceを現行比較から隔離する。旧詳細フックは現在受理するどのmaskでも無効。古いStartExam installed表示を出さない。資料はhistoricalRecords等に保持する。PID再利用対策の開始時刻トークンは依然未実装。
- expectedBuildId表示を3.4.1の77...へ修正。旧c94...定数はLegacyCardBuildIdとして旧RVA用のまま保持し、RVAを77...へ流用しない。buildIdCheck pending/matched/mismatchを明記。mask256のphaseはmodule-self-test-only、128は実際のprobe設置結果を表示し、mismatchでは設置しない。
- 既存128のRVA/ABI/caller whitelistは変更していない。元APKから16メソッド/20 BL参照を再照合し、実機actual Build IDも同じと確認した。**ゲームABIの動的検証はこれから。**
- 初期化コピーJSONにentryProbeRecordと最大128件のPID別entryProbeEventsを含める。ゲームPID未検出時は最後のNative記録PIDのサンプルとしてタグを付け、他PID/無印の古いイベントを混ぜない。managed objectsは読まない、modeVerifiedはfalseのまま。
- ローカルPython 64テスト、Native -Wall/-Wextra/-Werror、SDK35/NDK r27c/JDK17 APKビルドと署名検証。新しいレポート回帰テストは本番makeReportを実行し、Android Process.myUidだけをstub、実org.jsonでPID未検出の今回のケース・別PID・不正backup・古いinstalled/card/RNGの隔離を確認した。本番Native JSON生成関数をホスト実行し、Build ID一致/不一致/未検出を確認。Android UI/SELinux/Dobbyの新ビルド実動作とは区別する。
- 次の実機: ローカル版を適用し、128を明示選択・学マス完全終了/起動、まずコンテストリハーサル1回のみ観測。初期化ログとコピーJSONからprobe installed/callsObserved/recordedSamples/返り先RVA/現在PIDを照合。現在の状態で無理にモード確定や詳細取得へ進めない。終了操作無しでgamePidが消えた場合はその事実も確認する。


## 13. v1.5.5 SetUpExamの実機動作成功（ユーザー12:44報告）

### 追加の成功記録（v1.5.6ローカルAPK、2026-10-11）

ユーザー提供の現在PID14785・mask640のコピーJSONで、参照取得と自然なモードgetterの動作を確認した。9世代すべてExamType=2（Contest）・IsReplay=false、bindingFailures/writeFailures/errnoは0。記録28件は対応付け9・ExamType9・Replay9・アドレス再利用1。世代1と4で同じSequenceアドレスを別のParameter参照へ分離できた。

終了イベントはなく8件の対応が残るため、終了検知の成功とは報告しない。この版はfalseのIsEndExam呼出回数を記録しておらず、呼出0とfalseのみの実行を区別できない。本番かリハーサルかは操作名が未提示。乱数・カード・効果・スコア、オーディション/上位リプレイ/ドル道は未確認。現在PIDのNative呼出記録があるため、SO名のmaps一致noや空logcatだけで未注入・適用範囲/API不備とは判定しない。

GitHubコードはv1.5.5のまま。追加フックはローカル実機検証を続け、成功後に反映する。ここには成功記録と確認範囲だけ保存し、APK・元ゲームバイナリ・生dumpは追加しない。


- 現在gamePid=2385/UID10537/user0、mask128/read、JNI loadedとNative API accepted=true、currentProcess=true。Build IDはexpected/actualとも77fda4e2a21f23954e2349b83fc113ede408f70b/matched。
- ExamSequence.SetUpExam（token060050A4/RVA080A1E90）はinstalled、callsObserved=9、recordedSamples=9。9件すべて現在PID2385/TID8748、callerReturnRva=07EFD3B4、contest-auto-calculation。1791690199772〜1791690202168ms。単なるinstalledではなく、置換関数経由のゲーム関数実行と元関数復帰後のファイル書込を確認。
- 9件のsequenceアドレスは8種類で同一アドレスの再利用がある。次のセッション管理にはアドレスに加え単調増加generationが必要。参加者/味方敵/セット数はこの記録だけでは判定しない。
- リハーサル1回を依頼後の記録だが、ユーザーは今回の操作種別を明言していない。rehearsal/modeを確定しない。modeVerified=false/managedObjectsRead=falseを維持。
- 自己テストファイルは別PID31065/mask256でpassed。現在PID2385/mask128ではnot-requested。unattributed-or-other-runは意図した隔離であり自己テスト失敗ではない。
- injectionLogcatが空でも、同じPIDのNative API登録と9件の実行記録が存在する。適用範囲/API不備を示す証拠ではない。「適用範囲/API確認」は空ログだけに基づく一般案内であり、このケースでは不適切。次のローカル版で文言を修正。
- 成功確認済みv1.5.5のコード・テスト・短い証拠要約のみGitHubへ反映。APK/元ゲームバイナリ/生ダンプはコミットしない。PRはDraftを維持。
- RNG/card/effect/score、オーディション/上位リプレイ/ドル道、実際のコンテスト/リハーサル区別、終了検知は依然未確認。
