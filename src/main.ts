import './style.css';
import {
  blockedBy,
  EGG,
  EMPTY,
  findConflicts,
  isSolutionCell,
  isSolved,
  MARK,
  MAX_LIVES,
  scoreFor,
  type CellState,
  type Score,
} from './game';
import { CHAPTERS, getLevel, LEVELS, starsFor } from './levels';
import { generate, hashString, mulberry32, type Puzzle } from './puzzle';

type Mode = 'daily' | 'practice' | 'level';
type StatMode = Exclude<Mode, 'level'>;
type Screen = 'menu' | 'map' | 'game';

interface SavedGame {
  id: string;
  size: number;
  seed: number;
  cells: CellState[];
  elapsed: number;
  solved: boolean;
  mistakes?: number;
  lost?: boolean;
}

interface Stats {
  best: number;
  streak: number;
  bestStreak: number;
  /** Puzzle id of the most recent win, used to keep the daily streak going. */
  lastWonId?: string;
}

interface Store {
  theme?: 'light' | 'dark';
  autoX: boolean;
  practiceSize: number;
  mode: Mode;
  games: Partial<Record<Mode, SavedGame>>;
  stats: Record<StatMode, Stats>;
  levels: { cleared: Record<number, { stars: number; best: number }> };
}

const STORE_KEY = 'eggdoku:v1';
const DAILY_SIZE = 8;
const REGION_COLORS = 10;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const boardEl = $<HTMLDivElement>('board');
const timerEl = $('timer');
const subtitleEl = $('subtitle');
const backBtn = $<HTMLButtonElement>('back-btn');
const screens: Record<Screen, HTMLElement> = {
  menu: $('menu-screen'),
  map: $('map-screen'),
  game: $('game-screen'),
};
const mapEl = $('map');
const undoBtn = $<HTMLButtonElement>('undo-btn');
const clearBtn = $<HTMLButtonElement>('clear-btn');
const newBtn = $<HTMLButtonElement>('new-btn');
const sizePicker = $('size-picker');
const sizeSelect = $<HTMLSelectElement>('size-select');
const autoXToggle = $<HTMLInputElement>('autox-toggle');
const livesEl = $('lives');
const helpDialog = $<HTMLDialogElement>('help-dialog');
const winDialog = $<HTMLDialogElement>('win-dialog');
const loseDialog = $<HTMLDialogElement>('lose-dialog');
const levelDialog = $<HTMLDialogElement>('level-dialog');

// ---------- Persistence ----------

function loadStore(): Store {
  const freshStats = (): Stats => ({ best: 0, streak: 0, bestStreak: 0 });
  const fallback: Store = {
    autoX: false,
    practiceSize: 8,
    mode: 'daily',
    games: {},
    stats: { daily: freshStats(), practice: freshStats() },
    levels: { cleared: {} },
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return {
      ...fallback,
      ...saved,
      stats: { ...fallback.stats, ...saved.stats },
      levels: { ...fallback.levels, ...saved.levels },
    };
  } catch {
    return fallback;
  }
}

const store = loadStore();

function persist() {
  if (game) {
    store.games[store.mode] = {
      id: game.id,
      size: game.puzzle.size,
      seed: game.puzzle.seed,
      cells: game.cells,
      elapsed: timer.elapsed(),
      solved: game.solved,
      mistakes: game.mistakes,
      lost: game.lost,
    };
  }
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Storage unavailable (private mode, quota) — the game still works.
  }
}

// ---------- Timer ----------

const timer = (() => {
  let acc = 0;
  let base = 0;
  let running = false;
  const elapsed = () => acc + (running ? performance.now() - base : 0);
  const render = () => (timerEl.textContent = formatTime(elapsed()));
  setInterval(render, 250);
  return {
    elapsed,
    reset(ms: number) {
      acc = ms;
      base = performance.now();
      render();
    },
    start() {
      if (running) return;
      base = performance.now();
      running = true;
    },
    stop() {
      if (!running) return;
      acc = elapsed();
      running = false;
      render();
    },
  };
})();

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

document.addEventListener('visibilitychange', () => {
  if (!game || isOver() || screen !== 'game') return;
  if (document.hidden) {
    timer.stop();
    persist();
  } else {
    timer.start();
  }
});

// ---------- Game state ----------

interface Game {
  id: string;
  puzzle: Puzzle;
  cells: CellState[];
  history: CellState[][];
  solved: boolean;
  mistakes: number;
  lost: boolean;
  /** Adventure level number, when playing one. */
  level?: number;
}

let game: Game | null = null;
const isOver = () => !!game && (game.solved || game.lost);
let cellEls: HTMLDivElement[] = [];

function todayId(): string {
  const d = new Date();
  return dateId(d);
}

function dateId(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function yesterdayId(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dateId(d);
}

/** A daily streak only counts if the last win was today or yesterday. */
function currentStreak(mode: StatMode): number {
  const st = store.stats[mode];
  if (mode === 'daily' && st.lastWonId !== todayId() && st.lastWonId !== yesterdayId()) return 0;
  return st.streak;
}

/** The first level not yet cleared (or the last level once all are). */
function currentLevel(): number {
  const next = LEVELS.find((l) => !store.levels.cleared[l.n]);
  return next ? next.n : LEVELS.length;
}

function startGame(mode: Mode, forceNew = false, levelN = 1) {
  if (game) persist();
  store.mode = mode;
  const saved = store.games[mode];
  let id: string;
  let size: number;
  let seed: number;

  if (mode === 'daily') {
    id = todayId();
    size = DAILY_SIZE;
    seed = hashString(`eggdoku-${id}`);
  } else if (mode === 'level') {
    const lv = getLevel(levelN);
    id = `level-${lv.n}`;
    size = lv.size;
    seed = lv.seed;
    // Replaying a cleared level starts it fresh.
    if (saved?.id === id && saved.solved) forceNew = true;
  } else if (saved && !forceNew) {
    ({ id, size, seed } = saved);
  } else {
    size = store.practiceSize;
    seed = Math.floor(Math.random() * 2 ** 32);
    id = `p-${seed}`;
  }

  const resume = saved && saved.id === id && saved.size === size && !forceNew ? saved : null;
  game = {
    id,
    puzzle: generate(size, seed),
    cells: resume ? [...resume.cells] : new Array(size * size).fill(EMPTY),
    history: [],
    solved: resume?.solved ?? false,
    mistakes: resume?.mistakes ?? 0,
    lost: resume?.lost ?? false,
    level: mode === 'level' ? levelN : undefined,
  };
  showGame(resume?.elapsed ?? 0);
  showScreen('game');
}

/** Starts the current puzzle over from scratch after running out of lives. */
function retryGame() {
  const g = game!;
  Object.assign(g, {
    cells: new Array(g.puzzle.size ** 2).fill(EMPTY),
    history: [],
    solved: false,
    mistakes: 0,
    lost: false,
  });
  showGame(0);
}

function showGame(elapsed: number) {
  lastTap = null;
  wrongFlash.clear();
  timer.stop();
  timer.reset(elapsed);
  if (!isOver()) timer.start();
  buildBoard();
  render();
  renderLives();
  persist();
}

function renderLives(justLost = -1) {
  const g = game!;
  livesEl.replaceChildren(
    ...Array.from({ length: MAX_LIVES }, (_, k) => {
      const heart = document.createElement('span');
      heart.className = 'heart';
      heart.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.3C1 8.4 3 5 6.4 5c2.1 0 3.6 1.2 5.6 3.3C14 6.2 15.5 5 17.6 5 21 5 23 8.4 21.6 11.7 19.5 16.4 12 21 12 21z"/></svg>';
      // Hearts are spent from the right.
      const spent = k >= MAX_LIVES - g.mistakes;
      heart.classList.toggle('spent', spent);
      heart.classList.toggle('breaking', k === MAX_LIVES - 1 - justLost);
      return heart;
    }),
  );
  livesEl.setAttribute('aria-label', `${MAX_LIVES - g.mistakes} of ${MAX_LIVES} lives left`);
}

function updateChrome() {
  if (!game) return;
  const size = game.puzzle.size;
  if (store.mode === 'level') {
    subtitleEl.textContent = `Level ${game.level} · ${CHAPTERS[getLevel(game.level!).chapter].name}`;
  } else {
    subtitleEl.textContent =
      store.mode === 'daily'
        ? `Daily · ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
        : `Practice · ${size}×${size}`;
    const streak = currentStreak(store.mode);
    if (streak > 1) subtitleEl.textContent += ` · ${streak} ${store.mode === 'daily' ? 'days' : 'wins'} in a row`;
  }
  sizePicker.classList.toggle('hidden', store.mode !== 'practice');
  sizeSelect.value = String(store.practiceSize);
  newBtn.hidden = store.mode !== 'practice';
  undoBtn.disabled = isOver() || game.history.length === 0;
  clearBtn.disabled = isOver() || game.cells.every((c) => c === EMPTY);
  autoXToggle.checked = store.autoX;
}

// ---------- Board rendering ----------

/**
 * Picks a palette slot per region. The palette is a hue wheel, so neighboring
 * regions are given colors as far apart on the wheel as possible.
 */
function assignColors({ size, regions, seed }: Puzzle): number[] {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const adj = Array.from({ length: size }, () => new Set<number>());
  for (let i = 0; i < size * size; i++) {
    const right = i % size < size - 1 ? regions[i + 1] : regions[i];
    const down = i + size < size * size ? regions[i + size] : regions[i];
    for (const n of [right, down]) {
      if (n !== regions[i]) {
        adj[regions[i]].add(n);
        adj[n].add(regions[i]);
      }
    }
  }
  const ringDist = (a: number, b: number) => {
    const d = Math.abs(a - b);
    return Math.min(d, REGION_COLORS - d);
  };
  const colors = new Array<number>(size).fill(-1);
  const tiebreak = [...Array(size)].map(() => rng());
  const order = [...Array(size).keys()].sort((a, b) => adj[b].size - adj[a].size || tiebreak[a] - tiebreak[b]);
  for (const reg of order) {
    let best = -1;
    let bestScore = -1;
    const offset = Math.floor(rng() * REGION_COLORS);
    for (let k = 0; k < REGION_COLORS; k++) {
      const color = (k + offset) % REGION_COLORS;
      if (colors.includes(color)) continue;
      const near = [...adj[reg]].filter((n) => colors[n] >= 0).map((n) => ringDist(colors[n], color));
      const score = near.length ? Math.min(...near) : REGION_COLORS;
      if (score > bestScore) {
        best = color;
        bestScore = score;
      }
    }
    colors[reg] = best;
  }
  return colors;
}

function buildBoard() {
  const { size, regions } = game!.puzzle;
  const palette = assignColors(game!.puzzle);

  boardEl.style.setProperty('--size', String(size));
  boardEl.classList.remove('won', 'lost');
  boardEl.replaceChildren();
  cellEls = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const i = r * size + c;
      const reg = regions[i];
      const el = document.createElement('div');
      el.className = 'cell';
      el.style.setProperty('--rc', `var(--r${palette[reg]})`);
      el.style.setProperty('--d', `${(r + c) * 0.045}s`);
      if (r > 0 && regions[i - size] !== reg) el.classList.add('bt');
      if (r < size - 1 && regions[i + size] !== reg) el.classList.add('bb');
      if (c > 0 && regions[i - 1] !== reg) el.classList.add('bl');
      if (c < size - 1 && regions[i + 1] !== reg) el.classList.add('br');
      el.innerHTML =
        '<div class="mark"><svg><use href="#mark"/></svg></div>' +
        '<div class="egg-wrap"><svg class="egg"><use href="#eggplant"/></svg></div>';
      boardEl.appendChild(el);
      cellEls.push(el);
    }
  }
  boardEl.classList.remove('entering');
  void boardEl.offsetWidth;
  boardEl.classList.add('entering');
  setTimeout(() => boardEl.classList.remove('entering'), 1200);
}

function render() {
  const g = game!;
  const conflicts = findConflicts(g.puzzle, g.cells);
  g.cells.forEach((state, i) => {
    const el = cellEls[i];
    const flashing = wrongFlash.has(i);
    el.classList.toggle('is-mark', state === MARK && !flashing);
    el.classList.toggle('is-egg', state === EGG || flashing);
    el.classList.toggle('wrong', flashing);
    el.classList.toggle('bad', conflicts.cells.has(i));
    el.classList.toggle('egg-bad', conflicts.eggs.has(i));
  });
  if (g.solved) {
    boardEl.classList.remove('entering');
    boardEl.classList.add('won');
  }
  boardEl.classList.toggle('lost', g.lost);
  updateChrome();
}

// ---------- Moves ----------

function commit(before: CellState[]) {
  const g = game!;
  if (before.every((s, i) => s === g.cells[i])) return;
  g.history.push(before);
  if (g.history.length > 300) g.history.shift();
  let score: Score | null = null;
  if (isSolved(g.puzzle, g.cells)) {
    g.solved = true;
    timer.stop();
    score = recordWin();
  }
  render();
  if (score) celebrateWin(score);
  persist();
}

function recordWin(): Score {
  const g = game!;
  const score = scoreFor(g.puzzle.size, timer.elapsed(), g.mistakes);
  if (store.mode === 'level') {
    const prev = store.levels.cleared[g.level!];
    firstClear = !prev;
    newBest = !!prev && score.total > prev.best;
    store.levels.cleared[g.level!] = {
      stars: Math.max(prev?.stars ?? 0, starsFor(g.mistakes)),
      best: Math.max(prev?.best ?? 0, score.total),
    };
    return score;
  }
  const st = store.stats[store.mode];
  const prevBest = st.best;
  const continues = store.mode === 'practice' || st.lastWonId === yesterdayId();
  st.streak = continues ? st.streak + 1 : 1;
  st.bestStreak = Math.max(st.bestStreak, st.streak);
  st.best = Math.max(st.best, score.total);
  st.lastWonId = g.id;
  newBest = score.total > prevBest;
  return score;
}
let newBest = false;
let firstClear = false;

/** Squares briefly showing a rejected eggplant before it turns into a ✕. */
const wrongFlash = new Set<number>();

function wrongEggplant(i: number, before: CellState[]) {
  const g = game!;
  g.cells[i] = MARK;
  g.mistakes++;
  wrongFlash.add(i);
  setTimeout(() => {
    wrongFlash.delete(i);
    if (game === g) render();
  }, 650);
  renderLives(g.mistakes - 1);
  if (g.mistakes >= MAX_LIVES) {
    g.lost = true;
    timer.stop();
    if (store.mode !== 'level') {
      const st = store.stats[store.mode];
      st.streak = 0;
      st.lastWonId = undefined;
    }
    setTimeout(() => {
      if (game === g && g.lost && !loseDialog.open) showLoseDialog();
    }, 1100);
  }
  commit(before);
}

function showLoseDialog() {
  $('lose-next').textContent = { daily: 'Play practice', practice: 'New puzzle', level: 'Map' }[store.mode];
  $('lose-text').textContent =
    store.mode === 'level'
      ? 'Three eggplants went in the wrong squares. Try the level again or head back to the map.'
      : 'Three eggplants went in the wrong squares. Your streak resets, but you can try this puzzle again.';
  loseDialog.returnValue = '';
  loseDialog.showModal();
}

const DOUBLE_TAP_MS = 350;
let lastTap: { i: number; time: number; before: CellState[] } | null = null;

/**
 * A single tap toggles ✕ (or clears an eggplant) right away. A second tap on
 * the same square soon after rolls that back and toggles an eggplant instead,
 * as one undo step.
 */
function tap(i: number) {
  const g = game!;
  const now = performance.now();
  let before: CellState[];
  let next: CellState;
  if (lastTap && lastTap.i === i && now - lastTap.time < DOUBLE_TAP_MS) {
    before = lastTap.before;
    g.history.pop();
    g.cells = [...before];
    next = before[i] === EGG ? EMPTY : EGG;
    lastTap = null;
  } else {
    before = [...g.cells];
    next = g.cells[i] === EMPTY ? MARK : EMPTY;
    lastTap = { i, time: now, before };
  }
  if (next === EGG && !isSolutionCell(g.puzzle, i)) {
    wrongEggplant(i, before);
    return;
  }
  g.cells[i] = next;
  if (next === EGG && store.autoX) {
    for (const j of blockedBy(g.puzzle, i)) if (g.cells[j] === EMPTY) g.cells[j] = MARK;
  }
  commit(before);
}

type DragMode = 'mark' | 'clear';

function dragApply(i: number, mode: DragMode) {
  const cells = game!.cells;
  if (mode === 'mark' && cells[i] === EMPTY) cells[i] = MARK;
  else if (mode === 'clear' && cells[i] === MARK) cells[i] = EMPTY;
}

let drag: {
  pointerId: number;
  start: number;
  last: number;
  mode: DragMode | null;
  before: CellState[];
} | null = null;

function cellAt(e: PointerEvent): number {
  const size = game!.puzzle.size;
  const rect = boardEl.getBoundingClientRect();
  const c = Math.floor(((e.clientX - rect.left) / rect.width) * size);
  const r = Math.floor(((e.clientY - rect.top) / rect.height) * size);
  if (r < 0 || r >= size || c < 0 || c >= size) return -1;
  return r * size + c;
}

/** Cells on the straight line between a and b, so fast swipes don't skip any. */
function cellsBetween(a: number, b: number): number[] {
  const size = game!.puzzle.size;
  const [r0, c0, r1, c1] = [Math.floor(a / size), a % size, Math.floor(b / size), b % size];
  const steps = Math.max(Math.abs(r1 - r0), Math.abs(c1 - c0));
  const out: number[] = [];
  for (let s = 1; s <= steps; s++) {
    const r = Math.round(r0 + ((r1 - r0) * s) / steps);
    const c = Math.round(c0 + ((c1 - c0) * s) / steps);
    out.push(r * size + c);
  }
  return out;
}

boardEl.addEventListener('pointerdown', (e) => {
  if (!game || drag) return;
  if (game.lost && !loseDialog.open) showLoseDialog();
  if (isOver()) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const i = cellAt(e);
  if (i < 0) return;
  e.preventDefault();
  boardEl.setPointerCapture(e.pointerId);
  drag = { pointerId: e.pointerId, start: i, last: i, mode: null, before: [...game.cells] };
});

boardEl.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const i = cellAt(e);
  if (i < 0 || i === drag.last) return;
  if (!drag.mode) {
    // First move into another cell turns the gesture into a drag.
    drag.mode = game!.cells[drag.start] === MARK ? 'clear' : 'mark';
    dragApply(drag.start, drag.mode);
  }
  for (const j of cellsBetween(drag.last, i)) dragApply(j, drag.mode);
  drag.last = i;
  render();
});

function endDrag(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = drag;
  drag = null;
  if (d.mode) {
    lastTap = null;
    commit(d.before);
  } else if (e.type === 'pointerup') tap(d.start);
}
boardEl.addEventListener('pointerup', endDrag);
boardEl.addEventListener('pointercancel', endDrag);
boardEl.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- Celebration ----------

function celebrateWin(score: Score) {
  if (store.mode === 'level') return celebrateLevel(score);
  const g = game!;
  const size = g.puzzle.size;
  const waveTime = (size * 2 - 2) * 45 + 800;
  spawnConfetti();
  $('win-text').textContent =
    `${store.mode === 'daily' ? "Today's" : `This ${size}×${size}`} puzzle solved in ${formatTime(timer.elapsed())}.`;
  $('s-base').textContent = fmt(score.base);
  $('s-time').textContent = `+${fmt(score.timeBonus)}`;
  $('s-pen').textContent = score.penalty ? `−${fmt(score.penalty)}` : 'None';
  $('s-pen-label').textContent = g.mistakes === 1 ? '1 mistake' : `${g.mistakes} mistakes`;
  $('s-total').textContent = '0';
  const st = store.stats[store.mode];
  $('s-best').textContent = newBest ? 'New best!' : `Best ${fmt(st.best)}`;
  $('s-best').classList.toggle('new-best', newBest);
  $('s-streak').textContent = `${store.mode === 'daily' ? 'Day streak' : 'Win streak'} ${st.streak}`;
  $('win-next').textContent = store.mode === 'daily' ? 'Play practice' : 'Next puzzle';
  setTimeout(() => {
    if (game === g && !winDialog.open) {
      winDialog.returnValue = '';
      winDialog.showModal();
      countUp($('s-total'), score.total);
    }
  }, waveTime);
}

const AUTO_NEXT_MS = 2800;
let autoNextTimer = 0;

function celebrateLevel(score: Score) {
  const g = game!;
  const n = g.level!;
  const last = n >= LEVELS.length;
  const earned = starsFor(g.mistakes);
  const waveTime = (g.puzzle.size * 2 - 2) * 45 + 700;
  spawnConfetti();
  $('lv-title').textContent = last ? 'Every level cleared!' : `Level ${n} cleared!`;
  $('lv-stars').innerHTML = [0, 1, 2]
    .map((k) => `<svg class="star${k < earned ? ' earned' : ''}" style="--k:${k}"><use href="#eggplant"/></svg>`)
    .join('');
  $('lv-score').textContent = fmt(score.total);
  $('lv-best').textContent = firstClear
    ? 'First clear'
    : newBest
      ? 'New best!'
      : `Best ${fmt(store.levels.cleared[n].best)}`;
  $('lv-best').classList.toggle('new-best', newBest);
  $('lv-next').hidden = last;
  const bar = $('lv-autonext');
  bar.hidden = last;
  setTimeout(() => {
    if (game !== g || levelDialog.open) return;
    levelDialog.returnValue = '';
    levelDialog.showModal();
    if (last) return;
    // Restart the progress bar animation, then move on when it fills.
    bar.classList.remove('running');
    void bar.offsetWidth;
    bar.classList.add('running');
    clearTimeout(autoNextTimer);
    autoNextTimer = window.setTimeout(() => {
      if (levelDialog.open) levelDialog.close('next');
    }, AUTO_NEXT_MS);
  }, waveTime);
}

levelDialog.addEventListener('close', () => {
  clearTimeout(autoNextTimer);
  $('lv-autonext').classList.remove('running');
  const n = game?.level ?? 1;
  if (levelDialog.returnValue === 'next') startGame('level', true, n + 1);
  else if (levelDialog.returnValue === 'map') showScreen('map');
});

const fmt = (n: number) => n.toLocaleString();

function countUp(el: HTMLElement, target: number) {
  const start = performance.now();
  const dur = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900;
  const step = (now: number) => {
    const t = dur ? Math.min(1, (now - start) / dur) : 1;
    el.textContent = fmt(Math.round(target * (1 - (1 - t) ** 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function spawnConfetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (let k = 0; k < 36; k++) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('confetti');
    svg.innerHTML = '<use href="#eggplant"/>';
    const scale = 0.6 + Math.random() * 0.8;
    svg.style.left = `${Math.random() * 100}vw`;
    svg.style.width = svg.style.height = `${32 * scale}px`;
    svg.style.setProperty('--dx', `${(Math.random() - 0.5) * 200}px`);
    svg.style.setProperty('--rot', `${(Math.random() - 0.5) * 1080}deg`);
    svg.style.setProperty('--dur', `${2.2 + Math.random() * 1.6}s`);
    svg.style.setProperty('--delay', `${Math.random() * 0.8}s`);
    document.body.appendChild(svg);
    svg.addEventListener('animationend', () => svg.remove());
  }
}

winDialog.addEventListener('close', () => {
  if (winDialog.returnValue === 'next') startGame('practice', true);
});

loseDialog.addEventListener('close', () => {
  if (loseDialog.returnValue === 'retry') retryGame();
  else if (loseDialog.returnValue === 'next') {
    if (store.mode === 'level') showScreen('map');
    else startGame('practice', true);
  }
});

// ---------- Controls ----------

undoBtn.addEventListener('click', () => {
  const g = game!;
  const prev = g.history.pop();
  if (!prev || isOver()) return;
  g.cells = prev;
  render();
  persist();
});

clearBtn.addEventListener('click', () => {
  const g = game!;
  if (isOver()) return;
  const before = [...g.cells];
  g.cells.fill(EMPTY);
  commit(before);
});

newBtn.addEventListener('click', () => startGame('practice', true));

sizeSelect.addEventListener('change', () => {
  store.practiceSize = Number(sizeSelect.value);
  startGame('practice', true);
});

autoXToggle.addEventListener('change', () => {
  store.autoX = autoXToggle.checked;
  persist();
});

backBtn.addEventListener('click', () => {
  showScreen(screen === 'game' && store.mode === 'level' ? 'map' : 'menu');
});

$('help-btn').addEventListener('click', () => helpDialog.showModal());

$('theme-btn').addEventListener('click', () => {
  const root = document.documentElement;
  const current =
    root.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  store.theme = next;
  persist();
});

// Close dialogs by tapping the backdrop.
for (const dlg of [helpDialog, winDialog, loseDialog, levelDialog]) {
  dlg.addEventListener('click', (e) => {
    const r = dlg.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (e.target === dlg && !inside) dlg.close();
  });
}

// ---------- Screens ----------

let screen: Screen = 'menu';

function showScreen(next: Screen) {
  if (screen === 'game' && next !== 'game' && game) {
    timer.stop();
    persist();
  }
  screen = next;
  for (const [name, el] of Object.entries(screens)) el.hidden = name !== next;
  backBtn.hidden = next === 'menu';
  document.body.dataset.screen = next;
  if (next === 'menu') renderMenu();
  if (next === 'map') renderMap(true);
  else window.scrollTo(0, 0);
  if (next === 'game' && !isOver()) timer.start();
}

function renderMenu() {
  const cur = currentLevel();
  const allCleared = Object.keys(store.levels.cleared).length >= LEVELS.length;
  $('menu-adventure-sub').textContent = allCleared
    ? `All ${LEVELS.length} levels cleared`
    : `Level ${cur} · ${CHAPTERS[getLevel(cur).chapter].name}`;

  const daily = store.games.daily;
  const solvedToday = daily?.id === todayId() && daily.solved;
  const streak = currentStreak('daily');
  $('menu-daily-sub').textContent = [
    solvedToday ? 'Solved today' : new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' }),
    streak ? `${streak}-day streak` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  $('menu-daily').classList.toggle('done', !!solvedToday);

  const best = store.stats.practice.best;
  $('menu-practice-sub').textContent = best ? `Endless puzzles · best ${fmt(best)}` : 'Endless puzzles, any size';
}

$('menu-adventure').addEventListener('click', () => showScreen('map'));
$('menu-daily').addEventListener('click', () => startGame('daily'));
$('menu-practice').addEventListener('click', () => startGame('practice'));

// ---------- Adventure map ----------

/** Chapter background tints, picked from the region palette. */
const CHAPTER_TINTS = [4, 3, 5, 2, 6, 8];
const STAR_SVG = '<svg><use href="#eggplant"/></svg>';

/** Lays the levels out bottom-up along a winding path, chapter by chapter. */
function renderMap(scrollToCurrent = false) {
  const width = mapEl.clientWidth || 360;
  const spacing = 96;
  const bannerSpace = 64;
  const amp = Math.min(width * 0.3, 140);
  const cur = currentLevel();

  // Positions are measured from the bottom of the map first. Each chapter is
  // a band that opens with its banner, followed by its levels.
  const nodes: { n: number; x: number; y: number }[] = [];
  const bands: { ch: number; from: number; to: number }[] = [];
  let y = 0;
  CHAPTERS.forEach((_, ch) => {
    const from = y;
    y += bannerSpace + spacing / 2;
    for (const lv of LEVELS.filter((l) => l.chapter === ch)) {
      nodes.push({ n: lv.n, x: width / 2 + amp * Math.sin((lv.n - 1) * 0.8), y });
      y += spacing;
    }
    y -= spacing / 2;
    bands.push({ ch, from, to: y });
  });
  const height = y;
  const top = (b: number) => height - b;

  const pathD = (pts: typeof nodes) =>
    pts
      .map((p, i) => {
        if (i === 0) return `M${p.x},${top(p.y)}`;
        const prev = pts[i - 1];
        const mid = (top(prev.y) + top(p.y)) / 2;
        return `C${prev.x},${mid} ${p.x},${mid} ${p.x},${top(p.y)}`;
      })
      .join(' ');

  const html: string[] = [];
  for (const b of bands) {
    const chapter = CHAPTERS[b.ch];
    const locked = LEVELS.find((l) => l.chapter === b.ch)!.n > cur;
    html.push(
      `<div class="map-band" style="top:${top(b.to)}px;height:${b.to - b.from}px;--tint:var(--r${CHAPTER_TINTS[b.ch]})"></div>`,
      `<div class="map-banner${locked ? ' locked' : ''}" style="top:${top(b.from) - bannerSpace + 14}px">` +
        `<span class="ch-num">Chapter ${b.ch + 1}</span>${chapter.name}<span class="ch-size">${chapter.size}×${chapter.size}</span></div>`,
    );
  }
  html.push(
    `<svg class="map-path" width="${width}" height="${height}">` +
      `<path class="trail" d="${pathD(nodes)}"/>` +
      `<path class="trail-done" d="${pathD(nodes.slice(0, cur))}"/></svg>`,
  );
  for (const node of nodes) {
    const rec = store.levels.cleared[node.n];
    const state = rec ? 'cleared' : node.n === cur ? 'current' : 'locked';
    const stars = rec
      ? `<span class="node-stars">${[0, 1, 2].map((k) => `<span class="${k < rec.stars ? 'on' : ''}">${STAR_SVG}</span>`).join('')}</span>`
      : '';
    const avatar = node.n === cur ? '<svg class="avatar"><use href="#eggplant"/></svg>' : '';
    html.push(
      `<button class="map-node ${state}" data-level="${node.n}" style="left:${node.x}px;top:${top(node.y)}px"` +
        ` aria-label="Level ${node.n}${state === 'locked' ? ' (locked)' : ''}">${avatar}<span class="num">${node.n}</span>${stars}</button>`,
    );
  }
  mapEl.style.height = `${height}px`;
  mapEl.innerHTML = html.join('');

  const totalStars = Object.values(store.levels.cleared).reduce((sum, r) => sum + r.stars, 0);
  $('map-progress').innerHTML =
    `<span>${Object.keys(store.levels.cleared).length} of ${LEVELS.length} levels</span>` +
    `<span class="map-stars">${STAR_SVG}${totalStars} / ${LEVELS.length * 3}</span>`;

  if (scrollToCurrent) {
    mapEl.querySelector(`.map-node[data-level="${cur}"]`)?.scrollIntoView({ block: 'center' });
  }
}

mapEl.addEventListener('click', (e) => {
  const node = (e.target as HTMLElement).closest<HTMLButtonElement>('.map-node');
  if (!node) return;
  if (node.classList.contains('locked')) {
    node.classList.remove('nope');
    void node.offsetWidth;
    node.classList.add('nope');
    return;
  }
  startGame('level', false, Number(node.dataset.level));
});

let lastMapWidth = 0;
window.addEventListener('resize', () => {
  if (screen === 'map' && mapEl.clientWidth !== lastMapWidth) {
    lastMapWidth = mapEl.clientWidth;
    renderMap();
  }
});

// ---------- Boot ----------

showScreen('menu');
try {
  if (!localStorage.getItem(`${STORE_KEY}:seen-help`)) {
    localStorage.setItem(`${STORE_KEY}:seen-help`, '1');
    helpDialog.showModal();
  }
} catch {
  // No storage: skip the first-run help.
}
