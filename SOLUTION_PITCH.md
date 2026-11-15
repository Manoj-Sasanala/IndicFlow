# IndicFlow — Solution Pitch

## The problem
Typing is the slowest part of working on a computer — and for millions of
Indians, it is worse: two scripts, constant Hinglish code-mixing, and
dictation tools that only understand American English. Existing voice
typing lives inside one app at a time and fails on Hindi-English mix.

## The solution
**IndicFlow** is system-wide voice dictation for Windows. Press `Alt+D`
in *any* application — Notepad, VS Code, WhatsApp Web, Outlook — speak
naturally in English, Hindi, Hinglish, or an Indic language, and your
words are typed at the cursor, formatted for the app you are in. Pause
for 3 seconds and it stops by itself; nothing to click.

## How it works
1. A native Windows helper catches the hotkey and tracks the text caret.
2. A 16 kHz audio pipeline captures speech; voice-activity detection
   auto-stops on a 3-second pause.
3. **Gnani AI Prisma STT v3.0** transcribes with first-class Hinglish
   and Indic-language support.
4. A context engine formats the text (code style for editors, formal
   tone for documents, casual for chat), expands your personal jargon,
   and pastes it at the cursor.

## Why it is fast (measured)
- Warm microphone: live in **~6–7 ms** after the second dictation.
- Capture starts on key-down; caret lookup runs in parallel.
- Session in one line: press → speak → pause → text appears.

## Tech stack
Electron shell · C# native helper (hotkey, caret, paste) · Gnani AI
Prisma STT · Node.js SQLite (WAL) · AudioWorklet + VAD pipeline.

## Who it helps
Students, professionals, and creators who think in Hindi/Hinglish but
type in English — plus anyone with accessibility needs that make
keyboards slow or painful. Fewer keystrokes, zero app-switching, your
own words, instantly typed.
