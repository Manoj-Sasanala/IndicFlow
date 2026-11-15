# IndicFlow 🎙️🇮🇳

> **High-Performance System-Wide AI Voice Dictation & Workflow Companion for Windows, natively powered by Gnani AI's Prisma STT v3.0.**

Built for **The Great Indian AI Internship Challenge** by **Gnani AI**.

---

## 🌟 Overview

**IndicFlow** brings seamless, voice-first intelligence directly to any Windows application. Whether you are drafting messages in WhatsApp Web, writing code in VS Code, composing emails in Outlook, or taking notes in Notion, IndicFlow allows you to speak naturally in **English, Hindi, Hinglish, and Indic regional languages**, instantly typing the formatted transcription right at your cursor.

Powered natively by **Gnani AI's Prisma STT (v3.0)** running on the high-performance **Vachana AI Platform** (`api.vachana.ai`), IndicFlow bridges cutting-edge Indian language voice AI with low-latency Windows desktop architecture.

---

## ✨ Key Features

- **🇮🇳 Powered by Gnani AI Prisma STT (v3.0)**:
  - First-class support for **Hinglish** (code-mixed Hindi + English) and auto-detected Indic languages (`indic-auto`).
  - Supports Hindi, Indian English, Telugu, Tamil, Kannada, Marathi, and Bengali.
  - Direct REST integration (`POST /stt/v3`) with sub-second processing latency.
- **🎯 System-Wide Windows Caret Tracking**:
  - A discreet, floating pill HUD dynamically positions itself right next to your active text caret across any application using Windows UI Automation (`UIAutomationCore`).
- **⚡ Global Hotkey & Push-to-Talk**:
  - Native C# input engine (`FlowHelper.exe`) supporting `Alt + D` (default) for push-to-talk activation. Capture starts on key-down; tap again (or release a hold) to stop.

## ⚡ Performance (measured on a dev machine, i7/16GB, Windows 11)

- **Warm microphone**: the capture device stays open between dictations, so the mic is live **~6–7 ms** after you press the hotkey (vs 270–540 ms for a cold device open). The first dictation after launch pays a one-time ~0.5 s device open.
- **Key-down capture**: recording starts the instant the hotkey goes down; the caret-position lookup runs in parallel instead of blocking the mic.
- **Silence auto-stop (VAD)**: pause for **3 seconds** and dictation stops by itself — no second keypress needed. 8 s timeout if you never speak, 60 s hard cap per session.
- **End to end**: press → pill instantly → speak → ~3 s pause → cloud transcription (~0.4–2 s depending on clip length) → text pasted at the cursor.
- **🧠 Context-Aware Formatting & Command Mode**:
  - Automatically formats spoken speech based on the active application context:
    - **Terminals (pwsh, bash, wt)**: Shell command sanitization, flags (`-m`, `--help`), camelCase and snake_case formatting.
    - **Documents (Word, Outlook)**: Formal capitalization, punctuation, and grammar polish.
    - **Chat (Slack, Discord, WhatsApp)**: Natural conversational flow.
  - **Voice Actions**: Say *"make it bullet points"* or *"translate to Hindi"* to transform text on the fly.
- **📚 Personalization & Custom Jargon Expansion**:
  - Auto-learning user dictionary expands acronyms, technical jargon, and team phrases (e.g., *"k8s"* $\rightarrow$ *"Kubernetes"*).
- **🛡️ 100% Clean-Room Architecture**:
  - Built from scratch with an independent Electron 42 shell, Node.js SQLite (`node:sqlite`) with WAL mode, and lightweight C# native supervisor.

---

## 🏗️ System Architecture

```mermaid
flowchart TD
    User([🎙️ User Speaks]) -->|Global Hotkey / UI Click| AudioCapture[Audio Capture Pipeline\n16kHz 16-bit Mono WAV]
    AudioCapture --> SilenceCheck{Silence Detection / RMS}
    SilenceCheck -->|Audible Speech| GnaniAPI[Gnani AI Prisma STT v3.0\nhttps://api.vachana.ai/stt/v3]
    SilenceCheck -->|Zero Energy| Discard[Short-circuit Save Credits]
    
    GnaniAPI -->|Transcribed Text| ContextEngine[Context-Aware NLP Engine\nApp Detection & Jargon Expansion]
    ContextEngine -->|Formatted Text| NativeHelper[FlowHelper.exe Native Windows IPC\nWin32 SendInput / UIAutomation]
    NativeHelper -->|Direct Caret Injection| ActiveApp([💻 Notepad / Chrome / WhatsApp / VS Code])
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Windows 10 / 11** (64-bit)
- **Node.js v22.5+** (v24 verified) — the app and tests use `node:sqlite`, which does not exist in Node 20
- A **Gnani AI API Key** from [app.gnani.ai](https://app.gnani.ai) (5,000 free credits available)

### 2. Installation
```powershell
# Clone the repository
git clone https://github.com/Manoj-Sasanala/IndicFlow.git
cd IndicFlow

# Install dependencies
npm install

# npm 11+ only: if npm asks to review Electron's install script, approve it
# (already pre-approved in package.json; run only if `npm start` reports a missing Electron binary)
npm install-scripts approve electron
```

### 3. Configure Your Gnani API Key
Launch the app once (`npm start`), open the Hub, and paste your key into the
**Gnani API Key** field. It saves automatically and takes effect immediately —
no restart needed. (The app does not read `.env` at runtime; `.env` is only
used by the `npm run test:gnani` live-API check, where you can set
`GNANI_API_KEY` in your shell.)

### 4. Run Verification Tests
IndicFlow comes with an exhaustive test suite covering native helper IPC, audio pipelines, SQLite persistence, and Gnani API integration:
```powershell
# Run the test suites
npm test
npm run test:services
npm run test:native

# Test live connection to Gnani AI Prisma STT API (requires GNANI_API_KEY)
npm run test:gnani
```

### 5. Launch IndicFlow
```powershell
npm start
```
*Or on Windows, simply double-click **`run.bat`**.*
- Open any app (e.g., Notepad, WhatsApp, or Chrome).
- Press the hotkey (default: **`Alt + D`**, changeable in Settings) or click the floating pill.
- Speak in Hindi, Hinglish, or English:
  > *"Kal subah 10 baje team meeting schedule karni hai."*
- Watch IndicFlow transcribe and paste your speech in real time!

---

## 🧪 Test Coverage

| Test Suite | Components Tested | Pass Rate |
| :--- | :--- | :--- |
| **Desktop Client Tests** | Electron window manager, SQLite WAL mode, notes, dictionary, IPC | **53 / 53 PASS** |
| **AI & Audio Services** | 16kHz downsampling, AudioChunker, RMS silence gate, Context Formatter, Command Classifier, Gnani STT provider, hotkey event contract, null-audio stop guard | **38 / 38 PASS** |
| **E2E Integration** | FlowHelper native IPC, active window caret tracking, end-to-end dictation lifecycle | **8 / 8 PASS** |
| **Native Helper** | Hotkey hook, UIA context extraction, clipboard paste injection, clean exit | **31 / 31 PASS** |
| **Gnani Live STT** | Live ping to `api.vachana.ai/stt/v3` with `prisma-v3.0` | **PASS (200 OK)** |

---

## 🛠️ Tech Stack

- **Speech Recognition Engine**: [Gnani AI](https://gnani.ai) Prisma STT v3.0 / Vachana AI REST API
- **Application Shell**: Electron v42.11.18
- **Native OS Layer**: Win32 C# (`FlowHelper.exe`, Windows UI Automation, Virtual Key Injection)
- **Local Persistence**: `node:sqlite` DatabaseSync with Write-Ahead Logging (WAL)
- **Audio Processing**: High-speed Float32/Int16 PCM streaming buffer, RMS speech detector

---

## 📜 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgements

- **[Gnani AI](https://gnani.ai)** for providing their state-of-the-art **Prisma STT** voice models and hosting the **Great Indian AI Internship Challenge**.

