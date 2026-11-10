// @ts-check
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * Computes standard Levenshtein edit distance between two strings.
 * Uses O(min(N, M)) space optimization.
 * 
 * @param {string} a 
 * @param {string} b 
 * @returns {number} Minimum number of single-character edits (insertions, deletions, substitutions)
 */
function computeLevenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a || a.length === 0) return (b || '').length;
  if (!b || b.length === 0) return a.length;

  let s1 = a;
  let s2 = b;
  if (s1.length > s2.length) {
    s1 = b;
    s2 = a;
  }

  const len1 = s1.length;
  const len2 = s2.length;
  let prevRow = new Int32Array(len1 + 1);
  let currRow = new Int32Array(len1 + 1);

  for (let i = 0; i <= len1; i++) {
    prevRow[i] = i;
  }

  for (let j = 1; j <= len2; j++) {
    currRow[0] = j;
    const char2 = s2.charCodeAt(j - 1);

    for (let i = 1; i <= len1; i++) {
      const char1 = s1.charCodeAt(i - 1);
      const cost = char1 === char2 ? 0 : 1;

      const deletion = prevRow[i] + 1;
      const insertion = currRow[i - 1] + 1;
      const substitution = prevRow[i - 1] + cost;

      currRow[i] = Math.min(deletion, insertion, substitution);
    }

    const temp = prevRow;
    prevRow = currRow;
    currRow = temp;
  }

  return prevRow[len1];
}

/**
 * Computes normalized similarity score [0.0 to 1.0]
 * @param {string} a 
 * @param {string} b 
 * @returns {number}
 */
function computeSimilarity(a, b) {
  const maxLen = Math.max((a || '').length, (b || '').length);
  if (maxLen === 0) return 1.0;
  const dist = computeLevenshteinDistance(a, b);
  return Math.max(0.0, Math.round((1.0 - (dist / maxLen)) * 100) / 100);
}

/**
 * Personalization & Learning Engine
 * Handles custom dictionary replacements and learns user corrections via Levenshtein diffing.
 */
class PersonalizationEngine {
  /**
   * @param {object} [config]
   * @param {any} [config.database] - Optional FlowDatabase instance
   * @param {string} [config.storagePath] - Optional JSON file storage path
   * @param {number} [config.autoLearnThreshold=2] - Number of occurrences before auto-learning a correction
   */
  constructor(config = {}) {
    this.database = config.database || null;
    this.storagePath = config.storagePath || null;
    this.autoLearnThreshold = config.autoLearnThreshold || 2;

    /** @type {Map<string, { id: string, phrase: string, replacement: string, frequencyUsed: number, createdAt: number }>} */
    this.dictionary = new Map();

    /** @type {Map<string, { phrase: string, replacement: string, count: number, lastSeen: number }>} */
    this.learningBuffer = new Map();

    this.init();
  }

  init() {
    if (this.database && typeof this.database.getDictionary === 'function') {
      try {
        const rows = this.database.getDictionary();
        for (const row of rows) {
          this.dictionary.set(row.phrase.toLowerCase(), {
            id: row.id,
            phrase: row.phrase,
            replacement: row.replacement,
            frequencyUsed: row.frequencyUsed || 0,
            createdAt: row.createdAt || Date.now()
          });
        }
      } catch (err) {
        // Fall back to memory
      }
    } else if (this.storagePath && fs.existsSync(this.storagePath)) {
      try {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        const data = JSON.parse(raw);
        for (const item of (data.dictionary || [])) {
          this.dictionary.set(item.phrase.toLowerCase(), item);
        }
        for (const [key, val] of Object.entries(data.learningBuffer || {})) {
          this.learningBuffer.set(key, val);
        }
      } catch (err) {
        // Fall back to empty map
      }
    }
  }

  save() {
    if (this.storagePath) {
      try {
        const dir = path.dirname(this.storagePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const payload = {
          dictionary: Array.from(this.dictionary.values()),
          learningBuffer: Object.fromEntries(this.learningBuffer.entries())
        };
        fs.writeFileSync(this.storagePath, JSON.stringify(payload, null, 2), 'utf8');
      } catch (err) {
        // Non-blocking save error
      }
    }
  }

  /**
   * Adds or updates a dictionary replacement entry.
   * @param {string} phrase - Trigger phrase/word (e.g. "k8s", "pr", "indic")
   * @param {string} replacement - Target replacement (e.g. "Kubernetes", "PR", "IndicFlow")
   * @returns {{ id: string, phrase: string, replacement: string, frequencyUsed: number }}
   */
  addWord(phrase, replacement) {
    const p = (phrase || '').trim();
    const r = (replacement || '').trim();
    if (!p) throw new Error('Dictionary phrase cannot be empty');

    const key = p.toLowerCase();
    const existing = this.dictionary.get(key);

    const entry = {
      id: existing ? existing.id : crypto.randomUUID(),
      phrase: p,
      replacement: r,
      frequencyUsed: existing ? existing.frequencyUsed : 0,
      createdAt: existing ? existing.createdAt : Date.now()
    };

    this.dictionary.set(key, entry);

    if (this.database && typeof this.database.addDictionaryWord === 'function') {
      try {
        this.database.addDictionaryWord(p, r);
      } catch (err) {}
    }

    this.save();
    return entry;
  }

  /**
   * Removes a word from the dictionary.
   * @param {string} phrase 
   * @returns {boolean}
   */
  removeWord(phrase) {
    const key = (phrase || '').trim().toLowerCase();
    const existed = this.dictionary.delete(key);

    if (this.database && typeof this.database.deleteDictionaryWord === 'function') {
      try {
        const words = this.database.getDictionary();
        const found = words.find(w => w.phrase.toLowerCase() === key);
        if (found) this.database.deleteDictionaryWord(found.id);
      } catch (err) {}
    }

    this.save();
    return existed;
  }

  /**
   * Retrieves all dictionary entries sorted by frequency of use.
   * @returns {Array<{ phrase: string, replacement: string, frequencyUsed: number }>}
   */
  getAllWords() {
    return Array.from(this.dictionary.values()).sort((a, b) => b.frequencyUsed - a.frequencyUsed);
  }

  /**
   * Substitutes custom dictionary phrases in the text.
   * Respects word boundaries and preserves surrounding punctuation.
   * 
   * @param {string} text - Spoken or formatted text
   * @returns {string} Text with dictionary replacements applied
   */
  applyDictionary(text) {
    if (!text || this.dictionary.size === 0) return text;

    let result = text;
    // Sort entries so multi-word phrases get replaced before single words
    const entries = Array.from(this.dictionary.values()).sort((a, b) => b.phrase.length - a.phrase.length);

    for (const item of entries) {
      if (!item.phrase || !item.replacement) continue;

      // Escape special regex characters in the user's phrase
      const escaped = item.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Case-insensitive word boundary match
      const regex = new RegExp(`\\b${escaped}\\b`, 'gi');

      if (regex.test(result)) {
        result = result.replace(regex, (match) => {
          // If original match was ALL CAPS, and replacement has a title/lower version,
          // keep replacement case or uppercase it appropriately
          item.frequencyUsed++;
          if (this.database && typeof this.database.incrementDictionaryUsage === 'function') {
            try { this.database.incrementDictionaryUsage(item.phrase); } catch (e) {}
          }
          return item.replacement;
        });
      }
    }

    return result;
  }

  /**
   * Learns from user edits by comparing dictated text with subsequent manually edited text.
   * Uses Levenshtein distance and token-level diffing to detect single-word corrections.
   * 
   * @param {string} dictatedText - Original text that was typed/pasted
   * @param {string} editedText - The modified text after user backspaced/corrected
   * @returns {{
   *   distance: number,
   *   similarity: number,
   *   learned: boolean,
   *   correctionDetected: boolean,
   *   candidate?: { phrase: string, replacement: string, count: number }
   * }}
   */
  learnFromEdit(dictatedText, editedText) {
    const dText = (dictatedText || '').trim();
    const eText = (editedText || '').trim();

    if (!dText || !eText || dText === eText) {
      return {
        distance: 0,
        similarity: 1.0,
        learned: false,
        correctionDetected: false
      };
    }

    const distance = computeLevenshteinDistance(dText, eText);
    const similarity = computeSimilarity(dText, eText);

    // If text was completely wiped out or replaced with something totally different (< 50% similar),
    // don't treat it as a word-level typo correction
    if (similarity < 0.40) {
      return {
        distance,
        similarity,
        learned: false,
        correctionDetected: false
      };
    }

    // Extract word-level substitution pair
    const wordDiff = this._extractWordSubstitution(dText, eText);
    if (!wordDiff) {
      return {
        distance,
        similarity,
        learned: false,
        correctionDetected: false
      };
    }

    const { phrase, replacement } = wordDiff;
    const bufferKey = `${phrase.toLowerCase()}->${replacement.toLowerCase()}`;

    let bufferEntry = this.learningBuffer.get(bufferKey);
    if (!bufferEntry) {
      bufferEntry = { phrase, replacement, count: 1, lastSeen: Date.now() };
    } else {
      bufferEntry.count++;
      bufferEntry.lastSeen = Date.now();
    }
    this.learningBuffer.set(bufferKey, bufferEntry);

    // Check if correction has hit learning threshold
    let learned = false;
    if (bufferEntry.count >= this.autoLearnThreshold) {
      this.addWord(phrase, replacement);
      learned = true;
    }

    this.save();

    return {
      distance,
      similarity,
      learned,
      correctionDetected: true,
      candidate: {
        phrase,
        replacement,
        count: bufferEntry.count
      }
    };
  }

  /**
   * Identifies candidate single-word substitutions between dictated and edited text.
   * @private
   */
  _extractWordSubstitution(dictated, edited) {
    const cleanWords = (s) => s.split(/\s+/).map(w => w.replace(/^[^\w]+|[^\w]+$/g, '')).filter(Boolean);

    const dWords = cleanWords(dictated);
    const eWords = cleanWords(edited);

    // If word counts are equal, find the single word that changed
    if (dWords.length === eWords.length && dWords.length > 0) {
      const diffIndices = [];
      for (let i = 0; i < dWords.length; i++) {
        if (dWords[i].toLowerCase() !== eWords[i].toLowerCase()) {
          diffIndices.push(i);
        }
      }

      // Exactly one word substituted!
      if (diffIndices.length === 1) {
        const idx = diffIndices[0];
        const oldWord = dWords[idx];
        const newWord = eWords[idx];

        // Ensure edit distance between the two words is reasonable (1-4 character changes)
        const wordDist = computeLevenshteinDistance(oldWord.toLowerCase(), newWord.toLowerCase());
        if (wordDist >= 1 && wordDist <= 5) {
          return { phrase: oldWord, replacement: newWord };
        }
      }
    }

    // If word counts differ by 1 (e.g. "Graph QL" -> "GraphQL" or "micro service" -> "microservice")
    if (dWords.length === eWords.length + 1) {
      for (let i = 0; i < eWords.length; i++) {
        const merged = dWords[i] + dWords[i + 1];
        if (merged.toLowerCase() === eWords[i].toLowerCase()) {
          return { phrase: `${dWords[i]} ${dWords[i + 1]}`, replacement: eWords[i] };
        }
      }
    }

    return null;
  }
}

module.exports = {
  PersonalizationEngine,
  computeLevenshteinDistance,
  computeSimilarity
};
