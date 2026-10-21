import type { ReadingDirection, Size } from './layout';
export type PresentationMode = 'single' | 'double';
export type PageGroup = readonly number[];
export const WIDE_RATIO = 1.2;
export const SPREAD_GUTTER = 8;
export const isWide = (size: Size) => size.width / size.height >= WIDE_RATIO;
// Unknown dimensions provisionally pair. Only bounded on-demand acquisitions resolve them.
export function planGroups(
  count: number,
  mode: PresentationMode,
  cover: boolean,
  wide: ReadonlySet<number>,
): PageGroup[] {
  const groups: PageGroup[] = [];
  for (let i = 0; i < count;) {
    const pair =
      mode === 'double' &&
      !(cover && i === 0) &&
      !wide.has(i) &&
      i + 1 < count &&
      !wide.has(i + 1);
    groups.push(pair ? [i, i + 1] : [i]);
    i += pair ? 2 : 1;
  }
  return groups;
}
export function containing(
  groups: readonly PageGroup[],
  index: number,
): PageGroup {
  return groups.find((g) => g.includes(index)) ?? [];
}
export function visualOrder(
  group: PageGroup,
  direction: ReadingDirection,
): number[] {
  return direction === 'rtl' ? [...group].reverse() : [...group];
}
export function pageNumber(value: string, count: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 && n <= count ? n - 1 : null;
}
export function composedSize(pages: readonly Size[]): Size {
  return {
    width:
      pages.reduce((n, p) => n + p.width, 0) +
      Math.max(0, pages.length - 1) * SPREAD_GUTTER,
    height: Math.max(0, ...pages.map((p) => p.height)),
  };
}
