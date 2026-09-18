/* ============================================================
   VELO — chess.js
   Representación de tablero, generación de movimientos legales,
   FEN, jaque/mate/ahogado, enroque, captura al paso, promoción.
   Puerto y reconstrucción en JavaScript del motor original de VELO.
   ============================================================ */

const WHITE = 'w';
const BLACK = 'b';

const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

function opposite(color) { return color === WHITE ? BLACK : WHITE; }

function fileOf(sq) { return sq % 8; }
function rankOf(sq) { return Math.floor(sq / 8); }
function fileChar(sq) { return String.fromCharCode(97 + fileOf(sq)); }
function rankChar(sq) { return String(rankOf(sq) + 1); }
function toAlgebraic(sq) { return fileChar(sq) + rankChar(sq); }
function fromAlgebraic(s) {
  const file = s.charCodeAt(0) - 97;
  const rank = s.charCodeAt(1) - 49;
  return rank * 8 + file;
}
function sqFromFileRank(file, rank) { return rank * 8 + file; }
function inBounds(file, rank) { return file >= 0 && file <= 7 && rank >= 0 && rank <= 7; }

const KNIGHT_OFFSETS = [-17, -15, -10, -6, 6, 10, 15, 17];
const KING_OFFSETS = [-9, -8, -7, -1, 1, 7, 8, 9];

class Move {
  constructor(from, to, opts = {}) {
    this.from = from;
    this.to = to;
    this.promotion = opts.promotion || null; // 'q','r','b','n'
    this.isCastle = !!opts.isCastle;
    this.isEnPassant = !!opts.isEnPassant;
    this.captured = opts.captured || null; // piece char (lowercase type) captured
    this.piece = opts.piece || null; // moving piece char
  }
  toUci() {
    return toAlgebraic(this.from) + toAlgebraic(this.to) + (this.promotion || '');
  }
  equals(m) {
    if (!m) return false;
    return this.from === m.from && this.to === m.to && this.promotion === m.promotion;
  }
}

class Board {
  constructor() {
    this.squares = new Array(64).fill(null); // e.g. 'P','n', etc (FEN-style char)
    this.turn = WHITE;
    this.castling = { K: true, Q: true, k: true, q: true };
    this.epSquare = null;
    this.halfmove = 0;
    this.fullmove = 1;
    this.history = []; // {state snapshot, move}
    this.moveHistory = [];
    this.redoStack = [];
    this.setupStart();
  }

  setupStart() {
    this.loadFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  }

  clone() {
    const b = new Board();
    b.squares = this.squares.slice();
    b.turn = this.turn;
    b.castling = { ...this.castling };
    b.epSquare = this.epSquare;
    b.halfmove = this.halfmove;
    b.fullmove = this.fullmove;
    b.moveHistory = this.moveHistory.slice();
    return b;
  }

  pieceAt(sq) { return this.squares[sq]; }
  colorAt(sq) {
    const p = this.squares[sq];
    if (!p) return null;
    return p === p.toUpperCase() ? WHITE : BLACK;
  }
  typeAt(sq) {
    const p = this.squares[sq];
    return p ? p.toLowerCase() : null;
  }

  saveState() {
    return {
      squares: this.squares.slice(),
      turn: this.turn,
      castling: { ...this.castling },
      epSquare: this.epSquare,
      halfmove: this.halfmove,
      fullmove: this.fullmove
    };
  }
  restoreState(s) {
    this.squares = s.squares;
    this.turn = s.turn;
    this.castling = s.castling;
    this.epSquare = s.epSquare;
    this.halfmove = s.halfmove;
    this.fullmove = s.fullmove;
  }

  findKing(color) {
    const k = color === WHITE ? 'K' : 'k';
    return this.squares.indexOf(k);
  }

  isSquareAttacked(sq, byColor) {
    const f0 = fileOf(sq), r0 = rankOf(sq);
    // Pawns
    const pawnDir = byColor === WHITE ? 1 : -1;
    for (const df of [-1, 1]) {
      const f = f0 + df, r = r0 - pawnDir;
      if (inBounds(f, r)) {
        const s = sqFromFileRank(f, r);
        if (this.squares[s] === (byColor === WHITE ? 'P' : 'p')) return true;
      }
    }
    // Knights
    for (const off of KNIGHT_OFFSETS) {
      const s = sq + off;
      if (s < 0 || s > 63) continue;
      if (Math.abs(fileOf(s) - f0) > 2) continue;
      if (this.squares[s] === (byColor === WHITE ? 'N' : 'n')) return true;
    }
    // King
    for (const off of KING_OFFSETS) {
      const s = sq + off;
      if (s < 0 || s > 63) continue;
      if (Math.abs(fileOf(s) - f0) > 1) continue;
      if (this.squares[s] === (byColor === WHITE ? 'K' : 'k')) return true;
    }
    // Sliding
    const rookDirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const bishopDirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [df, dr] of rookDirs) {
      let f = f0 + df, r = r0 + dr;
      while (inBounds(f, r)) {
        const s = sqFromFileRank(f, r);
        const p = this.squares[s];
        if (p) {
          const isWhite = p === p.toUpperCase();
          if ((isWhite ? WHITE : BLACK) === byColor) {
            const t = p.toLowerCase();
            if (t === 'r' || t === 'q') return true;
          }
          break;
        }
        f += df; r += dr;
      }
    }
    for (const [df, dr] of bishopDirs) {
      let f = f0 + df, r = r0 + dr;
      while (inBounds(f, r)) {
        const s = sqFromFileRank(f, r);
        const p = this.squares[s];
        if (p) {
          const isWhite = p === p.toUpperCase();
          if ((isWhite ? WHITE : BLACK) === byColor) {
            const t = p.toLowerCase();
            if (t === 'b' || t === 'q') return true;
          }
          break;
        }
        f += df; r += dr;
      }
    }
    return false;
  }

  isInCheck(color = this.turn) {
    const k = this.findKing(color);
    if (k === -1) return false;
    return this.isSquareAttacked(k, opposite(color));
  }

  generatePseudoMoves() {
    const moves = [];
    for (let sq = 0; sq < 64; sq++) {
      const p = this.squares[sq];
      if (!p) continue;
      const color = p === p.toUpperCase() ? WHITE : BLACK;
      if (color !== this.turn) continue;
      const type = p.toLowerCase();
      if (type === 'p') this.genPawn(sq, color, moves);
      else if (type === 'n') this.genKnight(sq, color, moves);
      else if (type === 'b') this.genSliding(sq, color, moves, true, false);
      else if (type === 'r') this.genSliding(sq, color, moves, false, true);
      else if (type === 'q') this.genSliding(sq, color, moves, true, true);
      else if (type === 'k') this.genKing(sq, color, moves);
    }
    return moves;
  }

  genPawn(from, color, moves) {
    const dir = color === WHITE ? 1 : -1;
    const startRank = color === WHITE ? 1 : 6;
    const promoRank = color === WHITE ? 7 : 0;
    const f0 = fileOf(from), r0 = rankOf(from);
    const oneR = r0 + dir;
    if (inBounds(f0, oneR)) {
      const to = sqFromFileRank(f0, oneR);
      if (!this.squares[to]) {
        if (oneR === promoRank) {
          for (const promo of ['q', 'r', 'b', 'n']) {
            moves.push(new Move(from, to, { promotion: promo, piece: color === WHITE ? 'P' : 'p' }));
          }
        } else {
          moves.push(new Move(from, to, { piece: color === WHITE ? 'P' : 'p' }));
          if (r0 === startRank) {
            const twoR = r0 + 2 * dir;
            const to2 = sqFromFileRank(f0, twoR);
            if (!this.squares[to2]) moves.push(new Move(from, to2, { piece: color === WHITE ? 'P' : 'p' }));
          }
        }
      }
    }
    for (const df of [-1, 1]) {
      const f = f0 + df, r = r0 + dir;
      if (!inBounds(f, r)) continue;
      const to = sqFromFileRank(f, r);
      const target = this.squares[to];
      if (target && (target === target.toUpperCase() ? WHITE : BLACK) !== color) {
        if (r === promoRank) {
          for (const promo of ['q', 'r', 'b', 'n']) {
            moves.push(new Move(from, to, { promotion: promo, captured: target.toLowerCase(), piece: color === WHITE ? 'P' : 'p' }));
          }
        } else {
          moves.push(new Move(from, to, { captured: target.toLowerCase(), piece: color === WHITE ? 'P' : 'p' }));
        }
      }
      if (this.epSquare !== null && to === this.epSquare) {
        moves.push(new Move(from, to, { isEnPassant: true, captured: 'p', piece: color === WHITE ? 'P' : 'p' }));
      }
    }
  }

  genKnight(from, color, moves) {
    const f0 = fileOf(from);
    for (const off of KNIGHT_OFFSETS) {
      const to = from + off;
      if (to < 0 || to > 63) continue;
      if (Math.abs(fileOf(to) - f0) > 2) continue;
      const target = this.squares[to];
      if (!target || (target === target.toUpperCase() ? WHITE : BLACK) !== color) {
        moves.push(new Move(from, to, { captured: target ? target.toLowerCase() : null, piece: color === WHITE ? 'N' : 'n' }));
      }
    }
  }

  genSliding(from, color, moves, diagonal, orthogonal) {
    const dirs = [];
    if (orthogonal) dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);
    if (diagonal) dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
    const f0 = fileOf(from), r0 = rankOf(from);
    const pieceChar = this.squares[from];
    for (const [df, dr] of dirs) {
      let f = f0 + df, r = r0 + dr;
      while (inBounds(f, r)) {
        const to = sqFromFileRank(f, r);
        const target = this.squares[to];
        if (!target) {
          moves.push(new Move(from, to, { piece: pieceChar }));
        } else {
          if ((target === target.toUpperCase() ? WHITE : BLACK) !== color) {
            moves.push(new Move(from, to, { captured: target.toLowerCase(), piece: pieceChar }));
          }
          break;
        }
        f += df; r += dr;
      }
    }
  }

  genKing(from, color, moves) {
    const f0 = fileOf(from);
    const pieceChar = color === WHITE ? 'K' : 'k';
    for (const off of KING_OFFSETS) {
      const to = from + off;
      if (to < 0 || to > 63) continue;
      if (Math.abs(fileOf(to) - f0) > 1) continue;
      const target = this.squares[to];
      if (!target || (target === target.toUpperCase() ? WHITE : BLACK) !== color) {
        moves.push(new Move(from, to, { captured: target ? target.toLowerCase() : null, piece: pieceChar }));
      }
    }
    if (!this.isInCheck(color)) {
      if (color === WHITE && from === 4) {
        if (this.castling.K && !this.squares[5] && !this.squares[6] &&
          !this.isSquareAttacked(5, BLACK) && !this.isSquareAttacked(6, BLACK)) {
          moves.push(new Move(from, 6, { isCastle: true, piece: 'K' }));
        }
        if (this.castling.Q && !this.squares[1] && !this.squares[2] && !this.squares[3] &&
          !this.isSquareAttacked(2, BLACK) && !this.isSquareAttacked(3, BLACK)) {
          moves.push(new Move(from, 2, { isCastle: true, piece: 'K' }));
        }
      } else if (color === BLACK && from === 60) {
        if (this.castling.k && !this.squares[61] && !this.squares[62] &&
          !this.isSquareAttacked(61, WHITE) && !this.isSquareAttacked(62, WHITE)) {
          moves.push(new Move(from, 62, { isCastle: true, piece: 'k' }));
        }
        if (this.castling.q && !this.squares[57] && !this.squares[58] && !this.squares[59] &&
          !this.isSquareAttacked(58, WHITE) && !this.isSquareAttacked(59, WHITE)) {
          moves.push(new Move(from, 58, { isCastle: true, piece: 'k' }));
        }
      }
    }
  }

  applyMoveUnsafe(move) {
    const piece = this.squares[move.from];
    const color = piece === piece.toUpperCase() ? WHITE : BLACK;
    if (move.isEnPassant) {
      const capRank = color === WHITE ? rankOf(move.to) - 1 : rankOf(move.to) + 1;
      const capSq = sqFromFileRank(fileOf(move.to), capRank);
      this.squares[capSq] = null;
    }
    if (move.isCastle) {
      const isKingSide = fileOf(move.to) > fileOf(move.from);
      if (color === WHITE) {
        if (isKingSide) { this.squares[7] = null; this.squares[5] = 'R'; }
        else { this.squares[0] = null; this.squares[3] = 'R'; }
      } else {
        if (isKingSide) { this.squares[63] = null; this.squares[61] = 'r'; }
        else { this.squares[56] = null; this.squares[59] = 'r'; }
      }
    }
    this.squares[move.from] = null;
    if (move.promotion) {
      this.squares[move.to] = color === WHITE ? move.promotion.toUpperCase() : move.promotion;
    } else {
      this.squares[move.to] = piece;
    }
    this.turn = opposite(this.turn);
  }

  isLegalMove(move) {
    const piece = this.squares[move.from];
    if (!piece) return false;
    const color = piece === piece.toUpperCase() ? WHITE : BLACK;
    if (color !== this.turn) return false;
    const snap = this.saveState();
    this.applyMoveUnsafe(move);
    const legal = !this.isInCheck(color);
    this.restoreState(snap);
    return legal;
  }

  generateLegalMoves() {
    return this.generatePseudoMoves().filter(m => this.isLegalMove(m));
  }

  legalMovesFrom(sq) {
    return this.generateLegalMoves().filter(m => m.from === sq);
  }

  updateCastlingRights(move, piece) {
    const type = piece.toLowerCase();
    const color = piece === piece.toUpperCase() ? WHITE : BLACK;
    if (type === 'k') {
      if (color === WHITE) { this.castling.K = false; this.castling.Q = false; }
      else { this.castling.k = false; this.castling.q = false; }
    }
    if (move.from === 0 || move.to === 0) this.castling.Q = false;
    if (move.from === 7 || move.to === 7) this.castling.K = false;
    if (move.from === 56 || move.to === 56) this.castling.q = false;
    if (move.from === 63 || move.to === 63) this.castling.k = false;
  }

  makeMove(move) {
    const piece = this.squares[move.from];
    if (!piece) return false;
    const color = piece === piece.toUpperCase() ? WHITE : BLACK;
    if (color !== this.turn) return false;
    if (!this.isLegalMove(move)) return false;

    this.history.push(this.saveState());
    this.redoStack = [];

    if (move.isEnPassant) {
      const capRank = color === WHITE ? rankOf(move.to) - 1 : rankOf(move.to) + 1;
      this.squares[sqFromFileRank(fileOf(move.to), capRank)] = null;
    }
    if (move.isCastle) {
      const isKingSide = fileOf(move.to) > fileOf(move.from);
      if (color === WHITE) {
        if (isKingSide) { this.squares[7] = null; this.squares[5] = 'R'; }
        else { this.squares[0] = null; this.squares[3] = 'R'; }
      } else {
        if (isKingSide) { this.squares[63] = null; this.squares[61] = 'r'; }
        else { this.squares[56] = null; this.squares[59] = 'r'; }
      }
    }
    this.squares[move.from] = null;
    this.squares[move.to] = move.promotion ? (color === WHITE ? move.promotion.toUpperCase() : move.promotion) : piece;

    this.updateCastlingRights(move, piece);

    this.epSquare = null;
    if (piece.toLowerCase() === 'p' && Math.abs(rankOf(move.to) - rankOf(move.from)) === 2) {
      const epRank = (rankOf(move.from) + rankOf(move.to)) / 2;
      this.epSquare = sqFromFileRank(fileOf(move.from), epRank);
    }

    if (piece.toLowerCase() === 'p' || move.captured) this.halfmove = 0;
    else this.halfmove++;
    if (this.turn === BLACK) this.fullmove++;

    this.turn = opposite(this.turn);
    this.moveHistory.push(move);
    return true;
  }

  undoMove() {
    if (this.history.length === 0) return null;
    const last = this.moveHistory.pop();
    const state = this.history.pop();
    this.restoreState(state);
    this.redoStack.push(last);
    return last;
  }

  redoMove() {
    if (this.redoStack.length === 0) return null;
    const move = this.redoStack[this.redoStack.length - 1];
    this.makeMove(move);
    return move;
  }

  canUndo() { return this.history.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  isCheckmate() {
    if (!this.isInCheck()) return false;
    return this.generateLegalMoves().length === 0;
  }
  isStalemate() {
    if (this.isInCheck()) return false;
    return this.generateLegalMoves().length === 0;
  }
  isDrawByFifty() { return this.halfmove >= 100; }
  isDrawByInsufficientMaterial() {
    const pieces = this.squares.filter(p => p);
    if (pieces.length <= 2) return true;
    if (pieces.length === 3) {
      const nonKing = pieces.find(p => p.toLowerCase() !== 'k');
      const t = nonKing ? nonKing.toLowerCase() : null;
      return t === 'n' || t === 'b';
    }
    return false;
  }
  isThreefoldRepetition() {
    // Lightweight check using FEN piece-placement+turn+castling+ep signature
    const sig = this.positionSignature();
    let count = 0;
    const temp = new Board();
    temp.loadFen('8/8/8/8/8/8/8/8 w - - 0 1');
    // Replay is expensive; caller tracks signatures externally in app.js instead.
    return false;
  }
  positionSignature() {
    return this.squares.map(p => p || '-').join('') + this.turn +
      (this.castling.K ? 'K' : '') + (this.castling.Q ? 'Q' : '') +
      (this.castling.k ? 'k' : '') + (this.castling.q ? 'q' : '') +
      (this.epSquare === null ? '-' : this.epSquare);
  }

  getResult() {
    if (this.isCheckmate()) return this.turn === WHITE ? 'black_wins' : 'white_wins';
    if (this.isStalemate() || this.isDrawByFifty() || this.isDrawByInsufficientMaterial()) return 'draw';
    return 'ongoing';
  }

  toFen() {
    let out = '';
    for (let rank = 7; rank >= 0; rank--) {
      let empty = 0;
      for (let file = 0; file <= 7; file++) {
        const p = this.squares[sqFromFileRank(file, rank)];
        if (!p) empty++;
        else {
          if (empty > 0) { out += empty; empty = 0; }
          out += p;
        }
      }
      if (empty > 0) out += empty;
      if (rank > 0) out += '/';
    }
    out += ' ' + this.turn + ' ';
    let castle = '';
    if (this.castling.K) castle += 'K';
    if (this.castling.Q) castle += 'Q';
    if (this.castling.k) castle += 'k';
    if (this.castling.q) castle += 'q';
    out += (castle || '-') + ' ';
    out += (this.epSquare === null ? '-' : toAlgebraic(this.epSquare)) + ' ';
    out += this.halfmove + ' ' + this.fullmove;
    return out;
  }

  loadFen(fen) {
    try {
      const parts = fen.trim().split(/\s+/);
      if (parts.length < 4) return false;
      const ranks = parts[0].split('/');
      if (ranks.length !== 8) return false;
      const squares = new Array(64).fill(null);
      for (let rankIdx = 0; rankIdx <= 7; rankIdx++) {
        const rank = 7 - rankIdx;
        let file = 0;
        for (const c of ranks[rankIdx]) {
          if (/\d/.test(c)) file += parseInt(c, 10);
          else {
            squares[sqFromFileRank(file, rank)] = c;
            file++;
          }
        }
      }
      this.squares = squares;
      this.turn = parts[1] === 'w' ? WHITE : BLACK;
      this.castling = { K: false, Q: false, k: false, q: false };
      if (parts[2] !== '-') {
        for (const c of parts[2]) {
          if (c === 'K') this.castling.K = true;
          else if (c === 'Q') this.castling.Q = true;
          else if (c === 'k') this.castling.k = true;
          else if (c === 'q') this.castling.q = true;
        }
      }
      this.epSquare = parts[3] === '-' ? null : fromAlgebraic(parts[3]);
      this.halfmove = parseInt(parts[4], 10) || 0;
      this.fullmove = parseInt(parts[5], 10) || 1;
      this.history = [];
      this.moveHistory = [];
      this.redoStack = [];
      return true;
    } catch (e) {
      return false;
    }
  }

  // Proper SAN generation given legal move context (call BEFORE making the move)
  moveToSan(move) {
    if (move.isCastle) {
      return fileOf(move.to) > fileOf(move.from) ? 'O-O' : 'O-O-O';
    }
    const piece = this.squares[move.from];
    const type = piece.toLowerCase();
    let san = '';
    if (type !== 'p') {
      san += type.toUpperCase();
      // Disambiguation
      const others = this.generateLegalMoves().filter(m =>
        m.to === move.to && m.from !== move.from && this.squares[m.from] && this.squares[m.from].toLowerCase() === type
      );
      if (others.length > 0) {
        const sameFile = others.some(m => fileOf(m.from) === fileOf(move.from));
        const sameRank = others.some(m => rankOf(m.from) === rankOf(move.from));
        if (!sameFile) san += fileChar(move.from);
        else if (!sameRank) san += rankChar(move.from);
        else san += toAlgebraic(move.from);
      }
    }
    const isCapture = !!move.captured || move.isEnPassant;
    if (isCapture) {
      if (type === 'p') san += fileChar(move.from);
      san += 'x';
    }
    san += toAlgebraic(move.to);
    if (move.promotion) san += '=' + move.promotion.toUpperCase();

    // Determine check/mate by simulating
    const clone = this.clone();
    clone.makeMove(move);
    if (clone.isCheckmate()) san += '#';
    else if (clone.isInCheck()) san += '+';
    return san;
  }
}

// UMD-ish export for both window and worker contexts
const ChessLib = { WHITE, BLACK, Move, Board, toAlgebraic, fromAlgebraic, fileOf, rankOf, PIECE_VALUES, opposite };
if (typeof module !== 'undefined' && module.exports) module.exports = ChessLib;
if (typeof self !== 'undefined') self.ChessLib = ChessLib;
