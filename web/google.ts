// The browser uses a public OAuth client ID; access tokens never leave memory.
export const CLIENT_ID =
  "207693332888-cr9hth35u1mera1trcjnlf76pep8mbs0.apps.googleusercontent.com";
interface TokenResult {
  access_token?: string;
  expires_in?: number;
  error?: string;
  scope?: string;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (r: TokenResult) => void;
            error_callback: (r: { type: string }) => void;
          }) => { requestAccessToken: (o: { prompt: string }) => void };
        };
      };
    };
  }
}
let token = "";
let expires = 0;
let loading: Promise<void> | undefined;
export function connected() {
  return !!token && Date.now() < expires;
}
export function disconnect() {
  token = "";
  expires = 0;
}
const REDIRECT_STATE = "deadline-dock-oauth-state";
export function authorizeInThisTab() {
  const state = crypto.randomUUID() + crypto.randomUUID();
  sessionStorage.setItem(
    REDIRECT_STATE,
    JSON.stringify({ state, created: Date.now() }),
  );
  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: location.origin + "/tools/deadline-dock/",
    response_type: "token",
    scope: "openid email profile https://www.googleapis.com/auth/drive.file",
    state,
    prompt: "select_account",
    include_granted_scopes: "true",
  });
  location.assign("https://accounts.google.com/o/oauth2/v2/auth?" + query);
}
export function consumeRedirect(): boolean {
  const params = new URLSearchParams(location.hash.slice(1));
  if (!params.has("access_token") && !params.has("error")) return false;
  // Remove tokens from the address/history before rendering or loading Google scripts.
  history.replaceState(null, "", location.pathname + location.search);
  const raw = sessionStorage.getItem(REDIRECT_STATE);
  sessionStorage.removeItem(REDIRECT_STATE);
  let pending: { state: string; created: number } | null = null;
  try {
    pending = raw ? JSON.parse(raw) : null;
  } catch {}
  if (
    !pending ||
    params.get("state") !== pending.state ||
    Date.now() - pending.created > 15 * 60 * 1000
  )
    throw new Error(
      "認証の確認に失敗しました。設定からもう一度接続してください。",
    );
  if (params.has("error"))
    throw new Error("Googleへの接続が取り消されました。");
  const lifetime = Number(params.get("expires_in"));
  if (
    !params.get("access_token") ||
    !Number.isFinite(lifetime) ||
    lifetime <= 0 ||
    params.get("token_type")?.toLowerCase() !== "bearer"
  )
    throw new Error("Googleの認証結果を確認できませんでした。");
  token = params.get("access_token")!;
  expires = Date.now() + Math.max(0, lifetime - 60) * 1000;
  return true;
}
export function loadGoogle(): Promise<void> {
  if (window.google?.accounts.oauth2) return Promise.resolve();
  return (loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = undefined;
      s.remove();
      reject(
        new Error(
          "Googleの認証画面を読み込めませんでした。ネット接続を確認してください。",
        ),
      );
    };
    document.head.append(s);
  }));
}
// Call directly from a click after loadGoogle resolves, preserving the popup user gesture.
export function authorize(): Promise<void> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timeout = setTimeout(() => {
      finished = true;
      reject(
        new Error(
          "接続画面を確認できませんでした。「同じタブでGoogleに接続」をお試しください。",
        ),
      );
    }, 90000);
    if (!CLIENT_ID || !window.google)
      return reject(new Error("Google連携の準備ができていません。"));
    window.google.accounts.oauth2
      .initTokenClient({
        client_id: CLIENT_ID,
        scope:
          "openid email profile https://www.googleapis.com/auth/drive.file",
        callback: (r) => {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          if (r.error || !r.access_token)
            return reject(new Error("Googleへの接続が取り消されました。"));
          token = r.access_token;
          expires =
            Date.now() + Math.max(0, (r.expires_in ?? 3600) - 60) * 1000;
          resolve();
        },
        error_callback: () => {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          reject(
            new Error(
              "接続画面を開けませんでした。ポップアップを許可して、もう一度接続してください。",
            ),
          );
        },
      })
      .requestAccessToken({ prompt: "select_account" });
  });
}
export async function googleApi<T = any>(
  url: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  if (!connected())
    throw new Error(
      "Googleへ再接続してください。端末のタスクは保存されています。",
    );
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 401) {
    disconnect();
    throw new Error("Googleへの接続期限が切れました。再接続してください。");
  }
  if (!response.ok)
    throw new Error(
      response.status === 403 || response.status === 404
        ? "このシートにアクセスできません。PC版と同じGoogleアカウント・同期用シートか確認してください。"
        : `Googleとの通信に失敗しました（${response.status}）。もう一度同期してください。`,
    );
  return response.json();
}
export async function account() {
  return googleApi<{ sub: string; email: string }>(
    "https://www.googleapis.com/oauth2/v3/userinfo",
  );
}
export async function listSheets() {
  const q =
    "trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet' and appProperties has { key='deadlineDock' and value='true' } and appProperties has { key='workspaceId' and value='00000000-0000-4000-8000-000000000001' }";
  let page = "";
  const files: { id: string; name: string }[] = [];
  do {
    const r = await googleApi<{
      files: { id: string; name: string }[];
      nextPageToken?: string;
    }>(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name),nextPageToken&pageSize=100${page ? "&pageToken=" + encodeURIComponent(page) : ""}`,
    );
    files.push(...r.files);
    page = r.nextPageToken ?? "";
  } while (page);
  return files;
}
export async function createSheet() {
  const result = await googleApi<{ spreadsheetId: string }>(
    "https://sheets.googleapis.com/v4/spreadsheets",
    {
      properties: { title: "Deadline Dock タスク同期" },
      sheets: [{ properties: { sheetId: 105, title: "SyncMeta" } }],
    },
  );
  await googleApi(
    `https://www.googleapis.com/drive/v3/files/${result.spreadsheetId}`,
    {
      appProperties: {
        deadlineDock: "true",
        schemaVersion: "1",
        workspaceId: "00000000-0000-4000-8000-000000000001",
      },
    },
    "PATCH",
  );
  return result;
}
export function sheetIdFromInput(input: string) {
  const id =
    input.match(
      /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/,
    )?.[1] ?? input.trim();
  if (!/^[\w-]{20,150}$/.test(id))
    throw new Error("GoogleスプレッドシートのURLを入力してください。");
  return id;
}
