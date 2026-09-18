/* ============================================================
   VELO — storage.js
   Almacenamiento 100% local. Ajustes en localStorage,
   historial de partidas en IndexedDB (con fallback a
   localStorage si IndexedDB no está disponible).
   ============================================================ */

const StorageLib = (function () {
  const SETTINGS_KEY = 'velo_settings_v1';
  const DB_NAME = 'velo_db';
  const DB_VERSION = 1;
  const STORE = 'games';

  const DEFAULT_SETTINGS = {
    boardTheme: 'classic_dark',
    pieceStyle: 'unicode',
    showLegalMoves: true,
    showArrows: true,
    showEval: true,
    engineDepth: 8,
    analysisTimeMs: 1800,
    orientation: 'white', // white | black | auto
    animations: true,
    coachLevel: 'intermediate',
    multiPv: 3,
    soundEnabled: true,
    vibrationEnabled: true
  };

  function getSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch (e) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings(settings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      return true;
    } catch (e) {
      return false;
    }
  }

  let dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('date', 'date', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null); // fall back gracefully
    });
    return dbPromise;
  }

  const LS_GAMES_KEY = 'velo_games_fallback_v1';
  function lsGetGames() {
    try { return JSON.parse(localStorage.getItem(LS_GAMES_KEY) || '[]'); } catch (e) { return []; }
  }
  function lsSaveGames(games) {
    try { localStorage.setItem(LS_GAMES_KEY, JSON.stringify(games)); } catch (e) { /* ignore */ }
  }

  async function saveGame(game) {
    const db = await openDb();
    game.date = game.date || Date.now();
    if (!db) {
      const games = lsGetGames();
      game.id = (games.reduce((m, g) => Math.max(m, g.id || 0), 0)) + 1;
      games.unshift(game);
      lsSaveGames(games);
      return game.id;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.add(game);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllGames() {
    const db = await openDb();
    if (!db) return lsGetGames().sort((a, b) => b.date - a.date);
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => b.date - a.date));
      req.onerror = () => resolve([]);
    });
  }

  async function deleteGame(id) {
    const db = await openDb();
    if (!db) {
      const games = lsGetGames().filter(g => g.id !== id);
      lsSaveGames(games);
      return;
    }
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  async function clearGames() {
    const db = await openDb();
    if (!db) { lsSaveGames([]); return; }
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  function downloadTextFile(filename, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return {
    DEFAULT_SETTINGS, getSettings, saveSettings,
    saveGame, getAllGames, deleteGame, clearGames,
    downloadTextFile
  };
})();

if (typeof window !== 'undefined') window.StorageLib = StorageLib;
