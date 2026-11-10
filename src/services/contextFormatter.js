// @ts-check
'use strict';

/**
 * Application Type Taxonomy
 * @enum {string}
 */
const AppCategory = {
  TERMINAL: 'terminal',
  CODE_EDITOR: 'code_editor',
  CHAT: 'chat',
  DOCUMENT: 'document',
  GENERIC: 'generic'
};

/**
 * Spoken punctuation and typography dictionary
 */
const SPOKEN_PUNCTUATION = [
  { pattern: /\b(period|full stop)\b/gi, replacement: '.' },
  { pattern: /\b(comma)\b/gi, replacement: ',' },
  { pattern: /\b(question mark)\b/gi, replacement: '?' },
  { pattern: /\b(exclamation mark|exclamation point)\b/gi, replacement: '!' },
  { pattern: /\b(semicolon)\b/gi, replacement: ';' },
  { pattern: /\b(colon)\b/gi, replacement: ':' },
  { pattern: /\b(ellipsis|dot dot dot)\b/gi, replacement: '...' },
  { pattern: /\b(new line|newline)\b/gi, replacement: '\n' },
  { pattern: /\b(new paragraph)\b/gi, replacement: '\n\n' },
  { pattern: /\b(bullet point|bullet)\b/gi, replacement: '\n- ' },
  { pattern: /\b(open parenthesis|open paren)\b/gi, replacement: '(' },
  { pattern: /\b(close parenthesis|close paren)\b/gi, replacement: ')' },
  { pattern: /\b(open quote|open quotation)\b/gi, replacement: '"' },
  { pattern: /\b(close quote|close quotation)\b/gi, replacement: '"' },
  { pattern: /\b(hyphen)\b/gi, replacement: '-' },
  { pattern: /\b(at sign)\b/gi, replacement: '@' }
];

/**
 * Common terminal command roots that must stay strictly lowercase
 */
const TERMINAL_COMMANDS = new Set([
  'git', 'npm', 'pnpm', 'yarn', 'npx', 'node', 'deno', 'bun', 'docker', 'docker-compose',
  'kubectl', 'helm', 'cargo', 'rustc', 'python', 'python3', 'pip', 'pytest', 'poetry',
  'go', 'make', 'cmake', 'gcc', 'clang', 'curl', 'wget', 'ssh', 'scp', 'rsync', 'tar',
  'ls', 'dir', 'cd', 'pwd', 'cat', 'grep', 'rg', 'find', 'awk', 'sed', 'chmod', 'chown',
  'mkdir', 'rm', 'rmdir', 'cp', 'mv', 'touch', 'echo', 'clear', 'cls', 'history', 'kill',
  'ps', 'top', 'htop', 'systemctl', 'journalctl', 'sudo', 'su', 'apt', 'apt-get', 'dnf',
  'pacman', 'brew', 'winget', 'choco', 'dotnet', 'pwsh', 'powershell', 'wsl', 'ipconfig',
  'ifconfig', 'ping', 'netstat', 'traceroute', 'vi', 'vim', 'nvim', 'nano', 'code'
]);

class ContextFormatter {
  /**
   * @param {object} [config]
   * @param {string} [config.llmProvider='heuristic'] - 'groq', 'openai', 'gemini', 'anthropic', or 'heuristic'
   * @param {string} [config.groqApiKey]
   * @param {string} [config.openaiApiKey]
   * @param {string} [config.geminiApiKey]
   * @param {string} [config.anthropicApiKey]
   * @param {string} [config.groqModel='llama-3.3-70b-versatile']
   * @param {string} [config.openaiModel='gpt-4o-mini']
   * @param {string} [config.geminiModel='gemini-2.5-flash']
   * @param {boolean} [config.preferLlm=false]
   */
  constructor(config = {}) {
    this.groqApiKey = config.groqApiKey || process.env.GROQ_API_KEY || '';
    this.openaiApiKey = config.openaiApiKey || process.env.OPENAI_API_KEY || '';
    this.geminiApiKey = config.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
    this.anthropicApiKey = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '';

    this.groqModel = config.groqModel || 'llama-3.3-70b-versatile';
    this.openaiModel = config.openaiModel || 'gpt-4o-mini';
    this.geminiModel = config.geminiModel || 'gemini-2.5-flash';

    this.preferLlm = config.preferLlm || false;
    this.llmProvider = config.llmProvider || this._determineLlmProvider();
  }

  _determineLlmProvider() {
    if (this.groqApiKey) return 'groq';
    if (this.openaiApiKey) return 'openai';
    if (this.geminiApiKey) return 'gemini';
    return 'heuristic';
  }

  /**
   * Detects the category of application from app name and window title.
   * @param {string} [appName='']
   * @param {string} [windowTitle='']
   * @returns {string} One of AppCategory values
   */
  detectAppCategory(appName = '', windowTitle = '') {
    const app = (appName || '').toLowerCase();
    const title = (windowTitle || '').toLowerCase();

    // Terminal / Shell
    const terminalSignatures = [
      'powershell', 'pwsh', 'cmd.exe', 'cmd', 'windowsterminal', 'wt.exe', 'bash', 'zsh',
      'alacritty', 'wezterm', 'warp', 'hyper', 'mintty', 'conhost', 'iterm', 'terminal', 'git bash'
    ];
    if (terminalSignatures.some(sig => app.includes(sig) || title.includes(sig))) {
      return AppCategory.TERMINAL;
    }

    // Code Editor / IDE
    const codeSignatures = [
      'code.exe', 'visual studio code', 'vscode', 'cursor.exe', 'cursor', 'windsurf',
      'devenv.exe', 'idea64', 'pycharm', 'webstorm', 'sublime_text', 'nvim', 'vim'
    ];
    if (codeSignatures.some(sig => app.includes(sig) || title.includes(sig))) {
      return AppCategory.CODE_EDITOR;
    }

    // Chat / Casual Messaging
    const chatSignatures = [
      'slack', 'discord', 'teams.exe', 'msteams', 'telegram', 'whatsapp', 'signal', 'messenger'
    ];
    if (chatSignatures.some(sig => app.includes(sig) || title.includes(sig))) {
      return AppCategory.CHAT;
    }

    // Document / Email / Professional
    const docSignatures = [
      'winword.exe', 'word', 'outlook.exe', 'outlook', 'excel', 'powerpnt', 'notion.exe',
      'notion', 'obsidian.exe', 'obsidian', 'mail.exe', 'thunderbird'
    ];
    if (docSignatures.some(sig => app.includes(sig) || title.includes(sig))) {
      return AppCategory.DOCUMENT;
    }

    return AppCategory.GENERIC;
  }

  /**
   * Main Context-Aware Text Formatting entry point.
   * Formats raw transcription (`asrText`) according to target app and caret context.
   * 
   * @param {object} context
   * @param {string} context.asrText - Raw text from speech recognizer
   * @param {string} [context.activeApp=''] - Process / executable name
   * @param {string} [context.windowTitle=''] - Window title
   * @param {string} [context.precedingText=''] - Text immediately before caret
   * @param {string} [context.followingText=''] - Text immediately after caret
   * @param {object} [context.stylePreferences] - Optional style overrides
   * @param {boolean} [context.useLlm] - Explicit flag to force LLM or heuristic
   * @returns {Promise<{
   *   formattedText: string,
   *   pastedText: string,
   *   detectedCategory: string,
   *   rulesApplied: string[],
   *   latencyMs: number,
   *   provider: string
   * }>}
   */
  async formatContext(context) {
    const startTime = Date.now();
    const rawAsr = (context.asrText || '').trim();
    if (!rawAsr) {
      return {
        formattedText: '',
        pastedText: '',
        detectedCategory: AppCategory.GENERIC,
        rulesApplied: [],
        latencyMs: 0,
        provider: 'noop'
      };
    }

    const appCategory = this.detectAppCategory(context.activeApp, context.windowTitle);
    const shouldRunLlm = (context.useLlm !== undefined ? context.useLlm : this.preferLlm) && this.llmProvider !== 'heuristic';

    let formattedText = '';
    let rulesApplied = [];
    let providerUsed = 'heuristic';

    if (shouldRunLlm) {
      try {
        const llmResult = await this._formatWithLlm(rawAsr, appCategory, context);
        formattedText = llmResult;
        rulesApplied.push('llm_prompt_formatting');
        providerUsed = this.llmProvider;
      } catch (err) {
        // Fallback to rule-based engine on LLM failure
        const heuristic = this._formatWithHeuristics(rawAsr, appCategory, context);
        formattedText = heuristic.text;
        rulesApplied = heuristic.rules;
        rulesApplied.push('fallback_from_llm_error: ' + err.message);
        providerUsed = 'heuristic_fallback';
      }
    } else {
      const heuristic = this._formatWithHeuristics(rawAsr, appCategory, context);
      formattedText = heuristic.text;
      rulesApplied = heuristic.rules;
      providerUsed = 'heuristic';
    }

    // Client-side caret alignment & spacing correction
    const pastedText = this.alignCaretSpacing(formattedText, context.precedingText, context.followingText, appCategory);

    return {
      formattedText,
      pastedText,
      detectedCategory: appCategory,
      rulesApplied,
      latencyMs: Date.now() - startTime,
      provider: providerUsed
    };
  }

  /**
   * Rule-based context formatting engine (IndicFlow Heuristics).
   * @private
   */
  _formatWithHeuristics(rawText, appCategory, context) {
    let text = rawText;
    const rules = [];

    // 0. Sanitize terminal NUL bytes (\u0000 -> space)
    if (text.includes('\u0000')) {
      text = text.replaceAll('\u0000', ' ');
      rules.push('sanitize_nul_bytes');
    }

    // 1. Spoken Punctuation parsing
    const punctResult = this.parseSpokenPunctuation(text);
    if (punctResult.applied) {
      text = punctResult.text;
      rules.push('parse_spoken_punctuation');
    }

    // 2. Environment-specific formatting
    if (appCategory === AppCategory.TERMINAL) {
      const termResult = this.formatTerminalText(text);
      text = termResult.text;
      rules.push(...termResult.rules);
    } else if (appCategory === AppCategory.CODE_EDITOR) {
      const codeResult = this.formatCodeEditorText(text, context.precedingText);
      text = codeResult.text;
      rules.push(...codeResult.rules);
    } else if (appCategory === AppCategory.CHAT) {
      const chatResult = this.formatChatText(text);
      text = chatResult.text;
      rules.push(...chatResult.rules);
    } else {
      // Document / Formal / Generic
      const docResult = this.formatDocumentText(text, context.precedingText);
      text = docResult.text;
      rules.push(...docResult.rules);
    }

    // Clean up excessive internal whitespace while preserving intentional newlines
    text = text.replace(/[ \t]{2,}/g, ' ');

    return { text, rules };
  }

  /**
   * Converts spoken punctuation phrases into standard typography.
   * @param {string} text 
   * @returns {{ text: string, applied: boolean }}
   */
  parseSpokenPunctuation(text) {
    let result = text;
    let applied = false;

    for (const item of SPOKEN_PUNCTUATION) {
      if (item.pattern.test(result)) {
        result = result.replace(item.pattern, item.replacement);
        applied = true;
      }
    }

    // Clean up whitespace around punctuation marks
    // E.g., "hello , world" -> "hello, world", "test ." -> "test."
    result = result
      .replace(/\s+([.,;:!?])/g, '$1')
      .replace(/([(\[\{])\s+/g, '$1')
      .replace(/\s+([)\]\}])/g, '$1')
      .replace(/"\s+([^"]+?)\s+"/g, '"$1"');

    // Bullet formatting cleanup: normalize newlines before bullet and capitalize bullet item
    result = result.replace(/\n\s*\n-\s*/g, '\n- ');
    result = result.replace(/\n-\s*/g, '\n- ');
    result = result.replace(/(\n-\s+)([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase());

    return { text: result, applied };
  }

  /**
   * Terminal / Shell Formatting Rules
   * Lowercase commands, flag formatting (--help, -v), remove trailing period, identifier casing.
   * @param {string} text 
   * @returns {{ text: string, rules: string[] }}
   */
  formatTerminalText(text) {
    let result = text.trim();
    const rules = [];

    // Strip trailing periods, commas, question marks
    if (/[.,?]$/.test(result)) {
      result = result.replace(/[.,?]+$/, '');
      rules.push('strip_terminal_trailing_punctuation');
    }

    // Transform spoken flags: "dash dash [word] [word]" -> "--word-word", e.g. "dash dash dry run" -> "--dry-run"
    result = result.replace(/\b(dash dash|double dash)\s+([a-zA-Z0-9]+)(?:\s+([a-zA-Z0-9]+))?/gi, (m, prefix, w1, w2) => {
      if (w2 && !/^(dash|minus|pipe)$/i.test(w2) && !TERMINAL_COMMANDS.has(w2.toLowerCase())) {
        return '--' + w1.toLowerCase() + '-' + w2.toLowerCase();
      }
      return '--' + w1.toLowerCase() + (w2 ? ' ' + w2 : '');
    });
    // "dash [letter/word]" or "minus [letter/word]" -> "-[letter/word]"
    result = result.replace(/\b(dash|minus)\s+([a-zA-Z0-9_-]+)/gi, '-$2');

    // Identifiers formatting:
    // "camel case [words]" -> e.g. "camel case user profile" -> "userProfile"
    result = result.replace(/\bcamel case\s+([a-zA-Z0-9 ]+?)(?=[.,;!?\n]|$)/gi, (match, words) => {
      return this._toCamelCase(words);
    });

    // "snake case [words]" -> e.g. "snake case user profile" -> "user_profile"
    result = result.replace(/\bsnake case\s+([a-zA-Z0-9 ]+?)(?=[.,;!?\n]|$)/gi, (match, words) => {
      return this._toSnakeCase(words);
    });

    // "kebab case [words]" -> e.g. "kebab case user profile" -> "user-profile"
    result = result.replace(/\bkebab case\s+([a-zA-Z0-9 ]+?)(?=[.,;!?\n]|$)/gi, (match, words) => {
      return this._toKebabCase(words);
    });

    // "constant case [words]" or "screaming snake case [words]" -> e.g. "MAX_RETRY_COUNT"
    result = result.replace(/\b(screaming snake case|constant case)\s+([a-zA-Z0-9 ]+?)(?=[.,;!?\n]|$)/gi, (match, p1, words) => {
      return this._toScreamingSnakeCase(words);
    });

    // "dot [extension]" -> ".[extension]" (e.g. "index dot js" -> "index.js")
    result = result.replace(/(\w+)\s+dot\s+([a-zA-Z0-9]+)/gi, '$1.$2');

    // Lowercase shell command if recognized command root or typical command structure
    const firstWord = (result.split(/\s+/)[0] || '').toLowerCase();
    if (TERMINAL_COMMANDS.has(firstWord) || /^(git|npm|pnpm|yarn|docker|kubectl|cargo|cd|ls|mkdir|rm)\b/i.test(result)) {
      result = result.toLowerCase();
      rules.push('terminal_command_lowercase');
    } else {
      // General shell prompt: keep clean without leading capitalization
      result = result.charAt(0).toLowerCase() + result.slice(1);
      rules.push('terminal_lowercase_start');
    }

    return { text: result, rules };
  }

  /**
   * Code Editor / IDE Formatting Rules
   * @param {string} text 
   * @param {string} [precedingText='']
   */
  formatCodeEditorText(text, precedingText = '') {
    let result = text.trim();
    const rules = ['code_editor_formatting'];

    // Check if user is typing a comment (e.g. precedingText ends with // or /* or #)
    const isComment = /((?:\/\/|#|\/\*)\s*)$/.test(precedingText);

    if (isComment) {
      // Natural comment prose: capitalize first letter, standard punctuation
      result = result.charAt(0).toUpperCase() + result.slice(1);
      rules.push('code_comment_prose');
    } else {
      // Code identifier or expression: strip trailing period
      if (result.endsWith('.')) {
        result = result.slice(0, -1);
        rules.push('strip_trailing_period');
      }
      // Expand common casing requests
      result = result.replace(/\bcamel case\s+([a-zA-Z0-9 ]+?)(?=[.,;!?\n]|$)/gi, (m, w) => this._toCamelCase(w));
      result = result.replace(/\bsnake case\s+([a-zA-Z0-9 ]+?)(?=[.,;!?\n]|$)/gi, (m, w) => this._toSnakeCase(w));
    }

    return { text: result, rules };
  }

  /**
   * Chat / Slack / Discord Formatting Rules
   * Casual, conversational style. No stiff trailing periods on single sentences. Preserves exclamation & questions.
   * @param {string} text 
   */
  formatChatText(text) {
    let result = text.trim();
    const rules = ['chat_casual_formatting'];

    // If single sentence ending with a period, drop the trailing period for casual tone
    if (!result.includes('\n') && !result.includes('. ') && result.endsWith('.')) {
      result = result.slice(0, -1);
      rules.push('omit_casual_trailing_period');
    }

    // Capitalize first character of chat message
    if (result.length > 0) {
      result = result.charAt(0).toUpperCase() + result.slice(1);
    }

    return { text: result, rules };
  }

  /**
   * Document / Word / Outlook Formatting Rules
   * Formal capitalization, periods, commas, paragraph formatting.
   * @param {string} text 
   * @param {string} [precedingText='']
   */
  formatDocumentText(text, precedingText = '') {
    let result = text.trim();
    const rules = ['document_formal_formatting'];

    // Capitalize sentences
    result = result.replace(/(^\s*|[.!?]\s+)([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase());

    // Capitalize days of the week and months
    const properNouns = [
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
      'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
      'September', 'October', 'November', 'December'
    ];
    for (const noun of properNouns) {
      const reg = new RegExp(`\\b${noun}\\b`, 'gi');
      result = result.replace(reg, noun);
    }

    // Ensure closing punctuation if it appears to be a complete sentence (including Indic danda \u0964, \u0965, \u06D4)
    const hasPunctuation = /[.!?।॥۔]$/u.test(result);
    const hasBullets = result.startsWith('-') || result.startsWith('•');

    if (!hasPunctuation && !hasBullets && result.length > 5) {
      // If preceding text was an unfinished sentence, don't force a period here if user might continue
      const isPrecedingUnfinished = precedingText && !/[.!?\n]\s*$/.test(precedingText);
      if (!isPrecedingUnfinished) {
        result += '.';
        rules.push('append_closing_period');
      }
    }

    return { text: result, rules };
  }

  /**
   * Aligns spacing relative to surrounding textbox contents.
   * Avoids double spaces or missing spaces when pasting at active caret.
   * 
   * @param {string} formattedText 
   * @param {string} [precedingText='']
   * @param {string} [followingText='']
   * @param {string} [appCategory='generic']
   * @returns {string} Text ready to paste via synthetic Ctrl+V
   */
  alignCaretSpacing(formattedText, precedingText = '', followingText = '', appCategory = 'generic') {
    if (!formattedText) return '';

    let text = formattedText;
    const preceding = precedingText || '';
    const following = followingText || '';

    // Check casing continuation:
    // If preceding text ends with an unfinished clause (e.g. "because ", "I think that "),
    // do NOT capitalize the first letter.
    if (preceding.length > 0) {
      const endsWithSentencePunct = /[.!?]\s*$/.test(preceding);
      const endsWithNewline = /[\r\n]\s*$/.test(preceding);

      if (!endsWithSentencePunct && !endsWithNewline && appCategory !== AppCategory.TERMINAL) {
        // Lowercase the first character so it seamlessly joins
        text = text.charAt(0).toLowerCase() + text.slice(1);
      }
    }

    // Caret prepended space alignment:
    let prefix = '';
    if (preceding.length > 0) {
      const endsWithWhitespace = /\s$/.test(preceding);
      const endsWithNewline = /[\r\n]$/.test(preceding);

      if (!endsWithWhitespace && !endsWithNewline) {
        // Preceding text has a character with no space (e.g. "Hello" -> paste " world")
        prefix = ' ';
      }
    }

    // Caret appended space alignment:
    // If following text starts with punctuation (e.g. "," or "."), ensure text doesn't end with a space
    if (following.length > 0 && /^[.,;:!?]/.test(following.trimStart())) {
      text = text.trimEnd();
    }

    return prefix + text;
  }

  /**
   * LLM Formatter using IndicFlow's prompt architecture.
   * @private
   */
  async _formatWithLlm(rawText, appCategory, context) {
    const prompt = this._buildPrompt(rawText, appCategory, context);

    if (this.llmProvider === 'groq' && this.groqApiKey) {
      return await this._callGroqLlm(prompt);
    } else if (this.llmProvider === 'openai' && this.openaiApiKey) {
      return await this._callOpenAiLlm(prompt);
    } else if (this.llmProvider === 'gemini' && this.geminiApiKey) {
      return await this._callGeminiLlm(prompt);
    }

    throw new Error(`Configured LLM provider '${this.llmProvider}' is not available.`);
  }

  /**
   * Constructs the structured prompt template.
   * @private
   */
  _buildPrompt(rawText, appCategory, context) {
    return `You are an expert voice-typing text formatter for IndicFlow.
Your task is to convert raw spoken speech into perfectly punctuated, capitalized, and formatted text that fits naturally into the user's active application context.

<ACTIVE_APPLICATION>
Name: ${context.activeApp || 'Unknown'}
Window Title: ${context.windowTitle || 'Unknown'}
Detected Category: ${appCategory}
</ACTIVE_APPLICATION>

<SURROUNDING_TEXT>
Preceding Text: "${(context.precedingText || '').slice(-200)}"
Following Text: "${(context.followingText || '').slice(0, 200)}"
</SURROUNDING_TEXT>

<RAW_SPOKEN_TEXT>
"${rawText}"
</RAW_SPOKEN_TEXT>

<FORMATTING_RULES>
1. If preceding text does not end with punctuation and speech continues the thought, do NOT capitalize the first letter.
2. If in a terminal/code environment, format as clean shell commands (lowercase, flags like --help or -v, snake_case/camelCase), with NO trailing periods.
3. If in Slack or Discord, format as casual conversational text. Omit trailing periods on single sentences.
4. If in Word, Docs, or Outlook, format with standard capitalization, punctuation, and full stops.
5. If user says punctuation words like "comma", "period", "question mark", "new line", "bullet point", format them into actual typography.
6. Return ONLY the exact formatted text to paste. Do not include markdown code fences, quotes, or commentary.
</FORMATTING_RULES>`;
  }

  async _callGroqLlm(prompt) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.groqApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.groqModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 1024
      })
    });
    if (!res.ok) throw new Error(`Groq LLM HTTP ${res.status}`);
    const json = await res.json();
    return (json.choices?.[0]?.message?.content || '').trim();
  }

  async _callOpenAiLlm(prompt) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.openaiModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 1024
      })
    });
    if (!res.ok) throw new Error(`OpenAI LLM HTTP ${res.status}`);
    const json = await res.json();
    return (json.choices?.[0]?.message?.content || '').trim();
  }

  async _callGeminiLlm(prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${this.geminiApiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
      })
    });
    if (!res.ok) throw new Error(`Gemini LLM HTTP ${res.status}`);
    const json = await res.json();
    return (json.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
  }

  // Helper Casing Transformers
  _toCamelCase(str) {
    return str
      .trim()
      .split(/\s+/)
      .map((w, idx) => idx === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('');
  }

  _toSnakeCase(str) {
    return str.trim().split(/\s+/).map(w => w.toLowerCase()).join('_');
  }

  _toKebabCase(str) {
    return str.trim().split(/\s+/).map(w => w.toLowerCase()).join('-');
  }

  _toScreamingSnakeCase(str) {
    return str.trim().split(/\s+/).map(w => w.toUpperCase()).join('_');
  }
}

module.exports = {
  ContextFormatter,
  AppCategory,
  SPOKEN_PUNCTUATION
};
