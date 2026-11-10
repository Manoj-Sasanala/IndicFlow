// @ts-check
'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

class FlowDatabase {
  /**
   * @param {string} [customDbPath]
   */
  constructor(customDbPath) {
    this.dbPath = customDbPath || FlowDatabase.getDefaultPath();
    this.db = null;
    this.init();
  }

  static getDefaultPath() {
    const appData = process.env.APPDATA || (
      process.platform === 'darwin'
        ? path.join(process.env.HOME || '', 'Library', 'Application Support')
        : path.join(process.env.HOME || '', '.config')
    );
    const flowDir = path.join(appData, 'FlowApp');
    if (!fs.existsSync(flowDir)) {
      fs.mkdirSync(flowDir, { recursive: true });
    }
    return path.join(flowDir, 'flow.sqlite');
  }

  init() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(this.dbPath);

    // Enable Write-Ahead Logging (WAL) for high concurrency and performance
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA synchronous = NORMAL;');

    this._createTables();
    this._seedDefaultSettings();
  }

  _createTables() {
    // 1. History Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS History (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        asrText TEXT,
        formattedText TEXT,
        pastedText TEXT,
        app TEXT,
        url TEXT,
        duration INTEGER DEFAULT 0,
        status TEXT DEFAULT 'completed',
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_history_timestamp ON History (timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_history_app ON History (app);
    `);

    // 2. Dictionary Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS Dictionary (
        id TEXT PRIMARY KEY,
        phrase TEXT NOT NULL UNIQUE COLLATE NOCASE,
        replacement TEXT NOT NULL,
        frequencyUsed INTEGER DEFAULT 0,
        createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dict_phrase ON Dictionary (phrase);
    `);

    // 3. Settings Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS Settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // 4. Notes Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS Notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notes_updated ON Notes (updatedAt DESC);
    `);
  }

  _seedDefaultSettings() {
    const defaultSettings = [
      ['hotkey', 'Double-Fn / CapsLock'],
      ['activationMode', 'push_to_talk'],
      ['model', 'prisma-v3.0'],
      ['primaryProvider', 'gnani_prisma'],
      ['gnaniApiKey', process.env.GNANI_API_KEY || 'vach_1ytE2CY5X2EAmc5L3wuTWkGhJ68RnojDdCYDsXvUVyXdJGxiJ5yz4hMbZS5gE7RdnROeYrso6PoFnyQ5URmPzx6pEYdRMUTL_428d9096381302fb25361cdda2d6b97e'],
      ['gnaniModel', 'prisma-v3.0'],
      ['gnaniLanguage', 'indic-auto'],
      ['geminiApiKey', process.env.GEMINI_API_KEY || ''],
      ['geminiModel', 'gemini-3.5-flash'],
      ['groqApiKey', process.env.GROQ_API_KEY || ''],
      ['cloudEndpoint', 'wss://api.flow.local/v1/stream'],
      ['audioDevice', 'default'],
      ['autoPunctuation', 'true'],
      ['clipboardFallback', 'true'],
      ['caretTracking', 'true'],
      ['theme', 'dark'],
      ['soundEffects', 'true']
    ];

    const checkStmt = this.db.prepare('SELECT key FROM Settings WHERE key = ?');
    const insertStmt = this.db.prepare('INSERT INTO Settings (key, value) VALUES (?, ?)');

    for (const [key, val] of defaultSettings) {
      const existing = checkStmt.get(key);
      if (!existing) {
        insertStmt.run(key, val);
      }
    }
  }

  // --- History Operations ---

  addHistory(item) {
    const id = item.id || crypto.randomUUID();
    const timestamp = item.timestamp || Date.now();
    const asrText = item.asrText || '';
    const formattedText = item.formattedText || asrText;
    const pastedText = item.pastedText || formattedText;
    const app = item.app || 'Unknown';
    const url = item.url || null;
    const duration = item.duration || 0;
    const status = item.status || 'completed';
    const metadata = item.metadata ? JSON.stringify(item.metadata) : null;

    const stmt = this.db.prepare(`
      INSERT INTO History (id, timestamp, asrText, formattedText, pastedText, app, url, duration, status, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, timestamp, asrText, formattedText, pastedText, app, url, duration, status, metadata);

    return { id, timestamp, asrText, formattedText, pastedText, app, url, duration, status, metadata };
  }

  getHistory(limit = 50, offset = 0, query = '') {
    if (query && query.trim()) {
      const q = `%${query.trim()}%`;
      const stmt = this.db.prepare(`
        SELECT * FROM History
        WHERE asrText LIKE ? OR formattedText LIKE ? OR app LIKE ?
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `);
      return stmt.all(q, q, q, limit, offset);
    }

    const stmt = this.db.prepare(`
      SELECT * FROM History
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `);
    return stmt.all(limit, offset);
  }

  getHistoryItem(id) {
    const stmt = this.db.prepare('SELECT * FROM History WHERE id = ?');
    return stmt.get(id);
  }

  deleteHistory(id) {
    const stmt = this.db.prepare('DELETE FROM History WHERE id = ?');
    return stmt.run(id);
  }

  clearHistory() {
    this.db.exec('DELETE FROM History');
  }

  // --- Dictionary Operations ---

  getDictionary() {
    const stmt = this.db.prepare('SELECT * FROM Dictionary ORDER BY frequencyUsed DESC, phrase ASC');
    return stmt.all();
  }

  addDictionaryWord(phrase, replacement) {
    const trimmedPhrase = (phrase || '').trim();
    const trimmedReplacement = (replacement || '').trim();
    if (!trimmedPhrase) {
      throw new Error('Dictionary phrase cannot be empty');
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO Dictionary (id, phrase, replacement, frequencyUsed, createdAt)
      VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(phrase) DO UPDATE SET replacement = excluded.replacement
    `);
    stmt.run(id, trimmedPhrase, trimmedReplacement, now);
    return { id, phrase: trimmedPhrase, replacement: trimmedReplacement, frequencyUsed: 0, createdAt: now };
  }

  updateDictionaryWord(id, phrase, replacement) {
    const stmt = this.db.prepare(`
      UPDATE Dictionary
      SET phrase = ?, replacement = ?
      WHERE id = ?
    `);
    return stmt.run(phrase.trim(), replacement.trim(), id);
  }

  deleteDictionaryWord(id) {
    const stmt = this.db.prepare('DELETE FROM Dictionary WHERE id = ?');
    return stmt.run(id);
  }

  incrementDictionaryUsage(phrase) {
    const stmt = this.db.prepare(`
      UPDATE Dictionary
      SET frequencyUsed = frequencyUsed + 1
      WHERE phrase = ? COLLATE NOCASE
    `);
    return stmt.run(phrase.trim());
  }

  // Apply dictionary replacements to transcription
  applyDictionary(text) {
    if (!text) return text;
    const words = this.getDictionary();
    let result = text;
    for (const item of words) {
      if (!item.phrase || !item.replacement) continue;
      // Regex word boundary replace
      const escaped = item.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
      if (regex.test(result)) {
        result = result.replace(regex, item.replacement);
        this.incrementDictionaryUsage(item.phrase);
      }
    }
    return result;
  }

  // --- Settings Operations ---

  getSetting(key, defaultValue = null) {
    const stmt = this.db.prepare('SELECT value FROM Settings WHERE key = ?');
    const row = stmt.get(key);
    return row ? row.value : defaultValue;
  }

  getAllSettings() {
    const stmt = this.db.prepare('SELECT key, value FROM Settings');
    const rows = stmt.all();
    const result = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  setSetting(key, value) {
    const stmt = this.db.prepare(`
      INSERT INTO Settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    stmt.run(key, String(value));
  }

  // --- Notes Operations ---

  getNotes() {
    const stmt = this.db.prepare('SELECT * FROM Notes ORDER BY updatedAt DESC');
    return stmt.all();
  }

  getNote(id) {
    const stmt = this.db.prepare('SELECT * FROM Notes WHERE id = ?');
    return stmt.get(id);
  }

  saveNote(title, content, id = null) {
    const now = Date.now();
    if (id) {
      const stmt = this.db.prepare(`
        UPDATE Notes
        SET title = ?, content = ?, updatedAt = ?
        WHERE id = ?
      `);
      stmt.run(title, content, now, id);
      return { id, title, content, updatedAt: now };
    } else {
      const newId = crypto.randomUUID();
      const stmt = this.db.prepare(`
        INSERT INTO Notes (id, title, content, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run(newId, title, content, now, now);
      return { id: newId, title, content, createdAt: now, updatedAt: now };
    }
  }

  deleteNote(id) {
    const stmt = this.db.prepare('DELETE FROM Notes WHERE id = ?');
    return stmt.run(id);
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = { FlowDatabase };
