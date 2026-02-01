# Workshop.AI

Local-first, tool-using agent loop powered by Ollama. Includes a CLI, safe file tools, web search + fetch, and optional push-to-talk speech-to-text.

## Quickstart

### 1) Download
```
git clone https://github.com/etjones22/workshop.ai.git
cd workshop.ai
```

### 2) Setup
Prerequisites:
- Node.js 20+
- Ollama running locally with model `gpt-oss:20b`
- (Optional, for push-to-talk) Python 3 on PATH
- (Optional, for push-to-talk) `sox` or `rec` on PATH for microphone capture

Install dependencies:
```
npm install
```

Build:
```
npm run build
```

Initialize workspace:
```
npm start -- init
```

### 3) Commands
Run (one-shot):
```
npm start -- run "Summarize ./workspace/hello.txt"
```

Chat (interactive):
```
npm start -- chat
```

Chat with push-to-talk:
```
npm start -- chat --push-to-talk
```
Hold **Ctrl + Win** while speaking, release to transcribe and insert text into the prompt.

## Environment Variables

### Search
- `BRAVE_API_KEY` (optional, enables Brave Search; otherwise DuckDuckGo HTML scraping)

### Speech-to-Text
- `STT_ENGINE` = `vosk` | `whisper` | `auto` (default `vosk`)
- `VOSK_MODEL_URL` (optional override for the Vosk model zip)
- `PYTHON_BIN` (optional override for Python path)
- `SOX_BIN` / `REC_BIN` (optional override for audio recorder path)
- `WHISPER_CPP_BIN` / `WHISPER_CPP_MODEL` (if using whisper.cpp)

## Commands
- `workshop init` — create workspace and example files
- `workshop run "<request>"` — one-shot run
- `workshop chat` — interactive chat (default)

## Notes
- The workspace root is `./workspace`. File tools are sandboxed to this directory.
- Sessions are logged to `./.workshop/sessions/*.jsonl`.
- Write tools prompt for confirmation unless `--auto-approve` is used.
