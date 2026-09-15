# Google Sheets 連携のセットアップ

作業フォルダ: `C:\Users\ship2\Documents\06-Yu-zora\deadline-dock`

## 現在の範囲

Phase 1: Google OAuth接続、Windows資格情報保存、専用スプレッドシートの自動作成、URL表示・コピー・オープン、解除・再接続。
実Googleアカウントでの認証確認は利用者のOAuthクライアントが必要です。Phase 2以降のタスク同期は未実装で、現段階ではシートにタスクを送信しません。

## Google Cloudの準備

1. Google Cloud Consoleでプロジェクトを作成します。
2. APIライブラリで **Google Drive API** と **Google Sheets API** を有効にします。
3. Google Auth Platformでアプリ名、サポート用メール、対象ユーザーを設定します。
4. データアクセスのスコープを `openid`、`email`、`profile`、`https://www.googleapis.com/auth/drive.file` に設定します。
5. OAuthクライアントの種類を **デスクトップアプリ** にして作成します。
6. 発行されたClient IDとクライアントシークレットを、Deadline Dockの「設定 → Google Sheets 連携」に入力して保存します。チャットやGitHubに貼り付ける必要はありません。
7. Testingの場合は利用アカウントをテストユーザーに登録します。
8. 「Google アカウントと連携」を押し、既定ブラウザで同意します。3分以内に完了してください。
9. アプリへ戻ると専用シートが作成され、URLが表示されます。

Desktop appのclient secretはサーバー秘密鍵ではありませんが、アプリではWindows資格情報に保存し、JSONバックアップに含めません。Googleのtoken endpointが要求するためClient IDと併せて設定します。

Testingの外部向けOAuthアプリでdrive.fileを利用する場合、refresh tokenには通常7日間の期限があります。常用時は公開ステータスとGoogleの要件を確認してください。

## データと接続解除

- タスクのSQLiteは従来どおり `%APPDATA%\local.deadlinedock.app\deadline-dock.db` にあります。プロジェクトフォルダ移動によって既存のタスク保存先は変更しません。
- Client ID、メール、Sheet ID/URLだけをSQLiteへ保存します。refresh tokenとclient secretはWindows資格情報マネージャーの `DeadlineDock` サービスに保存します。
- アクセストークンはRustの処理中のみ利用し、画面、ログ、バックアップには渡しません。
- 「Google連携を解除」はこのPCのrefresh tokenと紐付けを削除します。Google Driveのシートは保持します。
- Google側の許可も取り消す場合はGoogleアカウントの「サードパーティとの接続」からDeadline Dockのアクセスを削除してください。
- 同じアカウントへの再接続では、専用appPropertiesで既存ファイルを検索し再利用します。複数候補は自動選択しません。
- ファイルがゴミ箱にある場合はGoogle Driveで復元して「接続を確認」を押します。
- 現在のJSONバックアップにはGoogle連携設定を含めません。別PCでは再設定・再認証が必要です。

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
