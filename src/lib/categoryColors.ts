import type { CategoryColor } from '../types';

// Tints are intentionally visible but still light enough that deadline/urgency
// colors remain the strongest signal in the UI.
export const CATEGORY_COLORS: Array<{ value: CategoryColor; label: string; accent: string; tint: string }> = [
  { value: 'slate', label: 'グレー', accent: '#747c76', tint: 'rgba(116, 124, 118, .13)' },
  { value: 'blue', label: 'ブルー', accent: '#4f77a6', tint: 'rgba(79, 119, 166, .145)' },
  { value: 'cyan', label: 'シアン', accent: '#4d8c94', tint: 'rgba(77, 140, 148, .145)' },
  { value: 'green', label: 'グリーン', accent: '#5c8768', tint: 'rgba(92, 135, 104, .145)' },
  { value: 'lime', label: 'ライム', accent: '#7f904d', tint: 'rgba(127, 144, 77, .145)' },
  { value: 'yellow', label: 'イエロー', accent: '#a38a3e', tint: 'rgba(163, 138, 62, .155)' },
  { value: 'orange', label: 'オレンジ', accent: '#b6753e', tint: 'rgba(182, 117, 62, .155)' },
  { value: 'red', label: 'レッド', accent: '#a65a55', tint: 'rgba(166, 90, 85, .145)' },
  { value: 'pink', label: 'ピンク', accent: '#a7657f', tint: 'rgba(167, 101, 127, .145)' },
  { value: 'purple', label: 'パープル', accent: '#77689c', tint: 'rgba(119, 104, 156, .145)' }
];

export const DEFAULT_CATEGORY_COLOR: CategoryColor = 'slate';

export function normalizeCategoryColor(value?: string | null): CategoryColor {
  return CATEGORY_COLORS.some(color => color.value === value) ? value as CategoryColor : DEFAULT_CATEGORY_COLOR;
}

export function categoryColor(value?: string | null) {
  const key = normalizeCategoryColor(value);
  return CATEGORY_COLORS.find(color => color.value === key)!;
}
