# Eggdoku 🍆

A logic puzzle about placing eggplants, with a dark mode.

## Rules

Place one eggplant in every **row**, every **column** and every **color region**.
Eggplants can't **touch** each other, not even diagonally. Every puzzle has exactly one solution.

## Controls

- **Tap** a square to toggle ✕; **double-tap** (or double-click) to place or remove an eggplant
- **Drag** from an empty square to mark ✕ along the path; start on a ✕ to clear them instead
- **Undo**, **Clear**, and an optional **Auto-✕** that marks the squares an eggplant rules out

## Modes

- **Adventure**: 50 levels on a map in six chapters, growing from 5×5 to 10×10. Each level earns 1–3 eggplant stars (one fewer per mistake), and clearing a level moves on to the next one automatically.
- **Daily**: a new 8×8 puzzle every day. It's the same for everyone because it's seeded by the date.
- **Practice**: endless puzzles from 5×5 to 10×10.

A wrong eggplant costs one of three hearts. Scores reward bigger boards and fast solves.
Your progress, theme and settings are saved in localStorage.

## Development

```sh
npm install
npm run dev      # dev server
npm test         # generator uniqueness tests
npm run build    # static build in dist/
```

## Layout

- `src/puzzle.ts`: seeded generator and solver. It places a valid solution, grows regions from each eggplant, then moves cells around until the solver finds exactly one solution.
- `src/game.ts`: board rules (conflicts, solved check, auto-✕ targets, scoring)
- `src/levels.ts`: adventure chapters and level seeds
- `src/main.ts`: screens (menu, map, game), input gestures, timer, persistence, celebrations
- `src/style.css`: light and dark themes, animations
