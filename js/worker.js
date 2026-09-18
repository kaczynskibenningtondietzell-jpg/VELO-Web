/* ============================================================
   VELO — worker.js
   Web Worker: ejecuta el motor de ajedrez en segundo plano para
   no bloquear la interfaz durante el análisis.
   ============================================================ */

importScripts('chess.js', 'engine.js');

const engine = new EngineLib.Engine();

self.onmessage = function (e) {
  const { id, type, payload } = e.data;

  if (type === 'analyze') {
    const board = new ChessLib.Board();
    board.loadFen(payload.fen);
    const result = engine.analyze(
      board,
      payload.maxDepth || 8,
      payload.timeLimitMs || 1800,
      payload.multiPv || 1,
      (partial) => {
        self.postMessage({
          id, type: 'progress',
          payload: serializeResult(partial)
        });
      }
    );
    self.postMessage({ id, type: 'done', payload: serializeResult(result) });
  } else if (type === 'stop') {
    engine.requestStop();
  } else if (type === 'evaluate') {
    const board = new ChessLib.Board();
    board.loadFen(payload.fen);
    const ev = engine.evaluate(board);
    const whiteEval = board.turn === ChessLib.WHITE ? ev : -ev;
    self.postMessage({ id, type: 'done', payload: { evaluation: whiteEval / 100 } });
  }
};

function serializeResult(result) {
  return {
    bestMove: result.bestMove ? {
      from: result.bestMove.from, to: result.bestMove.to,
      promotion: result.bestMove.promotion, uci: result.bestMove.toUci()
    } : null,
    evaluation: result.evaluation,
    depth: result.depth,
    nodes: result.nodes,
    timeMs: result.timeMs || 0,
    pv: (result.pv || []).map(m => m.toUci()),
    multiPv: (result.multiPv || []).map(([m, s]) => ({ uci: m.toUci(), from: m.from, to: m.to, promotion: m.promotion, evaluation: s }))
  };
}
