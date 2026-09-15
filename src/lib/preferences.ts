export type QuickAddShortcut = '' | 'CommandOrControl+Shift+Space' | 'CommandOrControl+Alt+Space' | 'CommandOrControl+Shift+N' | 'Alt+Shift+Space';

const QUICK_ADD_SHORTCUT_KEY = 'deadline-dock-quick-add-shortcut';

export const QUICK_ADD_SHORTCUT_OPTIONS: { value: QuickAddShortcut; label: string }[] = [
  { value: 'CommandOrControl+Shift+Space', label: 'Ctrl + Shift + Space' },
  { value: 'CommandOrControl+Alt+Space', label: 'Ctrl + Alt + Space' },
  { value: 'CommandOrControl+Shift+N', label: 'Ctrl + Shift + N' },
  { value: 'Alt+Shift+Space', label: 'Alt + Shift + Space' },
  { value: '', label: '無効' }
];

const allowed = new Set<QuickAddShortcut>(QUICK_ADD_SHORTCUT_OPTIONS.map(option => option.value));

export function getQuickAddShortcut(): QuickAddShortcut {
  const stored = localStorage.getItem(QUICK_ADD_SHORTCUT_KEY) as QuickAddShortcut | null;
  return stored !== null && allowed.has(stored) ? stored : 'CommandOrControl+Shift+Space';
}

export function setQuickAddShortcut(value: QuickAddShortcut) {
  if (!allowed.has(value)) throw new Error('未対応のショートカットです。');
  localStorage.setItem(QUICK_ADD_SHORTCUT_KEY, value);
}

export function quickAddShortcutLabel(value: QuickAddShortcut) {
  return QUICK_ADD_SHORTCUT_OPTIONS.find(option => option.value === value)?.label ?? value;
}
