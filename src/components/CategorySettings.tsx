import { GoogleSyncSettings } from './GoogleSyncSettings';
import { useState } from 'react';
import type { Category, CategoryColor } from '../types';
import type { Repository } from '../lib/repository';
import { chooseBackupText, saveBackupText, syncQuickAddShortcut } from '../lib/platform';
import { getQuickAddShortcut, QUICK_ADD_SHORTCUT_OPTIONS, quickAddShortcutLabel, setQuickAddShortcut, type QuickAddShortcut } from '../lib/preferences';
import { assertBackupSnapshot } from '../lib/backup';
import { CATEGORY_COLORS, DEFAULT_CATEGORY_COLOR, categoryColor } from '../lib/categoryColors';

function ColorPicker({ value, onChange, label }: { value?: CategoryColor; onChange: (color: CategoryColor) => void; label: string }) {
  const current = value || DEFAULT_CATEGORY_COLOR;
  return <div className="category-color-picker" role="group" aria-label={label}>
    {CATEGORY_COLORS.map(color => <button key={color.value} type="button" className={`category-color-swatch ${current === color.value ? 'active' : ''}`} style={{ background: color.accent }} title={color.label} aria-label={color.label} onClick={() => onChange(color.value)} />)}
    <GoogleSyncSettings />
  </div>;
}

export function CategorySettings({ repo, categories, onChanged }: { repo: Repository; categories: Category[]; onChanged: () => Promise<void> | void }) {
  const [name, setName] = useState('');
  const [newColor, setNewColor] = useState<CategoryColor>(DEFAULT_CATEGORY_COLOR);
  const [backupBusy, setBackupBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [shortcut, setShortcut] = useState<QuickAddShortcut>(() => getQuickAddShortcut());
  const [shortcutBusy, setShortcutBusy] = useState(false);
  const [shortcutMessage, setShortcutMessage] = useState('');

  async function exportBackup() {
    setBackupBusy(true); setMessage('');
    try {
      const snapshot = await repo.exportSnapshot();
      const path = await saveBackupText(JSON.stringify(snapshot, null, 2));
      if (path) setMessage(`バックアップを書き出しました：${path}`);
    } catch (e) {
      setMessage(`バックアップに失敗しました：${e instanceof Error ? e.message : String(e)}`);
    } finally { setBackupBusy(false); }
  }

  async function importBackup() {
    const picked = await chooseBackupText();
    if (!picked) return;
    let snapshot: unknown;
    try { snapshot = JSON.parse(picked.text); assertBackupSnapshot(snapshot); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'JSONファイルを読み取れませんでした。'); return; }
    if (!confirm(`「${picked.source}」から復元しますか？\n現在のDeadline Dockデータはバックアップ内容で置き換わります。`)) return;
    setBackupBusy(true); setMessage('');
    try {
      await repo.importSnapshot(snapshot);
      await onChanged();
      setMessage(`バックアップから復元しました：${picked.source}`);
    } catch (e) {
      setMessage(`復元に失敗しました：${e instanceof Error ? e.message : String(e)}`);
    } finally { setBackupBusy(false); }
  }

  async function changeShortcut(next: QuickAddShortcut) {
    if (shortcutBusy || next === shortcut) return;
    const previous = shortcut;
    setShortcutBusy(true); setShortcutMessage('');
    try {
      await syncQuickAddShortcut(next);
      setQuickAddShortcut(next);
      setShortcut(next);
      setShortcutMessage(next ? `クイック登録を「${quickAddShortcutLabel(next)}」に変更しました。` : 'クイック登録ショートカットを無効にしました。');
    } catch (e) {
      try { await syncQuickAddShortcut(previous); } catch { /* best effort */ }
      setShortcutMessage(`ショートカットを変更できませんでした：${e instanceof Error ? e.message : String(e)}`);
    } finally { setShortcutBusy(false); }
  }

  async function createCategory() {
    if (!name.trim()) return;
    await repo.createCategory(name, newColor);
    setName(''); setNewColor(DEFAULT_CATEGORY_COLOR);
    await onChanged();
  }

  return <div className="settings-page">
    <div className="page-intro"><span className="eyebrow">SETTINGS</span><h2>設定</h2><p>分類、ローカルデータのバックアップなどを管理します。外部サービスへの送信は行いません。</p></div>

    <section className="settings-section">
      <div className="settings-section-head"><div><span className="eyebrow">CATEGORY</span><h3>分類設定</h3></div><p>タスク登録時に選べる分類を増減・並べ替えできます。色は一覧カードへ薄く反映されます。</p></div>
      <div className="settings-card">
        <div className="settings-add category-add-area">
          <div className="category-add-main"><input placeholder="新しい分類名" value={name} onChange={e => setName(e.target.value)} onKeyDown={async e => { if (e.key === 'Enter') await createCategory(); }} /><button className="button primary" disabled={!name.trim()} onClick={createCategory}>追加</button></div>
          <div className="category-add-color"><span>色</span><ColorPicker value={newColor} onChange={setNewColor} label="新しい分類の色" /><strong style={{ color: categoryColor(newColor).accent }}>{categoryColor(newColor).label}</strong></div>
        </div>
        <div className="category-list">
          {categories.map((category, index) => <div key={category.id} className="category-row category-row-colored">
            <span className="category-preview-dot" style={{ background: categoryColor(category.color).accent }} />
            <div className="category-row-main">
              <input defaultValue={category.name} onBlur={async e => { const next = e.target.value.trim(); if (next && next !== category.name) { await repo.renameCategory(category.id, next); await onChanged(); } }} />
              <ColorPicker value={category.color} label={`${category.name}の色`} onChange={async color => { await repo.setCategoryColor(category.id, color); await onChanged(); }} />
            </div>
            <div className="row-actions">
              <button className="icon-button" disabled={index === 0} onClick={async () => { await repo.moveCategory(category.id, 'UP'); await onChanged(); }}>↑</button>
              <button className="icon-button" disabled={index === categories.length - 1} onClick={async () => { await repo.moveCategory(category.id, 'DOWN'); await onChanged(); }}>↓</button>
              <button className="icon-button danger-text" onClick={async () => { if (confirm(`分類「${category.name}」を削除しますか？\n既存タスクは未分類になります。`)) { await repo.deleteCategory(category.id); await onChanged(); } }}>×</button>
            </div>
          </div>)}
          {!categories.length && <div className="empty-inline">分類はまだありません。</div>}
        </div>
      </div>
    </section>

    <section className="settings-section">
      <div className="settings-section-head"><div><span className="eyebrow">LOCAL DATA</span><h3>バックアップ / 復元</h3></div><p>タスク、履歴、分類、予定、関連先を1つのJSONファイルに保存します。</p></div>
      <div className="settings-card data-card">
        <div className="settings-action-row"><div><strong>バックアップを書き出す</strong><small>現在のローカルデータを丸ごと保存します。</small></div><button className="button secondary" disabled={backupBusy} onClick={exportBackup}>書き出す</button></div>
        <div className="settings-action-row"><div><strong>バックアップから復元</strong><small>選んだバックアップで現在のデータを置き換えます。</small></div><button className="button secondary" disabled={backupBusy} onClick={importBackup}>復元する</button></div>
        {message && <div className="settings-message">{message}</div>}
      </div>
    </section>

    <section className="settings-section">
      <div className="settings-section-head"><div><span className="eyebrow">DESKTOP</span><h3>デスクトップ動作</h3></div></div>
      <div className="settings-card data-card">
        <div className="settings-action-row"><div><strong>クイック登録</strong><small>アプリがバックグラウンドにいても呼び出せるショートカットです。</small></div><select className="settings-select" value={shortcut} disabled={shortcutBusy} onChange={e => changeShortcut(e.target.value as QuickAddShortcut)}>{QUICK_ADD_SHORTCUT_OPTIONS.map(option => <option key={option.value || 'disabled'} value={option.value}>{option.label}</option>)}</select></div>
        <div className="settings-action-row static"><div><strong>ウィンドウ状態</strong><small>メイン・ミニウィンドウの位置とサイズを終了時に記憶します。</small></div><span className="settings-value">自動保存</span></div>
        {shortcutMessage && <div className="settings-message">{shortcutMessage}</div>}
      </div>
    </section>
    <GoogleSyncSettings />
  </div>;
}
