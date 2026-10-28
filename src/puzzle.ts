// Puzzle generation and solving.
//
// Rules: an N×N board split into N colored regions. Place exactly one eggplant
// in every row, column and region, and no two eggplants may touch — not even
// diagonally.

export interface Puzzle {
  size: number;
  /** regions[r * size + c] = region index (0..size-1) */
  regions: number[];
  /** solution[r] = column of the eggplant in row r */
  solution: number[];
  seed: number;
}

export type Rng = () => number;

/** Small, fast seeded PRNG (mulberry32). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Random placement with one per row/column and no diagonal touching. */
function randomPlacement(size: number, rng: Rng): number[] {
  const cols: number[] = [];
  const used = new Array(size).fill(false);
  const place = (r: number): boolean => {
    if (r === size) return true;
    for (const c of shuffle([...Array(size).keys()], rng)) {
      if (used[c]) continue;
      if (r > 0 && Math.abs(cols[r - 1] - c) <= 1) continue;
      used[c] = true;
      cols[r] = c;
      if (place(r + 1)) return true;
      used[c] = false;
    }
    return false;
  };
  place(0);
  return cols;
}

const DIRS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/** Grow regions outward from each eggplant until the board is covered. */
function growRegions(size: number, solution: number[], rng: Rng): number[] {
  const regions = new Array(size * size).fill(-1);
  const frontier: number[][] = [];
  for (let r = 0; r < size; r++) {
    regions[r * size + solution[r]] = r;
    frontier.push([r * size + solution[r]]);
  }
  let remaining = size * size - size;
  while (remaining > 0) {
    const reg = Math.floor(rng() * size);
    const cells = frontier[reg];
    // Pick a random cell already in the region and try to expand from it.
    while (cells.length > 0) {
      const idx = Math.floor(rng() * cells.length);
      const cell = cells[idx];
      const r = Math.floor(cell / size);
      const c = cell % size;
      const open = DIRS.map(([dr, dc]) => [r + dr, c + dc]).filter(
        ([nr, nc]) =>
          nr >= 0 && nr < size && nc >= 0 && nc < size && regions[nr * size + nc] === -1,
      );
      if (open.length === 0) {
        cells.splice(idx, 1);
        continue;
      }
      const [nr, nc] = open[Math.floor(rng() * open.length)];
      regions[nr * size + nc] = reg;
      cells.push(nr * size + nc);
      remaining--;
      break;
    }
  }
  return regions;
}

/**
 * Enumerates solutions (up to `limit`) for the given region layout.
 * Returns the solutions found as column-per-row arrays.
 */
export function solve(size: number, regions: number[], limit = 2): number[][] {
  const found: number[][] = [];
  const cols: number[] = [];
  let usedCols = 0;
  let usedRegions = 0;
  const step = (r: number): boolean => {
    if (r === size) {
      found.push([...cols]);
      return found.length >= limit;
    }
    for (let c = 0; c < size; c++) {
      if (usedCols & (1 << c)) continue;
      if (r > 0 && Math.abs(cols[r - 1] - c) <= 1) continue;
      const reg = regions[r * size + c];
      if (usedRegions & (1 << reg)) continue;
      usedCols |= 1 << c;
      usedRegions |= 1 << reg;
      cols[r] = c;
      const done = step(r + 1);
      usedCols &= ~(1 << c);
      usedRegions &= ~(1 << reg);
      if (done) return true;
    }
    return false;
  };
  step(0);
  return found;
}

function isConnectedWithout(size: number, regions: number[], cell: number): boolean {
  const reg = regions[cell];
  const members: number[] = [];
  for (let i = 0; i < regions.length; i++) if (regions[i] === reg && i !== cell) members.push(i);
  if (members.length === 0) return false;
  const seen = new Set<number>([members[0]]);
  const stack = [members[0]];
  while (stack.length) {
    const cur = stack.pop()!;
    const r = Math.floor(cur / size);
    const c = cur % size;
    for (const [dr, dc] of DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      const n = nr * size + nc;
      if (n === cell || regions[n] !== reg || seen.has(n)) continue;
      seen.add(n);
      stack.push(n);
    }
  }
  return seen.size === members.length;
}

/**
 * Tries to make the layout uniquely solvable by stealing cells that alternate
 * solutions rely on and handing them to a neighboring region.
 */
function refine(size: number, regions: number[], solution: number[], rng: Rng): boolean {
  const anchors = new Set(solution.map((c, r) => r * size + c));
  for (let iter = 0; iter < size * size * 4; iter++) {
    const sols = solve(size, regions, 2);
    if (sols.length === 1) return true;
    const alt = sols.find((s) => s.some((c, r) => c !== solution[r]))!;
    const candidates = shuffle(
      alt.map((c, r) => r * size + c).filter((cell) => !anchors.has(cell)),
      rng,
    );
    let moved = false;
    for (const cell of candidates) {
      const r = Math.floor(cell / size);
      const c = cell % size;
      const neighborRegions = shuffle(
        DIRS.map(([dr, dc]) => [r + dr, c + dc])
          .filter(([nr, nc]) => nr >= 0 && nr < size && nc >= 0 && nc < size)
          .map(([nr, nc]) => regions[nr * size + nc])
          .filter((reg) => reg !== regions[cell]),
        rng,
      );
      if (neighborRegions.length === 0 || !isConnectedWithout(size, regions, cell)) continue;
      regions[cell] = neighborRegions[0];
      moved = true;
      break;
    }
    if (!moved) return false;
  }
  return false;
}

export function generate(size: number, seed: number): Puzzle {
  const rng = mulberry32(seed);
  for (;;) {
    const solution = randomPlacement(size, rng);
    const regions = growRegions(size, solution, rng);
    if (refine(size, regions, solution, rng)) {
      return { size, regions, solution, seed };
    }
  }
}

