import { describe, expect, it } from 'vitest';
import { scoreFor } from './game';

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
