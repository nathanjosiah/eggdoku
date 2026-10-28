// Adventure mode: a fixed run of levels grouped into chapters that grow in size.

import { hashString } from './puzzle';

export interface Chapter {
  name: string;
  size: number;
  count: number;
}

export const CHAPTERS: Chapter[] = [
  { name: 'Seedling Patch', size: 5, count: 5 },
  { name: 'Sprout Rows', size: 6, count: 7 },
  { name: 'Greenhouse', size: 7, count: 9 },
  { name: 'Market Garden', size: 8, count: 10 },
  { name: 'Trellis Maze', size: 9, count: 9 },
  { name: 'Eggplant Kingdom', size: 10, count: 10 },
];

export interface Level {
  /** 1-based level number. */
  n: number;
  size: number;
  chapter: number;
  seed: number;
}

export const LEVELS: Level[] = CHAPTERS.flatMap((ch, chapter) =>
  Array.from({ length: ch.count }, () => ({ size: ch.size, chapter })),
).map((l, i) => ({ ...l, n: i + 1, seed: hashString(`eggdoku-level-${i + 1}`) }));

export function getLevel(n: number): Level {
  return LEVELS[n - 1];
}

/** Three stars for a clean solve, one fewer per mistake. */
export function starsFor(mistakes: number): number {
  return Math.max(1, 3 - mistakes);
}
