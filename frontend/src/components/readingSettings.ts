export const READING_FONT_MIN = 14;
export const READING_FONT_MAX = 24;
export const READING_FONT_DEFAULT = 17;

export function clampFontSize(value: number): number {
  return Math.min(READING_FONT_MAX, Math.max(READING_FONT_MIN, Math.round(value)));
}

export function nextFontSize(current: number, delta: number): number {
  return clampFontSize(current + delta);
}