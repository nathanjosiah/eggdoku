import { describe, expect, it } from 'vitest';
import { generate, solve } from './puzzle';

describe('generate', () => {
  for (const size of [5, 6, 7, 8, 9, 10]) {
    it(`produces a uniquely solvable ${size}×${size} puzzle`, () => {
      for (let seed = 1; seed <= 5; seed++) {
        const p = generate(size, seed * 7919 + size);
        const sols = solve(size, p.regions, 2);
        expect(sols).toEqual([p.solution]);
        // every region is used exactly once
        expect(new Set(p.regions).size).toBe(size);
      }
    });
  }

  it('is deterministic for a seed', () => {
    expect(generate(8, 42)).toEqual(generate(8, 42));
  });
});
