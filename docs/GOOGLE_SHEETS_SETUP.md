# Google Sheets 連携のセットアップ

作業フォルダ: `C:\Users\ship2\Documents\06-Yu-zora\deadline-dock`

## 現在の範囲

v0.1.10ではGoogle接続とタスク双方向同期を実装しています。接続後は初回送信と自動同期が動きます。分類の名前・色・並び順とチェック項目の双方向同期を追加しました。予定・関連先の独立した同期は未実装です。
実Googleアカウントでの動作確認は未実施です。最初はテスト用データで確認してください。詳しい検証状況は [引き継ぎ書](HANDOFF_2026-09-15.md) を参照してください。

## 利用者の接続手順（アプリ共通設定を組み込んだ版）

1. 設定で「Googleと連携」を押します。
2. このPCのブラウザでGoogleアカウントを選び、アクセスを許可します。
3. 専用スプレッドシートを自動作成（既存の連携用シートがあれば再利用）します。
4. 初回同期の件数と合算ルールを確認し、「両方を残して同期」を押します。

利用者がClient IDやクライアントシークレットを入力する必要はありません。開発者用OAuthクライアントを作成済みです。設定を組み込んでいないビルドでは接続ボタンが無効となり準備中の案内を表示します。実Googleでの動作確認はまだ行っていません。

## 開発者が一度だけ行うGoogle Cloudの準備

アプリ提供者がDeadline Dock用のDesktop app OAuthクライアントを用意します。以下の手動入力は独自クライアントの検証用で、設定画面の「開発者向け設定」内にあります。

1. Google Cloud Consoleでプロジェクトを作成します。
2. APIライブラリで **Google Drive API** と **Google Sheets API** を有効にします。
3. Google Auth Platformでアプリ名、サポート用メール、対象ユーザーを設定します。
4. データアクセスのスコープを `openid`、`email`、`profile`、`https://www.googleapis.com/auth/drive.file` に設定します。
5. OAuthクライアントの種類を **デスクトップアプリ** にして作成します。
6. 発行されたClient IDとクライアントシークレットを、Deadline Dockの「設定 → Google Sheets 連携」に入力して保存します。チャットやGitHubに貼り付ける必要はありません。
7. Testingの場合は利用アカウントをテストユーザーに登録します。
8. 「Google アカウントと連携」を押し、既定ブラウザで同意します。3分以内に完了してください。
9. アプリへ戻ると専用シートが作成され、URLが表示され、タスク同期が始まります。

認証用ブラウザはDeadline Dockを起動したPCで開いてください。認証の戻り先はそのPCの127.0.0.1です。別PCだけで同意しても元PCのアプリには戻りません。

Desktop appのclient secretはサーバー秘密鍵ではありませんが、アプリではWindows資格情報に保存し、JSONバックアップに含めません。Googleのtoken endpointが要求するためClient IDと併せて設定します。

Testingの外部向けOAuthアプリでdrive.fileを利用する場合、refresh tokenには通常7日間の期限があります。常用時は公開ステータスとGoogleの要件を確認してください。

## アプリ共通設定の組み込み

Google CloudからダウンロードしたDesktop appのJSONを、リポジトリ直下の`client_secret.desktop.json`に保存します。このファイルはGit対象外です。Windowsの起動・ビルド用cmdはこのJSONを自動で読み込みます。別PCでは安全な方法で個別に配置してください。JSONを配布ZIPへ含めないでください。

または、ビルドを実行するプロセスの環境変数にDesktop appの値を設定します。明示した環境変数を優先し、片方だけの指定はエラーにします。

- `DEADLINE_DOCK_GOOGLE_CLIENT_ID`
- `DEADLINE_DOCK_GOOGLE_CLIENT_SECRET`

その環境から`npm run tauri -- dev`または`npm run tauri -- build --bundles nsis`を実行します。変更した場合はビルド／開発プロセスを再起動してください。`.env`の自動読み込みはありません。値をGitやチャットに貼らず、ローカル環境または配布ビルド用の環境設定で管理します。

Desktop OAuthクライアントは公開クライアントで、アプリに含まれるclient secretは取り出せるため秘密保持を前提にしません。認証は外部ブラウザ・PKCE・state・loopbackを使います。ユーザーのrefresh tokenやaccess tokenは絶対にアプリへ同梱しません。独自の認証中継サーバーは追加しません。

明示的に保存済みのクライアントは共通設定より優先します。認証成功時のClient IDとclient secretをこのPCに保存し、別のクライアントを組み込んだ新版でも古いrefresh tokenを別Client IDで送信しないようにしています。

配布前にGoogle Auth Platformの公開ステータス、ブランド確認、プライバシーポリシー等の要件を確認してください。`drive.file`は非機密スコープですが、公開準備が一切不要という意味ではありません。

## データと接続解除

- タスクのSQLiteは従来どおり `%APPDATA%\local.deadlinedock.app\deadline-dock.db` にあります。プロジェクトフォルダ移動によって既存のタスク保存先は変更しません。
- Client ID、メール、Sheet ID/URLだけをSQLiteへ保存します。refresh tokenとclient secretはWindows資格情報マネージャーの `DeadlineDock` サービスに保存します。
- アクセストークンはRustの処理中のみ利用し、画面、ログ、バックアップには渡しません。
- 「Google連携を解除」はこのPCのrefresh tokenと紐付けを削除します。Google Driveのシートは保持します。
- Google側の許可も取り消す場合はGoogleアカウントの「サードパーティとの接続」からDeadline Dockのアクセスを削除してください。
- 同じアカウントへの再接続では、専用appPropertiesで既存ファイルを検索し再利用します。複数候補は「既存の同期シートを探す」から選択します。復旧欄から新しいシートの作成もできます。既存ファイルは削除しません。
- ファイルがゴミ箱にある場合はGoogle Driveで復元して「接続を確認」を押します。
- 現在のJSONバックアップにはGoogle連携設定を含めません。別PCでは再設定・再認証が必要です。

## 同期の操作

- 「今すぐ同期」と自動同期（60・120・300秒）を利用できます。ローカル変更後、フォーカス復帰、オンライン復帰でも同期します。
- 両側で変更されたタスクは競合欄で比較し、採用する側を選びます。選択後に内容が再変更された場合は再確認になります。
- シートの空ID行にはUUIDを付与してから取り込みます。行の並べ替えは可能です。ID重複や不正な期限は警告します。
- シート上の行を物理削除してもローカルタスクは削除しません。削除操作はアプリから行ってください。
- JSONバックアップを復元すると同期を停止します。内容を確認してGoogleへ再接続してください。
- API制限・通信失敗時はエラー表示と再試行を行います。ローカル操作は継続できます。

## 更新版の起動

現在実行中の旧版はタスクトレイの「終了」で終了し、このフォルダの `windows-build\Deadline-Dock.exe` を起動してください。画面右上の×はトレイへ隠す操作です。
通常の利用にCMD/PowerShellは不要です。ソース変更だけでは起動中の旧版は更新されません。

## 確認手順

- Google接続後、メール・URLが表示されることを確認。
- URLコピーと「開く」を確認。
- アプリを終了・再起動して設定が残ることを確認。
- 「接続を確認」でrefresh tokenによる通信を確認。
- 連携解除・再接続で同じシートが再利用されることを確認。
- 同意をキャンセル、オフライン、シートをゴミ箱へ移動した場合にエラーが表示され、ローカルタスク操作が続行できることを確認。

## 公式資料

- [Desktop OAuth / PKCE / loopback](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Sheets API scopes](https://developers.google.com/workspace/sheets/api/scopes)
- [Drive files.create](https://developers.google.com/workspace/drive/api/guides/create-file)
- [OAuth token expiration](https://developers.google.com/identity/protocols/oauth2#expiration)

## 件名だけの登録と2台のPC

- スマホでは「タスク一覧」のB列（件名）だけ入力できる。締切が空欄なら「急ぎではない」（日付を持たない設定）、ステータスが空欄なら未着手になる。期限超過にはならない。
- 両PCで同じGoogleアカウント・同じOAuth設定を組み込んだ新版を使う。初回に既存の同期シートを再発見する。複数候補がある場合は「接続の管理・同期先の変更」で同じシートを選ぶ。
- 各PCで初回同期前に件数をプレビューし、「両方を残して同期」で開始。確認するまでは自動・手動どちらもタスク等を書き込まない。接続解除や同期先変更後も再確認する。
- 異なるIDは同じ件名でも別タスクとして残す。同一IDで異なる内容は競合画面で選ぶ。同名分類は一意に対応づけられる場合に統合し、色・順序などの差は競合として確認する。
- 確認中に内容が変更された場合は最新プレビューを再確認する。既に同期済みのこのPCは更新後も継続する。
- 検証は2台分の独立した同期状態を使う自動テスト。別の実PC上でのOAuth・同時利用は別途確認が必要。
