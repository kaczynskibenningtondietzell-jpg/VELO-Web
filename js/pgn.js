/* ============================================================
   VELO — pgn.js
   Parseo y exportación de PGN. Conversión SAN <-> Move.
   ============================================================ */

const PgnLib = (function () {
  const { WHITE } = ChessLib;

  function parse(pgn) {
    try {
      const tags = {};
      const lines = pgn.split('\n');
      const moveLines = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          const content = trimmed.substring(1, trimmed.length - 1);
          const spaceIdx = content.indexOf(' ');
          if (spaceIdx > 0) {
            const key = content.substring(0, spaceIdx);
            let value = content.substring(spaceIdx + 1).trim();
            if (value.startsWith('"') && value.endsWith('"')) value = value.substring(1, value.length - 1);
            tags[key] = value;
          }
        } else if (trimmed.length > 0) {
          moveLines.push(trimmed);
        }
      }
      let moveText = moveLines.join(' ');
      moveText = moveText.replace(/\{[^}]*\}/g, ' '); // comments
      moveText = moveText.replace(/\([^)]*\)/g, ' '); // variations (simplificado)
      moveText = moveText.replace(/\$\d+/g, ' '); // NAGs
      moveText = moveText.replace(/\d+\.(\.\.)?/g, ' '); // move numbers
      const tokens = moveText.split(/\s+/).filter(t => t.length > 0 && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));

      let result = tags['Result'] || null;
      if (!result) {
        if (moveText.includes('1-0')) result = '1-0';
        else if (moveText.includes('0-1')) result = '0-1';
        else if (moveText.includes('1/2-1/2')) result = '1/2-1/2';
      }
      return { ok: true, tags, moves: tokens, result };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  function sanToMove(board, sanRaw) {
    let san = sanRaw.replace(/[+#!?]/g, '').trim();
    if (!san) return null;

    if (san === 'O-O' || san === '0-0') {
      return board.generateLegalMoves().find(m => m.isCastle && ChessLib.fileOf(m.to) > ChessLib.fileOf(m.from)) || null;
    }
    if (san === 'O-O-O' || san === '0-0-0') {
      return board.generateLegalMoves().find(m => m.isCastle && ChessLib.fileOf(m.to) < ChessLib.fileOf(m.from)) || null;
    }

    let promotion = null;
    if (san.includes('=')) {
      const parts = san.split('=');
      san = parts[0];
      const pc = (parts[1] || 'Q')[0].toUpperCase();
      promotion = { Q: 'q', R: 'r', B: 'b', N: 'n' }[pc] || 'q';
    }

    const destStr = san.slice(-2);
    if (destStr.length < 2) return null;
    let to;
    try { to = ChessLib.fromAlgebraic(destStr); } catch (e) { return null; }

    const pieceChar = san[0];
    let pieceType;
    if (!pieceChar || pieceChar === pieceChar.toLowerCase() || pieceChar === 'x') pieceType = 'p';
    else if (pieceChar === 'N') pieceType = 'n';
    else if (pieceChar === 'B') pieceType = 'b';
    else if (pieceChar === 'R') pieceType = 'r';
    else if (pieceChar === 'Q') pieceType = 'q';
    else if (pieceChar === 'K') pieceType = 'k';
    else pieceType = 'p';

    let body = san.slice(0, -2).replace('x', '');
    if (pieceType !== 'p' && body.length > 0) body = body.slice(1); // drop piece letter
    let fromFile = null, fromRank = null;
    for (const c of body) {
      if (c >= 'a' && c <= 'h') fromFile = c.charCodeAt(0) - 97;
      else if (c >= '1' && c <= '8') fromRank = c.charCodeAt(0) - 49;
    }

    const candidates = board.generateLegalMoves().filter(m => {
      if (m.to !== to) return false;
      const p = board.pieceAt(m.from);
      if (!p || p.toLowerCase() !== pieceType) return false;
      if (promotion && m.promotion !== promotion) return false;
      if (!promotion && m.promotion) return false;
      if (fromFile !== null && ChessLib.fileOf(m.from) !== fromFile) return false;
      if (fromRank !== null && ChessLib.rankOf(m.from) !== fromRank) return false;
      return true;
    });
    return candidates[0] || null;
  }

  function applyMoves(board, sanMoves) {
    const applied = [];
    for (const san of sanMoves) {
      const move = sanToMove(board, san);
      if (!move) return null;
      if (!board.makeMove(move)) return null;
      applied.push(move);
    }
    return applied;
  }

  function exportPgn(moveSanList, tags = {}) {
    const defaultTags = {
      Event: 'VELO Analysis',
      Site: 'Local',
      Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
      White: tags.White || 'Blancas',
      Black: tags.Black || 'Negras',
      Result: tags.Result || '*',
      ...tags
    };
    let out = '';
    for (const k of Object.keys(defaultTags)) {
      out += `[${k} "${defaultTags[k]}"]\n`;
    }
    out += '\n';
    let line = '';
    for (let i = 0; i < moveSanList.length; i++) {
      if (i % 2 === 0) line += `${Math.floor(i / 2) + 1}. `;
      line += moveSanList[i] + ' ';
    }
    out += line.trim() + ' ' + (defaultTags.Result || '*');
    return out;
  }

  return { parse, sanToMove, applyMoves, exportPgn };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PgnLib;
if (typeof self !== 'undefined') self.PgnLib = PgnLib;
