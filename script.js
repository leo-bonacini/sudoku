(function () {
  'use strict';

  /* =====================================================================
     CONSTANTS
     ===================================================================== */
  const DIFFICULTY_CLUES = { easy: 44, medium: 34, hard: 29, expert: 24 };
  const HINTS_LIMIT = 3;
  const STORAGE_KEYS = {
    SAVE: 'sudoku.save.v1',
    STATS: 'sudoku.stats.v1',
    SETTINGS: 'sudoku.settings.v1',
    RECENT_PUZZLES: 'sudoku.recent.v1'
  };

  /* =====================================================================
     UTILITIES
     ===================================================================== */
  // Format seconds as mm:ss for timer and stats display.
  function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  // Capitalize the first letter of a difficulty name for display.
  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // Fisher-Yates shuffle, accepts a pluggable RNG for seeded (daily) puzzles.
  function shuffle(arr, rng) {
    const rand = rng || Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Deterministic PRNG so the daily challenge is identical for all players on a given date.
  function mulberry32(seed) {
    let a = seed;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Numeric seed derived from today's date (YYYYMMDD) for the daily challenge.
  function dateSeedToday() {
    const d = new Date();
    return Number(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`);
  }

  /* =====================================================================
     BOARD
     ===================================================================== */
  const Board = {
    rowOf(i) { return Math.floor(i / 9); },
    colOf(i) { return i % 9; },
    boxOf(i) {
      const r = Board.rowOf(i), c = Board.colOf(i);
      return Math.floor(r / 3) * 3 + Math.floor(c / 3);
    },
    indexOf(r, c) { return r * 9 + c; },
    createEmpty() { return new Array(81).fill(0); },
    // All 20 cells sharing a row, column, or box with i (itself excluded).
    peersOf(i) {
      const r = Board.rowOf(i), c = Board.colOf(i);
      const set = new Set();
      for (let k = 0; k < 9; k++) {
        set.add(Board.indexOf(r, k));
        set.add(Board.indexOf(k, c));
      }
      const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
      for (let dr = 0; dr < 3; dr++) {
        for (let dc = 0; dc < 3; dc++) set.add(Board.indexOf(br + dr, bc + dc));
      }
      set.delete(i);
      return Array.from(set);
    }
  };

  // Precomputed peer list per cell index; avoids recomputation on every render.
  const PEERS = Array.from({ length: 81 }, (_, i) => Board.peersOf(i));

  /* =====================================================================
     SOLVER
     ===================================================================== */
  const Solver = {
    // Legal candidate digits for an empty cell given the current board.
    getCandidates(board, i) {
      const used = new Set();
      PEERS[i].forEach(p => { if (board[p]) used.add(board[p]); });
      const result = [];
      for (let n = 1; n <= 9; n++) if (!used.has(n)) result.push(n);
      return result;
    },
    // True if board[i]'s value duplicates a peer (row/column/box conflict).
    hasConflict(board, i) {
      const val = board[i];
      if (!val) return false;
      return PEERS[i].some(p => board[p] === val);
    },
    // Backtracking solver; fills `board` in place. Randomized candidate order is
    // used to generate varied full boards; deterministic order is used to verify solvability.
    solve(board, options) {
      const opts = options || {};
      const randomize = opts.randomize || false;
      const rng = opts.rng || Math.random;
      const emptyIndex = board.indexOf(0);
      if (emptyIndex === -1) return true;
      let candidates = Solver.getCandidates(board, emptyIndex);
      if (randomize) candidates = shuffle(candidates, rng);
      for (const num of candidates) {
        board[emptyIndex] = num;
        if (Solver.solve(board, opts)) return true;
        board[emptyIndex] = 0;
      }
      return false;
    },
    // Counts solutions up to `limit`, stopping early. Used to guarantee puzzle uniqueness.
    countSolutions(board, limit) {
      const emptyIndex = board.indexOf(0);
      if (emptyIndex === -1) return 1;
      let count = 0;
      const candidates = Solver.getCandidates(board, emptyIndex);
      for (const num of candidates) {
        board[emptyIndex] = num;
        count += Solver.countSolutions(board, limit);
        board[emptyIndex] = 0;
        if (count >= limit) break;
      }
      return count;
    },
    // Produces a fully solved, randomly shuffled 9x9 board.
    generateFullBoard(rng) {
      const board = Board.createEmpty();
      Solver.solve(board, { randomize: true, rng: rng || Math.random });
      return board;
    }
  };

  /* =====================================================================
     GENERATOR
     ===================================================================== */
  const Generator = {
    // Removes digits one at a time, keeping a removal only if the puzzle
    // still has exactly one solution. Guarantees a unique-solution puzzle.
    digHoles(solution, targetClues, rng) {
      const board = solution.slice();
      const indices = shuffle([...Array(81).keys()], rng);
      let clues = 81;
      for (const i of indices) {
        if (clues <= targetClues) break;
        const backup = board[i];
        board[i] = 0;
        const probe = board.slice();
        const solutionCount = Solver.countSolutions(probe, 2);
        if (solutionCount === 1) {
          clues--;
        } else {
          board[i] = backup;
        }
      }
      return board;
    },
    // Generates a full solved board plus a matching puzzle for the given difficulty,
    // retrying if the puzzle was recently seen to avoid repeats.
    generatePuzzle(difficulty) {
      let puzzle, solution, attempts = 0;
      do {
        solution = Solver.generateFullBoard();
        puzzle = Generator.digHoles(solution, DIFFICULTY_CLUES[difficulty] || DIFFICULTY_CLUES.medium);
        attempts++;
      } while (Storage.isRecentPuzzle(puzzle) && attempts < 5);
      Storage.rememberPuzzle(puzzle);
      return { puzzle, solution };
    }
  };

  /* =====================================================================
     STATE
     ===================================================================== */
  const state = {
    puzzle: null, solution: null, board: null, given: null, notes: null,
    difficulty: 'easy', isDaily: false, selected: null, inputMode: 'normal',
    mistakes: 0, hintsUsed: 0, hintsLeft: HINTS_LIMIT,
    elapsedSeconds: 0, timerHandle: null, paused: false, gameActive: false,
    undoStack: [], redoStack: []
  };

  const settings = {
    darkMode: true, animations: true, sound: false, highlightConflicts: true,
    autoSave: true, showTimer: true, highContrast: false
  };

  /* =====================================================================
     UI
     ===================================================================== */
  const UI = {
    boardEl: null, numberPadEl: null, cellEls: [], _toastHandle: null,

    init() {
      UI.boardEl = document.getElementById('board');
      UI.numberPadEl = document.getElementById('number-pad');
      UI.buildBoard();
      UI.buildNumberPad();
    },

    // Builds the 81 cell elements once; subsequent updates only touch their contents.
    buildBoard() {
      UI.boardEl.innerHTML = '';
      UI.cellEls = [];
      for (let i = 0; i < 81; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.setAttribute('role', 'gridcell');
        cell.tabIndex = 0;
        cell.dataset.index = String(i);

        const valueSpan = document.createElement('span');
        valueSpan.className = 'value';
        cell.appendChild(valueSpan);

        const notesGrid = document.createElement('div');
        notesGrid.className = 'notes-grid';
        for (let n = 1; n <= 9; n++) {
          const noteSpan = document.createElement('span');
          noteSpan.dataset.n = String(n);
          notesGrid.appendChild(noteSpan);
        }
        cell.appendChild(notesGrid);

        cell.addEventListener('click', () => Input.selectCell(i));
        cell.addEventListener('focus', () => Input.selectCell(i));
        UI.boardEl.appendChild(cell);
        UI.cellEls.push(cell);
      }
    },

    buildNumberPad() {
      UI.numberPadEl.innerHTML = '';
      for (let n = 1; n <= 9; n++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'num-btn';
        btn.textContent = String(n);
        btn.dataset.n = String(n);
        btn.setAttribute('aria-label', `Enter number ${n}`);
        btn.addEventListener('click', () => Input.handleNumber(n));
        UI.numberPadEl.appendChild(btn);
      }
    },

    renderAll() {
      for (let i = 0; i < 81; i++) UI.renderCell(i);
      UI.updateHighlights();
      UI.updateNumberPadState();
      UI.updateProgress();
    },

    // Refreshes a single cell's displayed value/notes/error state.
    renderCell(i) {
      const cell = UI.cellEls[i];
      const value = state.board[i];
      const valueSpan = cell.querySelector('.value');
      const notesGrid = cell.querySelector('.notes-grid');

      cell.classList.toggle('given', !!state.given[i]);
      cell.classList.toggle('user-value', !state.given[i] && value !== 0);

      const r = Board.rowOf(i), c = Board.colOf(i);
      cell.setAttribute('aria-label', `Row ${r + 1} column ${c + 1}${value ? ', ' + value : ', empty'}`);

      if (value !== 0) {
        valueSpan.textContent = String(value);
        notesGrid.style.display = 'none';
      } else {
        valueSpan.textContent = '';
        notesGrid.style.display = '';
        const noteSet = state.notes[i];
        notesGrid.querySelectorAll('span').forEach(span => {
          const n = Number(span.dataset.n);
          span.textContent = noteSet.has(n) ? String(n) : '';
        });
      }

      cell.classList.remove('error');
      if (settings.highlightConflicts && value !== 0 && Solver.hasConflict(state.board, i)) {
        cell.classList.add('error');
      }
    },

    // Recomputes selection/peer/same-number/candidate highlighting across the board.
    updateHighlights() {
      UI.cellEls.forEach(cell => {
        cell.classList.remove('selected', 'peer', 'same-number');
        cell.querySelectorAll('.notes-grid span').forEach(s => s.classList.remove('highlight-candidate'));
      });
      if (state.selected === null) return;

      const sel = state.selected;
      UI.cellEls[sel].classList.add('selected');
      PEERS[sel].forEach(p => UI.cellEls[p].classList.add('peer'));

      const val = state.board[sel];
      if (val !== 0) {
        for (let i = 0; i < 81; i++) {
          if (state.board[i] === val) UI.cellEls[i].classList.add('same-number');
          else if (state.board[i] === 0 && state.notes[i].has(val)) {
            const span = UI.cellEls[i].querySelector(`.notes-grid span[data-n="${val}"]`);
            if (span) span.classList.add('highlight-candidate');
          }
        }
      }
    },

    // Dims number-pad digits that already appear nine times on the board.
    updateNumberPadState() {
      const counts = new Array(10).fill(0);
      state.board.forEach(v => { if (v) counts[v]++; });
      UI.numberPadEl.querySelectorAll('.num-btn').forEach(btn => {
        const n = Number(btn.dataset.n);
        btn.classList.toggle('depleted', counts[n] >= 9);
      });
    },

    updateProgress() {
      const filled = state.board.filter(v => v !== 0).length;
      const pct = Math.round((filled / 81) * 100);
      document.getElementById('progress-fill').style.width = pct + '%';
      document.getElementById('progress-count').textContent = pct + '%';
    },

    updateDifficultyLabel() {
      document.getElementById('difficulty-label').textContent =
        capitalize(state.difficulty) + (state.isDaily ? ' · Daily' : '');
    },

    updateMistakesAndHints() {
      document.getElementById('mistakes-count').textContent = String(state.mistakes);
      document.getElementById('hints-used-count').textContent = String(state.hintsUsed);
      document.getElementById('hints-left').textContent = String(state.hintsLeft);
      document.getElementById('btn-hint').disabled = state.hintsLeft <= 0;
    },

    flashError(i) {
      const cell = UI.cellEls[i];
      cell.classList.add('shake');
      setTimeout(() => cell.classList.remove('shake'), 400);
    },

    showOverlay(id) { document.getElementById(id).classList.remove('hidden'); },
    hideOverlay(id) { document.getElementById(id).classList.add('hidden'); },

    toast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.remove('hidden');
      clearTimeout(UI._toastHandle);
      UI._toastHandle = setTimeout(() => t.classList.add('hidden'), 2200);
    }
  };

  /* =====================================================================
     STORAGE
     ===================================================================== */
  function serializeNotes(notesArr) { return notesArr.map(s => Array.from(s)); }
  function deserializeNotes(arr) { return arr.map(a => new Set(a)); }
  function serializeSnapshot(snap) {
    return { board: snap.board, notes: serializeNotes(snap.notes), mistakes: snap.mistakes, hintsUsed: snap.hintsUsed, hintsLeft: snap.hintsLeft };
  }
  function deserializeSnapshot(s) {
    return { board: s.board, notes: deserializeNotes(s.notes), mistakes: s.mistakes, hintsUsed: s.hintsUsed, hintsLeft: s.hintsLeft };
  }

  const Storage = {
    saveGame() {
      if (!settings.autoSave || !state.gameActive) return;
      const data = {
        puzzle: state.puzzle, solution: state.solution, board: state.board,
        given: state.given, notes: serializeNotes(state.notes),
        difficulty: state.difficulty, isDaily: state.isDaily,
        elapsedSeconds: state.elapsedSeconds, mistakes: state.mistakes,
        hintsUsed: state.hintsUsed, hintsLeft: state.hintsLeft,
        undoStack: state.undoStack.map(serializeSnapshot),
        redoStack: state.redoStack.map(serializeSnapshot),
        timestamp: Date.now()
      };
      localStorage.setItem(STORAGE_KEYS.SAVE, JSON.stringify(data));
    },

    loadGame() {
      const raw = localStorage.getItem(STORAGE_KEYS.SAVE);
      if (!raw) return null;
      try {
        const data = JSON.parse(raw);
        data.notes = deserializeNotes(data.notes);
        data.undoStack = (data.undoStack || []).map(deserializeSnapshot);
        data.redoStack = (data.redoStack || []).map(deserializeSnapshot);
        return data;
      } catch (e) {
        return null;
      }
    },

    hasSavedGame() { return !!localStorage.getItem(STORAGE_KEYS.SAVE); },
    clearSave() { localStorage.removeItem(STORAGE_KEYS.SAVE); },

    loadSettings() {
      const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (raw) {
        try { Object.assign(settings, JSON.parse(raw)); } catch (e) { /* ignore corrupt settings */ }
      }
    },
    saveSettings() { localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings)); },

    loadStats() {
      const raw = localStorage.getItem(STORAGE_KEYS.STATS);
      if (raw) {
        try { return JSON.parse(raw); } catch (e) { /* fall through to defaults */ }
      }
      return {
        gamesPlayed: 0, gamesWon: 0, totalWinTime: 0, hintsUsedTotal: 0, mistakesTotal: 0,
        bestTimes: { easy: null, medium: null, hard: null, expert: null }
      };
    },
    saveStats(stats) { localStorage.setItem(STORAGE_KEYS.STATS, JSON.stringify(stats)); },

    getRecentPuzzles() {
      const raw = localStorage.getItem(STORAGE_KEYS.RECENT_PUZZLES);
      try { return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
    },
    isRecentPuzzle(puzzle) {
      return Storage.getRecentPuzzles().includes(puzzle.join(''));
    },
    rememberPuzzle(puzzle) {
      const list = Storage.getRecentPuzzles();
      list.push(puzzle.join(''));
      while (list.length > 30) list.shift();
      localStorage.setItem(STORAGE_KEYS.RECENT_PUZZLES, JSON.stringify(list));
    }
  };

  /* =====================================================================
     STATISTICS
     ===================================================================== */
  const Statistics = {
    data: null,

    init() { Statistics.data = Storage.loadStats(); },

    recordGameStart() {
      Statistics.data.gamesPlayed++;
      Storage.saveStats(Statistics.data);
    },

    // Records a win, updating totals and the per-difficulty best time. Returns true if it's a new best.
    recordWin(difficulty, timeSeconds, hintsUsed, mistakes) {
      const d = Statistics.data;
      d.gamesWon++;
      d.totalWinTime += timeSeconds;
      d.hintsUsedTotal += hintsUsed;
      d.mistakesTotal += mistakes;
      let isNewBest = false;
      const best = d.bestTimes[difficulty];
      if (best == null || timeSeconds < best) {
        d.bestTimes[difficulty] = timeSeconds;
        isNewBest = true;
      }
      Storage.saveStats(d);
      return isNewBest;
    },

    render() {
      const d = Statistics.data;
      document.getElementById('stat-played').textContent = String(d.gamesPlayed);
      document.getElementById('stat-won').textContent = String(d.gamesWon);
      const completion = d.gamesPlayed ? Math.round((d.gamesWon / d.gamesPlayed) * 100) : 0;
      document.getElementById('stat-completion').textContent = completion + '%';
      document.getElementById('stat-avg-time').textContent =
        d.gamesWon ? formatTime(Math.round(d.totalWinTime / d.gamesWon)) : '--:--';
      document.getElementById('stat-hints').textContent = String(d.hintsUsedTotal);
      document.getElementById('stat-mistakes').textContent = String(d.mistakesTotal);
      ['easy', 'medium', 'hard', 'expert'].forEach(diff => {
        const el = document.getElementById('stat-best-' + diff);
        const t = d.bestTimes[diff];
        el.textContent = t != null ? formatTime(t) : '--:--';
      });
    }
  };

  /* =====================================================================
     ANIMATIONS
     ===================================================================== */
  const Animations = {
    confetti() {
      if (!settings.animations) return;
      const layer = document.getElementById('confetti-layer');
      layer.innerHTML = '';
      const colors = ['#7c8cff', '#ff7cc8', '#8fe3ff', '#ffd23f', '#6bffb0'];
      for (let i = 0; i < 60; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = Math.random() * 100 + '%';
        piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDuration = (1.2 + Math.random() * 1.2) + 's';
        piece.style.animationDelay = (Math.random() * 0.4) + 's';
        layer.appendChild(piece);
      }
      setTimeout(() => { layer.innerHTML = ''; }, 3000);
    }
  };

  /* =====================================================================
     SETTINGS
     ===================================================================== */
  const Settings = {
    init() {
      Storage.loadSettings();
      Settings.applyToDOM();
    },

    // Pushes the settings object's values onto the DOM (theme, icons, checkboxes, visibility).
    applyToDOM() {
      document.documentElement.setAttribute('data-theme', settings.darkMode ? 'dark' : 'light');
      document.body.classList.toggle('no-animations', !settings.animations);
      document.body.classList.toggle('high-contrast', settings.highContrast);

      document.getElementById('btn-theme').textContent = settings.darkMode ? '🌙' : '☀️';
      document.getElementById('btn-sound').textContent = settings.sound ? '🔊' : '🔇';
      document.getElementById('btn-contrast').classList.toggle('active', settings.highContrast);
      document.getElementById('timer-display').style.visibility = settings.showTimer ? 'visible' : 'hidden';

      document.getElementById('setting-dark-mode').checked = settings.darkMode;
      document.getElementById('setting-animations').checked = settings.animations;
      document.getElementById('setting-sound').checked = settings.sound;
      document.getElementById('setting-highlight-conflicts').checked = settings.highlightConflicts;
      document.getElementById('setting-auto-save').checked = settings.autoSave;
      document.getElementById('setting-show-timer').checked = settings.showTimer;
      document.getElementById('setting-high-contrast').checked = settings.highContrast;

      if (state.gameActive) UI.renderAll();
    },

    save() { Storage.saveSettings(); }
  };

  /* =====================================================================
     SOUND
     ===================================================================== */
  const Sound = {
    ctx: null,
    ensureCtx() {
      if (!Sound.ctx) Sound.ctx = new (window.AudioContext || window.webkitAudioContext)();
      return Sound.ctx;
    },
    // Synthesizes short tones with the Web Audio API so no external audio files are needed.
    play(type) {
      if (!settings.sound) return;
      const ctx = Sound.ensureCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      const freqs = { place: 660, error: 160, victory: 880 };
      const duration = type === 'victory' ? 0.6 : 0.2;
      osc.frequency.value = freqs[type] || 440;
      osc.type = type === 'error' ? 'square' : 'sine';
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.start();
      osc.stop(ctx.currentTime + duration);
      if (type === 'victory') setTimeout(() => Sound.play('place'), 150);
    }
  };

  /* =====================================================================
     TIMER
     ===================================================================== */
  const Timer = {
    start() {
      Timer.stop();
      state.timerHandle = setInterval(() => {
        if (!state.paused && state.gameActive) {
          state.elapsedSeconds++;
          Timer.render();
          // Keep the saved elapsed time current even if the player hasn't moved recently.
          if (state.elapsedSeconds % 5 === 0) Storage.saveGame();
        }
      }, 1000);
    },
    stop() {
      if (state.timerHandle) clearInterval(state.timerHandle);
      state.timerHandle = null;
    },
    render() { document.getElementById('timer-display').textContent = formatTime(state.elapsedSeconds); },
    pause() {
      if (!state.gameActive) return;
      state.paused = true;
      UI.showOverlay('pause-overlay');
      Storage.saveGame();
    },
    resume() {
      state.paused = false;
      UI.hideOverlay('pause-overlay');
    }
  };

  /* =====================================================================
     HISTORY (undo / redo)
     ===================================================================== */
  const History = {
    snapshot() {
      return {
        board: state.board.slice(),
        notes: state.notes.map(s => new Set(s)),
        mistakes: state.mistakes,
        hintsUsed: state.hintsUsed,
        hintsLeft: state.hintsLeft
      };
    },
    // Call before any mutating action to record the pre-mutation state.
    push() {
      state.undoStack.push(History.snapshot());
      if (state.undoStack.length > 200) state.undoStack.shift();
      state.redoStack.length = 0;
    },
    undo() {
      if (!state.undoStack.length) return;
      const current = History.snapshot();
      const prev = state.undoStack.pop();
      state.redoStack.push(current);
      History.restore(prev);
    },
    redo() {
      if (!state.redoStack.length) return;
      const current = History.snapshot();
      const next = state.redoStack.pop();
      state.undoStack.push(current);
      History.restore(next);
    },
    restore(snap) {
      state.board = snap.board.slice();
      state.notes = snap.notes.map(s => new Set(s));
      state.mistakes = snap.mistakes;
      state.hintsUsed = snap.hintsUsed;
      state.hintsLeft = snap.hintsLeft;
      UI.renderAll();
      UI.updateMistakesAndHints();
      Storage.saveGame();
    }
  };

  /* =====================================================================
     INPUT
     ===================================================================== */
  const Input = {
    init() {
      document.addEventListener('keydown', Input.handleKeydown);
    },

    selectCell(i) {
      if (!state.gameActive || state.paused) return;
      state.selected = i;
      UI.updateHighlights();
    },

    handleNumber(n) {
      if (state.selected === null || !state.gameActive || state.paused) return;
      const i = state.selected;
      if (state.given[i]) return;
      if (state.inputMode === 'notes') Input.toggleNote(i, n);
      else Input.placeNumber(i, n);
    },

    toggleNote(i, n) {
      if (state.board[i] !== 0) return;
      History.push();
      if (state.notes[i].has(n)) state.notes[i].delete(n);
      else state.notes[i].add(n);
      UI.renderCell(i);
      UI.updateHighlights();
      Storage.saveGame();
    },

    placeNumber(i, n) {
      History.push();
      state.board[i] = n;
      state.notes[i].clear();
      // Auto-remove this candidate from notes of peers, since it's no longer possible there.
      PEERS[i].forEach(p => state.notes[p].delete(n));

      const correct = state.solution[i] === n;
      if (!correct) {
        state.mistakes++;
        Sound.play('error');
        UI.flashError(i);
      } else {
        Sound.play('place');
      }

      UI.renderAll();
      UI.updateMistakesAndHints();
      Storage.saveGame();
      Input.checkVictory();
    },

    eraseCell() {
      if (state.selected === null || !state.gameActive || state.paused) return;
      const i = state.selected;
      if (state.given[i]) return;
      if (state.board[i] === 0 && state.notes[i].size === 0) return;
      History.push();
      state.board[i] = 0;
      state.notes[i].clear();
      UI.renderAll();
      Storage.saveGame();
    },

    toggleNotesMode() {
      state.inputMode = state.inputMode === 'normal' ? 'notes' : 'normal';
      document.getElementById('btn-notes').classList.toggle('active', state.inputMode === 'notes');
    },

    // Reveals the correct digit for the selected (or first empty) cell.
    useHint() {
      if (!state.gameActive || state.paused) return;
      if (state.hintsLeft <= 0) { UI.toast('No hints left'); return; }
      let i = state.selected;
      if (i === null || state.board[i] !== 0) i = state.board.indexOf(0);
      if (i === -1) return;

      History.push();
      const n = state.solution[i];
      state.board[i] = n;
      state.notes[i].clear();
      PEERS[i].forEach(p => state.notes[p].delete(n));
      state.hintsUsed++;
      state.hintsLeft--;
      state.selected = i;

      UI.renderAll();
      UI.updateMistakesAndHints();
      Storage.saveGame();
      Input.checkVictory();
    },

    // Flags any filled cell that doesn't match the solution, without revealing the answer.
    checkBoard() {
      let hasError = false;
      for (let i = 0; i < 81; i++) {
        if (state.board[i] !== 0 && state.board[i] !== state.solution[i]) {
          UI.cellEls[i].classList.add('error');
          hasError = true;
        }
      }
      UI.toast(hasError ? 'Some cells are incorrect' : 'Looks good so far!');
    },

    checkVictory() {
      if (state.board.every((v, i) => v === state.solution[i])) Game.onVictory();
    },

    handleKeydown(e) {
      if (document.querySelector('.modal-overlay:not(.hidden)')) return;

      if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); History.undo(); return; }
      if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); History.redo(); return; }
      if (!state.gameActive || state.paused) return;

      if (e.key >= '1' && e.key <= '9') { Input.handleNumber(Number(e.key)); return; }
      if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') { Input.eraseCell(); return; }
      if (e.key.toLowerCase() === 'n') { Input.toggleNotesMode(); return; }
      if (e.key.startsWith('Arrow')) { e.preventDefault(); Input.moveSelection(e.key); return; }
    },

    moveSelection(key) {
      if (state.selected === null) { Input.selectCell(0); return; }
      let r = Board.rowOf(state.selected), c = Board.colOf(state.selected);
      if (key === 'ArrowUp') r = (r + 8) % 9;
      if (key === 'ArrowDown') r = (r + 1) % 9;
      if (key === 'ArrowLeft') c = (c + 8) % 9;
      if (key === 'ArrowRight') c = (c + 1) % 9;
      const i = Board.indexOf(r, c);
      Input.selectCell(i);
      UI.cellEls[i].focus();
    }
  };

  /* =====================================================================
     PUZZLE EXPORT / IMPORT
     ===================================================================== */
  const PuzzleIO = {
    exportString() {
      return state.puzzle.map(v => (v === 0 ? '.' : v)).join('');
    },
    importString(str) {
      const clean = str.trim();
      if (!/^[0-9.]{81}$/.test(clean)) { UI.toast('Invalid puzzle code (need 81 digits/dots)'); return false; }
      const puzzle = clean.split('').map(ch => (ch === '.' ? 0 : Number(ch)));

      const solved = puzzle.slice();
      if (!Solver.solve(solved)) { UI.toast('Puzzle has no solution'); return false; }

      const probe = puzzle.slice();
      if (Solver.countSolutions(probe, 2) !== 1) { UI.toast('Puzzle does not have a unique solution'); return false; }

      Game.setupGame(puzzle, solved, 'custom', false);
      Statistics.recordGameStart();
      UI.toast('Puzzle loaded');
      return true;
    }
  };

  /* =====================================================================
     GAME ORCHESTRATION
     ===================================================================== */
  const Game = {
    newGame(difficulty) {
      const { puzzle, solution } = Generator.generatePuzzle(difficulty);
      Game.setupGame(puzzle, solution, difficulty, false);
      Statistics.recordGameStart();
    },

    dailyChallenge() {
      const rng = mulberry32(dateSeedToday());
      const solution = Solver.generateFullBoard(rng);
      const puzzle = Generator.digHoles(solution, DIFFICULTY_CLUES.medium, rng);
      Game.setupGame(puzzle, solution, 'medium', true);
      Statistics.recordGameStart();
    },

    setupGame(puzzle, solution, difficulty, isDaily) {
      state.puzzle = puzzle.slice();
      state.solution = solution.slice();
      state.board = puzzle.slice();
      state.given = puzzle.map(v => v !== 0);
      state.notes = Array.from({ length: 81 }, () => new Set());
      state.difficulty = difficulty;
      state.isDaily = isDaily;
      state.selected = null;
      state.inputMode = 'normal';
      state.mistakes = 0;
      state.hintsUsed = 0;
      state.hintsLeft = HINTS_LIMIT;
      state.elapsedSeconds = 0;
      state.paused = false;
      state.gameActive = true;
      state.undoStack = [];
      state.redoStack = [];

      document.getElementById('btn-notes').classList.remove('active');
      UI.renderAll();
      UI.updateDifficultyLabel();
      UI.updateMistakesAndHints();
      Timer.render();
      Timer.start();
      UI.hideOverlay('victory-overlay');
      Menu.close();
      Storage.saveGame();
    },

    continueGame() {
      const data = Storage.loadGame();
      if (!data) { UI.toast('No saved game found'); return; }

      state.puzzle = data.puzzle;
      state.solution = data.solution;
      state.board = data.board;
      state.given = data.given;
      state.notes = data.notes;
      state.difficulty = data.difficulty;
      state.isDaily = data.isDaily;
      state.elapsedSeconds = data.elapsedSeconds;
      state.mistakes = data.mistakes;
      state.hintsUsed = data.hintsUsed;
      state.hintsLeft = data.hintsLeft;
      state.undoStack = data.undoStack;
      state.redoStack = data.redoStack;
      state.selected = null;
      state.inputMode = 'normal';
      state.paused = false;
      state.gameActive = true;

      document.getElementById('btn-notes').classList.remove('active');
      UI.renderAll();
      UI.updateDifficultyLabel();
      UI.updateMistakesAndHints();
      Timer.render();
      Timer.start();
      UI.hideOverlay('victory-overlay');
      Menu.close();
    },

    onVictory() {
      state.gameActive = false;
      Timer.stop();
      Storage.clearSave();
      const isBest = Statistics.recordWin(state.difficulty, state.elapsedSeconds, state.hintsUsed, state.mistakes);
      Sound.play('victory');
      Animations.confetti();
      document.getElementById('victory-time').textContent = 'Time: ' + formatTime(state.elapsedSeconds);
      document.getElementById('victory-best').textContent = isBest ? 'New best time!' : '';
      UI.showOverlay('victory-overlay');
    }
  };

  /* =====================================================================
     MENU
     ===================================================================== */
  const Menu = {
    wasPausedBeforeMenu: false,
    open() {
      if (state.gameActive) {
        Menu.wasPausedBeforeMenu = state.paused;
        state.paused = true;
      }
      document.getElementById('btn-continue').disabled = !Storage.hasSavedGame();
      document.getElementById('menu-overlay').classList.remove('hidden');
    },
    close() {
      document.getElementById('menu-overlay').classList.add('hidden');
      if (state.gameActive) state.paused = Menu.wasPausedBeforeMenu;
    }
  };

  /* =====================================================================
     EVENT BINDING
     ===================================================================== */
  function bindEvents() {
    document.getElementById('btn-menu').addEventListener('click', Menu.open);
    document.getElementById('btn-menu-close').addEventListener('click', Menu.close);

    // Clicking a modal's backdrop (not its content) dismisses it.
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target !== overlay) return;
        if (overlay.id === 'menu-overlay') Menu.close();
        else overlay.classList.add('hidden');
      });
    });

    document.getElementById('btn-theme').addEventListener('click', () => {
      settings.darkMode = !settings.darkMode;
      Settings.applyToDOM();
      Settings.save();
    });
    document.getElementById('btn-sound').addEventListener('click', () => {
      settings.sound = !settings.sound;
      Settings.applyToDOM();
      Settings.save();
      if (settings.sound) Sound.play('place');
    });
    document.getElementById('btn-contrast').addEventListener('click', () => {
      settings.highContrast = !settings.highContrast;
      Settings.applyToDOM();
      Settings.save();
    });

    document.querySelectorAll('.difficulty-btn').forEach(btn => {
      btn.addEventListener('click', () => Game.newGame(btn.dataset.difficulty));
    });
    document.getElementById('btn-continue').addEventListener('click', Game.continueGame);
    document.getElementById('btn-daily').addEventListener('click', () => { Game.dailyChallenge(); Menu.close(); });

    document.getElementById('btn-stats').addEventListener('click', () => {
      Statistics.render();
      document.getElementById('stats-modal').classList.remove('hidden');
    });
    document.getElementById('btn-stats-close').addEventListener('click', () => {
      document.getElementById('stats-modal').classList.add('hidden');
    });

    document.getElementById('btn-settings').addEventListener('click', () => {
      document.getElementById('settings-modal').classList.remove('hidden');
    });
    document.getElementById('btn-settings-close').addEventListener('click', () => {
      document.getElementById('settings-modal').classList.add('hidden');
    });

    const settingMap = {
      'setting-dark-mode': 'darkMode', 'setting-animations': 'animations', 'setting-sound': 'sound',
      'setting-highlight-conflicts': 'highlightConflicts', 'setting-auto-save': 'autoSave',
      'setting-show-timer': 'showTimer', 'setting-high-contrast': 'highContrast'
    };
    Object.keys(settingMap).forEach(id => {
      document.getElementById(id).addEventListener('change', (e) => {
        settings[settingMap[id]] = e.target.checked;
        Settings.applyToDOM();
        Settings.save();
      });
    });

    document.getElementById('btn-pause').addEventListener('click', Timer.pause);
    document.getElementById('btn-resume').addEventListener('click', Timer.resume);

    document.getElementById('btn-undo').addEventListener('click', History.undo);
    document.getElementById('btn-redo').addEventListener('click', History.redo);
    document.getElementById('btn-erase').addEventListener('click', Input.eraseCell);
    document.getElementById('btn-notes').addEventListener('click', Input.toggleNotesMode);
    document.getElementById('btn-hint').addEventListener('click', Input.useHint);
    document.getElementById('btn-check').addEventListener('click', Input.checkBoard);

    document.getElementById('btn-export').addEventListener('click', () => {
      if (!state.gameActive) { UI.toast('Start a game first'); return; }
      document.getElementById('io-modal-title').textContent = 'Export Puzzle';
      document.getElementById('io-textarea').value = PuzzleIO.exportString();
      document.getElementById('io-textarea').readOnly = true;
      document.getElementById('io-import-actions').classList.add('hidden');
      document.getElementById('io-modal').classList.remove('hidden');
    });
    document.getElementById('btn-import').addEventListener('click', () => {
      document.getElementById('io-modal-title').textContent = 'Import Puzzle';
      document.getElementById('io-textarea').value = '';
      document.getElementById('io-textarea').readOnly = false;
      document.getElementById('io-import-actions').classList.remove('hidden');
      document.getElementById('io-modal').classList.remove('hidden');
    });
    document.getElementById('btn-io-load').addEventListener('click', () => {
      if (PuzzleIO.importString(document.getElementById('io-textarea').value)) {
        document.getElementById('io-modal').classList.add('hidden');
      }
    });
    document.getElementById('btn-io-close').addEventListener('click', () => {
      document.getElementById('io-modal').classList.add('hidden');
    });

    document.getElementById('btn-victory-new').addEventListener('click', () => {
      UI.hideOverlay('victory-overlay');
      Menu.open();
    });
    document.getElementById('btn-victory-close').addEventListener('click', () => {
      UI.hideOverlay('victory-overlay');
    });
  }

  /* =====================================================================
     INIT
     ===================================================================== */
  function initApp() {
    Settings.init();
    Statistics.init();
    UI.init();
    Input.init();
    bindEvents();
    document.getElementById('btn-continue').disabled = !Storage.hasSavedGame();
  }

  document.addEventListener('DOMContentLoaded', initApp);
})();
