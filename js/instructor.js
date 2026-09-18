/* ============================================================
   VELO — instructor.js
   El Instructor VELO: explica jugadas y posiciones en lenguaje
   natural, adaptado al nivel del usuario (principiante,
   intermedio, avanzado).
   ============================================================ */

const InstructorLib = (function () {
  const { WHITE } = ChessLib;

  const CLASS_EMOJI = {
    brilliant: '💎', great: '⭐', excellent: '🟢', best: '🟢', good: '⚪',
    inaccuracy: '🟡', mistake: '🟠', blunder: '🔴', book: '📖', forced: '→'
  };
  const CLASS_LABEL = {
    brilliant: 'BRILLANTE', great: 'GENIAL', excellent: 'EXCELENTE', best: 'MEJOR',
    good: 'BUENA', inaccuracy: 'IMPRECISIÓN', mistake: 'ERROR', blunder: 'MUY MALA',
    book: 'TEÓRICA', forced: 'FORZADA'
  };

  class Coach {
    constructor() {
      this.level = 'intermediate'; // beginner | intermediate | advanced
    }

    detectPhase(board) {
      let queens = 0, minor = 0, total = 0;
      for (let i = 0; i < 64; i++) {
        const p = board.squares[i];
        if (!p) continue;
        total++;
        const t = p.toLowerCase();
        if (t === 'q') queens++;
        else if (t === 'n' || t === 'b') minor++;
      }
      if (total > 28 || (queens === 2 && minor > 4)) return 'opening';
      if (total < 14 || queens === 0) return 'endgame';
      return 'middlegame';
    }

    formatEval(ev) {
      if (ev > 5) return 'ventaja decisiva';
      if (ev < -5) return 'ventaja decisiva del rival';
      return (ev >= 0 ? '+' : '') + ev.toFixed(1);
    }

    describeMoveIdea(board, move) {
      const piece = board.pieceAt(move.from);
      if (!piece) return move.toUci();
      const type = piece.toLowerCase();
      if (move.isCastle) return 'enrocar y poner el rey a salvo';
      if (move.promotion) return 'promocionar el peón';
      if (move.captured) return `capturar en ${ChessLib.toAlgebraic(move.to)}`;
      if (type === 'p' && Math.abs(ChessLib.rankOf(move.to) - ChessLib.rankOf(move.from)) === 2) {
        return 'avanzar el peón liberando espacio';
      }
      if (type === 'n' || type === 'b') return 'desarrollar la pieza hacia una casilla más activa';
      if (type === 'r') return 'activar la torre';
      if (type === 'q') return 'mejorar la posición de la dama';
      return `jugar ${move.toUci()}`;
    }

    whyWorse(board, played, best) {
      if (!played.captured && best && best.captured) {
        return 'Dejaste material sin capturar.';
      }
      return 'El rival obtiene más actividad o mejores perspectivas.';
    }

    explainPosition(board, evalWhite, bestMove) {
      const phase = this.detectPhase(board);
      const side = board.turn === WHITE ? 'Blancas' : 'Negras';
      const evalText = this.formatEval(evalWhite);
      const parts = [];

      if (evalWhite > 2.0) parts.push(`La posición favorece claramente a las blancas (${evalText}).`);
      else if (evalWhite > 0.7) parts.push(`Las blancas tienen una ligera ventaja (${evalText}).`);
      else if (evalWhite > -0.7) parts.push(`La posición está equilibrada (${evalText}).`);
      else if (evalWhite > -2.0) parts.push(`Las negras tienen una ligera ventaja (${evalText}).`);
      else parts.push(`Las negras tienen una clara ventaja (${evalText}).`);

      if (phase === 'opening') parts.push('Estamos en la apertura. Es importante desarrollar las piezas y enrocar.');
      else if (phase === 'middlegame') parts.push('Medio juego: busca planes activos y coordina tus piezas.');
      else parts.push('Final: cada peón y la actividad del rey cuentan mucho.');

      if (board.isInCheck()) {
        parts.push(`¡Atención! El rey de ${side} está en jaque. Debes resolverlo de inmediato.`);
      } else {
        const wKing = board.findKing(WHITE);
        const bKing = board.findKing('b');
        if (wKing !== -1 && ChessLib.rankOf(wKing) > 1 && phase !== 'endgame') {
          parts.push('El rey blanco aún no está enrocado; conviene buscar seguridad.');
        }
        if (bKing !== -1 && ChessLib.rankOf(bKing) < 6 && phase !== 'endgame') {
          parts.push('El rey negro aún no está enrocado.');
        }
      }

      if (bestMove && this.level !== 'beginner') {
        parts.push(`Una idea fuerte es ${this.describeMoveIdea(board, bestMove)}.`);
      }
      return parts.join(' ');
    }

    explainMove(boardBefore, move, classification, evalBefore, evalAfter, bestMove) {
      const playedUci = move.toUci();
      const bestUci = bestMove ? bestMove.toUci() : null;
      const emoji = CLASS_EMOJI[classification];

      switch (classification) {
        case 'brilliant':
          return `${emoji} ¡Jugada brillante! ${this.describeMoveIdea(boardBefore, move)}. Es una decisión difícil de encontrar que mejora mucho la posición.`;
        case 'great':
        case 'excellent':
        case 'best':
          return `${emoji} Buena jugada. ${this.describeMoveIdea(boardBefore, move)}. Mantiene o mejora la evaluación.`;
        case 'good':
          return `${emoji} Jugada razonable. ${this.describeMoveIdea(boardBefore, move)}.`;
        case 'inaccuracy': {
          const better = (bestUci && bestUci !== playedUci) ? ` Era mejor ${bestUci}.` : '';
          return `${emoji} Imprecisión. La jugada no es mala, pero hay opciones más precisas.${better} La evaluación cambió ligeramente.`;
        }
        case 'mistake': {
          const better = bestUci ? ` La mejor era ${bestUci}.` : '';
          return `${emoji} Error. Esta jugada permite al rival mejorar su posición.${better} ${this.whyWorse(boardBefore, move, bestMove)}`;
        }
        case 'blunder': {
          const better = bestUci ? ` Debías jugar ${bestUci}.` : '';
          return `${emoji} Jugada muy mala. Pierdes material o dejas una debilidad grave.${better} ${this.whyWorse(boardBefore, move, bestMove)}`;
        }
        case 'book':
          return `${emoji} Jugada de la teoría de aperturas.`;
        case 'forced':
          return `${emoji} Jugada prácticamente forzada.`;
        default:
          return '';
      }
    }

    explainError(boardBefore, played, best, evalDrop) {
      let out = `Jugaste ${played.toUci()}. `;
      if (best) out += `Era mejor ${best.toUci()}. `;
      if (evalDrop > 3) out += 'Esto cambia drásticamente la evaluación a favor del rival. ';
      else if (evalDrop > 1.5) out += 'Pierdes una ventaja importante. ';
      else out += 'La posición se vuelve menos favorable. ';
      out += this.whyWorse(boardBefore, played, best);
      return out;
    }

    generateGameSummary(classifications) {
      const count = c => classifications.filter(x => x === c).length;
      const brilliant = count('brilliant');
      const great = count('great') + count('excellent');
      const best = count('best');
      const inaccuracies = count('inaccuracy');
      const mistakes = count('mistake');
      const blunders = count('blunder');

      const recs = [];
      if (blunders > 0) recs.push('Reduce los errores graves revisando las amenazas tácticas antes de mover.');
      if (mistakes > 2) recs.push('Tu principal área de mejora fue la precisión en el cálculo.');
      if (inaccuracies > 3) recs.push('Trabaja en encontrar la jugada más precisa en posiciones tranquilas.');
      if (brilliant + great > 0) recs.push('Tuviste momentos brillantes: sigue buscando ideas creativas.');
      if (recs.length === 0) recs.push('Partida sólida. Sigue entrenando posiciones críticas.');

      return { brilliant, great, best, inaccuracies, mistakes, blunders, recommendations: recs };
    }
  }

  return { Coach, CLASS_EMOJI, CLASS_LABEL };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = InstructorLib;
if (typeof self !== 'undefined') self.InstructorLib = InstructorLib;
