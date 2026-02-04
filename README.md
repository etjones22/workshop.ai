# Workshop.AI

Local-first, tool-using agent loop powered by Ollama. Includes a CLI, safe file tools, web search + fetch, and optional push-to-talk speech-to-text.

## Quickstart

### 1) Download
```
git clone https://github.com/etjones22/workshop.ai.git
cd workshop.ai
```

### 2) Setup
Windows quick setup (recommended):
```
setup.bat
```

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

Push-to-talk is enabled by default in chat. Disable it with:
```
npm start -- chat --no-push-to-talk
```
Hold **Ctrl + Win** while speaking, release to transcribe and insert text into the prompt.

### 4) Remote Mode (Option B)
Start the server on your machine:
```
npm start -- serve --host 0.0.0.0 --port 8080 --token YOUR_TOKEN --auto-approve
```

Connect from a client machine:
```
npm start -- chat --remote http://YOUR_HOST:8080 --token YOUR_TOKEN --user dev1
```

## Environment Variables

### Search
- `BRAVE_API_KEY` (optional, enables Brave Search; otherwise DuckDuckGo HTML scraping)

### LLM Provider
- `WORKSHOP_LLM_PROVIDER` = `ollama` | `openai`
- `WORKSHOP_BASE_URL` (e.g. `http://localhost:11434/v1` or `https://api.openai.com/v1`)
- `WORKSHOP_API_KEY` (OpenAI key or `ollama`)
- `WORKSHOP_MODEL` (e.g. `glm-4.7-flash` or `gpt-4o-mini`)

### Speech-to-Text
- `STT_ENGINE` = `vosk` | `whisper` | `auto` (default `vosk`)
- `VOSK_MODEL_URL` (optional override for the Vosk model zip)
- `PYTHON_BIN` (optional override for Python path)
- `SOX_BIN` / `REC_BIN` (optional override for audio recorder path)
- `WHISPER_CPP_BIN` / `WHISPER_CPP_MODEL` (if using whisper.cpp)

## Config
Configuration can be set via `workshop.config.json` in the repo root (or `./.workshop/config.json`). Precedence: CLI flags > env vars > config file > defaults.

Example:
```
{
  "llm": {
    "provider": "ollama",
    "baseUrl": "http://localhost:11434/v1",
    "apiKey": "ollama",
    "model": "glm-4.7-flash"
  },
  "agent": {
    "autoApprove": false,
    "maxSteps": 12
  },
  "updates": {
    "checkOnStart": true
  },
  "speech": {
    "enabled": true
  },
  "server": {
    "host": "0.0.0.0",
    "port": 8080,
    "token": ""
  }
}
```

## Commands
- `workshop init` -- create workspace and example files
- `workshop run "<request>"` -- one-shot run
- `workshop chat` -- interactive chat (default)

## Updates
Auto-update runs on startup (unless disabled) and will count down before pulling.

Force update to the latest remote (discard local changes):
```
git fetch origin
git reset --hard origin/main
```
Optional cleanup of untracked files:
```
git clean -fd
```

## Notes
- The workspace root is `./workspace`. File tools are sandboxed to this directory.
- Sessions are logged to `./.workshop/sessions/*.jsonl`.
- Write tools prompt for confirmation unless `--auto-approve` is used.
