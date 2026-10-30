import { describe, expect, it } from 'vitest';
import { EGG, EMPTY, findConflicts, PEACH, scoreFor, type CellState } from './game';
import type { Puzzle } from './puzzle';

describe('scoreFor', () => {
  it('doubles the base for an instant solve', () => {
    expect(scoreFor(8, 0, 0)).toEqual({ base: 640, timeBonus: 640, penalty: 0, total: 1280 });
  });

  it('drops the time bonus to zero at three times par', () => {
    expect(scoreFor(8, 384_000, 0).timeBonus).toBe(0);
    expect(scoreFor(8, 999_000, 0).timeBonus).toBe(0);
  });

  it('takes a quarter of the base per mistake and never goes negative', () => {
    expect(scoreFor(8, 384_000, 2).total).toBe(320);
    expect(scoreFor(5, 999_000, 5).total).toBe(0);
  });
});

describe('findConflicts', () => {
  // Four columns as regions: 0 1 2 3
  const p: Puzzle = { size: 4, regions: [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3], solution: [1, 3, 0, 2], seed: 0 };
  const board = (placed: Record<number, CellState>) => Array.from({ length: 16 }, (_, i) => placed[i] ?? EMPTY) as CellState[];

  it('treats peaches like eggplants when checking the rules', () => {
    expect([...findConflicts(p, board({ 0: PEACH, 2: EGG })).eggs].sort()).toEqual([0, 2]);
    expect([...findConflicts(p, board({ 0: PEACH, 5: PEACH })).eggs].sort()).toEqual([0, 5]);
  });

  it('leaves well-placed peaches alone', () => {
    expect(findConflicts(p, board({ 1: PEACH, 7: PEACH })).eggs.size).toBe(0);
  });
});
