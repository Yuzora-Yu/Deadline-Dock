import { useSyncExternalStore } from 'react';
import { subscribeSync, syncView } from '../lib/googleSync';
export function SyncStatusBadge({onClick}:{onClick:()=>void}) {
  const status=useSyncExternalStore(subscribeSync,syncView);
  if (!('__TAURI_INTERNALS__' in window)) return null;
  return <button className="text-button sync-status" onClick={onClick} title="Google Sheets連携の詳細">{status.warnings.length ? '⚠' : '☁'} {status.message}</button>;
}
