export function fontScale(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function controlHeight(base: number, scale: number): number {
  return Math.round(24 + (base - 24) * Math.max(1, fontScale(scale)));
}

export function singleColumn(width: number, scale: number): boolean {
  const available = Number.isFinite(width) && width > 0 ? Math.min(width, 840) : 390;
  return available / Math.max(1, fontScale(scale)) < 360;
}
