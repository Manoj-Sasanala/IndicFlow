// @ts-check
'use strict';

/**
 * IndicFlow Main Hub & Notes Controller
 */

// --- UI Elements ---
const navItems = document.querySelectorAll('.nav-item');
const tabPanels = document.querySelectorAll('.tab-panel');
const btnToggleDictation = document.getElementById('btn-toggle-dictation');
const btnDictationLabel = document.getElementById('btn-dictation-label');
const helperStatusBadge = document.getElementById('helper-status-badge');
const helperStatusText = document.getElementById('helper-status-text');

// Window controls
const btnMinimize = document.getElementById('btn-minimize');
const btnMaximize = document.getElementById('btn-maximize');
const btnClose = document.getElementById('btn-close');

// History elements
const historyList = document.getElementById('history-list');
const historySearchInput = document.getElementById('history-search-input');
const btnClearHistory = document.getElementById('btn-clear-history');

// Dictionary elements
const dictionaryList = document.getElementById('dictionary-list');
const dictPhraseInput = document.getElementById('dict-phrase');
const dictReplacementInput = document.getElementById('dict-replacement');
const btnSaveDictEntry = document.getElementById('btn-save-dict-entry');

// Notes elements
const notesList = document.getElementById('notes-list');
const noteTitleInput = document.getElementById('note-title-input');
const noteContentInput = document.getElementById('note-content-input');
const noteSaveStatus = document.getElementById('note-save-status');
const btnNewNote = document.getElementById('btn-new-note');
const btnDeleteNote = document.getElementById('btn-delete-note');

// Settings elements
const settingTheme = document.getElementById('setting-theme');
const btnThemeToggle = document.getElementById('btn-theme-toggle');
const themeIconSun = document.getElementById('theme-icon-sun');
const themeIconMoon = document.getElementById('theme-icon-moon');
const settingHotkey = document.getElementById('setting-hotkey');
const settingActivationMode = document.getElementById('setting-activationMode');
const settingModel = document.getElementById('setting-model');
const settingCaretTracking = document.getElementById('setting-caretTracking');
const settingGnaniApiKey = document.getElementById('setting-gnaniApiKey');
const settingGnaniLanguage = document.getElementById('setting-gnaniLanguage');
const settingGeminiApiKey = document.getElementById('setting-geminiApiKey');
const settingGroqApiKey = document.getElementById('setting-groqApiKey');

let activeTab = 'history';
let activeNoteId = null;
let currentDictationState = 'idle';
let noteSaveDebounceTimer = null;

// --- Theme Management ---
function applyTheme(theme) {
  const targetTheme = (theme === 'dark') ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', targetTheme);
  if (settingTheme) settingTheme.value = targetTheme;
  if (themeIconSun && themeIconMoon) {
    if (targetTheme === 'light') {
      themeIconSun.style.display = 'none';
      themeIconMoon.style.display = 'block';
      btnThemeToggle?.setAttribute('title', 'Switch to Dark Mode');
    } else {
      themeIconSun.style.display = 'block';
      themeIconMoon.style.display = 'none';
      btnThemeToggle?.setAttribute('title', 'Switch to Light Mode');
    }
  }
}

// --- Initialize Hub ---
async function initHub() {
  bindTabs();
  bindWindowControls();
  bindDictationControls();
  bindHistoryEvents();
  bindDictionaryEvents();
  bindNotesEvents();
  bindSettingsEvents();

  // Load Initial Data
  await Promise.all([
    loadHistory(),
    loadDictionary(),
    loadNotes(),
    loadSettings(),
    checkHelperStatus()
  ]);

  // Subscribe to IPC Events
  if (window.flowAPI) {
    window.flowAPI.onStateChange((data) => {
      updateDictationState(data.state);
    });

    window.flowAPI.onHistoryUpdated((item) => {
      loadHistory();
    });

    window.flowAPI.onHelperStatus((status) => {
      updateHelperStatusUI(status);
    });
  }
}

// --- Tabs Navigation ---
function bindTabs() {
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.getAttribute('data-tab');
      if (!tab) return;
      switchTab(tab);
    });
  });
}

function switchTab(tab) {
  activeTab = tab;
  navItems.forEach(i => i.classList.toggle('active', i.getAttribute('data-tab') === tab));
  tabPanels.forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
}

// --- Window Controls ---
function bindWindowControls() {
  btnMinimize?.addEventListener('click', () => window.flowAPI?.minimizeHub());
  btnMaximize?.addEventListener('click', () => window.flowAPI?.maximizeHub());
  btnClose?.addEventListener('click', () => window.flowAPI?.closeHub());

  btnThemeToggle?.addEventListener('click', async () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'light' ? 'dark' : 'light';
    applyTheme(next);
    if (window.flowAPI) {
      await window.flowAPI.setSetting('theme', next);
    }
  });
}

// --- Dictation Control ---
function bindDictationControls() {
  btnToggleDictation?.addEventListener('click', async () => {
    if (!window.flowAPI) return;

    if (currentDictationState === 'idle') {
      await window.flowAPI.startDictation();
    } else if (currentDictationState === 'listening') {
      await window.flowAPI.stopDictation();
    }
  });
}

function updateDictationState(state) {
  currentDictationState = state;

  if (state === 'listening') {
    if (btnDictationLabel) btnDictationLabel.textContent = 'Stop Dictation';
    btnToggleDictation?.classList.add('recording');
  } else if (state === 'processing') {
    if (btnDictationLabel) btnDictationLabel.textContent = 'Transcribing...';
    btnToggleDictation?.classList.remove('recording');
  } else {
    if (btnDictationLabel) btnDictationLabel.textContent = 'Start Dictation';
    btnToggleDictation?.classList.remove('recording');
  }
}

// --- Helper Status UI ---
function updateHelperStatusUI(status) {
  if (!helperStatusText || !helperStatusBadge) return;

  const dot = helperStatusBadge.querySelector('.status-indicator-dot');
  if (status.status === 'connected' || status.ready) {
    helperStatusText.textContent = `Helper (PID ${status.pid || 'Active'})`;
    dot?.setAttribute('class', 'status-indicator-dot online');
  } else if (status.status === 'reconnecting') {
    helperStatusText.textContent = `Helper Reconnecting (${status.attempt || 1})...`;
    dot?.setAttribute('class', 'status-indicator-dot reconnecting');
  } else {
    helperStatusText.textContent = 'Helper Offline';
    dot?.setAttribute('class', 'status-indicator-dot offline');
  }
}

async function checkHelperStatus() {
  if (window.flowAPI?.getHelperStatus) {
    const status = await window.flowAPI.getHelperStatus();
    updateHelperStatusUI(status);
  }
}

// --- History View ---
function bindHistoryEvents() {
  let debounce;
  historySearchInput?.addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      loadHistory(e.target.value);
    }, 250);
  });

  btnClearHistory?.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all dictation history?')) {
      if (window.flowAPI) {
        await window.flowAPI.clearHistory();
        await loadHistory();
      }
    }
  });
}

async function loadHistory(query = '') {
  if (!historyList || !window.flowAPI) return;

  try {
    const items = await window.flowAPI.getHistory(50, 0, query);
    historyList.innerHTML = '';

    if (!items || items.length === 0) {
      historyList.innerHTML = `
        <div class="empty-state">
          <p>No dictation history found.</p>
          <p style="font-size: 12px; margin-top: 6px; color: var(--text-muted);">Use the global shortcut or "Start Dictation" above to voice-type.</p>
        </div>
      `;
      return;
    }

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'history-card';

      const formattedDate = formatTimeAgo(item.timestamp);
      const appName = item.app || 'Unknown App';
      const durationText = item.duration ? `${item.duration}s` : '';

      card.innerHTML = `
        <div class="history-card-header">
          <div class="history-meta">
            <span class="app-tag">${escapeHtml(appName)}</span>
            <span class="time-stamp">${formattedDate} &bull; ${durationText}</span>
          </div>
          <div class="history-card-actions">
            <button class="action-icon-btn btn-copy" title="Copy to clipboard">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
            <button class="action-icon-btn btn-delete" title="Delete record">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="history-text">${escapeHtml(item.formattedText || item.asrText || '')}</div>
        ${item.asrText && item.asrText !== item.formattedText ? `<div class="history-raw">ASR: "${escapeHtml(item.asrText)}"</div>` : ''}
      `;

      // Copy Button
      const btnCopy = card.querySelector('.btn-copy');
      btnCopy?.addEventListener('click', async () => {
        await navigator.clipboard.writeText(item.formattedText || item.asrText);
        btnCopy.innerHTML = `<span style="font-size: 10px; color: #34d399;">Copied!</span>`;
        setTimeout(() => {
          btnCopy.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
        }, 1500);
      });

      // Delete Button
      const btnDel = card.querySelector('.btn-delete');
      btnDel?.addEventListener('click', async () => {
        await window.flowAPI.deleteHistory(item.id);
        card.remove();
        if (historyList.children.length === 0) {
          loadHistory();
        }
      });

      historyList.appendChild(card);
    });
  } catch (err) {
    console.error('[Hub] Failed to load history:', err);
  }
}

// --- Dictionary View ---
function bindDictionaryEvents() {
  btnSaveDictEntry?.addEventListener('click', async () => {
    const phrase = dictPhraseInput?.value.trim();
    const replacement = dictReplacementInput?.value.trim();

    if (!phrase || !replacement) {
      alert('Please fill out both phrase and replacement fields.');
      return;
    }

    try {
      await window.flowAPI.addDictionaryWord(phrase, replacement);
      if (dictPhraseInput) dictPhraseInput.value = '';
      if (dictReplacementInput) dictReplacementInput.value = '';
      await loadDictionary();
    } catch (err) {
      alert('Error saving dictionary entry: ' + err.message);
    }
  });
}

async function loadDictionary() {
  if (!dictionaryList || !window.flowAPI) return;

  try {
    const words = await window.flowAPI.getDictionary();
    dictionaryList.innerHTML = '';

    if (!words || words.length === 0) {
      dictionaryList.innerHTML = `
        <tr>
          <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 24px;">
            No dictionary replacements yet. Add your first snippet above!
          </td>
        </tr>
      `;
      return;
    }

    words.forEach(word => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong>${escapeHtml(word.phrase)}</strong></td>
        <td>${escapeHtml(word.replacement)}</td>
        <td><span class="freq-badge">${word.frequencyUsed || 0} times</span></td>
        <td>
          <button class="action-icon-btn btn-del-dict" title="Remove word">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </td>
      `;

      row.querySelector('.btn-del-dict')?.addEventListener('click', async () => {
        await window.flowAPI.deleteDictionaryWord(word.id);
        await loadDictionary();
      });

      dictionaryList.appendChild(row);
    });
  } catch (err) {
    console.error('[Hub] Failed to load dictionary:', err);
  }
}

// --- Notes View ---
function bindNotesEvents() {
  btnNewNote?.addEventListener('click', () => {
    activeNoteId = null;
    if (noteTitleInput) noteTitleInput.value = 'Untitled Note';
    if (noteContentInput) noteContentInput.value = '';
    if (noteSaveStatus) noteSaveStatus.textContent = 'Unsaved draft';
    triggerAutoSave();
  });

  noteTitleInput?.addEventListener('input', triggerAutoSave);
  noteContentInput?.addEventListener('input', triggerAutoSave);

  btnDeleteNote?.addEventListener('click', async () => {
    if (activeNoteId && confirm('Delete this note?')) {
      await window.flowAPI.deleteNote(activeNoteId);
      activeNoteId = null;
      if (noteTitleInput) noteTitleInput.value = '';
      if (noteContentInput) noteContentInput.value = '';
      await loadNotes();
    }
  });
}

function triggerAutoSave() {
  if (noteSaveStatus) noteSaveStatus.textContent = 'Saving...';
  clearTimeout(noteSaveDebounceTimer);
  noteSaveDebounceTimer = setTimeout(async () => {
    const title = (noteTitleInput?.value || '').trim() || 'Untitled Note';
    const content = noteContentInput?.value || '';

    try {
      const saved = await window.flowAPI.saveNote(title, content, activeNoteId);
      if (saved && saved.id) {
        activeNoteId = saved.id;
      }
      if (noteSaveStatus) noteSaveStatus.textContent = 'Saved at ' + new Date().toLocaleTimeString();
      await loadNotes(false);
    } catch (err) {
      if (noteSaveStatus) noteSaveStatus.textContent = 'Error saving';
    }
  }, 400);
}

async function loadNotes(switchActive = true) {
  if (!notesList || !window.flowAPI) return;

  try {
    const notes = await window.flowAPI.getNotes();
    notesList.innerHTML = '';

    if (!notes || notes.length === 0) {
      notesList.innerHTML = `
        <div style="padding: 16px; font-size: 12px; color: var(--text-muted); text-align: center;">
          No notes yet. Click "+ New Note" to write or dictate one.
        </div>
      `;
      if (switchActive) {
        activeNoteId = null;
        if (noteTitleInput) noteTitleInput.value = '';
        if (noteContentInput) noteContentInput.value = '';
      }
      return;
    }

    notes.forEach((note, index) => {
      const item = document.createElement('div');
      item.className = 'note-item' + (note.id === activeNoteId || (!activeNoteId && index === 0) ? ' active' : '');
      item.innerHTML = `
        <div class="note-item-title">${escapeHtml(note.title || 'Untitled')}</div>
        <div class="note-item-time">${formatTimeAgo(note.updatedAt)}</div>
      `;

      item.addEventListener('click', () => {
        activeNoteId = note.id;
        document.querySelectorAll('.note-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        if (noteTitleInput) noteTitleInput.value = note.title;
        if (noteContentInput) noteContentInput.value = note.content;
        if (noteSaveStatus) noteSaveStatus.textContent = 'Saved';
      });

      notesList.appendChild(item);
    });

    if (switchActive && (!activeNoteId || !notes.find(n => n.id === activeNoteId))) {
      activeNoteId = notes[0].id;
      if (noteTitleInput) noteTitleInput.value = notes[0].title;
      if (noteContentInput) noteContentInput.value = notes[0].content;
      if (noteSaveStatus) noteSaveStatus.textContent = 'Saved';
    }
  } catch (err) {
    console.error('[Hub] Failed to load notes:', err);
  }
}

// --- Settings View ---
function bindSettingsEvents() {
  const saveSetting = async (key, val) => {
    if (window.flowAPI) {
      await window.flowAPI.setSetting(key, val);
    }
  };

  settingTheme?.addEventListener('change', (e) => {
    const val = e.target.value;
    applyTheme(val);
    saveSetting('theme', val);
  });
  settingHotkey?.addEventListener('change', (e) => saveSetting('hotkey', e.target.value));
  settingActivationMode?.addEventListener('change', (e) => saveSetting('activationMode', e.target.value));
  settingModel?.addEventListener('change', (e) => {
    const val = e.target.value;
    saveSetting('model', val);
    if (val.startsWith('prisma')) {
      saveSetting('primaryProvider', 'gnani_prisma');
      saveSetting('gnaniModel', val);
    } else if (val.startsWith('gemini')) {
      saveSetting('geminiModel', val);
      saveSetting('primaryProvider', 'gemini');
    } else if (val.startsWith('whisper-large') || val.startsWith('groq')) {
      saveSetting('primaryProvider', 'groq');
    } else if (val === 'local-offline' || val === 'local-whisper') {
      saveSetting('primaryProvider', 'local_server');
    }
  });
  settingCaretTracking?.addEventListener('change', (e) => saveSetting('caretTracking', String(e.target.checked)));
  settingGnaniApiKey?.addEventListener('change', (e) => saveSetting('gnaniApiKey', e.target.value.trim()));
  settingGnaniLanguage?.addEventListener('change', (e) => saveSetting('gnaniLanguage', e.target.value));
  settingGeminiApiKey?.addEventListener('change', (e) => saveSetting('geminiApiKey', e.target.value.trim()));
  settingGroqApiKey?.addEventListener('change', (e) => saveSetting('groqApiKey', e.target.value.trim()));
}

async function loadSettings() {
  if (!window.flowAPI) return;

  try {
    const settings = await window.flowAPI.getSettings();
    if (settings) {
      const activeTheme = settings.theme || 'light';
      applyTheme(activeTheme);
      if (settings.hotkey && settingHotkey) settingHotkey.value = settings.hotkey;
      if (settings.activationMode && settingActivationMode) settingActivationMode.value = settings.activationMode;
      if (settings.model && settingModel) settingModel.value = settings.model;
      if (settings.caretTracking && settingCaretTracking) settingCaretTracking.checked = settings.caretTracking === 'true';
      if (settingGnaniApiKey) settingGnaniApiKey.value = settings.gnaniApiKey || '';
      if (settingGnaniLanguage) {
        const rawLang = settings.gnaniLanguage || 'indic-auto';
        const normalized = (rawLang.includes('-') || rawLang === 'indic-auto') ? rawLang : `${rawLang}-IN`;
        settingGnaniLanguage.value = normalized;
        if (!settingGnaniLanguage.value) settingGnaniLanguage.value = rawLang;
      }
      if (settingGeminiApiKey) settingGeminiApiKey.value = settings.geminiApiKey || '';
      if (settingGroqApiKey) settingGroqApiKey.value = settings.groqApiKey || '';
    } else {
      applyTheme('light');
    }

    // Check local engine status
    const engineStatus = await (window.flowAPI.getLocalEngineStatus?.() || window.flowAPI.getLocalWhisperStatus?.());
    const badge = document.getElementById('local-engine-badge') || document.getElementById('local-whisper-badge');
    if (badge) {
      if (engineStatus && engineStatus.ready) {
        badge.textContent = 'Installed & Ready';
        badge.style.background = 'rgba(34, 197, 94, 0.15)';
        badge.style.color = '#22c55e';
      } else {
        badge.textContent = 'Setup Available (scripts/setup-offline-engine.ps1)';
        badge.style.background = 'rgba(234, 179, 8, 0.15)';
        badge.style.color = '#eab308';
      }
    }
  } catch (err) {
    console.error('[Hub] Failed to load settings:', err);
  }
}

// --- Helpers ---
function formatTimeAgo(timestamp) {
  if (!timestamp) return '';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Start
document.addEventListener('DOMContentLoaded', initHub);
