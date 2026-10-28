// Pure board-state helpers (no DOM).

import type { Puzzle } from './puzzle';

export const EMPTY = 0;
export const MARK = 1;
export const EGG = 2;
export type CellState = typeof EMPTY | typeof MARK | typeof EGG;

export interface Conflicts {
  /** Cells inside a row/column/region that breaks a rule (drawn striped). */
  cells: Set<number>;
  /** Eggplants that are directly part of a rule violation (they shake). */
  eggs: Set<number>;
}

export function findConflicts(p: Puzzle, cells: CellState[]): Conflicts {
  const { size, regions } = p;
  const out: Conflicts = { cells: new Set(), eggs: new Set() };

  const groups: number[][] = [];
  for (let i = 0; i < size; i++) {
    const row: number[] = [];
    const col: number[] = [];
    for (let j = 0; j < size; j++) {
      row.push(i * size + j);
      col.push(j * size + i);
    }
    groups.push(row, col);
  }
  const byRegion: number[][] = Array.from({ length: size }, () => []);
  regions.forEach((reg, i) => byRegion[reg].push(i));
  groups.push(...byRegion);

  for (const group of groups) {
    const eggs = group.filter((i) => cells[i] === EGG);
    const allMarked = group.every((i) => cells[i] === MARK);
    if (eggs.length > 1 || allMarked) {
      group.forEach((i) => out.cells.add(i));
      eggs.forEach((i) => out.eggs.add(i));
    }
  }

  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== EGG) continue;
    for (const n of neighbors(size, i)) {
      if (cells[n] === EGG) {
        out.eggs.add(i);
        out.eggs.add(n);
      }
    }
  }
  return out;
}

export function isSolved(p: Puzzle, cells: CellState[]): boolean {
  return cells.every((s, i) => (s === EGG) === (p.solution[Math.floor(i / p.size)] === i % p.size));
}

export function neighbors(size: number, i: number): number[] {
  const r = Math.floor(i / size);
  const c = i % size;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < size && nc >= 0 && nc < size) out.push(nr * size + nc);
    }
  }
  return out;
}

/** Every cell an eggplant at `i` rules out: its row, column, region and neighbors. */
export function blockedBy(p: Puzzle, i: number): number[] {
  const { size, regions } = p;
  const r = Math.floor(i / size);
  const c = i % size;
  const out = new Set(neighbors(size, i));
  for (let j = 0; j < size * size; j++) {
    if (Math.floor(j / size) === r || j % size === c || regions[j] === regions[i]) out.add(j);
  }
  out.delete(i);
  return [...out];
}

export function isSolutionCell(p: Puzzle, i: number): boolean {
  return p.solution[Math.floor(i / p.size)] === i % p.size;
}

export const MAX_LIVES = 3;

export interface Score {
  base: number;
  timeBonus: number;
  penalty: number;
  total: number;
}

/**
 * Base points grow with the board's area. The time bonus starts equal to the
 * base and decays to zero at three times par (two seconds per square). Each
 * mistake costs a quarter of the base.
 */
export function scoreFor(size: number, elapsedMs: number, mistakes: number): Score {
  const base = size * size * 10;
  const par = size * size * 2;
  const timeBonus = Math.round(base * Math.max(0, 1 - elapsedMs / 1000 / (par * 3)));
  const penalty = mistakes * Math.round(base / 4);
  return { base, timeBonus, penalty, total: Math.max(0, base + timeBonus - penalty) };
}
