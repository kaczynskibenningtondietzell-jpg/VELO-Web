/* ============================================================
   VELO — engine.js
   Motor de ajedrez local: Minimax + Alpha-Beta + Iterative Deepening
   + Quiescence Search + ordenamiento de movimientos + tabla de
   transposición + evaluación posicional.
   Diseñado para ejecutarse dentro de un Web Worker (ver worker.js).
   ============================================================ */

const EngineLib = (function () {
  const { WHITE, BLACK, PIECE_VALUES, fileOf, rankOf } = ChessLib;

  const PAWN_T = [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0
  ];
  const KNIGHT_T = [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50
  ];
  const BISHOP_T = [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20
  ];
  const ROOK_T = [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0
  ];
  const QUEEN_T = [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20
  ];
  const KING_MID_T = [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20
  ];
  const KING_END_T = [
    -50, -40, -30, -20, -20, -30, -40, -50,
    -30, -20, -10, 0, 0, -10, -20, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -30, 0, 0, 0, 0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50
  ];

  class Engine {
    constructor() {
      this.nodes = 0;
      this.stopRequested = false;
      this.tt = new Map();
      this.historyHeuristic = new Array(64 * 64).fill(0);
      this.deadline = 0;
    }

    requestStop() { this.stopRequested = true; }

    timeUp() {
      return this.stopRequested || (this.deadline > 0 && Date.now() > this.deadline);
    }

    estimateComplexity(board) {
      const moves = board.generateLegalMoves().length;
      const inCheck = board.isInCheck();
      let pieceCount = 0;
      for (let i = 0; i < 64; i++) if (board.squares[i]) pieceCount++;
      let score = moves / 40.0;
      if (inCheck) score += 0.3;
      if (pieceCount > 20) score += 0.2;
      return Math.min(1, Math.max(0, score));
    }

    analyze(board, maxDepth = 8, timeLimitMs = 2000, multiPvCount = 1, onProgress = null) {
      this.stopRequested = false;
      this.nodes = 0;
      this.tt.clear();
      const start = Date.now();
      let bestResult = { bestMove: null, evaluation: 0, depth: 0, nodes: 0, pv: [], multiPv: [] };

      const complexity = this.estimateComplexity(board);
      let adaptive = timeLimitMs;
      if (complexity < 0.3) adaptive = timeLimitMs / 3;
      else if (complexity < 0.6) adaptive = timeLimitMs;
      else adaptive = timeLimitMs * 1.5;
      adaptive = Math.max(150, adaptive);
      this.deadline = start + adaptive;

      for (let depth = 1; depth <= maxDepth; depth++) {
        if (this.timeUp()) break;
        const result = this.searchRoot(board, depth, multiPvCount);
        if (result.bestMove) {
          bestResult = { ...result, timeMs: Date.now() - start, nodes: this.nodes };
          if (onProgress) onProgress(bestResult);
        }
        if (Math.abs(result.evaluation) > 90) break; // mate found (eval already /100)
        if (this.timeUp()) break;
      }
      bestResult.timeMs = Date.now() - start;
      bestResult.nodes = this.nodes;
      return bestResult;
    }

    searchRoot(board, depth, multiPv) {
      const legal = board.generateLegalMoves();
      const moves = this.orderMoves(board, legal, null);
      if (moves.length === 0) {
        const score = board.isInCheck() ? -10000 : 0;
        return { bestMove: null, evaluation: score / 100, depth, nodes: this.nodes, pv: [], multiPv: [] };
      }
      let bestMove = null;
      let bestScore = -Infinity;
      const scores = [];

      for (const move of moves) {
        if (this.timeUp()) break;
        const next = board.clone();
        next.makeMove(move);
        const score = -this.alphaBeta(next, depth - 1, -Infinity, Infinity, 1);
        scores.push([move, score]);
        if (score > bestScore) { bestScore = score; bestMove = move; }
      }
      scores.sort((a, b) => b[1] - a[1]);
      const multi = scores.slice(0, multiPv);

      const pv = [];
      if (bestMove) {
        pv.push(bestMove);
        let b = board.clone();
        b.makeMove(bestMove);
        for (let d = 1; d < Math.min(depth, 4); d++) {
          const entry = this.tt.get(this.hash(b));
          if (entry && entry.bestMove && b.isLegalMove(entry.bestMove)) {
            pv.push(entry.bestMove);
            b.makeMove(entry.bestMove);
          } else break;
        }
      }

      const whitePerspective = board.turn === WHITE ? bestScore : -bestScore;
      return {
        bestMove, evaluation: whitePerspective / 100, depth, nodes: this.nodes, pv,
        multiPv: multi.map(([m, s]) => [m, (board.turn === WHITE ? s : -s) / 100])
      };
    }

    alphaBeta(board, depth, alphaIn, betaIn, ply) {
      if (this.timeUp()) return 0;
      this.nodes++;

      if (board.isCheckmate()) return -10000 + ply;
      if (board.isStalemate() || board.isDrawByFifty() || board.isDrawByInsufficientMaterial()) return 0;

      const h = this.hash(board);
      const ttEntry = this.tt.get(h);
      if (ttEntry && ttEntry.depth >= depth) {
        if (ttEntry.flag === 0) return ttEntry.score;
        if (ttEntry.flag === 1 && ttEntry.score >= betaIn) return ttEntry.score;
        if (ttEntry.flag === 2 && ttEntry.score <= alphaIn) return ttEntry.score;
      }

      if (depth <= 0) return this.quiescence(board, alphaIn, betaIn, ply);

      let alpha = alphaIn, beta = betaIn;
      let bestScore = -Infinity, bestMove = null, flag = 2;

      const legal = board.generateLegalMoves();
      const moves = this.orderMoves(board, legal, ttEntry ? ttEntry.bestMove : null);
      if (moves.length === 0) {
        return board.isInCheck() ? -10000 + ply : 0;
      }

      for (const move of moves) {
        if (this.timeUp()) break;
        const next = board.clone();
        next.makeMove(move);
        const score = -this.alphaBeta(next, depth - 1, -beta, -alpha, ply + 1);
        if (score > bestScore) { bestScore = score; bestMove = move; }
        if (score > alpha) { alpha = score; flag = 0; }
        if (alpha >= beta) {
          this.historyHeuristic[move.from * 64 + move.to] += depth * depth;
          flag = 1;
          break;
        }
      }

      if (this.tt.size < 150000) {
        this.tt.set(h, { depth, score: bestScore, flag, bestMove });
      }
      return bestScore;
    }

    quiescence(board, alphaIn, betaIn, ply) {
      this.nodes++;
      let alpha = alphaIn;
      const standPat = this.evaluate(board);
      if (standPat >= betaIn) return betaIn;
      if (standPat > alpha) alpha = standPat;
      if (ply > 12) return alpha; // safety depth cap

      const captures = board.generateLegalMoves().filter(m => m.captured || m.isEnPassant || m.promotion);
      captures.sort((a, b) => {
        const va = (a.captured ? PIECE_VALUES[a.captured] : 0);
        const vb = (b.captured ? PIECE_VALUES[b.captured] : 0);
        return vb - va;
      });

      for (const move of captures) {
        if (this.timeUp()) break;
        const next = board.clone();
        next.makeMove(move);
        const score = -this.quiescence(next, -betaIn, -alpha, ply + 1);
        if (score >= betaIn) return betaIn;
        if (score > alpha) alpha = score;
      }
      return alpha;
    }

    orderMoves(board, moves, ttMove) {
      return moves.map(m => {
        let score = 0;
        if (ttMove && m.from === ttMove.from && m.to === ttMove.to) score += 10000;
        if (m.captured) {
          score += 1000 + PIECE_VALUES[m.captured] - (PIECE_VALUES[(board.squares[m.from] || 'p').toLowerCase()] || 0) / 10;
        }
        if (m.promotion) score += 800;
        if (m.isCastle) score += 100;
        score += this.historyHeuristic[m.from * 64 + m.to] || 0;
        return [m, score];
      }).sort((a, b) => b[1] - a[1]).map(x => x[0]);
    }

    evaluate(board) {
      let score = 0;
      let whiteMaterial = 0, blackMaterial = 0;
      for (let i = 0; i < 64; i++) {
        const p = board.squares[i];
        if (!p) continue;
        const isWhite = p === p.toUpperCase();
        const type = p.toLowerCase();
        const sq = isWhite ? i : 63 - i;
        let pst = 0;
        if (type === 'p') pst = PAWN_T[sq];
        else if (type === 'n') pst = KNIGHT_T[sq];
        else if (type === 'b') pst = BISHOP_T[sq];
        else if (type === 'r') pst = ROOK_T[sq];
        else if (type === 'q') pst = QUEEN_T[sq];
        else if (type === 'k') pst = (whiteMaterial + blackMaterial) < 2000 ? KING_END_T[sq] : KING_MID_T[sq];
        const mat = PIECE_VALUES[type];
        if (isWhite) { score += mat + pst; whiteMaterial += mat; }
        else { score -= mat + pst; blackMaterial += mat; }
      }

      const mobility = board.generateLegalMoves().length;
      score += board.turn === WHITE ? mobility * 2 : -mobility * 2;

      for (const idx of [27, 28, 35, 36]) {
        const p = board.squares[idx];
        if (p) score += (p === p.toUpperCase()) ? 15 : -15;
      }

      const wKing = board.findKing(WHITE);
      const bKing = board.findKing(BLACK);
      if (wKing !== -1 && rankOf(wKing) === 0 && [6, 2, 1].includes(fileOf(wKing))) score += 30;
      if (bKing !== -1 && rankOf(bKing) === 7 && [6, 2, 1].includes(fileOf(bKing))) score -= 30;

      for (let file = 0; file <= 7; file++) {
        let wp = 0, bp = 0;
        for (let rank = 0; rank <= 7; rank++) {
          const p = board.squares[rank * 8 + file];
          if (p && p.toLowerCase() === 'p') { if (p === p.toUpperCase()) wp++; else bp++; }
        }
        if (wp > 1) score -= 15 * (wp - 1);
        if (bp > 1) score += 15 * (bp - 1);
      }

      return board.turn === WHITE ? score : -score;
    }

    hash(board) {
      // Simple string-key hash (fast enough for our TT sizes; avoids BigInt overhead)
      let h = '';
      for (let i = 0; i < 64; i++) h += board.squares[i] || '.';
      h += board.turn + (board.castling.K ? 'K' : '') + (board.castling.Q ? 'Q' : '') +
        (board.castling.k ? 'k' : '') + (board.castling.q ? 'q' : '') +
        (board.epSquare === null ? '-' : board.epSquare);
      return h;
    }

    classifyMove(evalBefore, evalAfter, isBest, isOnlyMove, wasSacrifice = false) {
      if (isOnlyMove) return 'forced';
      const loss = evalBefore - evalAfter;
      const absLoss = Math.abs(loss);
      let cls;
      if (isBest && wasSacrifice && absLoss < 0.3) cls = 'brilliant';
      else if (isBest && absLoss < 0.05) cls = 'best';
      else if (isBest) cls = 'excellent';
      else if (absLoss < 0.2) cls = 'good';
      else if (absLoss < 0.5) cls = 'inaccuracy';
      else if (absLoss < 1.5) cls = 'mistake';
      else cls = 'blunder';

      if (cls === 'best' && wasSacrifice) cls = 'brilliant';
      else if (cls === 'excellent' && absLoss < 0.1) cls = 'great';
      return cls;
    }
  }

  return { Engine };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = EngineLib;
if (typeof self !== 'undefined') self.EngineLib = EngineLib;
