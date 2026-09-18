/* ============================================================
   VELO — analysis.js
   Controlador de análisis: envuelve el Web Worker con una API
   basada en promesas, clasifica jugadas y construye el reporte
   de revisión de partida completa.
   ============================================================ */

const AnalysisLib = (function () {
  let worker = null;
  let workerFailed = false;
  let reqId = 0;
  const pending = new Map();
  const progressHandlers = new Map();

  // Main-thread fallback engine, used when Web Workers are unavailable
  // (this happens when the app is opened directly as a local file:// —
  // most browsers block worker scripts under the file:// origin).
  let fallbackEngine = null;
  function getFallbackEngine() {
    if (!fallbackEngine) fallbackEngine = new EngineLib.Engine();
    return fallbackEngine;
  }

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

  function getWorker() {
    if (worker || workerFailed) return worker;
    try {
      worker = new Worker('js/worker.js');
      worker.onmessage = (e) => {
        const { id, type, payload } = e.data;
        if (type === 'progress') {
          const h = progressHandlers.get(id);
          if (h) h(payload);
        } else if (type === 'done') {
          const p = pending.get(id);
          if (p) { p.resolve(payload); pending.delete(id); progressHandlers.delete(id); }
        }
      };
      worker.onerror = () => {
        // Worker failed at runtime (common under file:// origin): fall back
        // to synchronous main-thread analysis for this and future requests.
        workerFailed = true;
        worker = null;
        for (const [, p] of pending) { /* let analyzePosition retry via fallback */ }
        pending.clear();
      };
    } catch (e) {
      workerFailed = true;
      worker = null;
    }
    return worker;
  }

  function analyzeFallback(fen, { maxDepth, timeLimitMs, multiPv, onProgress }) {
    return new Promise((resolve) => {
      // Yield a frame so the UI can show a "analyzing" state before the
      // (blocking) synchronous search runs.
      setTimeout(() => {
        const board = new ChessLib.Board();
        board.loadFen(fen);
        const engine = getFallbackEngine();
        const result = engine.analyze(board, maxDepth, timeLimitMs, multiPv, (partial) => {
          if (onProgress) onProgress(serializeResult(partial));
        });
        resolve(serializeResult(result));
      }, 10);
    });
  }

  function analyzePosition(fen, { maxDepth = 8, timeLimitMs = 1800, multiPv = 1, onProgress = null } = {}) {
    const w = getWorker();
    if (!w) return analyzeFallback(fen, { maxDepth, timeLimitMs, multiPv, onProgress });
    const id = ++reqId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      if (onProgress) progressHandlers.set(id, onProgress);
      try {
        w.postMessage({ id, type: 'analyze', payload: { fen, maxDepth, timeLimitMs, multiPv } });
      } catch (e) {
        pending.delete(id);
        progressHandlers.delete(id);
        workerFailed = true;
        worker = null;
        analyzeFallback(fen, { maxDepth, timeLimitMs, multiPv, onProgress }).then(resolve);
      }
    });
  }

  function stopAnalysis() {
    if (worker) worker.postMessage({ id: 0, type: 'stop' });
    else if (fallbackEngine) fallbackEngine.requestStop();
  }

  function isBestMoveUci(bestUci, playedUci) {
    return bestUci === playedUci;
  }

  function classify(evalBeforeWhite, evalAfterWhite, sideToMove, isBest, isOnlyMove) {
    // Convert to "side that moved" perspective: sideToMove is who was about to move (the mover)
    const sign = sideToMove === 'w' ? 1 : -1;
    const before = evalBeforeWhite * sign;
    const after = evalAfterWhite * sign;
    if (isOnlyMove) return 'forced';
    const absLoss = Math.abs(before - after);
    let cls;
    if (isBest && absLoss < 0.05) cls = 'best';
    else if (isBest) cls = 'excellent';
    else if (absLoss < 0.2) cls = 'good';
    else if (absLoss < 0.5) cls = 'inaccuracy';
    else if (absLoss < 1.5) cls = 'mistake';
    else cls = 'blunder';
    if (cls === 'excellent' && absLoss < 0.1) cls = 'great';
    return cls;
  }

  /**
   * Analiza una partida completa jugada por jugada.
   * moves: array of Move objects already applied in order (from a Board replay).
   * fens: array of FEN strings BEFORE each move (same length as moves).
   * onMoveDone(index, data) called as each move finishes.
   */
  async function reviewGame(fens, moveUcis, opts = {}) {
    const { maxDepth = 8, timeLimitMs = 900, onMoveDone = null } = opts;
    const results = [];
    let prevEval = null;
    for (let i = 0; i < fens.length; i++) {
      const fen = fens[i];
      const sideToMove = fen.split(' ')[1];
      const res = await analyzePosition(fen, { maxDepth, timeLimitMs, multiPv: 1 });
      const evalWhite = res.evaluation;
      const bestUci = res.bestMove ? res.bestMove.uci : null;
      const playedUci = moveUcis[i];
      const isBest = bestUci === playedUci;

      // Evaluate resulting position too, for delta-based classification
      let nextEvalWhite = evalWhite;
      // We approximate "after" eval using next position's pre-computed eval (i+1) when available;
      // otherwise reuse a quick static evaluation.
      results.push({ index: i, fen, evalWhite, bestUci, playedUci, isBest, sideToMove });
      if (onMoveDone) onMoveDone(i, results[i]);
      prevEval = evalWhite;
    }
    // second pass: classify using consecutive evals
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const nextR = results[i + 1];
      const evalAfterWhite = nextR ? nextR.evalWhite : r.evalWhite;
      r.classification = classify(r.evalWhite, evalAfterWhite, r.sideToMove, r.isBest, false);
    }
    return results;
  }

  return { analyzePosition, stopAnalysis, classify, reviewGame };
})();

if (typeof window !== 'undefined') window.AnalysisLib = AnalysisLib;
