import type { ResourceType, TaskComposerInitial } from '../types';

export function isTauriRuntime() {
  return '__TAURI_INTERNALS__' in window;
}

export async function openResource(type: ResourceType, value: string) {
  if (isTauriRuntime()) {
    if (type === 'URL') {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      return openUrl(value);
    }
    // opener's JS scope is intentionally restrictive. Resources may point to
    // any local/network location chosen by the user, so local paths are opened
    // by our desktop command instead of depending on a persisted opener scope.
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_local_path', { path: value });
    return;
  }
  if (type === 'URL') window.open(value, '_blank', 'noopener,noreferrer');
  else alert(`ブラウザプレビューではローカルパスを開けません。\n${value}`);
}

export async function chooseLocalPath(type: 'FILE' | 'FOLDER'): Promise<string | null> {
  if (isTauriRuntime()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({ multiple: false, directory: type === 'FOLDER' });
    return typeof result === 'string' ? result : null;
  }
  return window.prompt(type === 'FOLDER' ? 'フォルダパスを入力してください' : 'ファイルパスを入力してください') || null;
}

function backupFilename() {
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  return `deadline-dock-backup-${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}.json`;
}

export async function saveBackupText(contents: string): Promise<string | null> {
  const filename = backupFilename();
  if (isTauriRuntime()) {
    const [{ save }, { writeTextFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs')
    ]);
    const path = await save({
      defaultPath: filename,
      filters: [{ name: 'Deadline Dock Backup', extensions: ['json'] }]
    });
    if (!path) return null;
    await writeTextFile(path, contents);
    return path;
  }

  const blob = new Blob([contents], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return filename;
}

export async function chooseBackupText(): Promise<{ text: string; source: string } | null> {
  if (isTauriRuntime()) {
    const [{ open }, { readTextFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs')
    ]);
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'Deadline Dock Backup', extensions: ['json'] }]
    });
    if (typeof path !== 'string') return null;
    return { text: await readTextFile(path), source: path };
  }

  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    input.onchange = async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(null);
      resolve({ text: await file.text(), source: file.name });
    };
    input.oncancel = () => { input.remove(); resolve(null); };
    document.body.appendChild(input);
    input.click();
  });
}


export async function resizeQuickAddWindow(mode: 'compact' | 'candidates' | 'details') {
  if (!isTauriRuntime()) return;
  const [{ getCurrentWindow }, { LogicalSize }] = await Promise.all([
    import('@tauri-apps/api/window'),
    import('@tauri-apps/api/dpi')
  ]);
  const current = getCurrentWindow();
  const desired = mode === 'details'
    ? { width: 780, height: 800 }
    : mode === 'candidates'
      ? { width: 700, height: 720 }
      : { width: 640, height: 520 };

  // Keep the composer usable even on smaller displays. The footer is fixed
  // inside the window and the body scrolls, so fitting the work area matters
  // more than forcing a large fixed size.
  const availableWidth = Math.max(540, window.screen.availWidth - 56);
  const availableHeight = Math.max(440, window.screen.availHeight - 80);
  const width = Math.min(desired.width, availableWidth);
  const height = Math.min(desired.height, availableHeight);

  try {
    await current.setSize(new LogicalSize(width, height));
    await current.center();
  } catch (error) {
    console.warn('Quick Add window resize failed', error);
  }
}

export async function hideCurrentWindow() {
  if (!isTauriRuntime()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().hide();
}

export async function setCurrentAlwaysOnTop(value: boolean) {
  if (!isTauriRuntime()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().setAlwaysOnTop(value);
}

let activeQuickAddShortcut: string | null = null;

type ComposerRequest = {
  requestId: string;
  initial?: TaskComposerInitial | null;
};

export async function openTaskComposer(initial?: TaskComposerInitial): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const [{ WebviewWindow }, { emitTo }] = await Promise.all([
    import('@tauri-apps/api/webviewWindow'),
    import('@tauri-apps/api/event')
  ]);
  const quick = await WebviewWindow.getByLabel('quick');
  if (!quick) throw new Error('タスク登録ウィンドウが見つかりません。');
  await quick.show();
  await emitTo('quick', 'deadline-dock-compose-task', {
    requestId: crypto.randomUUID(),
    initial: initial ?? null
  } satisfies ComposerRequest);
  await quick.setFocus();
  return true;
}

export async function showQuickAddWindow() {
  return openTaskComposer();
}

export async function listenForComposeTask(handler: (initial?: TaskComposerInitial) => void | Promise<void>): Promise<() => void> {
  if (!isTauriRuntime()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<ComposerRequest>('deadline-dock-compose-task', event => {
    void handler(event.payload?.initial || undefined);
  });
}

export async function notifyTaskCreated(taskId: string) {
  if (!isTauriRuntime()) return;
  const { emitTo } = await import('@tauri-apps/api/event');
  await Promise.allSettled([
    emitTo('main', 'deadline-dock-task-created', { taskId }),
    emitTo('mini', 'deadline-dock-task-created', { taskId })
  ]);
}

export async function listenForTaskCreated(handler: (taskId: string) => void | Promise<void>): Promise<() => void> {
  if (!isTauriRuntime()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<{ taskId?: string }>('deadline-dock-task-created', event => {
    if (event.payload?.taskId) void handler(event.payload.taskId);
  });
}

export async function showMiniWindow() {
  if (!isTauriRuntime()) return false;
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const mini = await WebviewWindow.getByLabel('mini');
  if (!mini) throw new Error('ミニウィンドウが見つかりません。');
  await mini.show();
  await mini.setFocus();
  return true;
}

export async function syncQuickAddShortcut(shortcut: string) {
  if (!isTauriRuntime()) {
    activeQuickAddShortcut = shortcut || null;
    return;
  }

  const { register, unregister, isRegistered } = await import('@tauri-apps/plugin-global-shortcut');
  if (activeQuickAddShortcut && activeQuickAddShortcut !== shortcut) {
    try {
      if (await isRegistered(activeQuickAddShortcut)) await unregister(activeQuickAddShortcut);
    } finally {
      activeQuickAddShortcut = null;
    }
  }

  if (!shortcut) return;
  if (activeQuickAddShortcut === shortcut && await isRegistered(shortcut)) return;

  if (await isRegistered(shortcut)) {
    // A previous registration by this frontend instance can survive a React remount.
    try { await unregister(shortcut); } catch { /* re-register below */ }
  }

  await register(shortcut, async event => {
    if (event.state !== 'Pressed') return;
    try { await openTaskComposer(); } catch (error) { console.error('Failed to show task composer', error); }
  });
  activeQuickAddShortcut = shortcut;
}

export async function openTaskInMainWindow(taskId: string) {
  if (!isTauriRuntime()) return;
  const [{ WebviewWindow }, { emitTo }] = await Promise.all([
    import('@tauri-apps/api/webviewWindow'),
    import('@tauri-apps/api/event')
  ]);
  const main = await WebviewWindow.getByLabel('main');
  if (!main) throw new Error('メインウィンドウが見つかりません。');
  await main.show();
  await main.setFocus();
  await emitTo('main', 'deadline-dock-open-task', { taskId });
}

export async function listenForOpenTask(handler: (taskId: string) => void | Promise<void>): Promise<() => void> {
  if (!isTauriRuntime()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<{ taskId?: string }>('deadline-dock-open-task', event => {
    if (event.payload?.taskId) void handler(event.payload.taskId);
  });
}
