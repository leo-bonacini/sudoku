# Sudoku

A modern, dependency-free Sudoku game built with plain HTML5, CSS3, and vanilla JavaScript (ES6+): no frameworks, no build step.

## Features

- Four difficulty levels (Easy, Medium, Hard, Expert) driven by clue count, each generated with a guaranteed unique solution
- Backtracking solver with candidate-based pruning, used for board generation, solvability checks, and hints
- Pencil-mark notes mode with automatic candidate cleanup when a number is placed nearby
- Full undo/redo history (buttons and Ctrl+Z / Ctrl+Y)
- Limited hint system (3 per game) that reveals a correct digit without spoiling the rest of the board
- Real-time conflict highlighting (duplicate row/column/box) plus a silent mistake counter compared against the solution
- Selection highlighting for the active cell, its row/column/box, matching numbers, and matching candidates
- Timer with pause/resume and per-difficulty best times
- Auto-save to `localStorage`: board, notes, timer, difficulty, and move history all survive a page refresh
- Statistics tracking: games played, games won, completion %, average time, hints used, mistakes
- Confetti and a synthesized victory chime (Web Audio API, no audio files) on solve
- Dark, light, and high-contrast themes with a live theme switcher
- Export/import puzzles as an 81-character code, and a deterministic Daily Challenge seeded by today's date
- Fully responsive, touch-friendly glassmorphism UI
- Accessibility: full keyboard play, ARIA labels, visible focus states, high-contrast mode

## Controls

| Action | Input |
|---|---|
| Select a cell | Click, or Tab / Arrow keys |
| Enter a number | 1–9, or click the number pad |
| Erase a cell | Backspace / Delete |
| Toggle notes mode | N, or the Notes button |
| Undo / Redo | Ctrl+Z / Ctrl+Y, or the Undo/Redo buttons |
| Use a hint | Hint button (3 per game) |
| Pause / Resume | Pause button |

## Technologies

- HTML5
- CSS3 (custom properties, Grid, glassmorphism, keyframe animations)
- Vanilla JavaScript (ES6+, no modules/bundler required)
- Web Audio API for synthesized sound effects
- `localStorage` for save state, settings, and statistics

No React, Vue, Angular, Bootstrap, or Tailwind.

## Folder Structure

```
sudoku/
├── index.html
├── style.css
├── script.js
└── README.md
```

## Installation

No build tooling required.

```bash
git clone https://github.com/leo-bonacini/sudoku.git
cd sudoku
open index.html
```

Or serve it locally:

```bash
cd sudoku
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deployment

The game is fully static, so it's served directly from this repo via GitHub Pages (Settings → Pages → deploy from the `main` branch, root folder). No build step, so there's nothing to publish beyond pushing to `main`.
