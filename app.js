/* ============================================================
   VELO — app.js
   Controlador principal de la aplicación: renderizado del
   tablero, interacción táctil, navegación entre pantallas,
   modo entrenamiento, historial, ajustes e importación/exportación.
   ============================================================ */

(function () {
  const { Board, WHITE, BLACK, toAlgebraic } = ChessLib;
  const PIECE_UNICODE = {
    P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔',
    p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚'
  };

  const settings = StorageLib.getSettings();
  document.body.classList.add('theme-' + (settings.boardTheme === 'classic_dark' ? 'classic' : settings.boardTheme));

  const coach = new InstructorLib.Coach();
  coach.level = settings.coachLevel;

  // ============================================================
  // Sound / Haptics
  // ============================================================
  let audioCtx = null;
  function beep(freq, dur) {
    if (!settings.soundEnabled) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(); osc.stop(audioCtx.currentTime + dur);
    } catch (e) { /* ignore */ }
  }
  function sfxMove(isCapture, isCheck) {
    if (isCheck) beep(760, 0.18);
    else if (isCapture) beep(340, 0.12);
    else beep(500, 0.09);
  }
  function vibrate(ms) {
    if (settings.vibrationEnabled && navigator.vibrate) navigator.vibrate(ms);
  }
  function toast(msg, ms = 2200) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), ms);
  }

  // ============================================================
  // BoardView — reusable interactive board renderer
  // ============================================================
  class BoardView {
    constructor(containerEl, svgEl, opts = {}) {
      this.container = containerEl;
      this.svg = svgEl;
      this.onSquareTap = opts.onSquareTap || null;
      this.interactive = opts.interactive !== false;
      this.orientation = 'white';
      this.board = new Board();
      this.selected = null;
      this.legalTargets = [];
      this.lastMove = null;
      this.arrows = [];
      this.animateEnabled = settings.animations;
      this._buildGrid();
      if (this.interactive) {
        this.container.addEventListener('click', (e) => {
          const sqEl = e.target.closest('.sq');
          if (!sqEl) return;
          const sq = parseInt(sqEl.dataset.sq, 10);
          if (this.onSquareTap) this.onSquareTap(sq);
        });
      }
    }

    _buildGrid() {
      this.container.innerHTML = '';
      this.squareEls = new Array(64);
      for (let i = 0; i < 64; i++) {
        const div = document.createElement('div');
        div.className = 'sq';
        this.container.appendChild(div);
      }
    }

    setOrientation(o) { this.orientation = o; this.render(); }

    displayOrder() {
      // returns array of 64 square indices in the order they should be painted
      // into the grid (row-major, top-left to bottom-right)
      const order = [];
      if (this.orientation === 'black') {
        for (let rank = 0; rank <= 7; rank++)
          for (let file = 7; file >= 0; file--)
            order.push(rank * 8 + file);
      } else {
        for (let rank = 7; rank >= 0; rank--)
          for (let file = 0; file <= 7; file++)
            order.push(rank * 8 + file);
      }
      return order;
    }

    setState({ board, selected, legalTargets, lastMove, arrows, checkSquare }) {
      if (board !== undefined) this.board = board;
      if (selected !== undefined) this.selected = selected;
      if (legalTargets !== undefined) this.legalTargets = legalTargets;
      if (lastMove !== undefined) this.lastMove = lastMove;
      if (arrows !== undefined) this.arrows = arrows;
      this.checkSquare = checkSquare !== undefined ? checkSquare : this.checkSquare;
      this.render();
    }

    render() {
      const order = this.displayOrder();
      const board = this.board;
      let inCheckSq = -1;
      if (board.isInCheck()) inCheckSq = board.findKing(board.turn);

      order.forEach((sq, gridIdx) => {
        const el = this.squareEls[gridIdx];
        const file = ChessLib.fileOf(sq), rank = ChessLib.rankOf(sq);
        const isLight = (file + rank) % 2 === 1;
        el.className = 'sq ' + (isLight ? 'light' : 'dark');
        el.dataset.sq = sq;
        el.innerHTML = '';

        if (this.selected === sq) el.classList.add('selected');
        if (this.lastMove && (this.lastMove.from === sq || this.lastMove.to === sq)) el.classList.add('lastmove');
        if (inCheckSq === sq) el.classList.add('check');

        const piece = board.pieceAt(sq);
        if (piece) {
          const span = document.createElement('span');
          span.className = 'piece';
          span.textContent = PIECE_UNICODE[piece];
          el.appendChild(span);
          el.classList.add(piece === piece.toUpperCase() ? 'piece-white' : 'piece-black');
        }

        if (settings.showLegalMoves && this.legalTargets.includes(sq)) {
          el.classList.add(piece ? 'legal-capture' : 'legal-target');
        }

        // edge labels
        const isBottomRow = this.orientation === 'black' ? rank === 7 : rank === 0;
        const isLeftCol = this.orientation === 'black' ? file === 7 : file === 0;
        if (isBottomRow) {
          const lbl = document.createElement('span');
          lbl.className = 'file-label'; lbl.textContent = ChessLib.toAlgebraic(sq)[0];
          el.appendChild(lbl);
        }
        if (isLeftCol) {
          const lbl = document.createElement('span');
          lbl.className = 'rank-label'; lbl.textContent = ChessLib.toAlgebraic(sq)[1];
          el.appendChild(lbl);
        }
      });

      this._drawArrows();
    }

    squareCenterPct(sq) {
      const file = ChessLib.fileOf(sq), rank = ChessLib.rankOf(sq);
      let col = file, row = 7 - rank;
      if (this.orientation === 'black') { col = 7 - file; row = rank; }
      return { x: (col + 0.5) * 12.5, y: (row + 0.5) * 12.5 };
    }

    _drawArrows() {
      if (!this.svg) return;
      const arrows = settings.showArrows ? (this.arrows || []) : [];
      this.svg.setAttribute('viewBox', '0 0 100 100');
      let markup = `<defs><marker id="arrowhead-${this._uid()}" markerWidth="3.2" markerHeight="3.2" refX="1.6" refY="1.6" orient="auto"><polygon points="0 0, 3.2 1.6, 0 3.2" fill="var(--brass)"/></marker></defs>`;
      const markerId = `arrowhead-${this._uid()}`;
      markup = `<defs><marker id="${markerId}" markerWidth="3.2" markerHeight="3.2" refX="2.4" refY="1.6" orient="auto"><polygon points="0 0, 3.2 1.6, 0 3.2" fill="#CDA653"/></marker></defs>`;
      for (const [from, to] of arrows) {
        const p1 = this.squareCenterPct(from);
        const p2 = this.squareCenterPct(to);
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const shrink = 4.5;
        const ex = p2.x - (dx / len) * shrink;
        const ey = p2.y - (dy / len) * shrink;
        markup += `<line x1="${p1.x}" y1="${p1.y}" x2="${ex}" y2="${ey}" stroke="#CDA653" stroke-width="2.2" stroke-linecap="round" opacity="0.85" marker-end="url(#${markerId})"/>`;
      }
      this.svg.innerHTML = markup;
    }
    _uid() { return this._id || (this._id = Math.random().toString(36).slice(2, 8)); }
  }

  // ============================================================
  // Screen navigation
  // ============================================================
  function switchScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-' + name).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.screen === name));
    if (name === 'history') renderHistoryList();
    if (name === 'analysis') syncAnalysisBoard();
  }
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchScreen(btn.dataset.screen));
  });
  document.getElementById('btn-settings').addEventListener('click', () => {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-settings').classList.add('active');
  });
  document.getElementById('btn-settings-close').addEventListener('click', () => switchScreen('board'));

  // ============================================================
  // Promotion modal
  // ============================================================
  function askPromotion(color) {
    return new Promise((resolve) => {
      const modal = document.getElementById('modal-promotion');
      const wrap = document.getElementById('promotion-choices');
      wrap.innerHTML = '';
      const pieces = ['q', 'r', 'b', 'n'];
      for (const p of pieces) {
        const btn = document.createElement('button');
        btn.className = 'promo-btn';
        const ch = color === WHITE ? p.toUpperCase() : p;
        btn.textContent = PIECE_UNICODE[ch];
        btn.addEventListener('click', () => {
          modal.classList.add('hidden');
          resolve(p);
        });
        wrap.appendChild(btn);
      }
      modal.classList.remove('hidden');
    });
  }

  // ============================================================
  // Live Game Controller (Tablero screen)
  // ============================================================
  const liveBoardEl = document.getElementById('chessboard');
  const liveSvgEl = document.getElementById('arrows-svg-main');
  const liveView = new BoardView(liveBoardEl, liveSvgEl, { onSquareTap: onLiveTap });

  const gameState = {
    board: new Board(),
    selected: null,
    sanHistory: [],
    fenHistory: [], // FEN before each move
    lastMove: null,
    orientation: settings.orientation === 'auto' ? WHITE : settings.orientation,
    autoOrientation: settings.orientation === 'auto'
  };
  liveView.setOrientation(gameState.orientation);
  applyBoardTheme(settings.boardTheme);

  function applyBoardTheme(theme) {
    document.body.classList.remove('theme-classic', 'theme-ocean', 'theme-amethyst', 'theme-walnut');
    const map = { classic_dark: 'theme-classic', ocean: 'theme-ocean', amethyst: 'theme-amethyst', walnut: 'theme-walnut' };
    document.body.classList.add(map[theme] || 'theme-classic');
  }

  function refreshLiveView() {
    if (gameState.autoOrientation) {
      liveView.orientation = gameState.board.turn === WHITE ? 'white' : 'black';
    }
    liveView.setState({
      board: gameState.board,
      selected: gameState.selected,
      legalTargets: gameState.selected !== null ? gameState.board.legalMovesFrom(gameState.selected).map(m => m.to) : [],
      lastMove: gameState.lastMove,
      arrows: gameState.arrows || []
    });
    document.getElementById('board-move-list').innerHTML = renderMoveListInline(gameState.sanHistory);
    document.getElementById('btn-undo').disabled = !gameState.board.canUndo();
  }

  function renderMoveListInline(sanHistory) {
    let out = '';
    for (let i = 0; i < sanHistory.length; i += 2) {
      out += `<span>${i / 2 + 1}. ${sanHistory[i] || ''} ${sanHistory[i + 1] || ''}</span>`;
    }
    return out || '<span style="color:var(--text-faint)">Sin jugadas todavía.</span>';
  }

  function onLiveTap(sq) {
    const board = gameState.board;
    if (gameState.selected === null) {
      const piece = board.pieceAt(sq);
      if (piece && (piece === piece.toUpperCase() ? WHITE : BLACK) === board.turn) {
        gameState.selected = sq;
        refreshLiveView();
      }
      return;
    }
    if (sq === gameState.selected) {
      gameState.selected = null;
      refreshLiveView();
      return;
    }
    const candidates = board.legalMovesFrom(gameState.selected).filter(m => m.to === sq);
    if (candidates.length === 0) {
      const piece = board.pieceAt(sq);
      if (piece && (piece === piece.toUpperCase() ? WHITE : BLACK) === board.turn) {
        gameState.selected = sq;
      } else {
        gameState.selected = null;
      }
      refreshLiveView();
      return;
    }
    if (candidates.some(m => m.promotion)) {
      askPromotion(board.turn).then(promo => {
        const mv = candidates.find(m => m.promotion === promo);
        playLiveMove(mv);
      });
      return;
    }
    playLiveMove(candidates[0]);
  }

  function playLiveMove(move) {
    const board = gameState.board;
    const san = board.moveToSan(move);
    const fenBefore = board.toFen();
    const isCapture = !!move.captured;
    board.makeMove(move);
    gameState.sanHistory.push(san);
    gameState.fenHistory.push(fenBefore);
    gameState.sanRedoStack = [];
    gameState.fenRedoStack = [];
    gameState.lastMove = move;
    gameState.selected = null;
    gameState.arrows = [];
    sfxMove(isCapture, board.isInCheck());
    vibrate(isCapture ? 25 : 15);
    refreshLiveView();
    handleGameResultIfAny(board, 'coach-message');
    requestLightAnalysis();
  }

  function handleGameResultIfAny(board, coachElId) {
    const result = board.getResult();
    let msg = null;
    if (result === 'white_wins') msg = 'Jaque mate. Ganan las blancas. ♔';
    else if (result === 'black_wins') msg = 'Jaque mate. Ganan las negras. ♚';
    else if (result === 'draw') {
      if (board.isStalemate()) msg = 'Tablas por ahogado.';
      else if (board.isDrawByInsufficientMaterial()) msg = 'Tablas por material insuficiente.';
      else msg = 'Tablas por la regla de 50 movimientos.';
    }
    if (msg) {
      document.getElementById(coachElId).textContent = msg;
      if (gameState.sanHistory.length > 0) saveLiveGameToHistory(result);
    }
    return result;
  }

  let liveAnalysisToken = 0;
  function requestLightAnalysis() {
    const token = ++liveAnalysisToken;
    const fen = gameState.board.toFen();
    AnalysisLib.analyzePosition(fen, { maxDepth: 5, timeLimitMs: 500, multiPv: 1 }).then(res => {
      if (token !== liveAnalysisToken) return;
      updateEvalBar('board', res.evaluation);
      if (settings.showEval) {
        const msg = coach.explainPosition(gameState.board, res.evaluation, boardMoveFromUci(gameState.board, res.bestMove ? res.bestMove.uci : null));
        document.getElementById('coach-message').textContent = msg;
      }
      if (res.bestMove) gameState.arrows = [[res.bestMove.from, res.bestMove.to]];
      refreshLiveView();
    }).catch(() => {});
  }

  function boardMoveFromUci(board, uci) {
    if (!uci) return null;
    return board.generateLegalMoves().find(m => m.toUci() === uci) || null;
  }

  function updateEvalBar(prefix, evalWhite) {
    const clamped = Math.max(-8, Math.min(8, evalWhite));
    const pct = ((clamped + 8) / 16) * 100;
    const fill = document.getElementById(prefix + '-eval-fill');
    if (fill) fill.style.height = pct + '%';
    const text = document.getElementById(prefix + '-eval-text');
    if (text) text.textContent = (evalWhite >= 0 ? '+' : '') + evalWhite.toFixed(1);
  }

  // Toolbar bindings
  document.getElementById('btn-flip').addEventListener('click', () => {
    gameState.autoOrientation = false;
    liveView.orientation = liveView.orientation === 'white' ? 'black' : 'white';
    document.getElementById('orientation-select').value = liveView.orientation;
    refreshLiveView();
  });
  document.getElementById('orientation-select').value = settings.orientation;
  document.getElementById('orientation-select').addEventListener('change', (e) => {
    const val = e.target.value;
    gameState.autoOrientation = val === 'auto';
    if (val !== 'auto') liveView.orientation = val;
    refreshLiveView();
  });
  gameState.sanRedoStack = [];
  gameState.fenRedoStack = [];
  document.getElementById('btn-undo').addEventListener('click', () => {
    if (!gameState.board.canUndo()) return;
    gameState.board.undoMove();
    gameState.sanRedoStack.push(gameState.sanHistory.pop());
    gameState.fenRedoStack.push(gameState.fenHistory.pop());
    gameState.lastMove = gameState.board.moveHistory[gameState.board.moveHistory.length - 1] || null;
    gameState.selected = null;
    gameState.arrows = [];
    refreshLiveView();
    requestLightAnalysis();
  });
  document.getElementById('btn-redo').addEventListener('click', () => {
    const board = gameState.board;
    if (!board.canRedo()) return;
    const mv = board.redoMove();
    if (!mv) return;
    gameState.sanHistory.push(gameState.sanRedoStack.pop() || mv.toUci());
    gameState.fenHistory.push(gameState.fenRedoStack.pop());
    gameState.lastMove = mv;
    gameState.selected = null;
    gameState.arrows = [];
    refreshLiveView();
    requestLightAnalysis();
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    if (gameState.sanHistory.length > 0) saveLiveGameToHistory(gameState.board.getResult());
    gameState.board = new Board();
    gameState.sanHistory = [];
    gameState.fenHistory = [];
    gameState.sanRedoStack = [];
    gameState.fenRedoStack = [];
    gameState.lastMove = null;
    gameState.selected = null;
    gameState.arrows = [];
    document.getElementById('coach-message').textContent = 'Nueva partida. Blancas mueven.';
    updateEvalBar('board', 0);
    refreshLiveView();
  });

  function saveLiveGameToHistory(result) {
    const resultStr = { white_wins: '1-0', black_wins: '0-1', draw: '1/2-1/2' }[result] || '*';
    const pgn = PgnLib.exportPgn(gameState.sanHistory, { White: 'Jugador', Black: 'Rival', Result: resultStr });
    StorageLib.saveGame({
      date: Date.now(), white: 'Jugador', black: 'Rival', result: resultStr,
      pgn, fen: gameState.board.toFen(), moveCount: gameState.sanHistory.length,
      timeControl: currentTimeControlLabel()
    });
  }

  // ============================================================
  // Import / Export modal
  // ============================================================
  const ioModal = document.getElementById('modal-io');
  let ioTab = 'pgn';
  document.getElementById('btn-io').addEventListener('click', () => {
    document.getElementById('io-textarea').value = '';
    ioModal.classList.remove('hidden');
  });
  document.getElementById('btn-io-close').addEventListener('click', () => ioModal.classList.add('hidden'));
  document.querySelectorAll('.modal-tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.modal-tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    ioTab = t.dataset.iotab;
  }));
  document.getElementById('btn-io-fill-current').addEventListener('click', () => {
    const ta = document.getElementById('io-textarea');
    if (ioTab === 'fen') ta.value = gameState.board.toFen();
    else ta.value = PgnLib.exportPgn(gameState.sanHistory, { White: 'Jugador', Black: 'Rival' });
  });
  document.getElementById('btn-io-copy').addEventListener('click', async () => {
    const ta = document.getElementById('io-textarea');
    try { await navigator.clipboard.writeText(ta.value); toast('Copiado al portapapeles'); }
    catch (e) { ta.select(); document.execCommand('copy'); toast('Copiado'); }
  });
  document.getElementById('btn-io-download').addEventListener('click', () => {
    const ta = document.getElementById('io-textarea');
    if (!ta.value.trim()) { toast('Nada que descargar'); return; }
    const isFen = ioTab === 'fen';
    StorageLib.downloadTextFile(isFen ? 'velo-posicion.fen' : 'velo-partida.pgn', ta.value);
  });
  document.getElementById('btn-io-load').addEventListener('click', () => {
    const text = document.getElementById('io-textarea').value.trim();
    if (!text) { toast('Pega un PGN o FEN primero'); return; }
    if (ioTab === 'fen' || (!text.includes('.') && text.split(' ').length >= 4 && text.split(' ').length <= 6 && !text.includes('['))) {
      const b = new Board();
      if (b.loadFen(text)) {
        loadPositionIntoLiveGame(b, []);
        toast('Posición FEN cargada');
        ioModal.classList.add('hidden');
      } else {
        toast('FEN inválida');
      }
    } else {
      const parsed = PgnLib.parse(text);
      if (!parsed.ok) { toast('No se pudo interpretar el PGN'); return; }
      const b = new Board();
      const sanList = [];
      const applied = [];
      for (const san of parsed.moves) {
        const mv = PgnLib.sanToMove(b, san);
        if (!mv) { toast('PGN inválido: movimiento no reconocido cerca de "' + san + '"'); return; }
        const realSan = b.moveToSan(mv);
        b.makeMove(mv);
        sanList.push(realSan);
        applied.push(mv);
      }
      loadPositionIntoLiveGame(b, sanList);
      toast(`Partida importada (${sanList.length} jugadas)`);
      ioModal.classList.add('hidden');
    }
  });

  function loadPositionIntoLiveGame(board, sanHistory) {
    gameState.board = board;
    gameState.sanHistory = sanHistory;
    gameState.fenHistory = [];
    gameState.sanRedoStack = [];
    gameState.fenRedoStack = [];
    gameState.lastMove = board.moveHistory[board.moveHistory.length - 1] || null;
    gameState.selected = null;
    gameState.arrows = [];
    refreshLiveView();
    requestLightAnalysis();
    handleGameResultIfAny(board, 'coach-message');
  }

  // ============================================================
  // Clocks / Time control
  // ============================================================
  const clockState = { whiteMs: 0, blackMs: 0, running: false, activeColor: null, timerId: null, mode: 'none' };
  const TIME_PRESETS = { bullet: 60000, blitz: 300000, rapid: 600000, classical: 1800000 };

  document.getElementById('time-control-select').addEventListener('change', (e) => {
    const mode = e.target.value;
    clockState.mode = mode;
    document.getElementById('custom-minutes').style.display = mode === 'custom' ? 'inline-block' : 'none';
    setupClock(mode);
  });
  document.getElementById('custom-minutes').addEventListener('change', () => {
    if (clockState.mode === 'custom') setupClock('custom');
  });

  function setupClock(mode) {
    stopClockTimer();
    if (mode === 'none') {
      document.querySelector('#clock-white .clock-time').textContent = '—';
      document.querySelector('#clock-black .clock-time').textContent = '—';
      clockState.running = false;
      return;
    }
    let ms = TIME_PRESETS[mode];
    if (mode === 'custom') {
      const mins = parseInt(document.getElementById('custom-minutes').value, 10) || 15;
      ms = mins * 60000;
    }
    clockState.whiteMs = ms; clockState.blackMs = ms;
    clockState.activeColor = null;
    clockState.running = true;
    renderClocks();
  }
  function currentTimeControlLabel() {
    const map = { none: 'Sin reloj', bullet: 'Bullet · 1 min', blitz: 'Blitz · 5 min', rapid: 'Rápida · 10 min', classical: 'Clásica · 30 min', custom: 'Personalizado' };
    return map[clockState.mode] || 'Sin reloj';
  }
  function renderClocks() {
    document.querySelector('#clock-white .clock-time').textContent = fmtClock(clockState.whiteMs);
    document.querySelector('#clock-black .clock-time').textContent = fmtClock(clockState.blackMs);
    document.getElementById('clock-white').classList.toggle('active', clockState.activeColor === WHITE);
    document.getElementById('clock-black').classList.toggle('active', clockState.activeColor === BLACK);
  }
  function fmtClock(ms) {
    if (ms < 0) ms = 0;
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60), s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
  function stopClockTimer() { if (clockState.timerId) { clearInterval(clockState.timerId); clockState.timerId = null; } }
  function tickClock() {
    if (!clockState.running || !clockState.activeColor) return;
    if (clockState.activeColor === WHITE) clockState.whiteMs -= 200; else clockState.blackMs -= 200;
    if (clockState.whiteMs <= 0 || clockState.blackMs <= 0) {
      clockState.whiteMs = Math.max(0, clockState.whiteMs);
      clockState.blackMs = Math.max(0, clockState.blackMs);
      clockState.running = false;
      stopClockTimer();
      const winner = clockState.whiteMs <= 0 ? 'Negras' : 'Blancas';
      document.getElementById('coach-message').textContent = `Tiempo agotado. Ganan las ${winner} por tiempo.`;
    }
    renderClocks();
  }
  clockState.timerId = setInterval(tickClock, 200);
  // switch active clock on each live move
  const origPlayLiveMove = playLiveMove;
  playLiveMove = function (move) {
    const mover = gameState.board.turn;
    origPlayLiveMove(move);
    if (clockState.mode !== 'none') clockState.activeColor = mover === WHITE ? BLACK : WHITE;
  };

  // ============================================================
  // ANALYSIS SCREEN
  // ============================================================
  const analysisBoardEl = document.getElementById('chessboard-analysis');
  const analysisSvgEl = document.getElementById('arrows-svg-analysis');
  const analysisView = new BoardView(analysisBoardEl, analysisSvgEl, { interactive: false });
  analysisView.setOrientation('white');

  const analysisState = { positions: [], sanHistory: [], cursor: -1, reviewResults: null, sourceLabel: '' };

  function syncAnalysisBoard() {
    // Pull in the live game by default if analysis has nothing loaded
    if (analysisState.positions.length === 0 && gameState.sanHistory.length > 0) {
      loadGameIntoAnalysis(gameState.fenHistory.concat([gameState.board.toFen()]), gameState.sanHistory, 'Partida actual');
    } else if (analysisState.positions.length === 0) {
      const b = new Board();
      analysisState.positions = [b.toFen()];
      analysisState.sanHistory = [];
      analysisState.cursor = 0;
      renderAnalysisPosition();
    }
  }

  function loadGameIntoAnalysis(fenList, sanHistory, label) {
    analysisState.positions = fenList;
    analysisState.sanHistory = sanHistory;
    analysisState.cursor = fenList.length - 1;
    analysisState.reviewResults = null;
    analysisState.sourceLabel = label || '';
    document.getElementById('game-summary').classList.remove('show');
    renderAnalysisPosition();
  }

  function renderAnalysisPosition() {
    const fen = analysisState.positions[analysisState.cursor];
    if (!fen) return;
    const b = new Board();
    b.loadFen(fen);
    let arrows = [];
    const rr = analysisState.reviewResults;
    const idx = analysisState.cursor;
    if (rr && rr[idx] && rr[idx].bestUci) {
      const mv = b.generateLegalMoves().find(m => m.toUci() === rr[idx].bestUci);
      if (mv) arrows = [[mv.from, mv.to]];
    }
    analysisView.setState({ board: b, arrows, lastMove: null });
    document.getElementById('analysis-move-list-wrap');
    renderAnalysisMoveList();
    updateAnalysisInfoPanel(b, idx);
  }

  function renderAnalysisMoveList() {
    const wrap = document.getElementById('analysis-move-list');
    const san = analysisState.sanHistory;
    const rr = analysisState.reviewResults;
    let html = '';
    for (let i = 0; i < san.length; i += 2) {
      html += '<div class="move-pair"><span class="move-num">' + (i / 2 + 1) + '.</span>';
      for (const off of [0, 1]) {
        const idx = i + off;
        if (idx >= san.length) continue;
        const cls = rr && rr[idx] ? rr[idx].classification : null;
        const emoji = cls ? InstructorLib.CLASS_EMOJI[cls] : '';
        const clsClass = cls ? 'cls-' + cls : '';
        const isCurrent = (idx + 1) === analysisState.cursor ? 'current' : '';
        html += `<span class="move-chip ${clsClass} ${isCurrent}" data-idx="${idx}">${san[idx]}${emoji ? ' <span class=\"cls-emoji\">' + emoji + '</span>' : ''}</span>`;
      }
      html += '</div>';
    }
    wrap.innerHTML = html || '<span style="color:var(--text-faint);font-size:13px;">Sin jugadas.</span>';
    wrap.querySelectorAll('.move-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        analysisState.cursor = parseInt(chip.dataset.idx, 10) + 1;
        renderAnalysisPosition();
      });
    });
  }

  let analysisReqToken = 0;
  function updateAnalysisInfoPanel(board, idx) {
    const rr = analysisState.reviewResults;
    if (rr && rr[idx]) {
      const r = rr[idx];
      updateEvalBar('analysis', r.evalWhite);
      document.getElementById('analysis-depth').textContent = 'Profundidad: analizada';
      document.getElementById('analysis-bestmove').textContent = 'Mejor jugada: ' + (r.bestUci || '—');
      document.getElementById('analysis-pv').textContent = 'Clasificación: ' + (InstructorLib.CLASS_LABEL[r.classification] || '—');
      const boardBefore = new Board(); boardBefore.loadFen(r.fen);
      const playedMove = boardBefore.generateLegalMoves().find(m => m.toUci() === r.playedUci);
      const bestMove = r.bestUci ? boardBefore.generateLegalMoves().find(m => m.toUci() === r.bestUci) : null;
      const text = playedMove ? coach.explainMove(boardBefore, playedMove, r.classification, 0, 0, bestMove) : '';
      document.getElementById('analysis-coach-text').textContent = text;
      return;
    }
    // Live quick analysis of this exact position
    const token = ++analysisReqToken;
    document.getElementById('analysis-depth').textContent = 'Analizando…';
    AnalysisLib.analyzePosition(board.toFen(), { maxDepth: settings.engineDepth, timeLimitMs: settings.analysisTimeMs, multiPv: settings.multiPv }).then(res => {
      if (token !== analysisReqToken) return;
      updateEvalBar('analysis', res.evaluation);
      document.getElementById('analysis-depth').textContent = 'Profundidad: ' + res.depth + ' · ' + res.nodes + ' nodos';
      document.getElementById('analysis-bestmove').textContent = 'Mejor jugada: ' + (res.bestMove ? res.bestMove.uci : '—');
      document.getElementById('analysis-pv').textContent = 'Línea principal: ' + (res.pv || []).join(' ');
      const bestMv = res.bestMove ? board.generateLegalMoves().find(m => m.toUci() === res.bestMove.uci) : null;
      document.getElementById('analysis-coach-text').textContent = coach.explainPosition(board, res.evaluation, bestMv);
      if (bestMv) {
        analysisView.setState({ arrows: [[bestMv.from, bestMv.to]] });
      }
    });
  }

  document.getElementById('analysis-first').addEventListener('click', () => { analysisState.cursor = 0; renderAnalysisPosition(); });
  document.getElementById('analysis-prev').addEventListener('click', () => { analysisState.cursor = Math.max(0, analysisState.cursor - 1); renderAnalysisPosition(); });
  document.getElementById('analysis-next').addEventListener('click', () => { analysisState.cursor = Math.min(analysisState.positions.length - 1, analysisState.cursor + 1); renderAnalysisPosition(); });
  document.getElementById('analysis-last').addEventListener('click', () => { analysisState.cursor = analysisState.positions.length - 1; renderAnalysisPosition(); });

  document.getElementById('btn-full-review').addEventListener('click', async () => {
    if (analysisState.sanHistory.length === 0) { toast('No hay jugadas para analizar'); return; }
    const progressEl = document.getElementById('review-progress');
    const fens = analysisState.positions.slice(0, -1); // FEN before each move
    const ucis = [];
    for (let i = 0; i < analysisState.sanHistory.length; i++) {
      const b = new Board(); b.loadFen(fens[i]);
      const mv = PgnLib.sanToMove(b, analysisState.sanHistory[i]);
      ucis.push(mv ? mv.toUci() : null);
    }
    progressEl.textContent = 'Analizando 0 / ' + fens.length + '…';
    const results = await AnalysisLib.reviewGame(fens, ucis, {
      maxDepth: Math.min(settings.engineDepth, 7),
      timeLimitMs: Math.min(settings.analysisTimeMs, 700),
      onMoveDone: (i) => { progressEl.textContent = `Analizando ${i + 1} / ${fens.length}…`; }
    });
    analysisState.reviewResults = results;
    progressEl.textContent = 'Análisis completo.';
    renderAnalysisMoveList();
    renderAnalysisPosition();
    const summary = coach.generateGameSummary(results.map(r => r.classification));
    renderGameSummary(summary);
  });

  function renderGameSummary(s) {
    const el = document.getElementById('game-summary');
    el.classList.add('show');
    el.innerHTML = `
      <div style="font-family:var(--font-head);font-weight:700;margin-bottom:4px;">Resumen de la partida</div>
      <div class="summary-grid">
        <div class="summary-stat"><div class="num">${s.brilliant}</div>💎 Brillantes</div>
        <div class="summary-stat"><div class="num">${s.great}</div>🟢 Excelentes</div>
        <div class="summary-stat"><div class="num">${s.best}</div>🟢 Mejores</div>
        <div class="summary-stat"><div class="num">${s.inaccuracies}</div>🟡 Imprecisiones</div>
        <div class="summary-stat"><div class="num">${s.mistakes}</div>🟠 Errores</div>
        <div class="summary-stat"><div class="num">${s.blunders}</div>🔴 Muy malas</div>
      </div>
      <div>${s.recommendations.map(r => '• ' + r).join('<br>')}</div>
    `;
  }

  // ============================================================
  // TRAINING SCREEN
  // ============================================================
  const trainingBoardEl = document.getElementById('chessboard-training');
  const trainingSvgEl = document.getElementById('arrows-svg-training');
  const trainingView = new BoardView(trainingBoardEl, trainingSvgEl, { onSquareTap: onTrainingTap });

  const trainingState = {
    board: null, userColor: WHITE, selected: null, active: false, waitingEngine: false
  };

  document.getElementById('btn-training-new').addEventListener('click', () => {
    const colorSel = document.getElementById('training-color-select').value;
    trainingState.userColor = colorSel === 'random' ? (Math.random() < 0.5 ? WHITE : BLACK) : (colorSel === 'black' ? BLACK : WHITE);
    trainingState.board = new Board();
    trainingState.selected = null;
    trainingState.active = true;
    trainingView.setOrientation(trainingState.userColor === WHITE ? 'white' : 'black');
    document.getElementById('training-status').textContent = trainingState.userColor === WHITE
      ? 'Juegas con Blancas. Encuentra la mejor jugada.'
      : 'Juegas con Negras. Encuentra la mejor jugada.';
    document.getElementById('training-badge').textContent = '';
    document.getElementById('training-coach-text').textContent = 'Toca una pieza para empezar.';
    renderTrainingView();
    if (trainingState.board.turn !== trainingState.userColor) {
      engineReplyTraining();
    }
  });

  function renderTrainingView() {
    trainingView.setState({
      board: trainingState.board,
      selected: trainingState.selected,
      legalTargets: trainingState.selected !== null ? trainingState.board.legalMovesFrom(trainingState.selected).map(m => m.to) : [],
      lastMove: trainingState.board.moveHistory[trainingState.board.moveHistory.length - 1] || null
    });
  }

  function onTrainingTap(sq) {
    if (!trainingState.active || trainingState.waitingEngine) return;
    const board = trainingState.board;
    if (board.turn !== trainingState.userColor) return;
    if (trainingState.selected === null) {
      const piece = board.pieceAt(sq);
      if (piece && (piece === piece.toUpperCase() ? WHITE : BLACK) === board.turn) {
        trainingState.selected = sq;
        renderTrainingView();
      }
      return;
    }
    if (sq === trainingState.selected) { trainingState.selected = null; renderTrainingView(); return; }
    const candidates = board.legalMovesFrom(trainingState.selected).filter(m => m.to === sq);
    if (candidates.length === 0) {
      const piece = board.pieceAt(sq);
      if (piece && (piece === piece.toUpperCase() ? WHITE : BLACK) === board.turn) trainingState.selected = sq;
      else trainingState.selected = null;
      renderTrainingView();
      return;
    }
    if (candidates.some(m => m.promotion)) {
      askPromotion(board.turn).then(promo => {
        const mv = candidates.find(m => m.promotion === promo);
        playTrainingUserMove(mv);
      });
      return;
    }
    playTrainingUserMove(candidates[0]);
  }

  async function playTrainingUserMove(move) {
    const board = trainingState.board;
    const fenBefore = board.toFen();
    const boardBefore = new Board(); boardBefore.loadFen(fenBefore);
    const playedUci = move.toUci();
    board.makeMove(move);
    trainingState.selected = null;
    sfxMove(!!move.captured, board.isInCheck());
    vibrate(15);
    renderTrainingView();

    trainingState.waitingEngine = true;
    document.getElementById('training-coach-text').textContent = 'VELO está analizando tu jugada…';
    document.getElementById('training-badge').textContent = '';

    const res = await AnalysisLib.analyzePosition(fenBefore, { maxDepth: settings.engineDepth, timeLimitMs: settings.analysisTimeMs, multiPv: 1 });
    const isBest = res.bestMove && res.bestMove.uci === playedUci;
    const afterRes = await AnalysisLib.analyzePosition(board.toFen(), { maxDepth: Math.min(settings.engineDepth, 6), timeLimitMs: 600, multiPv: 1 });
    const cls = AnalysisLib.classify(res.evaluation, afterRes.evaluation, fenBefore.split(' ')[1], isBest, false);
    const bestMv = res.bestMove ? boardBefore.generateLegalMoves().find(m => m.toUci() === res.bestMove.uci) : null;
    const explanation = coach.explainMove(boardBefore, move, cls, res.evaluation, afterRes.evaluation, bestMv);

    document.getElementById('training-badge').textContent = InstructorLib.CLASS_LABEL[cls] + ' ' + InstructorLib.CLASS_EMOJI[cls];
    document.getElementById('training-coach-text').textContent = explanation;
    if (bestMv && !isBest) trainingView.setState({ arrows: [[bestMv.from, bestMv.to]] });
    else trainingView.setState({ arrows: [] });

    const result = handleGameResultIfAny(board, 'training-coach-text');
    trainingState.waitingEngine = false;
    if (result === 'ongoing') {
      setTimeout(() => engineReplyTraining(), 900);
    } else {
      document.getElementById('training-status').textContent = 'Partida terminada. Pulsa "Nueva posición" para seguir entrenando.';
    }
  }

  async function engineReplyTraining() {
    const board = trainingState.board;
    if (board.getResult() !== 'ongoing') return;
    trainingState.waitingEngine = true;
    document.getElementById('training-status').textContent = 'VELO está pensando su jugada…';
    const res = await AnalysisLib.analyzePosition(board.toFen(), { maxDepth: settings.engineDepth, timeLimitMs: settings.analysisTimeMs, multiPv: 1 });
    if (res.bestMove) {
      const mv = board.generateLegalMoves().find(m => m.toUci() === res.bestMove.uci);
      if (mv) {
        board.makeMove(mv);
        sfxMove(!!mv.captured, board.isInCheck());
        renderTrainingView();
      }
    }
    trainingState.waitingEngine = false;
    const result = handleGameResultIfAny(board, 'training-coach-text');
    document.getElementById('training-status').textContent = result === 'ongoing'
      ? 'Tu turno. Encuentra la mejor jugada.'
      : 'Partida terminada. Pulsa "Nueva posición" para seguir entrenando.';
  }

  // ============================================================
  // HISTORY SCREEN
  // ============================================================
  async function renderHistoryList() {
    const games = await StorageLib.getAllGames();
    const query = document.getElementById('history-search').value.trim().toLowerCase();
    const filtered = query ? games.filter(g =>
      (g.white || '').toLowerCase().includes(query) ||
      (g.black || '').toLowerCase().includes(query) ||
      (g.pgn || '').toLowerCase().includes(query)
    ) : games;

    const list = document.getElementById('history-list');
    if (filtered.length === 0) {
      list.innerHTML = '<div id="history-empty">Aún no hay partidas guardadas.<br>Juega una partida y termínala para verla aquí.</div>';
      return;
    }
    list.innerHTML = filtered.map(g => {
      const d = new Date(g.date);
      const dateStr = d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
      return `<div class="history-card" data-id="${g.id}">
        <div class="hc-top"><span>${dateStr}</span><span>${g.timeControl || ''}</span></div>
        <div class="hc-players">${g.white || 'Jugador'} vs ${g.black || 'Rival'}</div>
        <div class="hc-meta">${g.moveCount || 0} jugadas · Resultado: ${g.result || '*'}</div>
        <div class="hc-actions">
          <button data-act="analyze">Analizar</button>
          <button data-act="export">Exportar PGN</button>
          <button data-act="delete">Eliminar</button>
        </div>
      </div>`;
    }).join('');

    list.querySelectorAll('.history-card').forEach(card => {
      const id = parseInt(card.dataset.id, 10);
      const game = filtered.find(g => g.id === id);
      card.querySelector('[data-act="analyze"]').addEventListener('click', () => {
        const b = new Board();
        const parsed = PgnLib.parse(game.pgn);
        const fens = [b.toFen()];
        const sans = [];
        for (const san of parsed.moves || []) {
          const mv = PgnLib.sanToMove(b, san);
          if (!mv) break;
          const realSan = b.moveToSan(mv);
          b.makeMove(mv);
          sans.push(realSan);
          fens.push(b.toFen());
        }
        loadGameIntoAnalysis(fens, sans, `${game.white} vs ${game.black}`);
        switchScreen('analysis');
      });
      card.querySelector('[data-act="export"]').addEventListener('click', () => {
        StorageLib.downloadTextFile(`velo-partida-${id}.pgn`, game.pgn);
      });
      card.querySelector('[data-act="delete"]').addEventListener('click', async () => {
        await StorageLib.deleteGame(id);
        renderHistoryList();
      });
    });
  }
  document.getElementById('history-search').addEventListener('input', () => renderHistoryList());

  // ============================================================
  // SETTINGS SCREEN
  // ============================================================
  function bindSettingsUI() {
    document.getElementById('set-board-theme').value = settings.boardTheme;
    document.getElementById('set-orientation').value = settings.orientation;
    document.getElementById('set-show-legal').checked = settings.showLegalMoves;
    document.getElementById('set-show-arrows').checked = settings.showArrows;
    document.getElementById('set-animations').checked = settings.animations;
    document.getElementById('set-sound').checked = settings.soundEnabled;
    document.getElementById('set-vibration').checked = settings.vibrationEnabled;
    document.getElementById('set-show-eval').checked = settings.showEval;
    document.getElementById('set-engine-depth').value = settings.engineDepth;
    document.getElementById('set-engine-depth-val').textContent = settings.engineDepth;
    document.getElementById('set-analysis-time').value = settings.analysisTimeMs;
    document.getElementById('set-analysis-time-val').textContent = (settings.analysisTimeMs / 1000).toFixed(1) + 's';
    document.getElementById('set-coach-level').value = settings.coachLevel;
  }
  bindSettingsUI();

  function persist() { StorageLib.saveSettings(settings); }

  document.getElementById('set-board-theme').addEventListener('change', (e) => {
    settings.boardTheme = e.target.value; applyBoardTheme(settings.boardTheme); persist();
  });
  document.getElementById('set-orientation').addEventListener('change', (e) => {
    settings.orientation = e.target.value;
    document.getElementById('orientation-select').value = settings.orientation;
    gameState.autoOrientation = settings.orientation === 'auto';
    if (settings.orientation !== 'auto') liveView.orientation = settings.orientation;
    refreshLiveView(); persist();
  });
  document.getElementById('set-show-legal').addEventListener('change', (e) => { settings.showLegalMoves = e.target.checked; refreshLiveView(); persist(); });
  document.getElementById('set-show-arrows').addEventListener('change', (e) => { settings.showArrows = e.target.checked; refreshLiveView(); persist(); });
  document.getElementById('set-animations').addEventListener('change', (e) => { settings.animations = e.target.checked; persist(); });
  document.getElementById('set-sound').addEventListener('change', (e) => { settings.soundEnabled = e.target.checked; persist(); });
  document.getElementById('set-vibration').addEventListener('change', (e) => { settings.vibrationEnabled = e.target.checked; persist(); });
  document.getElementById('set-show-eval').addEventListener('change', (e) => { settings.showEval = e.target.checked; persist(); });
  document.getElementById('set-engine-depth').addEventListener('input', (e) => {
    settings.engineDepth = parseInt(e.target.value, 10);
    document.getElementById('set-engine-depth-val').textContent = settings.engineDepth;
    persist();
  });
  document.getElementById('set-analysis-time').addEventListener('input', (e) => {
    settings.analysisTimeMs = parseInt(e.target.value, 10);
    document.getElementById('set-analysis-time-val').textContent = (settings.analysisTimeMs / 1000).toFixed(1) + 's';
    persist();
  });
  document.getElementById('set-coach-level').addEventListener('change', (e) => {
    settings.coachLevel = e.target.value; coach.level = settings.coachLevel; persist();
  });
  document.getElementById('btn-clear-history').addEventListener('click', async () => {
    if (confirm('¿Borrar todo el historial local de partidas? Esta acción no se puede deshacer.')) {
      await StorageLib.clearGames();
      renderHistoryList();
      toast('Historial borrado');
    }
  });

  // Legal-target visibility toggle (CSS-level via class on root)
  function applyLegalMovesVisibility() {
    document.documentElement.style.setProperty('--legal-visible', settings.showLegalMoves ? '1' : '0');
  }
  applyLegalMovesVisibility();

  // ============================================================
  // INIT
  // ============================================================
  refreshLiveView();
  updateEvalBar('board', 0);
  updateEvalBar('analysis', 0);
  setupClock('none');

  // Register service worker for offline support (optional, non-blocking)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }
})();
